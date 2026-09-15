// Shapes of the background's replies, shared by the background and every page that talks to it.
import type { CookieLike } from './cookies';
import type { BlockRule, ProtectRule } from './rules';

export interface Failure {
  name: string;
  domain?: string;
  error: string;
}

export interface RemoveResult {
  removed: CookieLike[];
  failed: Failure[];
}

export interface WriteReport {
  written: CookieLike[];
  expired: string[];
  failed: Failure[];
}

export interface UpdateResult {
  cookie?: CookieLike | null;
  deleted?: boolean;
  warning?: string;
  error?: string;
}

export interface LoadProfileResult extends WriteReport {
  previous: CookieLike[];
  error?: string;
}

export interface ChangeEntry {
  timestamp: number;
  removed: boolean;
  cause: string;
  cookie: CookieLike;
}

export interface CookiesResult {
  cookies: CookieLike[];
  /** Jar identities of every protected cookie. */
  protectedIds: string[];
  /** Protect and block rules that concern the requested page. */
  protected: ProtectRule[];
  blocked: BlockRule[];
  partitionSupport: boolean;
}

export interface BlockResult {
  rule: BlockRule;
  removed: CookieLike[];
}
