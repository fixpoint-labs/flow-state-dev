/**
 * A request's stream ends once, with its final status, however a client
 * reaches it (FIX-2077).
 *
 * A request that owes request-end hooks writes its terminal record, then
 * holds its terminal status event until the hooks have run. In that gap the
 * record already reads terminal. A client attaching then must not get a
 * replay that never ends (`useSession` would stay streaming until its
 * watchdog trips), and a host that stops in that gap must not leave a log
 * that every later reader replays without an end.
 */
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { onRequestEnded } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  continueRequest,
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  detectInterruptedRequests,
  disposeFlowApiRouter,
  runAction
} from "../src";
import type { StoreRegistry } from "../src";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const FLOW_ID = "request-end-stream";

/**
 * A flow whose action registers one request-end hook that waits on `gate` and
 * then fails the request. `heartbeatIntervalMs: 0` turns the run's heartbeat
 * off, documented config a reader must not mistake for a finished run.
 */
function heldFlow(gate: { started: boolean; open: Promise<void> }, heartbeatIntervalMs?: number) {
  return defineFlow({
    kind: "request-end-stream",
    ...(heartbeatIntervalMs !== undefined ? { request: { heartbeatIntervalMs } } : {}),
    actions: {
      run: {
        inputSchema: z.any(),
        block: sequencer({ name: "run" })
          .tap(
            handler({
              name: "register",
              inputSchema: z.any(),
              execute: (_input, ctx) => {
                onRequestEnded(ctx, async () => {
                  gate.started = true;
                  await gate.open;
                  return { fail: new Error("the result could not be recorded") };
                });
              }
            })
          )
          .step(handler({ name: "answer", inputSchema: z.any(), execute: () => "fine" }))
      }
    }
  })({ id: FLOW_ID });
}

function hostFor(stores: StoreRegistry, flow: ReturnType<typeof heldFlow>) {
  const registry = createFlowRegistry();
  registry.register(flow as never);
  return createFlowApiRouter({ registry, stores });
}

const run = (flow: ReturnType<typeof heldFlow>, stores: StoreRegistry) =>
  runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: "u1",
    sessionId: "s1",
    stores,
    runtimeConfig: {}
  });

/** The request's stream as a GET client reads it, to its end. */
async function streamOf(router: ReturnType<typeof hostFor>, requestId: string): Promise<string> {
  const response = await router.GET(new Request(`http://localhost/api/flows/${FLOW_ID}/requests/${requestId}/stream`), {
    params: { path: [FLOW_ID, "requests", requestId, "stream"] }
  });
  expect(response.status).toBe(200);
  return response.text();
}

/** The terminal request events in an SSE body, in order. */
const terminalsIn = (body: string) =>
  [...body.matchAll(/^event: (request\.(?:completed|failed|incomplete|aborted|interrupted))$/gm)].map((match) => match[1]);

/** The sequence numbers of an SSE body's events, in order. */
const sequencesIn = (body: string) => [...body.matchAll(/^id: [^\n]*:(\d+)$/gm)].map((match) => Number(match[1]));

describe.each([
  ["heartbeats on", undefined],
  ["heartbeats off", 0]
] as const)("a held request's stream (%s)", (_label, heartbeatIntervalMs) => {
  it("a GET stream attached while the hooks run ends once, with the final status", async () => {
    let open!: () => void;
    const gate = { started: false, open: new Promise<void>((resolve) => (open = resolve)) };
    const stores = createInMemoryStores();
    const flow = heldFlow(gate, heartbeatIntervalMs);
    const router = hostFor(stores, flow);
    const running = run(flow, stores);
    for (let i = 0; i < 200 && !gate.started; i += 1) await sleep(5);
    const [record] = await stores.request.list({ sessionId: "s1" });
    // In the gap: the record already reads terminal, its terminal event isn't written.
    expect(record?.status).toBe("completed");

    const reading = streamOf(router, record!.id);
    await sleep(50);
    open();
    await running;

    expect(terminalsIn(await reading)).toEqual(["request.failed"]);
    await disposeFlowApiRouter(router);
  });

  it("a host shutting down while the hooks run waits for the held terminal event", async () => {
    let open!: () => void;
    const gate = { started: false, open: new Promise<void>((resolve) => (open = resolve)) };
    const stores = createInMemoryStores();
    // Event writes that land a little later, as a real backend's do: what a
    // shutdown must wait for before it closes the stores.
    const pending = new Set<Promise<void>>();
    const persist = stores.request.persistEvents.bind(stores.request);
    const flush = stores.request.flushEvents.bind(stores.request);
    stores.request.persistEvents = (requestId, events) => {
      const write = sleep(30).then(() => persist(requestId, events));
      pending.add(write);
      void write.finally(() => pending.delete(write));
    };
    stores.request.flushEvents = async (requestId) => {
      await Promise.all([...pending]);
      await flush(requestId);
    };
    const flow = heldFlow(gate, heartbeatIntervalMs);
    const router = hostFor(stores, flow);
    const running = run(flow, stores);
    for (let i = 0; i < 200 && !gate.started; i += 1) await sleep(5);
    const [record] = await stores.request.list({ sessionId: "s1" });

    setTimeout(open, 50);
    await disposeFlowApiRouter(router);

    // Read the moment shutdown is done, as a host closing its stores would.
    expect((await stores.request.getEvents(record!.id)).filter((event) => event.type === "request.failed")).toHaveLength(1);
    await running;
  });

  // Heartbeats off only: its entry never beats, so a sweep reaps a live held
  // run's entry while its hook still runs. A beating run is reaped only by a
  // sweep threshold below its beat, which is a misconfiguration (the sweep
  // then stamps it finalized as dead; `streaming.md`, Known limits).
  it.runIf(heartbeatIntervalMs === 0)("a stale sweep during the hooks: the reader's terminal is the persisted one, and no sequence number repeats", async () => {
    // The reader must still wait for the run's own terminal event, not end on
    // a status the hook then changes.
    let open!: () => void;
    const gate = { started: false, open: new Promise<void>((resolve) => (open = resolve)) };
    const stores = createInMemoryStores();
    const flow = heldFlow(gate, heartbeatIntervalMs);
    const router = hostFor(stores, flow);
    const running = run(flow, stores);
    try {
      for (let i = 0; i < 200 && !gate.started; i += 1) await sleep(5);
      const [record] = await stores.request.list({ sessionId: "s1" });
      await sleep(30);
      await detectInterruptedRequests({ stores, staleThresholdMs: 20 });

      const reading = streamOf(router, record!.id);
      await sleep(50);
      open();
      await running;
      const body = await reading;

      const persisted = (await stores.request.getEvents(record!.id)).filter((event) => terminalsIn(`event: ${event.type}`).length > 0);
      expect(terminalsIn(body)).toEqual(persisted.map((event) => event.type));
      expect(terminalsIn(body)).toEqual(["request.failed"]);
      const sequences = sequencesIn(body);
      expect(new Set(sequences).size).toBe(sequences.length);
    } finally {
      open();
      await running;
      await disposeFlowApiRouter(router, { drainMs: 0 });
    }
  });

  // Once: it doesn't depend on the heartbeat.
  it.runIf(heartbeatIntervalMs === 0)("a run the stale sweep stamped interrupted replays ending interrupted after its last event, and its continuation never reuses that number", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let calls = 0;
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "request-end-stream",
      actions: {
        run: {
          inputSchema: z.any(),
          // The first run hangs, as a run whose process died; a continuation finishes.
          block: handler({
            name: "hang-once",
            inputSchema: z.any(),
            execute: async () => {
              calls += 1;
              if (calls === 1) await gate;
              return "done";
            }
          })
        }
      }
    })({ id: FLOW_ID });
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const router = createFlowApiRouter({ registry, stores });
    const running = run(flow as never, stores);
    try {
      let record;
      for (let i = 0; i < 200 && record === undefined; i += 1) {
        await sleep(5);
        [record] = await stores.request.list({ sessionId: "s1" });
      }
      // Its process died: the sweep stamps it interrupted, and nothing writes its event.
      await detectInterruptedRequests({ stores, staleThresholdMs: 0 });
      expect((await stores.request.get(record!.id))?.status).toBe("interrupted");
      const lastReal = Math.max(...(await stores.request.getEvents(record!.id)).map((event) => event.sequence_number ?? 0));

      const body = await Promise.race([streamOf(router as never, record!.id), sleep(2_000).then(() => "still open")]);

      expect(terminalsIn(body)).toEqual(["request.interrupted"]);
      // The rule for a synthetic nothing can follow: one past the last real event.
      const synthetic = sequencesIn(body).at(-1);
      expect(synthetic).toBe(lastReal + 1);

      // Continued under its own id (DevTool's Continue, a re-drive): its events
      // must never take the number a reader already got for the synthetic.
      const continued = await continueRequest({ requestId: record!.id, stores, flowRegistry: registry, runtimeConfig: {} });
      await continued.finished;
      const persisted = (await stores.request.getEvents(record!.id)).map((event) => event.sequence_number);
      expect(persisted).not.toContain(synthetic);
      expect(new Set(persisted).size).toBe(persisted.length);
    } finally {
      open();
      await running.catch(() => undefined);
      await disposeFlowApiRouter(router, { drainMs: 0 });
    }
  });

  it("a log its run left without a terminal event replays with one, the record's status", async () => {
    // A run that stopped before writing its terminal event: the store drops it.
    const stores = createInMemoryStores();
    const persist = stores.request.persistEvents.bind(stores.request);
    stores.request.persistEvents = (requestId, events) =>
      persist(requestId, events.filter((event) => event.type !== "request.completed"));
    const flow = defineFlow({
      kind: "request-end-stream",
      actions: { run: { inputSchema: z.any(), block: handler({ name: "answer", inputSchema: z.any(), execute: () => "fine" }) } }
    })({ id: FLOW_ID });
    const router = hostFor(stores, flow as never);

    const result = await run(flow as never, stores);
    expect(terminalsIn((await stores.request.getEvents(result.requestId!)).map((e) => `event: ${e.type}`).join("\n"))).toEqual([]);

    expect(terminalsIn(await streamOf(router, result.requestId!))).toEqual(["request.completed"]);
    await disposeFlowApiRouter(router);
  });
});
