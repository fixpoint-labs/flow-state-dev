---
title: Receive a Stripe webhook
type: recipe
description: "Run a flow action when Stripe marks an invoice paid, with a verified signature, and test it locally with the Stripe CLI."
---

# Receive a Stripe webhook

When Stripe marks an invoice paid, you want to record it. Stripe signs every
delivery, so the server checks the signature before anything runs. By the end
you have an endpoint Stripe can POST to and a `billing` flow that records each
payment. You test it locally with the Stripe CLI.

## 1. The flow declares routing

The flow says which Stripe event runs which block. The secret and the signature
check go on the server, in step 2.

`recordPayment` is the block that does the work. `ledger` is your own helper
that writes to your database; this stub stands in for it.

```ts title="src/lib/ledger.ts"
export const ledger = {
  async recordPayment(invoiceId: string, cents: number): Promise<void> {
    // Replace with an upsert into your database, keyed on invoiceId.
  },
};
```

```ts title="src/flows/billing/blocks/record-payment.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { ledger } from "../../../lib/ledger";

export const recordPayment = handler({
  name: "record-payment",
  inputSchema: z.object({ invoiceId: z.string(), amountCents: z.number() }),
  execute: async ({ invoiceId, amountCents }) => {
    // Idempotent write keyed on invoiceId: Stripe delivers at-least-once.
    await ledger.recordPayment(invoiceId, amountCents);
  },
});
```

```ts title="src/flows/billing/flow.ts"
import { defineFlow, defineWebhookBinding } from "@flow-state-dev/core";
import { recordPayment } from "./blocks/record-payment";

interface StripeEvent {
  id: string;
  type: string;
  data: { object: { id: string; customer: string; amount_paid: number } };
}

export const billingFlow = defineFlow({
  kind: "billing",
  actions: {}, // no caller-facing actions: webhooks are the only way in
  authentication: { defaultUserId: "system", requireUser: false },
  webhooks: {
    stripe: {
      on: {
        "invoice.paid": defineWebhookBinding<StripeEvent>({
          block: recordPayment,
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

`requireUser: false` with `defaultUserId: "system"` runs each delivery as a
system user, since no signed-in user sends a webhook. `sessionId` keeps each
customer's payments in one session; drop it if you don't need that.

## 2. The server verifies and parses

The server checks the signature and reads the event type. You set both up on
`createWebhookTransportAdapter`, under the same `stripe` name the flow used.

```ts title="src/lib/flowstate.ts"
import {
  createFlowState,
  createWebhookTransportAdapter,
  inMemoryStores,
  stripeWebhookVerifier,
} from "@flow-state-dev/engine";
import { billingFlow } from "../flows/billing/flow";

export const flowstate = createFlowState({
  flows: [billingFlow()],
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

```ts title="src/app/api/flows/[...path]/route.ts"
import { flowstate } from "../../../../lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
```

The endpoint is `POST /api/flows/billing/webhooks/stripe`.
`stripeWebhookVerifier` checks the `Stripe-Signature` header against your secret
and rejects deliveries older than five minutes.

`deliveryId` puts Stripe's event id on `metadata.webhook.deliveryId` of the
delivery's request. Stripe delivers at least once and the framework does not
deduplicate, so a redelivered event reaches your block again with the same id.
The reference covers keying a write on it when a block has no natural key like
`invoiceId`.

## 3. Test it locally

The Stripe CLI forwards events to your local server and signs them with a real
secret, so you exercise the verification path end to end.

```bash
# Forward Stripe events to your local endpoint. Prints a signing secret.
stripe listen --forward-to localhost:3000/api/flows/billing/webhooks/stripe
```

`stripe listen` prints a `whsec_...` secret and keeps its terminal. In the
terminal where you run your server, export the secret, then start the server, so
the verifier matches:

```bash
export STRIPE_WEBHOOK_SECRET=whsec_...
```

From a third terminal, trigger an `invoice.paid` event:

```bash
stripe trigger invoice.paid
```

The CLI reports a `202` from your endpoint. The block runs after the response,
so check your ledger for the invoice id.

The [webhook receivers reference](/docs/server/webhooks) covers the other
response codes, `route` for dynamic mapping, the `when` predicate and
idempotency.
