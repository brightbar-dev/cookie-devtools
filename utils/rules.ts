// Protect and Block: per-cookie rules the background enforces as cookies change.
// Protect puts a cookie back the way it was saved whenever a site changes or deletes it;
// Block deletes a cookie whenever a site sets it.
import { cookieHost } from './cookies';
import type { CookieLike } from './cookies';
import { cookieIdentity, isExpired } from './writes';

export interface ProtectRule {
  id: string;
  cookie: CookieLike;
  createdAt: number;
}

export interface BlockRule {
  id: string;
  name: string;
  /** Host the cookie lives on, without a leading dot. */
  domain: string;
  createdAt: number;
}

export interface Rules {
  protect: ProtectRule[];
  block: BlockRule[];
}

export const EMPTY_RULES: Rules = { protect: [], block: [] };

export function blockId(name: string, domain: string): string {
  return JSON.stringify([cookieHost(domain).toLowerCase(), name]);
}

/** The attributes a protected cookie is kept at; volatile read-only fields are left out. */
function lockedCopy(cookie: CookieLike): CookieLike {
  const copy: CookieLike = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    hostOnly: cookie.hostOnly,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    session: cookie.session,
    expirationDate: cookie.session ? null : cookie.expirationDate ?? null,
  };
  if (cookie.storeId) copy.storeId = cookie.storeId;
  if (cookie.partitionKey?.topLevelSite) copy.partitionKey = { ...cookie.partitionKey };
  return copy;
}

export function protectRuleFor(cookie: CookieLike, now: number): ProtectRule {
  return { id: cookieIdentity(cookie), cookie: lockedCopy(cookie), createdAt: now };
}

export function blockRuleFor(cookie: Pick<CookieLike, 'name' | 'domain'>, now: number): BlockRule {
  const domain = cookieHost(cookie.domain).toLowerCase();
  return { id: blockId(cookie.name, domain), name: cookie.name, domain, createdAt: now };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

export function normalizeRules(raw: unknown): Rules {
  if (!isRecord(raw)) return { protect: [], block: [] };
  const protect = Array.isArray(raw.protect)
    ? raw.protect.filter((r): r is ProtectRule => isRecord(r) && typeof r.id === 'string' && isRecord(r.cookie) && typeof r.cookie.name === 'string')
    : [];
  const block = Array.isArray(raw.block)
    ? raw.block.filter((r): r is BlockRule => isRecord(r) && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.domain === 'string')
    : [];
  return { protect, block };
}

export function findProtectRule(rules: Rules, cookie: CookieLike): ProtectRule | undefined {
  const id = cookieIdentity(cookie);
  return rules.protect.find((r) => r.id === id);
}

export function findBlockRule(rules: Rules, cookie: Pick<CookieLike, 'name' | 'domain'>): BlockRule | undefined {
  const id = blockId(cookie.name, cookie.domain);
  return rules.block.find((r) => r.id === id);
}

/** Block rules that concern a page on `host`: its own cookies, its parents' and its subdomains'. */
export function blockRulesForHost(rules: Rules, host: string): BlockRule[] {
  const h = host.toLowerCase();
  return rules.block.filter((r) => h === r.domain || h.endsWith('.' + r.domain) || r.domain.endsWith('.' + h));
}

export function withProtect(rules: Rules, rule: ProtectRule): Rules {
  return { ...rules, protect: [...rules.protect.filter((r) => r.id !== rule.id), rule] };
}

export function withoutProtect(rules: Rules, id: string): Rules {
  return { ...rules, protect: rules.protect.filter((r) => r.id !== id) };
}

export function withBlock(rules: Rules, rule: BlockRule): Rules {
  return { ...rules, block: [...rules.block.filter((r) => r.id !== rule.id), rule] };
}

export function withoutBlock(rules: Rules, id: string): Rules {
  return { ...rules, block: rules.block.filter((r) => r.id !== id) };
}

/** Whether a cookie as it is now still matches the state it was protected at. */
export function matchesLockedState(locked: CookieLike, current: CookieLike): boolean {
  const expiry = (c: CookieLike) => (c.session || !c.expirationDate ? null : Math.round(c.expirationDate));
  return locked.value === current.value &&
    locked.secure === current.secure &&
    locked.httpOnly === current.httpOnly &&
    (locked.sameSite || 'unspecified') === (current.sameSite || 'unspecified') &&
    !!locked.session === !!current.session &&
    expiry(locked) === expiry(current);
}

export interface CookieChange {
  removed: boolean;
  cause: string;
  cookie: CookieLike;
}

export type RuleAction =
  | { type: 'none' }
  | { type: 'restore'; rule: ProtectRule }
  | { type: 'remove'; rule: BlockRule; cookie: CookieLike };

const NONE: RuleAction = { type: 'none' };

export function decideRuleAction(change: CookieChange, rules: Rules, nowSeconds: number): RuleAction {
  const protect = findProtectRule(rules, change.cookie);
  if (protect) {
    // A locked cookie that has reached its own expiry is allowed to go.
    if (isExpired(protect.cookie, nowSeconds)) return NONE;
    if (change.removed) {
      // An overwrite is followed by an event for the new value; judge that one instead.
      return change.cause === 'overwrite' ? NONE : { type: 'restore', rule: protect };
    }
    return matchesLockedState(protect.cookie, change.cookie) ? NONE : { type: 'restore', rule: protect };
  }
  if (!change.removed) {
    const block = findBlockRule(rules, change.cookie);
    if (block) return { type: 'remove', rule: block, cookie: change.cookie };
  }
  return NONE;
}

/**
 * Keeps rule enforcement from reacting to the extension's own writes, and from fighting a page
 * that rewrites a protected cookie in a loop. Each write registers the one change event it will
 * cause, and only that event is ignored — a site write moments later is still seen.
 */
export class WriteGuard {
  private pending = new Map<string, Array<{ removed: boolean; value?: string; until: number }>>();
  private restores = new Map<string, number[]>();

  constructor(
    private now: () => number = Date.now,
    private ttlMs = 3000,
    private maxRestores = 5,
    private windowMs = 10_000,
  ) {}

  /** The extension is about to set this cookie to `value`. */
  expectSet(identity: string, value: string): void {
    this.add(identity, { removed: false, value });
  }

  /** The extension is about to remove this cookie (or set it already expired). */
  expectRemove(identity: string): void {
    this.add(identity, { removed: true });
  }

  private add(identity: string, expected: { removed: boolean; value?: string }): void {
    const t = this.now();
    const list = (this.pending.get(identity) ?? []).filter((e) => e.until >= t);
    list.push({ ...expected, until: t + this.ttlMs });
    this.pending.set(identity, list);
  }

  /** True, once per registered write, for the change event that write produces. */
  isOwnWrite(identity: string, removed: boolean, value: string): boolean {
    const t = this.now();
    const list = (this.pending.get(identity) ?? []).filter((e) => e.until >= t);
    const index = list.findIndex((e) => e.removed === removed && (removed || e.value === value));
    if (index >= 0) list.splice(index, 1);
    if (list.length) this.pending.set(identity, list);
    else this.pending.delete(identity);
    return index >= 0;
  }

  /** Counts a restore; false once a cookie has been put back too often within the window. */
  allowRestore(identity: string): boolean {
    const t = this.now();
    const recent = (this.restores.get(identity) ?? []).filter((at) => t - at < this.windowMs);
    const allowed = recent.length < this.maxRestores;
    if (allowed) recent.push(t);
    this.restores.set(identity, recent);
    return allowed;
  }

  get restoreWindowMs(): number {
    return this.windowMs;
  }
}
