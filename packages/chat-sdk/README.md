# @flow-state-dev/chat-sdk

Vercel Chat SDK as a Flow State Dev inbound transport.

Wrap a `chat` instance into a single `InboundTransportAdapter` and every platform the bot has registered (Slack, Microsoft Teams, Google Chat, Discord, plus future adapters) drives the same FSD flows. Inbound events become action invocations; the flow's output stream is piped back to the originating thread by default.

## Install

```bash
pnpm add @flow-state-dev/chat-sdk chat
```

`chat` is pinned to `4.29.0` here; the upstream SDK is pre-1.0 and ships breaking changes between minor versions, so the wrapper pins exact and bumps deliberately.

## Quick start

```ts
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createFlowApiRouter } from "@flow-state-dev/server";
import { createChatTransportAdapter } from "@flow-state-dev/chat-sdk";

const bot = new Chat({
  userName: "fsd-bot",
  adapters: {
    slack: createSlackAdapter({ token: process.env.SLACK_BOT_TOKEN! }),
  },
});

export const { POST, GET } = createFlowApiRouter({
  registry,
  stores,
  adapters: [
    createChatTransportAdapter({ bot, flowKind: "support" }),
  ],
});
```

The adapter mounts `POST /api/chat/slack` and `GET /api/chat/slack` (the GET is for platforms that use challenge-response verification). Every inbound message routes to `flowKind: "support"`, action `"chat"`. Flow output streams back to the thread.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `bot` | required | `Chat` instance or thunk returning one. Thunk form defers construction until first request. |
| `flowKind` | — | Adapter-mount static routing. Optional once flows declare `chat.on` (see below). |
| `action` | `"chat"` | Action name used with `flowKind`. |
| `route` | — | `(event) => { flowKind, action, input, sessionId?, skip? }`. Adapter-mount escape hatch. |
| `streamToThread` | `true` | Pipe flow output to the thread. Per-flow override via `chat.streamToThread`, then `flowOverrides`. |
| `itemToChunk` | — | `(event) => string \| null \| undefined`. Custom stream rendering; fall through with `undefined`. |
| `routePrefix` | `"/api/chat"` | Mount prefix. |
| `mountOAuthRoutes` | `false` | When `true`, mounts `GET ${prefix}/:platform/oauth/callback` for adapters that expose `handleOAuthCallback`. |
| `resolvePrincipal` | `${platform}:${author.id}` | Override identity derivation. Throw `PrincipalResolutionError` to reject. |
| `events` | all on | Per-callback opt-outs. |
| `flowOverrides` | — | `Record<flowKind, { streamToThread? }>`. Per-flow config. |

## Declaring subscriptions on the flow

A flow can declare which inbound chat events trigger which of its actions directly on its definition. The adapter discovers these at mount by walking the flow registry, so a multi-flow chat agent reads top to bottom — triggers and handlers sit together, and adding a flow needs no adapter-config edit.

```ts
import { defineFlow } from "@flow-state-dev/core";
import { defineChatBinding } from "@flow-state-dev/chat-sdk";

const supportFlow = defineFlow({
  kind: "support",
  actions: { reply: { block: replyBlock }, escalate: { block: escalateBlock } },
  chat: {
    on: {
      // event-kind key → which action fires and how the event maps to input
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

With every flow declaring its own subscriptions, the mount is a one-liner — no `flowKind` or `route`:

```ts
createChatTransportAdapter({ bot });
```

- **Keys** match `ChatInboundEvent.kind` exactly (`"mention"`, `"directMessage"`, `"reaction"`, `"slashCommand"`, …). The vocabulary is uniform across platforms, so a `mention` binding fires on every platform the bot serves. Narrow to one with `when: (e) => e.platform === "slack"`.
- **`input`** maps the event to the action input (may be async). **`sessionId`** overrides the default thread-id derivation (may be async). **`when`** is a synchronous predicate; a falsy result skips the binding.
- **`defineChatBinding<T>()`** is a typing convenience — it gives `event` a `ChatInboundEvent` type. Plain object literals work too; `event` is then `unknown`.
- Validation runs at `defineFlow`: a binding naming an action the flow doesn't declare throws at registration.

**Fan-out is broadcast.** Two flows subscribing to the same event both run, independently. **Precedence is total**: when any flow-level binding matches an event, the adapter-mount `route()`/`flowKind` is not consulted; it fires only as a fallback when nothing matched. That lets a host migrate one flow at a time.

If no flow declares `chat.on` and neither `flowKind` nor `route` is passed, the adapter throws at startup rather than silently dropping every event.

## Session / thread mapping

`sessionId` is the Chat SDK's canonical `thread.id` (e.g. `slack:C123:1234567890.123456`). First inbound event per thread creates the FSD session; subsequent events reuse it. The principal `userId` is `${platform}:${author.id}` by default.

## Capability

```ts
import { chatCapability } from "@flow-state-dev/chat-sdk";

const replyToThread = generator({
  uses: [chatCapability.presets({ threadContext: true })],
  async execute(input, ctx) {
    const platform = ctx.cap.chat.getPlatform(); // "slack"
    const thread = ctx.cap.chat.getThread();
    // ...
  },
});
```

Methods: `getThread`, `getMessage`, `getPlatform`, `getUserId`, `isDM`, `getParticipants`, `setThreadState`. All read the live thread bound to the request; values become `null` after the request finishes.

`threadContext` preset (opt-in) appends platform/thread/user identity to the generator's system prompt.

## Utility blocks

```ts
import { chatPost, chatTyping, chatReact } from "@flow-state-dev/chat-sdk";

const flow = sequencer()
  .tap(chatTyping)
  .then(answer) // generator
  .tap(chatPost.connectInput((out) => ({ text: out.answer })))
  .tap(chatReact.connectInput(() => ({ emoji: "white_check_mark" })));
```

Per BP-012, compose with `.tap()` — these blocks mutate external state and don't produce output worth threading.

## OAuth

`mountOAuthRoutes: true` enables `GET ${prefix}/:platform/oauth/callback` for any adapter that exposes a `handleOAuthCallback` method. Install initiation (the redirect *to* the platform's authorize URL) stays the host's responsibility — wire a handler at `/auth/${platform}/install` in your app.

## Testing

```ts
import { withChatContext, createMockThread } from "@flow-state-dev/chat-sdk/testing";

const { requestId, cleanup } = withChatContext({
  thread: createMockThread({ id: "slack:C1:1" }),
});
// run a block with ctx.request.identity.id = requestId; assert thread.posts
cleanup();
```

## Deviations from the original spec

- **OAuth callback** is duck-typed against `adapter.handleOAuthCallback` because the Chat SDK doesn't yet expose it on the base `Adapter` type — only Slack-style adapters surface one in 4.29.0.
- **Cross-thread sends** are not supported in this release (Chat SDK 4.29.0 has no `chat.getThread({ ... })`); utility blocks operate on the inbound thread only.
