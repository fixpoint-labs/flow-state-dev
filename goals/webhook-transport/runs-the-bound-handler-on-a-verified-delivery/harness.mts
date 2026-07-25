/**
 * Real-path driver for the webhook goal check. Copied into `apps/kitchen-sink`
 * and run there as a real ESM file by run.mts
 * (via `runHarness`) so `@flow-state-dev/*` and `zod` resolve from
 * the app's node_modules — goals/ is not a package.
 *
 * Mounts the real webhook adapter on a real `createInboundTransportHost`, sends
 * a real signed Stripe-style POST through the adapter's route handler, and a
 * forged one, then reads the session store back. The webhook ack is
 * fire-and-forget (202), so it intercepts `host.dispatch` to capture the handle
 * and `await handle.finished` — driving the handler to completion (and
 * surfacing any handler error). It only DRIVES and reports observations on a
 * single `__GOAL__<json>` line; run.mts owns the assertions (graded against the
 * held-out fixture). Inputs arrive via env so this file hardcodes nothing.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver,
  createWebhookTransportAdapter,
  stripeWebhookVerifier,
} from "@flow-state-dev/engine";

const fixture = JSON.parse(process.env.GOAL_FIXTURE ?? "{}") as {
  invoiceId: string;
  customer: string;
  memo: string;
};
const SECRET = process.env.GOAL_SECRET ?? "whsec_goal_check";
const MODEL = process.env.GOAL_MODEL ?? "openai/gpt-5.4-mini";

interface StripeEvent {
  type: string;
  data: { object: { id: string; customer: string; memo: string } };
}

const recordInvoice = handler({
  name: "record-invoice",
  inputSchema: z.object({ invoiceId: z.string() }),
  execute: async (input, ctx) => {
    // setState replaces the whole state object, so merge with the current value.
    await ctx.session.setState({ ...ctx.session.state, lastInvoice: input.invoiceId });
  },
});

const extractCompany = generator({
  name: "extract-company",
  model: MODEL,
  inputSchema: z.object({ memo: z.string() }),
  prompt:
    "You read a payment memo and extract the paying company's name. " +
    "Respond with only the company name — no other words.",
  user: (input: { memo: string }) => input.memo,
  outputSchema: z.object({ company: z.string() }),
});

const recordCompany = handler({
  name: "record-company",
  inputSchema: z.object({ company: z.string() }),
  execute: async (input, ctx) => {
    await ctx.session.setState({ ...ctx.session.state, company: input.company });
  },
});

const recordPayment = sequencer({ name: "record-payment" })
  .tap(recordInvoice)
  .step(extractCompany)
  .tap(recordCompany);

const billingFlow = defineFlow({
  kind: "billing",
  authentication: { defaultUserId: "system", requireUser: false },
  session: {
    stateSchema: z.object({ lastInvoice: z.string(), company: z.string() }).partial(),
  },
  actions: {},
  webhooks: {
    stripe: {
      on: {
        "invoice.paid": {
          block: recordPayment,
          input: (e: { payload: StripeEvent }) => ({
            invoiceId: e.payload.data.object.id,
            memo: e.payload.data.object.memo,
          }),
          sessionId: (e: { payload: StripeEvent }) =>
            `customer-${e.payload.data.object.customer}`,
        },
      },
    },
  },
})({ id: "billing" });

const registry = createFlowRegistry();
registry.register(billingFlow);
const stores = createInMemoryStores();

// Mount the real webhook adapter on a real host. We intercept `host.dispatch`
// to capture the dispatch handle so we can `await handle.finished` — the
// webhook ack is fire-and-forget (202), so the handler completes on a floating
// promise; awaiting it drives execution deterministically AND surfaces any
// handler error (instead of leaving the request silently `in_progress`).
const host = createInboundTransportHost({
  registry,
  stores,
  resolvePrincipal: defaultBodyUserIdPrincipalResolver,
  runtimeConfig: {},
});
let handle: { finished?: Promise<unknown> } | undefined;
const realDispatch = host.dispatch.bind(host);
(host as { dispatch: typeof host.dispatch }).dispatch = ((env: Parameters<typeof host.dispatch>[0]) => {
  handle = realDispatch(env) as { finished?: Promise<unknown> };
  return handle as ReturnType<typeof host.dispatch>;
}) as typeof host.dispatch;

const adapter = createWebhookTransportAdapter({
  providers: {
    stripe: {
      verify: stripeWebhookVerifier(SECRET),
      eventType: (p) => (p as StripeEvent).type,
      deliveryId: (p) => (p as { id: string }).id,
    },
  },
});
const bindings = adapter.createBindings(host);
bindings.start?.();
const route = bindings.routes!.find((r) => r.method === "POST")!;
const PARAMS = { params: { flowKind: "billing", provider: "stripe" } };

const URL_STR = "http://localhost/api/flows/billing/webhooks/stripe";

function signed(payload: unknown): Request {
  const raw = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", SECRET)
    .update(new TextEncoder().encode(`${ts}.${raw}`))
    .digest("hex");
  return new Request(URL_STR, {
    method: "POST",
    headers: { "stripe-signature": `t=${ts},v1=${sig}`, "content-type": "application/json" },
    body: raw,
  });
}

// Wrapped in an async main: harmless now that runHarness runs this as a real
// ESM file, and it keeps the error handling in one place.
async function main(): Promise<void> {
  // Forged delivery first: must be rejected, must leave no session.
  const forgedCustomer = "cus_forged_x";
  handle = undefined;
  const forgedRes = await route.handler(
    new Request(URL_STR, {
      method: "POST",
      headers: { "stripe-signature": "t=9999999999,v1=deadbeef", "content-type": "application/json" },
      body: JSON.stringify({
        type: "invoice.paid",
        id: "evt_forged",
        data: { object: { id: "in_forged", customer: forgedCustomer, memo: fixture.memo } },
      }),
    }),
    PARAMS,
  );
  const forgedSession = await stores.session.get(`customer-${forgedCustomer}`);

  // Verified delivery: acks 202 fire-and-forget; await the captured handle so the
  // handler (real generator + state writes) runs to completion before we read.
  handle = undefined;
  const verifiedRes = await route.handler(
    signed({
      type: "invoice.paid",
      id: "evt_goal",
      data: { object: { id: fixture.invoiceId, customer: fixture.customer, memo: fixture.memo } },
    }),
    PARAMS,
  );
  await handle?.finished;

  const s = await stores.session.get(`customer-${fixture.customer}`);
  const state = (s?.state as { lastInvoice?: string; company?: string } | undefined) ?? null;

  console.log(
    "__GOAL__" +
      JSON.stringify({
        verifiedStatus: verifiedRes.status,
        forgedStatus: forgedRes.status,
        forgedSessionExists: forgedSession !== undefined,
        state,
        model: MODEL,
      }),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("harness threw:", err);
  process.exit(1);
});

