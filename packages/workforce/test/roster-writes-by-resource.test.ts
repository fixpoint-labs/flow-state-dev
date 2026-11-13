// FIX-2624.
/**
 * The roster's writes go through the workers collection's `runBy` flow:
 * a hire, fork, edit, fire or reset is a send addressed to the
 * user's workers collection, run by the roster flow in a write session the
 * server keeps per writer. No roster session is found or made to write, and the
 * organization a worker's conversation is derived under is the one the
 * roster flow's sign-in names, not one read off a session.
 *
 * Real engine, real HTTP router, the caller a verified user; the checks are on
 * the session and request stores.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { ROSTER_FLOW } from "../src/workers/keys";
import { bootHost, FIXTURE, ORG } from "./worker-model-harness";

function host() {
  const stores = createInMemoryStores();
  return { stores, ...bootHost(stores) };
}

/** Whether `id` is a server write session's. */
const isWriteSession = (id: string | null | undefined) => typeof id === "string" && id.startsWith("fsd-write.");

describe("the roster's writes", () => {
  it("hire, fork, edit, reset and fire through the workers collection, in one write session, with no roster session", async () => {
    const h = host();
    const alice = h.client("alice");
    expect(await alice.hire({ id: "scribe", flow: FIXTURE, instructions: "Write it down." })).toEqual({ id: "scribe", flow: FIXTURE });
    await alice.fork("planner", "planner-2");
    await alice.edit({ id: "scribe", description: "Takes notes." });
    await alice.edit({ id: "researcher", description: "Mine now." });
    await alice.reset("researcher");
    await alice.fire("planner-2");

    const requests = (await h.stores.request.list({})).filter((record) => record.flowKind === ROSTER_FLOW);
    expect(requests.map((record) => record.actionName).sort()).toEqual(["edit", "edit", "fire", "fork", "hire", "reset"]);
    expect(requests.every((record) => record.status === "completed")).toBe(true);
    expect(new Set(requests.map((record) => record.sessionId)).size).toBe(1);
    expect(requests.every((record) => isWriteSession(record.sessionId))).toBe(true);
    // No roster session was found or made to write.
    const sessions = await h.stores.session.list({});
    expect(sessions.filter((session) => session.flowKind === ROSTER_FLOW && !isWriteSession(session.id))).toEqual([]);
    // The hire landed: a session with the worker runs as it.
    const created = await h.create("alice", FIXTURE, { state: { workerId: "scribe" } });
    expect(created.status).toBe(201);
  });

  it("rejects a refused write with the roster flow's reason", async () => {
    const h = host();
    const alice = h.client("alice");
    await alice.hire({ id: "scribe", flow: FIXTURE });
    await expect(alice.hire({ id: "scribe", flow: FIXTURE })).rejects.toThrow(/scribe/);
  });

  it("derives a worker's conversation under the org the sign-in names, in each org the user is in", async () => {
    const h = host();
    // Alice's roster session exists in her first org; her client in the second never reads its org off it.
    await h.client("alice").roster();
    const inFirst = await h.client("alice").ensureWorkerSession({ worker: "researcher" });
    const inSecond = await h.client("alice", "beta").ensureWorkerSession({ worker: "researcher" });
    expect(inSecond.id).not.toBe(inFirst.id);
    const { deriveWorkerSessionId } = await import("../src/workers/derive-session-id");
    expect(inSecond.id).toBe(await deriveWorkerSessionId({ userId: "alice", orgId: "beta", flow: FIXTURE, criteria: { worker: "researcher" } }));
    expect(inFirst.id).toBe(await deriveWorkerSessionId({ userId: "alice", orgId: ORG, flow: FIXTURE, criteria: { worker: "researcher" } }));
  });
});
