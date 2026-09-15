import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ChangeLogBuffer, DEFAULT_MONITOR, DEFAULT_MAX_LOG, normalizeMonitorSettings, clampMaxLog,
  domainMatchesSite, shouldRecord, mergeLog,
} from '../utils/monitor';

describe('normalizeMonitorSettings', () => {
  it('defaults to not recording', () => {
    expect(normalizeMonitorSettings(undefined)).toEqual(DEFAULT_MONITOR);
    expect(normalizeMonitorSettings('garbage')).toEqual(DEFAULT_MONITOR);
    expect(DEFAULT_MONITOR.recording).toBe(false);
  });

  it('records only when recording is exactly true', () => {
    expect(normalizeMonitorSettings({ recording: 'yes' }).recording).toBe(false);
    expect(normalizeMonitorSettings({ recording: true }).recording).toBe(true);
  });

  it('falls back to all sites when the site scope has no site', () => {
    expect(normalizeMonitorSettings({ recording: true, scope: 'site', site: '' }).scope).toBe('all');
  });

  it('keeps a site scope, lower-cased', () => {
    expect(normalizeMonitorSettings({ recording: true, scope: 'site', site: ' App.Example.com ' }))
      .toEqual({ recording: true, scope: 'site', site: 'app.example.com' });
  });
});

describe('clampMaxLog', () => {
  it('defaults non-numbers', () => {
    expect(clampMaxLog(undefined)).toBe(DEFAULT_MAX_LOG);
    expect(clampMaxLog('abc')).toBe(DEFAULT_MAX_LOG);
  });

  it('clamps to the allowed range', () => {
    expect(clampMaxLog(5)).toBe(50);
    expect(clampMaxLog(99999)).toBe(1000);
    expect(clampMaxLog('250')).toBe(250);
  });
});

describe('domainMatchesSite', () => {
  it('matches the same host, parent domains and subdomains', () => {
    expect(domainMatchesSite('app.example.com', 'app.example.com')).toBe(true);
    expect(domainMatchesSite('.example.com', 'app.example.com')).toBe(true);
    expect(domainMatchesSite('api.app.example.com', 'app.example.com')).toBe(true);
  });

  it('rejects unrelated and lookalike domains', () => {
    expect(domainMatchesSite('notexample.com', 'example.com')).toBe(false);
    expect(domainMatchesSite('example.com.evil.test', 'example.com')).toBe(false);
    expect(domainMatchesSite('', 'example.com')).toBe(false);
  });
});

describe('shouldRecord', () => {
  it('records nothing while off', () => {
    expect(shouldRecord({ recording: false, scope: 'all', site: '' }, 'example.com')).toBe(false);
  });

  it('records everything with the all-sites scope', () => {
    expect(shouldRecord({ recording: true, scope: 'all', site: '' }, 'tracker.test')).toBe(true);
  });

  it('records only the pinned site with the site scope', () => {
    const s = { recording: true, scope: 'site' as const, site: 'app.example.com' };
    expect(shouldRecord(s, '.example.com')).toBe(true);
    expect(shouldRecord(s, 'tracker.test')).toBe(false);
  });
});

describe('mergeLog', () => {
  it('puts the batch newest-first ahead of the existing log', () => {
    expect(mergeLog([2, 1], [3, 4], 10)).toEqual([4, 3, 2, 1]);
  });

  it('caps the length, dropping the oldest', () => {
    expect(mergeLog([3, 2, 1], [4, 5], 4)).toEqual([5, 4, 3, 2]);
  });
});

function harness(initial: number[] = [], cap = 500) {
  const state = { stored: initial.slice(), writes: 0, timers: 0, failNext: false };
  let pendingTimer: (() => void) | null = null;
  const buffer = new ChangeLogBuffer<number>({
    read: async () => state.stored.slice(),
    write: async (log) => {
      if (state.failNext) {
        state.failNext = false;
        throw new Error('quota');
      }
      state.writes++;
      state.stored = log;
    },
    maxEntries: () => cap,
    setTimer: (fn) => {
      state.timers++;
      pendingTimer = fn;
      return state.timers;
    },
  });
  const fireTimer = async () => {
    const fn = pendingTimer;
    pendingTimer = null;
    fn?.();
    await buffer.flush();
  };
  return { buffer, state, fireTimer };
}

describe('ChangeLogBuffer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('turns a burst of changes into one timer and one write', async () => {
    const { buffer, state, fireTimer } = harness();
    for (let i = 0; i < 100; i++) buffer.push(i);
    expect(state.writes).toBe(0);
    expect(state.timers).toBe(1);
    await fireTimer();
    expect(state.writes).toBe(1);
    expect(state.stored).toHaveLength(100);
    expect(state.stored[0]).toBe(99);
  });

  it('adds to the existing log and caps it', async () => {
    const { buffer, state, fireTimer } = harness([2, 1], 3);
    buffer.push(3);
    buffer.push(4);
    await fireTimer();
    expect(state.stored).toEqual([4, 3, 2]);
  });

  it('loses nothing when changes arrive while a flush is reading storage', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let stored: number[] = [];
    const buffer = new ChangeLogBuffer<number>({
      read: async () => {
        await gate;
        return stored.slice();
      },
      write: async (log) => {
        stored = log;
      },
      maxEntries: () => 500,
      setTimer: () => 0,
    });
    buffer.push(1);
    const first = buffer.flush();
    buffer.push(2);
    const second = buffer.flush();
    release();
    await first;
    await second;
    expect(stored).toEqual([2, 1]);
  });

  it('keeps a batch whose write failed for the next flush', async () => {
    const { buffer, state } = harness();
    state.failNext = true;
    buffer.push(1);
    await buffer.flush();
    expect(state.writes).toBe(0);
    expect(buffer.pending).toBe(1);
    await buffer.flush();
    expect(state.stored).toEqual([1]);
  });

  it('discards queued entries when the log is cleared', async () => {
    const { buffer, state } = harness();
    buffer.push(1);
    buffer.discard();
    await buffer.flush();
    expect(state.writes).toBe(0);
  });

  it('arms a new timer for changes after a flush', async () => {
    const { buffer, state, fireTimer } = harness();
    buffer.push(1);
    await fireTimer();
    buffer.push(2);
    expect(state.timers).toBe(2);
  });

  it('writes at most once a second with the default timer', async () => {
    vi.useFakeTimers();
    let writes = 0;
    const buffer = new ChangeLogBuffer<number>({
      read: async () => [],
      write: async () => {
        writes++;
      },
      maxEntries: () => 500,
    });
    buffer.push(1);
    await vi.advanceTimersByTimeAsync(999);
    buffer.push(2);
    expect(writes).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toBe(1);
  });
});
