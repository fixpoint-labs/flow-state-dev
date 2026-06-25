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
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createChatTransportAdapter } from "@flow-state-dev/chat-sdk";

const bot = new Chat({
  userName: "fsd-bot",
  adapters: {
    slack: createSlackAdapter({ token: process.env.SLACK_BOT_TOKEN! }),
  },
});

export const flowstate = createFlowState({
  flows: { support: supportFlow },
  stores: { default: inMemoryStores() },
  adapters: [createChatTransportAdapter({ bot })],
});
```

`createFlowState` is the canonical setup entrypoint; turn its handle into route handlers with a platform adapter (e.g. `createVercelNextHandler(flowstate)`). The chat adapter mounts `POST /api/chat/slack` and `GET /api/chat/slack` (the GET is for platforms that use challenge-response verification). Routing lives on the flows — each declares which chat events trigger which handler (see below). An inbound event that matches no subscription is acknowledged and dropped. Flow output streams back to the thread.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `bot` | required | `Chat` instance or thunk returning one. Thunk form defers construction until first request. |
| `streamToThread` | `true` | Pipe flow output to the thread. Per-flow override via `chat.streamToThread`, then `flowOverrides`. |
| `itemToChunk` | — | `(event) => string \| null \| undefined`. Custom stream rendering; fall through with `undefined`. |
| `routePrefix` | `"/api/chat"` | Mount prefix. |
| `mountOAuthRoutes` | `false` | When `true`, mounts `GET ${prefix}/:platform/oauth/callback` for adapters that expose `handleOAuthCallback`. |
| `resolvePrincipal` | `${platform}:${author.id}` | Override identity derivation. Throw `PrincipalResolutionError` to reject. |
| `events` | all on | Per-callback opt-outs. |
| `flowOverrides` | — | `Record<flowKind, { streamToThread? }>`. Per-flow config. |

## Declaring subscriptions on the flow

A flow declares which inbound chat events trigger which handler directly on its definition. Each binding carries its handler inline (the shared action core), not a name pointing into `flow.actions`. Same model the webhook transport uses. The adapter discovers these at mount by walking the flow registry, so a multi-flow chat agent reads top to bottom — triggers and handlers sit together, and adding a flow needs no adapter-config edit.

```ts
import { defineFlow } from "@flow-state-dev/core";
import { defineChatBinding } from "@flow-state-dev/chat-sdk";

const supportFlow = defineFlow({
  kind: "support",
  chat: {
    on: {
      // event-kind key → which handler runs and how the event maps to input
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

The mount is bare — routing lives on the flows:

```ts
createChatTransportAdapter({ bot });
```

- **`block`** is the handler to run. Required. The binding also accepts the rest of the action core (`durable`, `tokenBudget`, `onCompleted`/`onErrored`, `inputSchema`, `userMessage`). A chat handler lives only on `chat.on`, so it has no HTTP or MCP caller surface; declare a block in both `chat.on` and `flow.actions` (same reference) to expose it both ways.
- **Keys** match `ChatInboundEvent.kind` exactly (`"mention"`, `"directMessage"`, `"reaction"`, `"slashCommand"`, …). The vocabulary is uniform across platforms, so a `mention` binding fires on every platform the bot serves. Narrow to one with `when: (e) => e.platform === "slack"`.
- **`input`** maps the event to the handler input (may be async). **`sessionId`** overrides the default thread-id derivation (may be async). **`when`** is a synchronous predicate; a falsy result skips the binding.
- **`defineChatBinding<T>()`** is a typing convenience — it gives `event` a `ChatInboundEvent` type. Plain object literals work too; `event` is then `unknown`.
- Validation runs at `defineFlow`: a binding with no `block` throws at registration.

**Fan-out is broadcast.** Two flows subscribing to the same event both run, independently. An event with no matching subscription is a no-op ack.

### Migrating from adapter-mount routing

The `route()` callback and the static `flowKind`/`action` mount options are removed, along with the `ChatRouteResult` / `ChatRouteFn` types. Re-express imperative or content-based routing as `chat.on` bindings with `when` predicates: one binding per target handler, gated by the condition the old `route()` checked. Whatever `route()` returned `skip` for is now an event with no matching binding — a no-op ack.

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
  .step(answer) // generator
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

