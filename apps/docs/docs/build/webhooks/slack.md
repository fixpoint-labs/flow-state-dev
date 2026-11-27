---
title: Receive Slack events
type: recipe
description: "Run a flow block when someone posts in a Slack channel your bot is in, with verified signatures and Slack's one-time URL check answered."
---

# Receive Slack events

When someone posts in a channel your bot is in, you want your backend to see it.
Slack's Events API does this by POSTing each event to a URL you give it, and
expecting a fast 2xx back. By the end you have an endpoint Slack can POST to and
a `slack` flow that ingests each message. The server answers Slack's one-time
URL check and rejects any request whose signature doesn't verify.

For event deliveries Slack ignores your response body, so a reply to a message
has to go out separately through Slack's Web API. This page covers receiving
only.

## 1. The flow declares routing

The flow says which Slack event runs which block. The secret, the signature
check and the URL check go on the server, in step 2.

`saveMessage` is your own helper that writes to your database; this stub stands
in for it. It takes Slack's `event_id` so the write can be made idempotent.

```ts title="src/lib/inbox.ts"
export const inbox = {
  async saveMessage(
    eventId: string | undefined,
    channel: string,
    user: string,
    text: string,
  ): Promise<void> {
    // Replace with a write to your database that does nothing if `eventId`
    // was already saved.
  },
};
```

```ts title="src/flows/slack/blocks/ingest-message.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { inbox } from "../../../lib/inbox";

export const ingestMessage = handler({
  name: "ingest-message",
  inputSchema: z.object({
    eventId: z.string().optional(),
    text: z.string(),
    user: z.string(),
    channel: z.string(),
  }),
  execute: async ({ eventId, text, user, channel }) => {
    await inbox.saveMessage(eventId, channel, user, text);
  },
});
```

Slack nests the event type inside the body, so the `on` key below is the inner
`event.type`, such as `message`. It is not the name of the subscription you pick
in Slack's settings (`message.channels`).

```ts title="src/flows/slack/flow.ts"
import { defineFlow, defineWebhookBinding } from "@flow-state-dev/core";
import { ingestMessage } from "./blocks/ingest-message";

interface SlackEventCallback {
  event: {
    type: string;
    text?: string;
    user?: string;
    channel: string;
    ts?: string;
  };
}

export const slackFlow = defineFlow({
  kind: "slack",
  actions: {}, // no caller-facing actions: webhooks are the only way in
  authentication: {
    // Only deliveries that passed the signature check get an identity.
    // Every other request, such as a read of these sessions, gets a 401.
    resolvePrincipal: ({ source }) =>
      source === "webhook" ? { orgId: "acme" } : null,
    defaultUserId: "slack-bot",
    requireUser: false,
  },
  webhooks: {
    slack: {
      on: {
        message: defineWebhookBinding<SlackEventCallback>({
          block: ingestMessage,
          // Skip events that carry no `user`.
          when: (e) => e.payload.event.user !== undefined,
          input: (e) => ({
            eventId: e.deliveryId,
            text: e.payload.event.text ?? "",
            user: e.payload.event.user ?? "",
            channel: e.payload.event.channel,
          }),
          sessionId: (e) => `channel-${e.payload.event.channel}`,
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
list these sessions and read each message's text.

`sessionId` keeps each channel's messages in one session; drop it if you don't
need that.

So two posts in #support and one in #billing make two sessions: the first
delivery for a channel creates its session and later ones reuse it. Both are
owned by `slack-bot`, not by the people who posted; the input's `user` is
Slack's id for the poster, not the run's user. Nobody reads these sessions over
HTTP. Your app shows messages by reading your own database, which the block
writes.

## 2. The server verifies and answers the URL check

The server's webhook receiver is `createWebhookTransportAdapter`. You give it a
provider entry under the same `slack` name the flow used. The entry checks the
signature, reads the event type and answers Slack's URL check.

```ts title="src/lib/flowstate.ts"
import { after } from "next/server";
import {
  createFlowState,
  createWebhookTransportAdapter,
  inMemoryStores,
  slackWebhookVerifier,
} from "@flow-state-dev/engine";
import { slackFlow } from "../flows/slack/flow";

interface SlackEnvelope {
  type?: string;             // "url_verification" | "event_callback"
  challenge?: string;        // present on the URL check
  event_id?: string;         // stable per-delivery id
  event?: { type?: string }; // "message" | "reaction_added" | ...
}

export const flowstate = createFlowState({
  flows: [slackFlow()],
  stores: { default: { primary: inMemoryStores() } },
  // Keep the function alive until the block finishes. The 202 goes out first.
  onBackgroundWork: (work) => after(() => work),
  adapters: [
    createWebhookTransportAdapter({
      providers: {
        slack: {
          verify: slackWebhookVerifier(() => process.env.SLACK_SIGNING_SECRET!),
          // Answer the one-time url_verification challenge and skip dispatch.
          acknowledge: (e) => {
            const p = e.payload as SlackEnvelope;
            return p.type === "url_verification" ? p.challenge ?? null : null;
          },
          // Real events carry their type under event.type.
          eventType: (payload) => {
            const p = payload as SlackEnvelope;
            return p.event?.type ?? p.type ?? null;
          },
          deliveryId: (payload) => (payload as SlackEnvelope).event_id,
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

Before Slack sends real events, it posts `{ "type": "url_verification",
"challenge": "..." }` and expects the challenge string echoed back. The
`acknowledge` hook returns it, so the server answers 200 with the challenge and
runs nothing. For every other request it returns `null` and routing continues.

`slackWebhookVerifier` checks Slack's signature on every request and rejects
stale ones. The secret is the signing secret from your Slack app's **Basic
Information** page, not a bot token.

The `deliveryId` hook hands Slack's `event_id` to the binding as
`e.deliveryId`, and `input` passes it on as `eventId`. Slack retries a delivery
it thinks was missed, and the framework does not deduplicate, so `saveMessage`
should do nothing when it has already seen that id.

The server answers before the block finishes, and Vercel can freeze the
function once the answer is sent. `onBackgroundWork` hands each run to Next's
`after()`, which keeps the function alive until the run ends. Without it, a
delivery can get its `202` and never finish, and Slack has no reason
to send it again.

## 3. Point Slack at the endpoint

The endpoint is `POST /api/flows/slack/webhooks/slack`. In your Slack app's
**Event Subscriptions** settings:

- Turn events on and set the **Request URL** to
  `https://your-app.example.com/api/flows/slack/webhooks/slack`.
- Slack immediately posts the URL check. The `acknowledge` hook answers it and
  the URL shows as Verified.
- Under **Subscribe to bot events**, add `message.channels` (and any others you
  want), then reinstall the app.

Events the flow has no binding for, such as a `reaction_added`, are
acknowledged and dropped, so subscribing to more than you bind is safe.

Slack allows three seconds for a response. The server answers
with a `202` carrying `status: "accepted"` and a `requestId` once the request is
recorded and before the block runs, so a slow block doesn't make Slack time out. If the request
can't be recorded, the answer is `503` and Slack retries. An error the block
throws is not in the response: it is recorded on the request that `requestId`
names.

The [webhooks reference](../../reference/webhooks.md) covers the response
codes, timing, the `when` predicate and idempotency.
