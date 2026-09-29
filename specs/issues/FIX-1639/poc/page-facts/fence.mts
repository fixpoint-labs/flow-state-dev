/**
 * FIX-1639 · poc/page-facts/fence.mts — throwaway, retained as evidence.
 *
 * Runs the page's queue-host fence paragraph against the shipped runtime, on the path a
 * BullMQ host takes: `createFlowState` with a dispatcher that has no `dispatchLocal`
 * (the host's own test for "external", and exactly what `createWorkerDispatcher` lacks),
 * and a queued job consumed by `runAction` the way `createFlowJobProcessor` consumes one.
 *
 *   F1  a `{ key }` dispatch is enqueued, not refused
 *   F2  an `{ id }` delivery is refused `external-dispatcher`, and nothing is enqueued
 *   F3  a `{ from: true }` reply from a queued run is refused the same way
 *   F4  a webhook with a `sessionId` naming an existing session is enqueued, not refused
 *
 * Control: `CONTROL=in-process` boots the same flow with no queue. F2 and F3 must FAIL
 * (the delivery goes through), F1 and F4 must FAIL too (nothing reaches a queue), which
 * shows each check reads the dispatcher, not a constant.
 *
 * Run from the repo root:  pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/fence.mts
 */
import { z } from "zod";
import {
  DEFAULT_ORG_ID,
  defineFlow,
  defineWebhookBinding,
  dispatcher,
  handler
} from "../../../../../packages/core/src/index.ts";
import {
  createFlowState,
  createWebhookTransportAdapter,
  inMemoryStores,
  runAction
} from "../../../../../packages/engine/src/index.ts";
import type { DispatchEnvelope, FlowDispatcher } from "../../../../../packages/engine/src/transports/dispatcher.ts";

const CONTROL = process.env.CONTROL === "in-process";
const USER = "system";
const KIND = "fence";

const ran: string[] = [];
const work = handler({
  name: "work",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({}),
  execute: async (input, ctx) => {
    ran.push(`${ctx.session.identity.id}:${input.note}`);
    return {};
  }
});
const spawn = dispatcher({
  name: "spawn",
  action: "reply",
  inputSchema: z.object({ key: z.string() }),
  session: { key: (i) => i.key },
  payload: () => ({})
});
const deliver = dispatcher({
  name: "deliver",
  action: "work",
  inputSchema: z.object({ to: z.string() }),
  session: { id: (i) => i.to },
  payload: () => ({ note: "id" })
});
// The dispatched run's block: reply into the session that sent it.
const reply = dispatcher({
  name: "reply",
  action: "work",
  inputSchema: z.object({}).passthrough(),
  session: { from: true },
  payload: () => ({ note: "from" })
});

const flow = defineFlow({
  kind: KIND,
  authentication: { defaultUserId: USER, requireUser: false },
  actions: { spawn: { block: spawn }, deliver: { block: deliver } },
  internal: { actions: { work: { block: work }, reply: { block: reply } } },
  webhooks: {
    test: {
      on: {
        ping: defineWebhookBinding({
          block: work,
          input: () => ({ note: "hook" }),
          sessionId: () => "s_existing"
        })
      }
    }
  }
})({ id: KIND });

const enqueued: DispatchEnvelope[] = [];
const queue: FlowDispatcher = {
  dispatch: async (envelope) => {
    enqueued.push(envelope);
    return {
      requestId: envelope.requestId,
      finished: Promise.resolve({ status: "completed" } as never)
    } as never;
  },
  close: async () => {}
};

const state = createFlowState({
  flows: { [KIND]: flow },
  stores: { default: { primary: inMemoryStores() } },
  adapters: [
    createWebhookTransportAdapter({
      providers: { test: { verify: () => true, eventType: (p) => (p as { type: string }).type } }
    })
  ],
  ...(CONTROL ? {} : { dispatcher: queue })
});
const runtime = await state.getRuntime();
const router = await state.getRouter();

async function seed(id: string) {
  const ts = Date.now();
  await runtime.stores.session.set(
    id,
    { id, state: {}, version: 0, createdAt: ts, updatedAt: ts, flowKind: KIND, userId: USER,
      orgId: DEFAULT_ORG_ID, lineageId: `lin_${id}`, journal: [] } as never,
    "any"
  );
}
const act = (actionName: string, input: unknown, extra: Record<string, unknown> = {}) =>
  runAction({ orgId: DEFAULT_ORG_ID, flow, actionName, input, userId: USER, sessionId: "s_sender",
    stores: runtime.stores, runtimeConfig: { ...runtime.runtimeConfig }, ...extra } as never);
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 5)); };

const results: [string, boolean, string][] = [];
const check = (id: string, pass: boolean, saw: string) => results.push([id, pass, saw]);

await seed("s_existing");

// F1 — key
const before1 = enqueued.length;
const r1 = await act("spawn", { key: "doc-1" });
await settle();
check("F1 key dispatch is enqueued", r1.error === undefined && enqueued.length === before1 + 1,
  `error=${r1.error?.message ?? "none"} enqueued=${enqueued.length - before1}`);

// F2 — id
const before2 = enqueued.length;
const r2 = await act("deliver", { to: "s_existing" });
await settle();
check("F2 id delivery refused external-dispatcher, nothing enqueued",
  /external-dispatcher/.test(r2.error?.message ?? "") && enqueued.length === before2,
  `error=${r2.error?.message?.slice(0, 80) ?? "none"} enqueued=${enqueued.length - before2}`);

// F3 — from: true, from the job F1 enqueued, consumed the way the BullMQ job processor does
const job = enqueued.find((e) => e.actionName === "reply");
let f3 = "no queued job to consume";
let f3pass = false;
if (job !== undefined) {
  const before3 = enqueued.length;
  const r3 = await runAction({
    flow, actionName: job.actionName, input: job.input, userId: job.userId, sessionId: job.sessionId,
    requestId: job.requestId, orgId: job.orgId, source: job.source, metadata: job.metadata,
    stores: runtime.stores, runtimeConfig: { ...runtime.runtimeConfig }
  } as never);
  await settle();
  f3pass = /external-dispatcher/.test(r3.error?.message ?? "") && enqueued.length === before3;
  f3 = `error=${r3.error?.message?.slice(0, 80) ?? "none"} enqueued=${enqueued.length - before3}`;
}
check("F3 from:true reply refused external-dispatcher", f3pass, f3);

// F4 — webhook into an existing session
const before4 = enqueued.length;
const res = await router.POST(
  new Request(`http://localhost/api/flows/${KIND}/webhooks/test`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "ping" })
  }),
  { params: { path: [KIND, "webhooks", "test"] } }
);
await settle();
const hook = enqueued.slice(before4).find((e) => e.sessionId === "s_existing");
check("F4 webhook with sessionId into an existing session is enqueued", res.status === 202 && hook !== undefined,
  `status=${res.status} enqueued-into-existing=${hook !== undefined}`);

await state.dispose();
console.log(CONTROL ? "CONTROL=in-process (every check must FAIL)" : "external dispatcher (queue host)");
for (const [id, pass, saw] of results) console.log(`${pass ? "PASS" : "FAIL"}  ${id}  · ${saw}`);
console.log(`ran in process: ${JSON.stringify(ran)}`);
process.exit(results.every(([, p]) => p) ? 0 : 1);
