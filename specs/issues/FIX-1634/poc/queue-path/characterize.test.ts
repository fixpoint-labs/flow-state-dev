/**
 * FIX-1634 · characterization POC. NOT production code and not part of any
 * default test run. See README.md for how to run it and what it observed.
 *
 * Two premises the spec rests on, checked on a real BullMQ host with a real
 * Redis, through the real enqueue → worker → runAction path:
 *
 *   P1  On a queue host, a session's concurrency policy governs NOTHING today:
 *       two `queue`-policy runs into one session overlap, whether they arrive
 *       as HTTP actions or as dispatched work. (The same flow in process
 *       serializes them.) So arbitrating deliveries alone would serialize
 *       against runs that hold no key.
 *
 *   P2  The incarnation guard already survives the queue: the recipient lineage
 *       the sender approved rides the job's metadata, and the worker's run
 *       drops a delivery whose recipient was replaced.
 *
 * Plus the control the spec's case must turn green: a `dispatcher()` into an
 * existing session is refused `external-dispatcher` on this host today.
 *
 * P2 reaches past the refusal by calling the installed dispatch operation with
 * `delivery: "child"` and hand-built provenance — exactly the envelope the
 * seam would produce if the refusal were deleted. That is what makes it a
 * characterization of the queue path rather than of the refusal.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "../src";
import { bullmqWorker } from "../../bullmq/src/index";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const USER_ID = "u_poc";
const HOLD_MS = 300;

type Span = { tag: string; start: number; end: number };

function recipientFlow(kind: string, spans: Span[]) {
  const work = handler({
    name: "work",
    inputSchema: z.object({ tag: z.string() }),
    outputSchema: z.object({}),
    execute: async (input) => {
      const start = Date.now();
      await new Promise((r) => setTimeout(r, HOLD_MS));
      spans.push({ tag: input.tag, start, end: Date.now() });
      return {};
    }
  });
  const deliver = dispatcher({
    name: "deliver-work",
    type: "internal",
    action: "work",
    inputSchema: z.object({ to: z.string(), tag: z.string() }),
    session: { id: (input) => input.to },
    payload: (input) => ({ tag: input.tag })
  });
  return defineFlow({
    kind,
    actions: {
      work: { block: work, inputSchema: z.object({ tag: z.string() }) },
      deliver: { block: deliver }
    },
    internal: { actions: { work: { block: work } } },
    // Session-keyed FIFO: in process, runs into one session never overlap.
    request: { concurrency: { policy: "queue", key: "session" } }
  })({ id: kind });
}

async function boot(kind: string, queued: boolean) {
  const spans: Span[] = [];
  const flow = recipientFlow(kind, spans);
  const state = createFlowState({
    flows: { [kind]: flow },
    stores: { default: { primary: inMemoryStores() } },
    ...(queued
      ? {
          worker: bullmqWorker({
            connection: REDIS_URL,
            queueName: `poc-1634-${kind}-${Date.now()}`,
            concurrency: 4
          })
        }
      : {})
  });
  const runtime = await state.getRuntime();
  const router = await state.getRouter();
  return { spans, flow, runtime, router, state };
}

async function seedSession(
  runtime: Awaited<ReturnType<typeof boot>>["runtime"],
  id: string,
  kind: string,
  lineageId: string
) {
  const ts = Date.now();
  await runtime.stores.session.set(
    id,
    {
      id,
      state: {},
      version: 0,
      createdAt: ts,
      updatedAt: ts,
      flowKind: kind,
      flowId: kind,
      userId: USER_ID,
      orgId: DEFAULT_ORG_ID,
      lineageId,
      journal: []
    },
    "any"
  );
}

async function postWork(
  router: Awaited<ReturnType<typeof boot>>["router"],
  kind: string,
  sessionId: string,
  tag: string
): Promise<string> {
  const res = await router.POST(
    new Request(`http://localhost/api/flows/${kind}/actions/work`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: USER_ID, sessionId, input: { tag } })
    }),
    { params: { path: [kind, "actions", "work"] } }
  );
  const body = (await res.json()) as { request?: { id?: string } };
  const requestId = body.request?.id;
  if (requestId === undefined) throw new Error(`no request id (status ${res.status})`);
  return requestId;
}

async function untilSettled(
  runtime: Awaited<ReturnType<typeof boot>>["runtime"],
  requestIds: string[]
): Promise<Record<string, string | undefined>> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const statuses: Record<string, string | undefined> = {};
    for (const id of requestIds) statuses[id] = (await runtime.stores.request.get(id))?.status;
    if (Object.values(statuses).every((s) => s !== "in_progress" && s !== undefined)) return statuses;
    if (Date.now() > deadline) return statuses;
    await new Promise((r) => setTimeout(r, 50));
  }
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

let disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const d of disposers) await d().catch(() => {});
  disposers = [];
});

describe("P1 · a session's concurrency policy on the queue path", () => {
  it("in process: two queue-policy runs into one session never overlap (the reference)", async () => {
    const { spans, runtime, router, state } = await boot("poc-inproc", false);
    disposers.push(() => state.dispose());
    await seedSession(runtime, "s_r", "poc-inproc", "lin_1");
    const ids = await Promise.all([
      postWork(router, "poc-inproc", "s_r", "a"),
      postWork(router, "poc-inproc", "s_r", "b")
    ]);
    await untilSettled(runtime, ids);
    expect(spans).toHaveLength(2);
    expect(overlaps(spans[0]!, spans[1]!)).toBe(false);
  });

  it("on BullMQ: the same two runs overlap — the policy governs nothing", async () => {
    const { spans, runtime, router, state } = await boot("poc-queued", true);
    disposers.push(() => state.dispose());
    await seedSession(runtime, "s_r", "poc-queued", "lin_1");
    const ids = await Promise.all([
      postWork(router, "poc-queued", "s_r", "a"),
      postWork(router, "poc-queued", "s_r", "b")
    ]);
    const statuses = await untilSettled(runtime, ids);
    expect(Object.values(statuses)).toEqual(["completed", "completed"]);
    expect(spans).toHaveLength(2);
    // OBSERVED, not desired: this is the defect the spec's D1 closes.
    expect(overlaps(spans[0]!, spans[1]!)).toBe(true);
  });
});

describe("P2 · the incarnation guard across the queue", () => {
  async function deliverPastTheRefusal(
    runtime: Awaited<ReturnType<typeof boot>>["runtime"],
    kind: string,
    approvedLineage: string,
    tag: string
  ) {
    const operation = runtime.runtimeConfig.requestHost?.dispatchOperation;
    if (operation === undefined) throw new Error("no dispatch operation installed");
    return operation({
      source: "internal",
      action: "work",
      sessionId: "s_r",
      // Lie about the delivery kind so the host's `external-dispatcher` check
      // does not fire: this is what the queue path does once the refusal goes.
      delivery: "child",
      input: { tag },
      flowKind: kind,
      userId: USER_ID,
      orgId: DEFAULT_ORG_ID,
      metadata: {
        dispatch: {
          type: "internal",
          action: "work",
          from: { block: "deliver-work", sessionId: "s_sender", lineageId: "lin_sender" },
          recipientLineageId: approvedLineage
        }
      }
    });
  }

  it("runs a delivery whose approved lineage still matches", async () => {
    const { spans, runtime, state } = await boot("poc-lineage-ok", true);
    disposers.push(() => state.dispose());
    await seedSession(runtime, "s_r", "poc-lineage-ok", "lin_current");
    const started = await deliverPastTheRefusal(runtime, "poc-lineage-ok", "lin_current", "ok");
    expect("requestId" in started).toBe(true);
    const id = (started as { requestId: string }).requestId;
    const statuses = await untilSettled(runtime, [id]);
    expect(statuses[id]).toBe("completed");
    expect(spans.map((s) => s.tag)).toEqual(["ok"]);
  });

  it("drops a delivery whose recipient was replaced, in the worker", async () => {
    const { spans, runtime, state } = await boot("poc-lineage-stale", true);
    disposers.push(() => state.dispose());
    await seedSession(runtime, "s_r", "poc-lineage-stale", "lin_replacement");
    const started = await deliverPastTheRefusal(runtime, "poc-lineage-stale", "lin_original", "stale");
    expect("requestId" in started).toBe(true);
    await new Promise((r) => setTimeout(r, 1_500));
    // The handler never ran against the replacement session…
    expect(spans).toEqual([]);
    // …and the acceptance-time record was reconciled away, as in process.
    const id = (started as { requestId: string }).requestId;
    expect(await runtime.stores.request.get(id)).toBeUndefined();
  });
});

describe("control · the refusal the spec narrows", () => {
  it("refuses a dispatcher() into an existing session by name on this host today", async () => {
    const { spans, flow, runtime, state } = await boot("poc-refusal", true);
    disposers.push(() => state.dispose());
    await seedSession(runtime, "s_r", "poc-refusal", "lin_1");
    const sent = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "deliver",
      input: { to: "s_r", tag: "refused" },
      userId: USER_ID,
      sessionId: "s_sender",
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    });
    expect(sent.error?.message).toMatch(/external-dispatcher/);
    expect(spans).toEqual([]);
  });
});
