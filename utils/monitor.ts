// Change monitor: recording settings, scope matching and a batched log writer.
// Recording is opt-in, and while it is on each change is kept only in local extension storage.

export type MonitorScope = 'all' | 'site';

export interface MonitorSettings {
  recording: boolean;
  scope: MonitorScope;
  /** Host the 'site' scope is pinned to, e.g. "app.example.com". */
  site: string;
}

export const DEFAULT_MONITOR: MonitorSettings = { recording: false, scope: 'all', site: '' };

export const DEFAULT_MAX_LOG = 500;
export const MIN_MAX_LOG = 50;
export const MAX_MAX_LOG = 1000;
export const FLUSH_INTERVAL_MS = 1000;

export function normalizeMonitorSettings(raw: unknown): MonitorSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<MonitorSettings>;
  const site = typeof r.site === 'string' ? r.site.trim().toLowerCase() : '';
  const scope: MonitorScope = r.scope === 'site' && site ? 'site' : 'all';
  return { recording: r.recording === true, scope, site };
}

export function clampMaxLog(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return DEFAULT_MAX_LOG;
  return Math.min(MAX_MAX_LOG, Math.max(MIN_MAX_LOG, Math.round(n)));
}

/**
 * True when a cookie on `cookieDomain` concerns pages on `site`: the same host, a parent domain
 * whose cookies the site receives, or a subdomain of the site.
 */
export function domainMatchesSite(cookieDomain: string, site: string): boolean {
  const d = cookieDomain.replace(/^\./, '').toLowerCase();
  const s = site.replace(/^\./, '').toLowerCase();
  if (!d || !s) return false;
  return d === s || s.endsWith('.' + d) || d.endsWith('.' + s);
}

export function shouldRecord(settings: MonitorSettings, cookieDomain: string): boolean {
  if (!settings.recording) return false;
  if (settings.scope === 'site') return domainMatchesSite(cookieDomain, settings.site);
  return true;
}

/** Prepend a batch (oldest first, as received) to a newest-first log and cap its length. */
export function mergeLog<T>(existing: T[], batchOldestFirst: T[], cap: number): T[] {
  const merged = [...batchOldestFirst].reverse().concat(existing);
  if (merged.length > cap) merged.length = cap;
  return merged;
}

export interface LogBufferDeps<T> {
  read: () => Promise<T[]>;
  write: (log: T[]) => Promise<void>;
  maxEntries: () => number;
  intervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Collects change entries in memory and writes them in one storage read+write at most once per
 * interval. Flushes run one at a time, so a burst of changes can't interleave get→set pairs and
 * drop entries.
 */
export class ChangeLogBuffer<T> {
  private queue: T[] = [];
  private timer: unknown = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(private deps: LogBufferDeps<T>) {}

  get pending(): number {
    return this.queue.length;
  }

  push(entry: T): void {
    this.queue.push(entry);
    if (this.timer === null) {
      const set = this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
      this.timer = set(() => {
        this.timer = null;
        void this.flush();
      }, this.deps.intervalMs ?? FLUSH_INTERVAL_MS);
    }
  }

  /** Drop anything queued (used when the log is cleared). */
  discard(): void {
    this.queue = [];
  }

  flush(): Promise<void> {
    this.chain = this.chain.then(() => this.writeBatch());
    return this.chain;
  }

  private async writeBatch(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    try {
      const existing = await this.deps.read();
      await this.deps.write(mergeLog(existing, batch, this.deps.maxEntries()));
    } catch {
      // Keep the entries for the next flush rather than losing them.
      this.queue = batch.concat(this.queue).slice(-this.deps.maxEntries());
    }
  }
}
