/**
 * A wake's run carries the resolver identity its wake names.
 *
 * Why it matters: a write into another session can start a turn there, as a
 * wake. That turn reaches the own-resolver sessions its writer's resolver
 * admits only if the wake carried the writer's `resolvedBy`; a wake with
 * none (one stored before the field, or one two resolvers folded into)
 * must run with none, so it admits no own-resolver session.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../../src/host";
import { fireWakeThrough } from "../../src/durability/request-wakes";
import type { WakeRecord } from "../../src/stores/types";

async function fire(extra: Partial<WakeRecord>) {
  const stores = createInMemoryStores();
  const now = Date.now();
  await stores.session.set(
    "s1",
    { id: "s1", state: {}, version: 0, createdAt: now, updatedAt: now, flowKind: "desk", flowId: "desk", userId: "alice", orgId: "acme", journal: [], principalKind: "person" },
    "absent"
  );
  const seen: Array<{ principal: unknown }> = [];
  const host = {
    stores,
    dispatch: (envelope: { principal: unknown }) => {
      seen.push(envelope);
      return { requestId: "r1", finished: Promise.resolve(undefined), accepted: Promise.resolve() };
    }
  };
  const wake: WakeRecord = {
    sessionId: "s1",
    entry: "notesChanged",
    flowKind: "desk",
    userId: "alice",
    orgId: "acme",
    dueAt: now,
    landBy: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...extra
  };
  await fireWakeThrough(host as never, wake);
  return seen[0]!.principal as { kind: string; resolvedBy?: string };
}

describe("fireWakeThrough", () => {
  it("runs as the session's owner with the resolver identity the wake names", async () => {
    expect(await fire({ resolvedBy: "flow:vault" })).toMatchObject({ userId: "alice", kind: "person", resolvedBy: "flow:vault" });
  });

  it("a wake that names none runs with none", async () => {
    expect((await fire({})).resolvedBy).toBeUndefined();
  });
});
