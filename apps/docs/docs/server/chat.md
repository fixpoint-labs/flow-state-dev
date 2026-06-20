---
sidebar_position: 7
sidebar_label: Chat
---

# Chat transport

`@flow-state-dev/chat-sdk` turns a Vercel Chat SDK bot into an inbound
transport. Wrap one `Chat` instance and every platform it serves — Slack,
Microsoft Teams, Google Chat, Discord — drives your flows. Inbound messages
become action invocations; flow output streams back to the originating
thread.

If you're building anything past a single-flow demo, the part that matters
is this: a flow declares which chat events trigger which of its actions,
directly on the flow definition. You read one file to know what fires it.

This is the transport for real-time conversation. For asynchronous
service-to-service notifications — Slack's Events API, Stripe, GitHub — use
the [webhook transport](./webhooks.md) instead.

## Install and mount

```bash
pnpm add @flow-state-dev/chat-sdk chat
```

```ts title="lib/flowstate.ts"
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";
import { createChatTransportAdapter } from "@flow-state-dev/chat-sdk";

const bot = new Chat({
  userName: "fsd-bot",
  adapters: { slack: createSlackAdapter({ token: process.env.SLACK_BOT_TOKEN! }) },
});

export const flowstate = createFlowState({
  flows: { support: supportFlow },
  stores: { default: inMemoryStores() },
  adapters: [createChatTransportAdapter({ bot })],
});
```

`createFlowState` is the canonical entrypoint (see [Server setup](./setup.md)); the chat transport is just another entry in `adapters`. Turn the handle into route handlers with a platform adapter — the chat webhooks mount under the same router:

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
```

The adapter mounts `POST /api/chat/slack` and `GET /api/chat/slack` (the GET
handles platforms that use challenge-response verification). When your flows
declare their own subscriptions, that's the whole mount — no routing config.

## Declaring subscriptions on the flow

Put a `chat.on` map on the flow. Each key is a chat event kind; each value
binds it to an action and says how the event maps to that action's input.

```ts
import { defineFlow } from "@flow-state-dev/core";
import { defineChatBinding } from "@flow-state-dev/chat-sdk";

const supportFlow = defineFlow({
  kind: "support",
  actions: {
    reply: { block: replyBlock },
    escalate: { block: escalateBlock },
  },
  chat: {
    on: {
      mention: defineChatBinding({
        action: "reply",
        input: (event) => ({ text: event.message?.text ?? "" }),
      }),
      reaction: defineChatBinding({
        action: "escalate",
        when: (event) => event.platform === "slack",
        input: (event) => ({ emoji: event.actionValue }),
      }),
    },
  },
});
```

A binding has four fields:

- **`action`** — the flow action to run. Must be a key in `actions`;
  `defineFlow` throws at registration if it isn't. Provide this *or* `block`.
- **`block`** — an inline chat-only handler, in place of `action`. See
  [Chat-only handlers](#chat-only-handlers) below.
- **`input`** — maps the event to the action's input. May be async.
- **`sessionId`** (optional) — derives the session id from the event. May be
  async. Defaults to the originating thread's id.
- **`when`** (optional) — a synchronous predicate. A falsy result skips the
  binding; other bindings still evaluate.

### Chat-only handlers

When a handler exists only to service a chat event, adding it to the flow's
public `actions` would also expose it on the HTTP action endpoint and as an MCP
tool. To keep it private to the subscription, give the binding a `block`
instead of an `action`:

```ts
chat: {
  on: {
    mention: defineChatBinding({
      block: replyBlock, // a handler/sequencer/router/generator
      input: (event) => ({ text: event.message?.text ?? "" }),
    }),
  },
},
```

A binding declares exactly one of `action` or `block`; declaring both, or
neither, throws at registration. The block runs through the full dispatch
runtime — lifecycle, state, items, request records, DevTool — exactly like a
named action, but it has no HTTP or MCP surface, so it can only fire through this
chat subscription. It does not appear in the flow's listed actions. This mirrors
the [webhook transport's webhook-only handlers](./webhooks.md#webhook-only-handlers).

### Typed events with `defineChatBinding`

`defineChatBinding` is a typing convenience: it gives the `event` parameter
a `ChatInboundEvent` type instead of `unknown`. It does nothing at runtime —
a plain object literal works just as well, you just lose the event type. The
helper lives in `@flow-state-dev/chat-sdk` (not core) so the core package
stays independent of the chat-sdk.

## How dispatch works

At mount the adapter walks the flow registry once and indexes every
`chat.on` binding by event kind. For each inbound event it looks up the
matching bindings, filters them by `when`, and dispatches.

- **Flow-level subscriptions take total precedence.** When any binding
  matches, those bindings fire and the adapter-mount `route()`/`flowKind`
  (below) is not consulted.
- **Fan-out is broadcast.** Two flows subscribing to the same event both
  run, independently.
- **No match falls through** to the adapter-mount routing, if configured;
  otherwise the event is acked and dropped.

If neither any flow nor the adapter mount configures routing, the adapter
throws at startup instead of silently dropping events.

## Event kinds

Keys match `ChatInboundEvent.kind` exactly:

`mention`, `subscribedMessage`, `directMessage`, `messageMatch`, `reaction`,
`action`, `slashCommand`, `modalSubmit`, `assistantThreadStarted`,
`memberJoined`, `custom`.

The vocabulary is uniform across platforms — a `mention` binding fires on
Slack, Teams, and Discord alike. To scope a binding to one platform, use
`when: (e) => e.platform === "slack"`. Two notes for this release:
`messageMatch` is reserved but not yet wired to a handler, and `custom`
events carry only `kind` and `platform`, so narrow inside `input`/`when`.

## Streaming back to the thread

Flow output pipes back to the originating thread by default. Turn it off
per-flow with `chat.streamToThread: false`. The effective value resolves in
order: the flow's `chat.streamToThread`, then the adapter-mount
`flowOverrides[kind].streamToThread`, then the adapter's `streamToThread`,
defaulting to `true`.

## Adapter-mount routing (advanced)

The original routing surface — a `route(event)` callback or a static
`flowKind` on the adapter mount — still works. It's now a fallback:
consulted only when no flow-level subscription matches. Keep it for hosts
with custom pre-registry logic, or migrate one flow at a time by moving its
routing onto `chat.on`.

```ts
createChatTransportAdapter({
  bot,
  route: (event) => ({ flowKind: "legacy", action: "chat", input: event.raw }),
});
```

## Testing

The package ships mocks under `@flow-state-dev/chat-sdk/testing` for
exercising flows without a real bot. To unit-test subscription dispatch,
build the subscription index and drive events through the dispatch path
directly — see the package's `dispatch.test.ts` for the pattern.

## Limitations

- No wildcard event matching and no first-match-wins (exclusive) semantics.
- `when` is synchronous only; for async filtering, let the action run and
  reject inside it.
- Subscriptions are snapshotted at mount; hot reload is out of scope.
