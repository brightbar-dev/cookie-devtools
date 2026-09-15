export const ALLOWED_PERMISSIONS: Set<string>;
export const ALLOWED_HOSTS: Set<string>;
export const FORBIDDEN_KEYS: Record<string, string>;
export function manifestProblems(manifest: Record<string, unknown>): string[];
