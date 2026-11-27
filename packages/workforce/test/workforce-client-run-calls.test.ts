/**
 * The calls an app makes on one run and one conversation through
 * `createWorkforceClient`, so its screens never address a worker's flow
 * themselves:
 *
 * - `send` answers the request id the client set, and takes the task the line
 *   is sent from, which it passes only to a door that takes one;
 * - `stopRun` stops one request by id, and a request already ended is no failure;
 * - `upload` puts a file through the worker's own flow;
 * - `addDelegate` and `removeDelegate` change a conversation's delegates through its actions.
 *
 * Each refuses a second user the way the session's doors do.
 *
 * Real engine, real HTTP router, the caller a verified user.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { createWorkforceClient } from "../src/workers/client";
import { bootHost as bootWorkerHost, FIXTURE, ORG } from "./worker-model-harness";
import { bootHost as bootCoordinatorHost } from "./coordinator-harness";

function workerHost() {
  const stores = createInMemoryStores();
  return { stores, ...bootWorkerHost(stores) };
}

/** Read `read` until `done` holds for its answer, or throw after 5 s. */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`never held; last: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The worker inventory's row for `worker` on `flow`, as an installation's boot writes it. */
function inventoryEntry(worker: string, flow: string, doorTakesTask: boolean) {
  return { id: worker, kind: flow, door: "respond", doorTakesTask, name: null, teamName: null, rules: false, hired: false, incarnation: null };
}

describe("send", () => {
  it("answers the request id the client set, which names the stored request", async () => {
    const h = workerHost();
    const alice = h.client("alice");
    const { id } = await alice.startSession("researcher");
    const sent = await alice.send(id, "hello there");
    const [turn] = await h.settled(id);
    expect(sent).toEqual({ requestId: turn!.id });
  });

  it("knows the request id before the server answers, so a running turn can be stopped by it", async () => {
    const h = workerHost();
    const alice = h.client("alice");
    const { id } = await alice.startSession("researcher");
    const sending = alice.send(id, "wait");
    const [running] = await until(
      () => h.stores.request.list({ sessionId: id }),
      (requests) => requests.some((request) => request.status === "in_progress"),
    );
    await alice.stopRun(id, running!.id);
    expect((await sending).requestId).toBe(running!.id);
  });

  it("leaves the task out for a door that doesn't take one, so the strict door doesn't refuse the line", async () => {
    const h = workerHost();
    await h.stores.resourceState.set("org", ORG, `inventory/workers/researcher`, inventoryEntry("researcher", FIXTURE, false) as never, "any");
    const alice = h.client("alice");
    const { id } = await alice.startSession("researcher");
    await alice.send(id, "hello", { taskId: "t-1" });
    const [turn] = await h.settled(id);
    expect(turn).toMatchObject({ status: "completed", input: { message: "hello" } });
    expect((turn!.input as Record<string, unknown>).taskId).toBeUndefined();
  });

  it("passes the task to a door that takes one", async () => {
    const host = bootCoordinatorHost();
    const runtime = await host.state.getRuntime();
    await runtime.stores.resourceState.set("org", "acme", "inventory/workers/chief", inventoryEntry("chief", "coordinator", true) as never, "any");
    const convo = await host.conversation("alice", "chief");
    const { requestId } = await host.client("alice").send(convo, "hello", { taskId: "t-1" });
    const stored = await until(
      () => runtime.stores.request.get(requestId),
      (request) => request !== undefined && request !== null,
    );
    expect(stored!.input).toEqual({ message: "hello", taskId: "t-1" });
  });

  it("refuses another user's session, as the door does", async () => {
    const h = workerHost();
    const { id } = await h.client("alice").startSession("researcher");
    await expect(h.client("bob").send(id, "hello")).rejects.toThrow();
    expect(await h.stores.request.list({ sessionId: id })).toEqual([]);
  });
});

describe("stopRun", () => {
  it("stops the one run it names and leaves another running turn of the session alone", async () => {
    const h = workerHost();
    const alice = h.client("alice");
    const { id } = await alice.startSession("researcher");
    void alice.send(id, "wait").catch(() => undefined);
    void alice.send(id, "wait").catch(() => undefined);
    const running = await until(
      () => h.stores.request.list({ sessionId: id }),
      (requests) => requests.filter((request) => request.status === "in_progress").length === 2,
    );
    const [first, second] = running;
    await alice.stopRun(id, first!.id);
    await until(
      () => h.stores.request.get(first!.id),
      (request) => request?.status === "aborted",
    );
    expect((await h.stores.request.get(second!.id))?.status).toBe("in_progress");
    await alice.stopTurns(id);
  });

  it("takes a run that already ended as no failure", async () => {
    const h = workerHost();
    const alice = h.client("alice");
    const { id } = await alice.startSession("researcher");
    const { requestId } = await alice.send(id, "hello");
    await h.settled(id);
    await expect(alice.stopRun(id, requestId)).resolves.toBeUndefined();
    expect((await h.stores.request.get(requestId))?.status).toBe("completed");
  });

  // Greptile 4621742267: the abort route also answers 409 when an answer resumed a waiting run before the
  // stop reached it, and records no stop. The run goes on, so the stop must not read as done.
  it("rejects a 409 whose run still reads in progress, asking for another stop", async () => {
    const h = workerHost();
    const alice = h.client("alice");
    const { id } = await alice.startSession("researcher");
    void alice.send(id, "wait").catch(() => undefined);
    const [running] = await until(
      () => h.stores.request.list({ sessionId: id }),
      (requests) => requests.some((request) => request.status === "in_progress"),
    );
    // The race, as the route answers it: the abort lost to a resume, and the run runs on.
    const fetcher = h.fetcherFor("alice");
    const racing = createWorkforceClient(
      createClient({
        userId: "alice",
        fetcher: async (input, init) =>
          init?.method === "POST" && String(input).endsWith(`/requests/${running!.id}/abort`)
            ? new Response(JSON.stringify({ error: "resumed before the stop reached it" }), { status: 409, headers: { "content-type": "application/json" } })
            : fetcher(input, init),
      }),
    );
    await expect(racing.stopRun(id, running!.id)).rejects.toThrow(/Stop it again/);
    expect((await h.stores.request.get(running!.id))?.status).toBe("in_progress");
    await alice.stopRun(id, running!.id);
  });

  it("refuses another user's run, and the run goes on", async () => {
    const h = workerHost();
    const alice = h.client("alice");
    const { id } = await alice.startSession("researcher");
    void alice.send(id, "wait").catch(() => undefined);
    const [running] = await until(
      () => h.stores.request.list({ sessionId: id }),
      (requests) => requests.some((request) => request.status === "in_progress"),
    );
    await expect(h.client("bob").stopRun(id, running!.id)).rejects.toThrow();
    expect((await h.stores.request.get(running!.id))?.status).toBe("in_progress");
    await alice.stopRun(id, running!.id);
  });
});

describe("upload", () => {
  it("stores a file through the worker's own flow and answers its reference", async () => {
    // A host with a blob store (`createFlowState`'s).
    const host = bootCoordinatorHost();
    const file = await host.client("alice").upload("chief", { data: new Uint8Array([1, 2, 3]), filename: "a.txt", mediaType: "text/plain" });
    expect(file).toMatchObject({ type: "file", mediaType: "text/plain", filename: "a.txt" });
    expect(file.data).toMatch(/^fsd-blob:/);
  });

  it("refuses a worker that isn't on the caller's roster, and stores nothing", async () => {
    const h = workerHost();
    expect((await h.rosterAction("alice", "hire", { id: "aides", flow: FIXTURE })).error).toBeUndefined();
    await expect(
      h.client("bob").upload("aides", { data: new Uint8Array([1]), filename: "a.txt", mediaType: "text/plain" }),
    ).rejects.toThrow('No worker "aides" on your roster.');
  });
});

describe("addDelegate and removeDelegate", () => {
  const workersOf = (output: { delegates: Array<{ worker: string; note?: string }> }) => output.delegates.map((d) => [d.worker, d.note]);

  it("add a worker with its note to the conversation, and take one off", async () => {
    const host = bootCoordinatorHost();
    const convo = await host.conversation("alice", "chief");
    const alice = host.client("alice");
    await alice.addDelegate(convo, "eng.lead", "leads it");
    expect(workersOf((await host.act("alice", convo, "listDelegates", {})).output)).toEqual([
      ["eng.em", undefined],
      ["eng.lead", "leads it"],
    ]);
    await alice.removeDelegate(convo, "eng.em");
    expect(workersOf((await host.act("alice", convo, "listDelegates", {})).output)).toEqual([["eng.lead", "leads it"]]);
  });

  it("rejects with the coordinator's own reason, and changes nothing", async () => {
    const host = bootCoordinatorHost();
    const convo = await host.conversation("alice", "chief");
    await expect(host.client("alice").addDelegate(convo, "notes")).rejects.toThrow(/notes/);
    await expect(host.client("alice").removeDelegate(convo, "eng.coder")).rejects.toThrow(/isn't a delegate/);
    expect(workersOf((await host.act("alice", convo, "listDelegates", {})).output)).toEqual([["eng.em", undefined]]);
  });

  it("refuses another user's conversation, as the delegate actions do", async () => {
    const host = bootCoordinatorHost();
    const convo = await host.conversation("alice", "chief");
    await expect(host.client("bob").addDelegate(convo, "eng.lead")).rejects.toThrow();
    await expect(host.client("bob").removeDelegate(convo, "eng.em")).rejects.toThrow();
    expect(workersOf((await host.act("alice", convo, "listDelegates", {})).output)).toEqual([["eng.em", undefined]]);
  });
});
