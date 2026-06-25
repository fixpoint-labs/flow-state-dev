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
is this: a flow declares which chat events trigger which handler, directly on
the flow definition. Each binding carries its handler inline (the shared
action core), so you read one file to know what fires it and what runs.

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
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
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
handles platforms that use challenge-response verification). The mount takes
just `{ bot }` — routing lives on the flows. An inbound event that matches no
subscription is acknowledged and dropped.

## Declaring subscriptions on the flow

Put a `chat.on` map on the flow. Each key is a chat event kind; each value
binds it to a handler and says how the event maps to that handler's input.

A binding carries the handler inline (the shared action core) instead of
naming an entry in `flow.actions`. Same model the webhook transport uses. An
event-addressed handler lives only on `chat.on`, so it has no HTTP or MCP
caller surface. If you want one block reachable both as a named action and as
a chat handler, declare it in both places (same block reference).

```ts
import { defineFlow } from "@flow-state-dev/core";
import { defineChatBinding } from "@flow-state-dev/chat-sdk";

const supportFlow = defineFlow({
  kind: "support",
  chat: {
    on: {
      mention: defineChatBinding({
        block: replyBlock,
        input: (event) => ({ text: event.message?.text ?? "" }),
      }),
      reaction: defineChatBinding({
        block: escalateBlock,
        when: (event) => event.platform === "slack",
        input: (event) => ({ emoji: event.actionValue }),
      }),
    },
  },
});
```

A binding carries the action core plus the event mapping:

- **`block`** — the handler to run for the event. Required.
- **`input`** — maps the event to the handler's input. May be async.
- **`sessionId`** (optional) — derives the session id from the event. May be
  async. Defaults to the originating thread's id.
- **`when`** (optional) — a synchronous predicate. A falsy result skips the
  binding; other bindings still evaluate.

It also accepts the rest of the action core: `durable`, `tokenBudget`,
`onCompleted` / `onErrored`, `inputSchema`, `userMessage`. The dispatched
request records the handler block's name as its action (provenance only — the
handler is never reachable through the action endpoint).

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

- **Fan-out is broadcast.** Two flows subscribing to the same event both
  run, independently.
- **No match is a no-op ack.** An event with no matching subscription is
  acknowledged and dropped. No event throws at dispatch.

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

## Migrating from adapter-mount routing

Earlier versions let the adapter mount carry a `route(event)` callback or a
static `flowKind`/`action` pair. Those options are gone. Chat is purely
declarative `on:` now, the same as webhooks.

Re-express imperative or content-based routing as `chat.on` bindings with
`when` predicates. A `route()` that inspected the event and picked a flow
becomes one binding per target, each gated by the condition the old callback
checked:

```ts
// Before: imperative routing at the mount.
createChatTransportAdapter({
  bot,
  route: (event) => ({ flowKind: "legacy", action: "chat", input: event.raw }),
});

// After: a declarative binding on the flow it routed to.
const legacyFlow = defineFlow({
  kind: "legacy",
  chat: {
    on: {
      mention: defineChatBinding({
        block: chatBlock,
        input: (event) => event.raw,
      }),
    },
  },
});
```

Whatever the old `route()` returned `skip` for becomes an event with no
matching binding: a no-op ack.

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
