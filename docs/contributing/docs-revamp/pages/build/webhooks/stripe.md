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
    console.log("recorded", invoiceId, cents);
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
  authentication: {
    // Only deliveries that passed the signature check get an identity.
    // Every other request, such as a read of these sessions, gets a 401.
    resolvePrincipal: ({ source }) =>
      source === "webhook" ? { orgId: "acme" } : null,
    defaultUserId: "system",
    requireUser: false,
  },
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

`resolvePrincipal` decides who a request runs as. It runs after the signature
check, so `source === "webhook"` means the delivery is genuine. It returns your
organization's id (`acme` here), and `defaultUserId` names the user, since no
signed-in user sends a webhook. Any other request gets `null`, which the server
answers with a 401. Without a resolver, anyone who can reach the server could
list these sessions and read each request's input, the invoice id and amount.

`sessionId` keeps each customer's payments in one session; drop it if you
don't need that. Your app shows payments by reading your own database, which
the block writes.

## 2. The server verifies and parses

The server checks the signature, reads the event type and picks out the
delivery id. You set all three on `createWebhookTransportAdapter`, under the
same `stripe` name the flow used.

```ts title="src/lib/flowstate.ts"
import { after } from "next/server";
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
  // Keep the function alive until the block finishes. The 202 goes out first.
  onBackgroundWork: (work) => after(() => work),
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
and rejects a timestamp more than five minutes from the server's clock. The
check runs first, on the raw body, before the body is parsed or a session is
created. A forged delivery gets a 401, and nothing runs.

`deliveryId` records Stripe's event id with each delivery. Stripe delivers at
least once and the framework does not deduplicate, so a redelivered event runs
your block again. Keying the write on `invoiceId` makes that harmless.

The server answers before the block finishes, and Vercel can freeze the
function once the answer is sent. `onBackgroundWork` hands each run to Next's
`after()`, which keeps the function alive until the run ends. Without it, a
delivery can get its `202` and never finish, and Stripe has no reason
to send it again.

What a delivery gets back:

| Response | When |
| --- | --- |
| `202 { status: "accepted" }` | Signature good and the event type has a binding. The block runs after the response. |
| `202 { status: "ignored" }` | Signature good but no binding for the event type, such as `customer.created`. Nothing runs. |
| `401 { error: "invalid_signature" }` | Wrong secret or signature, or a timestamp outside five minutes. |
| `404 { error: "webhook_not_found" }` | The provider in the URL is not declared on the flow or the server, such as `.../webhooks/strip`. |
| `404 { error: "flow_not_found" }` | No flow has the id in the URL. |
| `400 { error: "invalid_payload" }` | The body is not JSON. |

## 3. Test it locally

The Stripe CLI forwards events to your local server and signs them with a real
secret, so you exercise the verification path end to end.

```bash
# Forward Stripe events to your local endpoint. Prints a signing secret.
stripe listen --forward-to localhost:3000/api/flows/billing/webhooks/stripe
```

`stripe listen` prints a `whsec_...` secret and keeps running, so leave that
terminal open. In the
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
and your server log shows `recorded`, the invoice id (`in_...`) and the amount
in cents.

The [webhooks reference](../../reference/webhooks.md) covers `route` for
dynamic mapping, the `when` predicate and idempotency.
