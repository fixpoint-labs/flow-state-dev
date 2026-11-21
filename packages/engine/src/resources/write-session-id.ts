/**
 * Write session ids: the prefix every write session id carries, and the check
 * for one. A leaf module, so the change bus can tell a write session's writes
 * apart without importing the default write flow (which imports the bus).
 */

/** Every write session id starts with this; a client may not name one. */
export const WRITE_SESSION_PREFIX = "fsd-write.";

/** Whether `id` (bare, or tenant-namespaced as `tenant:id`) is a write session's. */
export function isWriteSessionId(id: string): boolean {
  return id.startsWith(WRITE_SESSION_PREFIX) || id.includes(`:${WRITE_SESSION_PREFIX}`);
}
