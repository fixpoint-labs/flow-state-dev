---
title: Receiving Slack Events
sidebar_label: Slack Events
---

# Receiving Slack Events

Slack shows up in two transports, and picking the right one matters. This guide
covers the **Events API** — Slack's asynchronous server-to-server notifications,
received over the webhook transport. If you want a real-time conversational bot
instead, that's the [chat transport](/docs/server/chat), not this.

**What we're building:** when someone posts in a channel our bot is in, our
`slack` flow runs an `ingestMessage` action. We answer Slack's one-time URL
verification handshake, verify every signature, and read the event type out of
Slack's nested payload.

## Events API vs the chat transport

The [chat transport](/docs/server/chat) wraps a Slack bot for live
conversation: mentions, slash commands, reactions, replies streamed back into
the thread. It's bidirectional.

The Events API is one-directional. Slack POSTs your endpoint when something
happens — a message, a reaction, a member joining — and expects a fast 2xx. No
reply channel; the webhook transport returns a 202 and the action runs in the
background. Use it when you're ingesting Slack activity into your backend, not
holding a conversation.

## 1. The URL verification handshake

Before Slack sends real events, it posts a one-time challenge:

```json
{ "type": "url_verification", "challenge": "3eZbrw1a..." }
```

Slack expects the `challenge` string echoed straight back. The provider's
`acknowledge` hook handles this: return the challenge and the adapter responds
200 with it and skips dispatch. Return `null` for everything else and normal
routing proceeds.

## 2. The host verifies and answers the handshake

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import {
  createWebhookTransportAdapter,
  slackWebhookVerifier,
} from "@flow-state-dev/engine";
import { slackFlow } from "@/flows/slack";

interface SlackEnvelope {
  type?: string;            // "url_verification" | "event_callback"
  challenge?: string;       // present on the handshake
  event_id?: string;        // stable per-delivery id
  event?: { type?: string }; // "message" | "reaction_added" | ...
}

export const flowstate = createFlowState({
  flows: { slackFlow },
  stores: { default: { primary: inMemoryStores() } },
  adapters: [
    createWebhookTransportAdapter({
      providers: {
        slack: {
          verify: slackWebhookVerifier(() => process.env.SLACK_SIGNING_SECRET!),
          // Answer the one-time url_verification challenge, skip dispatch.
          acknowledge: (e) => {
            const p = e.payload as SlackEnvelope;
            return p.type === "url_verification" ? p.challenge ?? null : null;
          },
          // Event type lives nested under event.type for real events.
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

`slackWebhookVerifier` implements Slack's signing scheme: it signs
`v0:<timestamp>:<rawBody>`, with the timestamp coming from the
`X-Slack-Request-Timestamp` header and the signature from `X-Slack-Signature`,
and rejects stale requests (default five-minute window). The signing secret is
the one from your Slack app's **Basic Information** page, not a bot token.

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
```

## 3. The flow declares routing

The `on` keys match the nested `event.type` the host extracts.

```ts title="flows/slack.ts"
import { defineFlow, defineWebhookBinding, sequencer } from "@flow-state-dev/core";

interface SlackEventCallback {
  event: {
    type: string;
    text?: string;
    user?: string;
    channel?: string;
    ts?: string;
  };
}

export const slackFlow = defineFlow({
  kind: "slack",
  authentication: { defaultUserId: "slack-bot", requireUser: false },
  webhooks: {
    slack: {
      on: {
        message: defineWebhookBinding<SlackEventCallback>({
          block: ingestPipeline,
          // Ignore the bot's own messages to avoid a loop.
          when: (e) => e.payload.event.user !== undefined,
          input: (e) => ({
            text: e.payload.event.text ?? "",
            user: e.payload.event.user,
            channel: e.payload.event.channel,
          }),
          sessionId: (e) => `channel-${e.payload.event.channel}`,
        }),
      },
    },
  },
});
```

## 4. Point Slack at the endpoint

In your Slack app's **Event Subscriptions** settings:

- Turn events on and set the **Request URL** to
  `https://your-app.example.com/api/flows/slack/webhooks/slack`.
- Slack immediately posts the `url_verification` challenge. The `acknowledge`
  hook answers it; the URL shows as Verified.
- Under **Subscribe to bot events**, add `message.channels` (and any others you
  want), then reinstall the app.

Slack is strict about the response budget — three seconds — and retries on a
miss. Because the action runs after the 202, the ack returns fast no matter how
long ingestion takes. Slack stamps each delivery with `event_id`; wiring
`deliveryId` puts it on `metadata.webhook` so a retried delivery can be deduped
in your action.

## What you have

- A verified Slack Events endpoint that auto-answers the URL handshake.
- `message` events routed to `ingestMessage`, the bot's own messages filtered
  out, keyed per channel.
- The nested event type handled by the host's `eventType` extractor.

For the full surface — and when to use the [chat transport](/docs/server/chat)
instead — see the [webhook receivers reference](/docs/server/webhooks).
