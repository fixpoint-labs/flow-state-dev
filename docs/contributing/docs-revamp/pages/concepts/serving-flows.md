---
title: Serving flows
type: concept
description: One config object turns your flows into a running app, and a page, a terminal, an MCP client, a webhook and a schedule all reach it through that object.
---

import Figure from "@site/src/components/Figure";
import WaysIn from "./figures/ways-in.svg";

# Serving flows

A flow is a self-contained system in your app, with actions that clients call. Serving flows is the step that makes them callable. One config object lists your flows, says where the app keeps its data and which models it uses, and gives you back a running app.

The example is a support desk with three flows. `support` has a `reply` action that a page calls. `billing` is started by Stripe. `digest` is started by a schedule.

<Figure svg={WaysIn} caption="Every way in ends at a run" description={"Three boxes on the left and two on the right surround one box in the middle, the running app, which holds the support, billing and digest flows from one config object. On the left, a browser page, the fsdev run terminal command and an MCP client such as Claude Desktop each call support.reply. On the right, Stripe runs the block billing binds and a scheduler runs the block digest binds. Five arrows, keyed as starts a run, point from those five boxes at the app. Inside the app, one highlighted box reads a run, recorded like any other, where the source says which door it came through. The highlight marks the one idea: every door ends there."} />

## One object

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import support from "./src/flows/support/flow";
import billing from "./src/flows/billing/flow";
import digest from "./src/flows/digest/flow";

export default createFlowState({
  flows: [support, billing, digest],
  models: { default: "openai/gpt-6-luna" },
  stores: sqliteStores({ filename: ".fsdev/data/support.db" }),
});
```

`flows` is a list. Each is served under its own id, its `kind`. A keyed object such as `flows: { support }` throws when the app starts.

`models` names the default model. Leave it out and Flow State finds providers from environment variables such as `OPENAI_API_KEY`. `stores` says where the app keeps what it saves: sessions, state, requests. Leave it out and everything lives in memory and is gone on restart. Models and stores are set here, not on a host and not in a flow.

Keep this file apart from your route handler. The route imports it, and the `fsdev` command loads its default export. Every other option is in [Runtime options](../reference/runtime.md).

## What it serves

Every flow gets HTTP routes under `/api/flows`, with the flow's id next: `/api/flows/support/...`. Calling `reply` is a `POST` to `/api/flows/support/actions/reply`. It answers `202 Accepted` with a request id, runs the action, and streams the result back as server-sent events. [HTTP API](../reference/http-api.md) has the rest of the routes.

A flow with no `authentication` takes the caller's `userId` from the request body. That is for development only. [Authentication](../reference/authentication.md) covers what to set before you expose a flow.

## Where it runs

The flows do not change with the host. What changes is the file that mounts the app. On Next.js that is a route file, shown in [Add to an existing app](../start/add-to-an-existing-app.md). On a plain Node process it is one call.

```ts title="src/server.ts"
import { serve } from "@flow-state-dev/node";
import flowstate from "../fsdev.config";

await serve(flowstate);
```

`serve` listens on `$PORT`, or 3000, and answers `/healthz`. On `SIGTERM` it finishes the requests in flight and releases the stores. `fsdev serve` does the same from the terminal, using `fsdev.config.ts`.

## Other ways in

HTTP is the built-in door. The others are adapters you add to `createFlowState` with `adapters`, and each one hands the app the same kind of request.

**A terminal.** `fsdev run support reply -i '{"message":"hi"}'` calls the action with the stores and models from `fsdev.config.ts`.

**MCP.** The Model Context Protocol is how clients such as Claude Desktop use outside tools. Set `mcp: { enabled: true }` on `support` and add `createMcpTransportAdapter()` from `@flow-state-dev/mcp` to `adapters`, and its actions become tools. An MCP call is an action call. See [MCP server](../reference/mcp-server.md).

**A webhook.** Stripe posting to your app is not an action call. A webhook has no action name for a caller to send. The flow says which block runs for which event, where a block is a unit of work.

```ts title="src/flows/billing/flow.ts"
import { defineFlow, defineWebhookBinding } from "@flow-state-dev/core";
import { recordPayment } from "./blocks/record-payment";

export default defineFlow({
  kind: "billing",
  actions: {},
  authentication: { defaultUserId: "system", requireUser: false },
  webhooks: {
    stripe: {
      on: {
        "invoice.paid": defineWebhookBinding<{ id: string }>({
          block: recordPayment,
          input: (e) => ({ invoiceId: e.payload.id }),
        }),
      },
    },
  },
})();
```

`input` turns Stripe's event into the input of `recordPayment`. `actions` is empty because there is nothing for a caller to call, and the run belongs to a `system` user. The flow holds no secret. The app adds `createWebhookTransportAdapter` to `adapters`, with the signing secret and how to verify Stripe's signature. Stripe is pointed at `POST /api/flows/billing/webhooks/stripe`. See [Webhooks](../reference/webhooks.md) and the [Stripe recipe](../build/webhooks/stripe.md).

**A schedule.** A schedule is a name and a cron string on the flow, with the block to run. Flow State does not own the clock. Your scheduler, such as Vercel Cron or EventBridge, calls the schedule's dispatch endpoint when the time comes, and `createScheduledTransportAdapter()` from `@flow-state-dev/scheduled` runs the block. It is not an action call either. See [Schedules](../reference/schedules.md).

Voice is not a separate door. It adds speech to the HTTP path.

## What it gets you

- **A flow is written once.** `support` is reached by a page, a terminal and an MCP client with no code for each.
- **Moving hosts changes one file.** Going from a Next.js route to `serve` touches the mount file, not `support`, `billing` or `digest`.
- **A forged webhook never starts a block.** A bad signature gets a 401 and `recordPayment` does not run. A good one gets a `202` at once, and the block runs after the response.
- **A misconfigured app fails when it starts.** A duplicate flow id, an empty `stores` map and a webhook provider the host did not set up each throw at startup.

## How it fits with the others

[Flows and actions](./flows-and-actions.md) define what is served: the actions a flow exposes are its HTTP and MCP surface. [Auth and tenancy](./auth-and-tenancy.md) decides who may use each door. [Persistence](./persistence.md) covers what `stores` keeps. A flow that hands work to another flow dispatches it, which is not a door: see [Background work](./background-work.md).

## Next

- [Add to an existing app](../start/add-to-an-existing-app.md) mounts the handler in a Next.js route.
- [Stripe webhook](../build/webhooks/stripe.md) builds the `billing` flow end to end.
- [Runtime options](../reference/runtime.md) lists every option on `createFlowState`.
