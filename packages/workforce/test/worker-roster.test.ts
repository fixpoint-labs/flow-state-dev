/**
 * Holding a worker (FIX-1788 S3, S4, S9; V3, V8): hire, fork, edit and fire
 * are writes to the user's own roster, checked before they are made, and
 * standard workers can't be written at all.
 *
 * Real engine. Each leg reads what a caller gets back, what a turn runs as, or
 * what a second host sees, never a stored key.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { bootHost, FIXTURE, messageOf, OTHER, skill, standardWorkers } from "./worker-model-harness";

function host(options: Parameters<typeof bootHost>[1] = {}) {
  const stores = createInMemoryStores();
  return { stores, ...bootHost(stores, options) };
}

describe("hiring a worker", () => {
  it("BR-1 · writes one row in the user's scope and registers nothing; another host runs it on its next turn", async () => {
    const h = host();
    const registered = h.registry.list().length;
    expect((await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE, settings: { tone: "terse" } })).error).toBeUndefined();
    expect(h.registry.list().length).toBe(registered);

    const second = bootHost(h.stores);
    const session = await second.client("alice").ensureWorkerSession({ worker: "scribe" });
    expect((await second.turn("alice", session.id)).output).toMatchObject({ worker: "scribe", tone: "terse" });
  });

  it("BR-3 · refuses every write to a standard worker, naming it and suggesting a fork", async () => {
    const h = host();
    for (const [verb, input] of [
      ["hire", { id: "researcher", flow: FIXTURE }],
      ["edit", { id: "researcher", instructions: "changed" }],
      ["fire", { id: "researcher" }]
    ] as const) {
      const result = await h.rosterAction("alice", verb, input);
      expect(messageOf(result.error), verb).toContain('"researcher" is a standard worker');
      expect(messageOf(result.error), verb).toContain("Fork it");
    }
    const session = await h.create("alice", FIXTURE, { state: { workerId: "researcher" } });
    expect((await h.turn("alice", session.body.session!.id)).output).toMatchObject({ instructions: "Research carefully." });
  });

  it("BR-4 · refuses an id already on the user's roster, and doesn't consult another user's", async () => {
    const h = host();
    expect((await h.rosterAction("bob", "hire", { id: "scribe", flow: FIXTURE })).error).toBeUndefined();
    expect((await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE })).error).toBeUndefined();
    const again = await h.rosterAction("alice", "hire", { id: "scribe", flow: OTHER });
    expect(messageOf(again.error)).toContain('"scribe" is already on your roster');
  });

  it("BR-5 · two users' workers under one id are two workers, and neither sees the other's", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE, instructions: "Alice's." });
    await h.rosterAction("bob", "hire", { id: "scribe", flow: OTHER, instructions: "Bob's." });
    const alices = (await h.client("alice").roster()).filter((entry) => !entry.standard);
    const bobs = (await h.client("bob").roster()).filter((entry) => !entry.standard);
    expect(alices).toEqual([{ id: "scribe", flow: FIXTURE, standard: false, description: null }]);
    expect(bobs).toEqual([{ id: "scribe", flow: OTHER, standard: false, description: null }]);
    const session = await h.client("alice").ensureWorkerSession({ worker: "scribe" });
    expect((await h.turn("alice", session.id)).output).toMatchObject({ instructions: "Alice's." });
  });

  it("BR-5 · a worker of one organization isn't on the same user's roster in another", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE }, "acme");
    const elsewhere = (await h.client("alice", "globex").roster()).filter((entry) => !entry.standard);
    expect(elsewhere).toEqual([]);
  });

  it("BR-6 · refuses a flow that isn't a worker flow, and settings the flow's schema refuses, writing nothing", async () => {
    const h = host();
    const unknownFlow = await h.rosterAction("alice", "hire", { id: "a", flow: "nope" });
    expect(messageOf(unknownFlow.error)).toContain('names flow "nope", which isn\'t a worker flow here');
    const badSetting = await h.rosterAction("alice", "hire", { id: "b", flow: FIXTURE, settings: { colour: "red" } });
    expect(messageOf(badSetting.error)).toContain("colour");
    expect((await h.client("alice").roster()).filter((entry) => !entry.standard)).toEqual([]);
  });

  it("BR-6 · refuses a flow kept for standard workers", async () => {
    const h = host({ standardOnly: true });
    const refused = await h.rosterAction("alice", "hire", { id: "a", flow: FIXTURE });
    expect(messageOf(refused.error)).toContain("keeps for declared workers");
  });

  it("BR-6a · refuses a grant of a document the flow doesn't declare, naming it", async () => {
    const h = host();
    const refused = await h.rosterAction("alice", "hire", { id: "a", flow: FIXTURE, settings: { resources: ["payroll"] } });
    expect(messageOf(refused.error)).toContain("payroll");
    expect((await h.rosterAction("alice", "hire", { id: "b", flow: FIXTURE, settings: { resources: ["handbook"] } })).error).toBeUndefined();
  });

  it("refuses a skill nothing registers, naming the skills that are, so the hire can be made again with one of them or none", async () => {
    const h = host({ skills: [skill("summarize"), skill("cite")] });
    const refused = await h.rosterAction("alice", "hire", { id: "auditor", flow: FIXTURE, skills: ["license auditing"] });
    expect(messageOf(refused.error)).toBe(
      'Worker "auditor" names skill "license auditing", which this installation doesn\'t register. ' +
        'Remove it, or register it. Skills it registers: "cite", "summarize". Nothing was written.'
    );
    expect((await h.client("alice").roster()).filter((entry) => !entry.standard)).toEqual([]);
    // The hire made again as the refusal says lands.
    expect((await h.rosterAction("alice", "hire", { id: "auditor", flow: FIXTURE, skills: ["cite"] })).error).toBeUndefined();

    const none = host({ skills: [] });
    const bare = await none.rosterAction("alice", "hire", { id: "auditor", flow: FIXTURE, skills: ["a", "b"] });
    expect(messageOf(bare.error)).toBe(
      'Worker "auditor" names skill "a", which this installation doesn\'t register. Remove it, or register it; ' +
        'names skill "b", which this installation doesn\'t register. Remove it, or register it. ' +
        "It registers no skills. Nothing was written."
    );
  });
});

describe("forking a worker", () => {
  it("BR-2 · copies a standard worker's configuration and shared instructions under a new id, and a later file edit doesn't reach it", async () => {
    const h = host();
    expect((await h.rosterAction("alice", "fork", { from: "researcher", id: "my-researcher" })).error).toBeUndefined();
    const edited = bootHost(h.stores, { standard: standardWorkers({ researcherBody: "Research quickly." }) });
    const fork = await edited.client("alice").ensureWorkerSession({ worker: "my-researcher" });
    expect((await edited.turn("alice", fork.id)).output).toMatchObject({
      worker: "my-researcher",
      standard: false,
      instructions: "Research carefully.",
      teamInstructions: "We cite sources.",
      tone: "formal",
      skills: ["cite"]
    });
    const original = await edited.create("alice", FIXTURE, { state: { workerId: "researcher" } });
    expect((await edited.turn("alice", original.body.session!.id)).output).toMatchObject({ instructions: "Research quickly." });
  });

  it("BR-2 · leaves the standard worker unchanged for everyone", async () => {
    const h = host();
    await h.rosterAction("alice", "fork", { from: "researcher", id: "mine" });
    await h.rosterAction("alice", "edit", { id: "mine", instructions: "Mine now." });
    const bobs = await h.create("bob", FIXTURE, { state: { workerId: "researcher" } });
    expect((await h.turn("bob", bobs.body.session!.id)).output).toMatchObject({ instructions: "Research carefully." });
  });

  it("BR-4 · refuses a fork under a standard worker's id, or an id already on the roster", async () => {
    const h = host();
    expect(messageOf((await h.rosterAction("alice", "fork", { from: "researcher", id: "planner" })).error)).toContain(
      '"planner" is a standard worker'
    );
    await h.rosterAction("alice", "fork", { from: "researcher", id: "mine" });
    expect(messageOf((await h.rosterAction("alice", "fork", { from: "researcher", id: "mine" })).error)).toContain(
      "already on your roster"
    );
  });

  it("BR-19c · a fork of a worker with sessions starts with none; the sessions stay with the original", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    const alice = h.client("alice");
    const original = await alice.ensureWorkerSession({ worker: "scribe" });
    await h.rosterAction("alice", "fork", { from: "scribe", id: "scribe-2" });
    expect(await alice.findWorkerSession({ worker: "scribe-2" })).toBeUndefined();
    expect((await alice.findWorkerSession({ worker: "scribe" }))?.id).toBe(original.id);
    expect((await h.turn("alice", original.id)).output).toMatchObject({ worker: "scribe" });
  });
});

describe("firing a worker", () => {
  it("BR-7 · deletes the row; its sessions stay readable, a new turn is refused naming it fired, on every host", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    const session = await h.client("alice").ensureWorkerSession({ worker: "scribe" });
    const second = bootHost(h.stores);
    expect((await second.turn("alice", session.id)).error).toBeUndefined();

    expect((await h.rosterAction("alice", "fire", { id: "scribe" })).error).toBeUndefined();
    expect(messageOf((await second.turn("alice", session.id)).error)).toContain('Worker "scribe" was fired');
    const read = await h.fetcherFor("alice")(`/api/flows/sessions/${session.id}`);
    expect(read.status).toBe(200);
    expect((await h.client("alice").roster()).filter((entry) => !entry.standard)).toEqual([]);
  });

  it("refuses to fire a worker that isn't on the roster", async () => {
    const h = host();
    expect(messageOf((await h.rosterAction("alice", "fire", { id: "nobody" })).error)).toContain('No worker "nobody"');
  });
});

describe("what a worker runs with", () => {
  it("BR-20 · an edit reaches the next turn on every host, with no restart", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE, settings: { tone: "terse" } });
    const second = bootHost(h.stores);
    const session = await h.client("alice").ensureWorkerSession({ worker: "scribe" });
    expect((await second.turn("alice", session.id)).output).toMatchObject({ tone: "terse" });
    await h.rosterAction("alice", "edit", { id: "scribe", settings: { tone: "warm" } });
    expect((await second.turn("alice", session.id)).output).toMatchObject({ tone: "warm" });
  });

  it("BR-22 · a configuration naming a skill this host doesn't register refuses that turn, naming it, and leaves the row", async () => {
    const h = host({ skills: [skill("cite"), skill("summarize")] });
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE, skills: ["summarize"] });
    const session = await h.client("alice").ensureWorkerSession({ worker: "scribe" });
    expect((await h.turn("alice", session.id)).output).toMatchObject({ skills: ["summarize"] });

    const narrower = bootHost(h.stores, { skills: [skill("cite")] });
    expect(messageOf((await narrower.turn("alice", session.id)).error)).toContain('names skill "summarize"');
    expect((await h.turn("alice", session.id)).output).toMatchObject({ skills: ["summarize"] });
  });

  it("BR-22a · a user's worker on a flow since kept for standard workers refuses its turn; the row is untouched", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    const session = await h.client("alice").ensureWorkerSession({ worker: "scribe" });
    const kept = bootHost(h.stores, { standardOnly: true });
    expect(messageOf((await kept.turn("alice", session.id)).error)).toContain("keeps for declared workers");
    expect((await h.turn("alice", session.id)).output).toMatchObject({ worker: "scribe" });
    const standard = await kept.create("alice", FIXTURE, { state: { workerId: "researcher" } });
    expect((await kept.turn("alice", standard.body.session!.id)).error).toBeUndefined();
  });

  it("BR-24 · a worker granted one document reaches it and not the flow's other document, on each turn", async () => {
    const h = host();
    await h.rosterAction("alice", "hire", { id: "reader", flow: FIXTURE, settings: { resources: ["handbook"] } });
    await h.rosterAction("alice", "hire", { id: "open", flow: FIXTURE });
    const reader = await h.client("alice").ensureWorkerSession({ worker: "reader" });
    const open = await h.client("alice").ensureWorkerSession({ worker: "open" });
    expect((await h.turn("alice", reader.id)).output).toMatchObject({ handbook: true, ledger: false });
    expect((await h.turn("alice", open.id)).output).toMatchObject({ handbook: true, ledger: true });
  });
});
