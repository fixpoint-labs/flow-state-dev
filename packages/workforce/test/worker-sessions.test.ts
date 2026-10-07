/**
 * A session's worker (FIX-1788 S5, S5a; V4): named once when the session is
 * created, checked there by the worker flow's create check, and found or
 * started from an app through `createWorkforceClient`.
 *
 * Real engine, real HTTP router, the caller a verified user. The tests read
 * what each caller gets back and what a turn runs as, never a stored key.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { bootHost, FIXTURE, messageOf, ORG, OTHER } from "./worker-model-harness";

function host() {
  const stores = createInMemoryStores();
  return { stores, ...bootHost(stores) };
}

describe("creating a session with a worker", () => {
  it("BR-10 · links a session to the creating user's own worker, and every turn runs as it", async () => {
    const h = host();
    expect((await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE, instructions: "Write it down." })).error).toBeUndefined();
    const created = await h.create("alice", FIXTURE, { state: { workerId: "scribe" } });
    expect(created.status).toBe(201);
    const ran = await h.turn("alice", created.body.session!.id);
    expect(ran.error).toBeUndefined();
    expect(ran.output).toMatchObject({ worker: "scribe", standard: false, instructions: "Write it down." });
  });

  it("BR-10 · links a session to a standard worker too", async () => {
    const h = host();
    const created = await h.create("alice", FIXTURE, { state: { workerId: "researcher" } });
    expect(created.status).toBe(201);
    expect((await h.turn("alice", created.body.session!.id)).output).toMatchObject({
      worker: "researcher",
      standard: true,
      tone: "formal",
      instructions: "Research carefully."
    });
  });

  it("BR-11 · refuses another user's worker with the answer a worker that doesn't exist gets", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    const bobs = await h.create("bob", FIXTURE, { state: { workerId: "scribe" } });
    const none = await h.create("bob", FIXTURE, { state: { workerId: "nobody" } });
    expect(bobs.status).toBe(404);
    expect(none.status).toBe(404);
    expect(bobs.body.error).toBe('No worker "scribe".');
    expect(none.body.error).toBe('No worker "nobody".');
  });

  it("BR-12 · refuses a worker on another flow, naming both flows", async () => {
    const h = host();
    const created = await h.create("alice", OTHER, { state: { workerId: "researcher" } });
    expect(created.status).toBe(400);
    expect(created.body.error).toContain(`runs on flow "${FIXTURE}", not "${OTHER}"`);
  });

  it("BR-13 · refuses a turn whose input names a worker, and the session keeps its worker", async () => {
    const h = host();
    const created = await h.create("alice", FIXTURE, { state: { workerId: "researcher" } });
    const id = created.body.session!.id;
    const ran = await runAction({
      flow: h.instances[FIXTURE],
      actionName: "run",
      input: { message: "hi", worker: "planner" },
      userId: "alice",
      orgId: ORG,
      sessionId: id,
      stores: h.stores,
      runtimeConfig: {}
    });
    expect(messageOf(ran.error)).toContain("worker");
    expect((await h.turn("alice", id)).output).toMatchObject({ worker: "researcher" });
  });

  it("BR-14 · refuses a session with no worker, by the create and by an action on an unused id", async () => {
    const h = host();
    const created = await h.create("alice", FIXTURE, {});
    expect(created.status).toBe(400);
    expect(created.body).toMatchObject({ field: "workerId" });
    const res = await h.fetcherFor("alice")(`/api/flows/${FIXTURE}/fresh/actions/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice", sessionId: "fresh", input: { message: "hi" } })
    });
    expect(res.status).toBe(400);
  });

  it("BR-15 · a create can't seed the worker through another field: the field is readonly and checked", async () => {
    const h = host();
    await h.rosterAction("bob", "hire", { id: "spy", flow: FIXTURE });
    // Alice's create names Bob's worker id: read at her scope, it isn't there.
    expect((await h.create("alice", FIXTURE, { state: { workerId: "spy" } })).status).toBe(404);
  });
});

describe("finding or starting a session with a worker", () => {
  it("BR-13a · two ensureWorkerSession calls at once get one session", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    const alice = h.client("alice");
    const [a, b] = await Promise.all([
      alice.ensureWorkerSession({ worker: "scribe" }),
      alice.ensureWorkerSession({ worker: "scribe" })
    ]);
    expect(a.id).toBe(b.id);
    expect(a.flowKind).toBe(FIXTURE);
    expect((await h.turn("alice", a.id)).output).toMatchObject({ worker: "scribe" });
  });

  it("BR-13a · two plain creates make two sessions, each checked", async () => {
    const h = host();
    const one = await h.create("alice", FIXTURE, { state: { workerId: "researcher" } });
    const two = await h.create("alice", FIXTURE, { state: { workerId: "researcher" } });
    expect(one.body.session!.id).not.toBe(two.body.session!.id);
  });

  it("BR-13b · refuses a create at another user's derived id, before that user's first ensure", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    await h.rosterAction("bob", "hire", { id: "scribe", flow: FIXTURE });
    // Alice's derived id, as her client would compute it.
    const { deriveWorkerSessionId } = await import("../src/workers/derive-session-id");
    const hers = await deriveWorkerSessionId({ userId: "alice", orgId: ORG, flow: FIXTURE, criteria: { worker: "scribe" } });
    const taken = await h.create("bob", FIXTURE, { sessionId: hers, state: { workerId: "scribe" } });
    expect(taken.status).toBe(403);
    const mine = await h.client("alice").ensureWorkerSession({ worker: "scribe" });
    expect(mine.id).toBe(hers);
  });

  it("BR-14a · finds the user's own session with the worker, most recent first, and never another user's", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    await h.rosterAction("bob", "hire", { id: "scribe", flow: FIXTURE });
    const alice = h.client("alice");
    expect(await alice.findWorkerSession({ worker: "scribe" })).toBeUndefined();
    const first = await h.create("alice", FIXTURE, { state: { workerId: "scribe" } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await h.create("alice", FIXTURE, { state: { workerId: "scribe" } });
    expect((await alice.findWorkerSession({ worker: "scribe" }))?.id).toBe(second.body.session!.id);
    expect(first.body.session!.id).not.toBe(second.body.session!.id);
    expect(await h.client("bob").findWorkerSession({ worker: "scribe" })).toBeUndefined();
  });

  it("BR-16 · a derived session deleted and ensured again is created fresh by its own create", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    const alice = h.client("alice");
    const first = await alice.ensureWorkerSession({ worker: "scribe" });
    const del = await h.fetcherFor("alice")(`/api/flows/sessions/${first.id}`, { method: "DELETE" });
    expect(del.status).toBeLessThan(300);
    const again = await alice.ensureWorkerSession({ worker: "scribe" });
    expect(again.id).toBe(first.id);
    expect((await h.stores.session.get(again.id))?.createdAt).toBeGreaterThanOrEqual(first.createdAt);
    expect((await h.turn("alice", again.id)).output).toMatchObject({ worker: "scribe" });
  });

  it("BR-19b · after a worker moves to another flow, ensure starts a new session there, and the old one refuses", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    const alice = h.client("alice");
    const before = await alice.ensureWorkerSession({ worker: "scribe" });
    expect((await h.rosterAction("alice", "edit", { id: "scribe", flow: OTHER })).error).toBeUndefined();
    const after = await alice.ensureWorkerSession({ worker: "scribe" });
    expect(after.flowKind).toBe(OTHER);
    expect(after.id).not.toBe(before.id);
    const refused = await h.turn("alice", before.id);
    expect(messageOf(refused.error)).toContain(`now runs on flow "${OTHER}", and this session runs on "${FIXTURE}"`);
    expect((await h.turn("alice", after.id, "hello", OTHER)).error).toBeUndefined();
  });

  it("BR-9 · the roster lists the user's own workers and every standard one, each with its flow", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: OTHER, description: "Takes notes." });
    await h.rosterAction("bob", "hire", { id: "bobs", flow: FIXTURE });
    const roster = await h.client("alice").roster();
    expect(roster).toEqual([
      { id: "scribe", flow: OTHER, standard: false, description: "Takes notes." },
      { id: "planner", flow: OTHER, standard: true, description: "Plans." },
      { id: "researcher", flow: FIXTURE, standard: true, description: "Finds things out." }
    ]);
  });
});
