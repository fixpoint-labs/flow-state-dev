/**
 * Test helper for reading session-scoped resource storage directly off an
 * in-memory `StoreRegistry` (FIX-1000 test fallout).
 *
 * Session-scoped `resourceState`/`content` now address at
 * `resolveSessionResourceScopeId(sessionRecord)` — `${recordKey}#${generation}`
 * for a record minted through a real path — not the bare `sessionId`
 * (`@flow-state-dev/engine`'s `packages/engine/src/stores/scope-keys.ts`).
 * Every spec here drives its session through `testFlow`/`testBlock` (a real
 * `createExecutionContext` call), so its record always carries a minted
 * generation. Reading storage directly (bypassing `ctx.resources`, as these
 * specs do to assert on the raw persisted shape) needs to resolve that same
 * address rather than reuse the caller-supplied `sessionId`.
 */
import { resolveSessionResourceScopeId, type StoreRegistry } from "@flow-state-dev/engine";

/**
 * Resolve the `scopeId` a session's resources are stored at, by loading its
 * record. Falls back to the bare `sessionId` when no record exists yet (a
 * session that was never run) — matching `resolveSessionResourceScopeId`'s own
 * legacy-record behavior.
 */
export async function sessionResourceScopeId(
  stores: Pick<StoreRegistry, "session">,
  sessionId: string
): Promise<string> {
  const record = await stores.session.get(sessionId);
  return record ? resolveSessionResourceScopeId(record) : sessionId;
}
