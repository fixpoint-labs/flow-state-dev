/**
 * Shared session-record fixture for engine tests (FIX-1000 test fallout).
 *
 * Session-scoped resource state and content now address through
 * `resolveSessionResourceScopeId(sessionRecord)`, not the bare session id
 * (see `packages/engine/src/stores/scope-keys.ts`). A test that seeds
 * `stores.resourceState` / `stores.content` directly at a bare session id
 * before running a flow needs a session record already in the store — with
 * the *legacy* shape (no `storageGeneration`) — or `createExecutionContext`'s
 * implicit session creation mints a fresh generation and the pre-seeded rows
 * become invisible to it.
 *
 * `seedLegacySession` exercises that legacy path deliberately: a record with
 * no `storageGeneration` resolves to the bare id, byte-identical to
 * pre-FIX-1000 behaviour. Every production path (routes, `createExecutionContext`)
 * has the session record before it ever touches session resources, so this
 * seed-resources-before-any-record shape is test-harness-only.
 *
 * `userId` is required, not defaulted — `createExecutionContext` rejects a
 * request whose `userId` doesn't match the session record's
 * (`UserBindingMismatchError`), so a mismatched default would fail every
 * caller whose test `userId` isn't literally "test-user".
 */
import type { SessionRecord, SessionStore } from "../src";

export async function seedLegacySession(
  sessionStore: SessionStore,
  sessionId: string,
  userId: string,
  overrides: Partial<SessionRecord> = {}
): Promise<SessionRecord> {
  const now = Date.now();
  const record: SessionRecord = {
    id: sessionId,
    flowKind: "test-flow",
    userId,
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    journal: [],
    ...overrides
  };
  await sessionStore.set(sessionId, record, "any");
  return record;
}
