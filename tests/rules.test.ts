import { describe, it, expect } from 'vitest';
import {
  EMPTY_RULES, blockId, protectRuleFor, blockRuleFor, normalizeRules, findProtectRule, findBlockRule,
  blockRulesForHost, withProtect, withoutProtect, withBlock, withoutBlock, matchesLockedState,
  decideRuleAction, WriteGuard,
} from '../utils/rules';
import type { Rules } from '../utils/rules';
import type { CookieLike } from '../utils/cookies';
import { cookieIdentity } from '../utils/writes';

const NOW = 1_800_000_000;
const cookie = (over: Partial<CookieLike> = {}): CookieLike => ({
  name: 'consent', value: 'granted', domain: 'shop.example.com', hostOnly: true, path: '/', secure: true,
  httpOnly: false, sameSite: 'lax', session: false, expirationDate: NOW + 86400, storeId: '0', ...over,
});

describe('rule construction', () => {
  it('protects by jar identity and keeps a clean copy of the locked state', () => {
    const rule = protectRuleFor({ ...cookie(), partitionKey: null }, 5);
    expect(rule.id).toBe(cookieIdentity(cookie()));
    expect(rule.cookie).toEqual({
      name: 'consent', value: 'granted', domain: 'shop.example.com', hostOnly: true, path: '/', secure: true,
      httpOnly: false, sameSite: 'lax', session: false, expirationDate: NOW + 86400, storeId: '0',
    });
    expect(rule.createdAt).toBe(5);
  });

  it('blocks by name and host, ignoring a leading dot and case', () => {
    const rule = blockRuleFor({ name: '_ga', domain: '.Example.com' }, 1);
    expect(rule).toEqual({ id: blockId('_ga', 'example.com'), name: '_ga', domain: 'example.com', createdAt: 1 });
    expect(findBlockRule({ ...EMPTY_RULES, block: [rule] }, { name: '_ga', domain: 'example.com' })).toBe(rule);
    expect(findBlockRule({ ...EMPTY_RULES, block: [rule] }, { name: '_gid', domain: 'example.com' })).toBeUndefined();
  });

  it('adds, replaces and removes rules without mutating', () => {
    const p = protectRuleFor(cookie(), 1);
    const b = blockRuleFor(cookie({ name: 'track' }), 1);
    let rules: Rules = withProtect(EMPTY_RULES, p);
    rules = withProtect(rules, { ...p, createdAt: 2 });
    rules = withBlock(rules, b);
    expect(rules.protect).toHaveLength(1);
    expect(rules.protect[0]!.createdAt).toBe(2);
    expect(withoutBlock(withoutProtect(rules, p.id), b.id)).toEqual(EMPTY_RULES);
    expect(EMPTY_RULES).toEqual({ protect: [], block: [] });
  });

  it('normalises stored rules, dropping malformed entries', () => {
    const good = protectRuleFor(cookie(), 1);
    expect(normalizeRules({ protect: [good, { id: 1 }, null], block: [{ id: 'x', name: 'n', domain: 'd.com', createdAt: 1 }, { name: 'x' }] }))
      .toEqual({ protect: [good], block: [{ id: 'x', name: 'n', domain: 'd.com', createdAt: 1 }] });
    expect(normalizeRules(undefined)).toEqual({ protect: [], block: [] });
  });

  it('finds block rules that concern a page host', () => {
    const rules: Rules = {
      protect: [],
      block: [blockRuleFor({ name: 'a', domain: 'example.com' }, 1), blockRuleFor({ name: 'b', domain: 'cdn.example.com' }, 1), blockRuleFor({ name: 'c', domain: 'other.test' }, 1)],
    };
    expect(blockRulesForHost(rules, 'example.com').map((r) => r.name)).toEqual(['a', 'b']);
    expect(blockRulesForHost(rules, 'shop.example.com').map((r) => r.name)).toEqual(['a']);
  });
});

describe('matchesLockedState', () => {
  it('ignores sub-second expiry noise and store fields', () => {
    expect(matchesLockedState(cookie({ expirationDate: NOW + 10.2 }), cookie({ expirationDate: NOW + 10.4, storeId: '1' }))).toBe(true);
  });

  it('notices a changed value, flag or expiry', () => {
    expect(matchesLockedState(cookie(), cookie({ value: 'denied' }))).toBe(false);
    expect(matchesLockedState(cookie(), cookie({ httpOnly: true }))).toBe(false);
    expect(matchesLockedState(cookie(), cookie({ sameSite: 'strict' }))).toBe(false);
    expect(matchesLockedState(cookie(), cookie({ expirationDate: NOW + 5 }))).toBe(false);
    expect(matchesLockedState(cookie(), cookie({ session: true, expirationDate: null }))).toBe(false);
  });
});

describe('decideRuleAction', () => {
  const locked = protectRuleFor(cookie(), 1);
  const rules: Rules = { protect: [locked], block: [blockRuleFor({ name: '_fbp', domain: '.example.com' }, 1)] };

  it('restores a protected cookie a site changed', () => {
    expect(decideRuleAction({ removed: false, cause: 'explicit', cookie: cookie({ value: 'denied' }) }, rules, NOW))
      .toEqual({ type: 'restore', rule: locked });
  });

  it('restores a protected cookie a site deleted or expired early', () => {
    for (const cause of ['explicit', 'expired', 'evicted', 'expired_overwrite']) {
      expect(decideRuleAction({ removed: true, cause, cookie: cookie() }, rules, NOW).type).toBe('restore');
    }
  });

  it('waits for the new-value event instead of reacting to the overwrite removal', () => {
    expect(decideRuleAction({ removed: true, cause: 'overwrite', cookie: cookie() }, rules, NOW)).toEqual({ type: 'none' });
  });

  it('does nothing when the protected cookie is set back to its locked state', () => {
    expect(decideRuleAction({ removed: false, cause: 'explicit', cookie: cookie() }, rules, NOW)).toEqual({ type: 'none' });
  });

  it('lets a protected cookie go once its own expiry has passed', () => {
    expect(decideRuleAction({ removed: true, cause: 'expired', cookie: cookie() }, rules, NOW + 86400)).toEqual({ type: 'none' });
  });

  it('removes a blocked cookie when a site sets it, on the rule host only', () => {
    const tracker = cookie({ name: '_fbp', domain: '.example.com', hostOnly: false });
    expect(decideRuleAction({ removed: false, cause: 'explicit', cookie: tracker }, rules, NOW)).toMatchObject({ type: 'remove', cookie: tracker });
    expect(decideRuleAction({ removed: true, cause: 'explicit', cookie: tracker }, rules, NOW)).toEqual({ type: 'none' });
    expect(decideRuleAction({ removed: false, cause: 'explicit', cookie: { ...tracker, domain: 'other.test' } }, rules, NOW)).toEqual({ type: 'none' });
  });

  it('protect only applies to the exact jar entry', () => {
    expect(decideRuleAction({ removed: false, cause: 'explicit', cookie: cookie({ path: '/cart', value: 'x' }) }, rules, NOW)).toEqual({ type: 'none' });
    expect(findProtectRule(rules, cookie({ domain: '.shop.example.com', hostOnly: false }))).toBeUndefined();
  });
});

describe('WriteGuard', () => {
  it('ignores exactly the event its own set produces, once', () => {
    let t = 0;
    const guard = new WriteGuard(() => t);
    guard.expectSet('id', 'granted');
    expect(guard.isOwnWrite('id', true, 'old')).toBe(false); // the overwrite removal is not the expected event
    expect(guard.isOwnWrite('id', false, 'granted')).toBe(true);
    expect(guard.isOwnWrite('id', false, 'granted')).toBe(false);
  });

  it('still sees a site write that arrives right after the extension wrote', () => {
    let t = 0;
    const guard = new WriteGuard(() => t);
    guard.expectSet('id', 'granted');
    t = 100;
    expect(guard.isOwnWrite('id', false, 'denied')).toBe(false);
    expect(guard.isOwnWrite('id', false, 'granted')).toBe(true);
  });

  it('matches removals separately from sets, per cookie', () => {
    const guard = new WriteGuard(() => 0);
    guard.expectRemove('a');
    expect(guard.isOwnWrite('b', true, '')).toBe(false);
    expect(guard.isOwnWrite('a', false, 'x')).toBe(false);
    expect(guard.isOwnWrite('a', true, 'x')).toBe(true);
    expect(guard.isOwnWrite('a', true, 'x')).toBe(false);
  });

  it('forgets an expectation whose event never came', () => {
    let t = 0;
    const guard = new WriteGuard(() => t, 3000);
    guard.expectSet('id', 'v');
    t = 3001;
    expect(guard.isOwnWrite('id', false, 'v')).toBe(false);
  });

  it('stops restoring a cookie a page rewrites in a loop, and resumes after the window', () => {
    let t = 0;
    const guard = new WriteGuard(() => t, 3000, 3, 10_000);
    expect([guard.allowRestore('id'), guard.allowRestore('id'), guard.allowRestore('id')]).toEqual([true, true, true]);
    t = 5000;
    expect(guard.allowRestore('id')).toBe(false);
    expect(guard.allowRestore('other')).toBe(true);
    t = 10_001;
    expect(guard.allowRestore('id')).toBe(true);
    expect(guard.restoreWindowMs).toBe(10_000);
  });
});
