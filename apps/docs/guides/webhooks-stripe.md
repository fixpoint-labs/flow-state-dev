---
title: Receiving Stripe webhooks
sidebar_label: Stripe
---

# Receiving Stripe webhooks

This guide wires Stripe's `invoice.paid` event to a flow action and tests it
locally with the Stripe CLI. By the end you'll have an endpoint Stripe can POST
to, a verified signature, and an action that records the payment.

**What we're building:** when Stripe marks an invoice paid, our `billing` flow
runs a `recordPayment` action. Stripe signs every delivery; we verify it before
doing anything. The action runs asynchronously, so Stripe gets its 2xx ack fast.

## 1. The flow declares routing

The flow says which Stripe event runs which action. Nothing else — no secret,
no signature code. Those imports come from `@flow-state-dev/core`.

```ts title="flows/billing.ts"
import { defineFlow, defineWebhookBinding, sequencer, handler } from "@flow-state-dev/core";
import { z } from "zod";

interface StripeEvent {
  id: string;
  type: string;
  data: { object: { id: string; customer: string; amount_paid: number } };
}

const recordPayment = handler({
  name: "record-payment",
  inputSchema: z.object({ invoiceId: z.string(), amountCents: z.number() }),
  execute: async ({ invoiceId, amountCents }) => {
    // Idempotent write keyed on invoiceId — Stripe delivers at-least-once.
    await ledger.recordPayment(invoiceId, amountCents);
  },
});

const recordPaymentPipeline = sequencer({ name: "record-payment-pipeline" })
  .tap(recordPayment);

export const billingFlow = defineFlow({
  kind: "billing",
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    recordPayment: { block: recordPaymentPipeline },
  },
  webhooks: {
    stripe: {
      on: {
        "invoice.paid": defineWebhookBinding<StripeEvent>({
          action: "recordPayment",
          input: (e) => ({
            invoiceId: e.payload.data.object.id,
            amountCents: e.payload.data.object.amount_paid,
          }),
          sessionId: (e) => `customer-${e.payload.data.object.customer}`,
        }),
      },
    },
  },
});
```

`requireUser: false` plus `defaultUserId: "system"` is the standard webhook auth
shape: no end user, run as a system principal. Deriving `sessionId` from the
customer id keeps each customer's payments in one session; drop it if you don't
need continuity.

## 2. The host verifies and parses

Verification and the Stripe-specific mechanics live on the adapter mount, keyed
by the `stripe` provider name. Stripe carries the event type in the body
(`payload.type`) and a stable delivery id (`payload.id`).

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";
import {
  createWebhookTransportAdapter,
  stripeWebhookVerifier,
} from "@flow-state-dev/server";
import { billingFlow } from "@/flows/billing";

export const flowstate = createFlowState({
  flows: { billingFlow },
  stores: { default: { primary: inMemoryStores() } },
  adapters: [
    createWebhookTransportAdapter({
      providers: {
        stripe: {
          verify: stripeWebhookVerifier(() => process.env.STRIPE_WEBHOOK_SECRET!),
          eventType: (payload) => (payload as { type: string }).type,
          deliveryId: (payload) => (payload as { id: string }).id,
        },
      },
    }),
  ],
});
```

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
```

The endpoint is now live at `POST /api/flows/billing/webhooks/stripe`.
`stripeWebhookVerifier` reads `Stripe-Signature`, signs `<timestamp>.<rawBody>`,
and rejects deliveries older than five minutes. Wiring `deliveryId` puts
Stripe's event id on `metadata.webhook.deliveryId` so your action can dedup.

## 3. Test it locally

The Stripe CLI forwards live events to your local server and signs them with a
real secret, so you exercise the verification path end to end.

```bash
# Forward Stripe events to your local endpoint. Prints a signing secret.
stripe listen --forward-to localhost:3000/api/flows/billing/webhooks/stripe
```

`stripe listen` prints a `whsec_...` secret. Put it in your environment so the
verifier matches:

```bash
export STRIPE_WEBHOOK_SECRET=whsec_...
```

Then trigger a `invoice.paid` event from another terminal:

```bash
stripe trigger invoice.payment_succeeded
```

You should see the CLI report a `200`/`202` back from your endpoint, and your
`recordPayment` action run in the server logs (or the DevTool request list, with
a `webhook` badge). A 401 means the secret doesn't match what `stripe listen`
printed; a 404 means the provider name or flow kind in the URL is off.

## What you have

- A verified Stripe endpoint at `POST /api/flows/billing/webhooks/stripe`.
- `invoice.paid` deliveries routed to `recordPayment`, keyed per customer.
- Fast 2xx acks — the action runs after the response, well inside Stripe's
  retry budget.

For the full surface — `route` for dynamic mapping, the `when` predicate,
idempotency details — see the [webhook receivers reference](/docs/server/webhooks).
