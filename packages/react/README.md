# @flow-state-dev/react

React-facing wrapper layer for Flow State Dev.

This package composes:
- hook-style wrappers around `@flow-state-dev/client`
- item render helpers
- block renderer registry helpers
- lightweight flow context utilities

## What This Package Is For

Use `@flow-state-dev/react` when you want framework-provided React-friendly APIs without implementing transport/session/stream logic yourself.

Transport and API contracts remain in `@flow-state-dev/client`; this package wraps them.

## Important Behavior

- These are wrapper utilities over `@flow-state-dev/client`.
- They do not currently manage React component lifecycle state for you.
- They resolve missing values from `FlowContext` when options are omitted.

Resolution precedence:

1. explicit hook option
2. `getFlowContext()` value
3. hook-specific default (only `useFlowAgent.userId` defaults to `"devuser"`)

Canonical integration still prefers explicitly passing `flowKind` and `userId` at call sites.

Why `useAction` can work without `flowKind` in some examples/tests:
- `useAction` requires `flowKind` and `userId`.
- If not provided in options, it reads them from `FlowContext`.
- If neither options nor context provide them, it throws.

## Public API

Hooks:
- `useFlowAgent`
- `useSession`
- `useAction`
- `useRequestStream`
- `useTypedFlowClient`

Render helpers:
- `ItemRenderer`
- `ItemsRenderer`
- `MessagesRenderer`
- `BlockRenderer`

Registry/context helpers:
- `registerBlockRenderer`
- `getBlockRenderer`
- `clearBlockRenderers`
- `listBlockRendererKeys`
- `setFlowContext`
- `getFlowContext`
- `withFlowContext`

## Hook Usage

### `useFlowAgent(options?)`

Purpose:
- List flows
- List sessions
- Create sessions

Options:
- `flowKind?: string`
- `userId?: string` (defaults to `"devuser"` when not set in options/context)
- `baseUrl?: string`

Notes:
- `createSession` requires `flowKind` from options or `FlowContext`.
- `refreshFlows` and `refreshSessions` update in-memory snapshots on the returned object.

Example:

```ts
import { useFlowAgent } from "@flow-state-dev/react";

const flowAgent = useFlowAgent({
  flowKind: "demo",
  userId: "devuser"
});

await flowAgent.refreshFlows();
await flowAgent.refreshSessions();
await flowAgent.createSession({ reason: "manual-run" });
```

### `useSession(options)`

Purpose:
- Read session + snapshot state
- Execute actions scoped to one session
- Open request stream wrappers for that session

Required (from options or `FlowContext`):
- `flowKind`
- `sessionId`
- `userId`

Optional:
- `baseUrl`

Example:

```ts
import { useSession } from "@flow-state-dev/react";

const session = useSession({
  flowKind: "demo",
  sessionId: "sess_1",
  userId: "devuser"
});

await session.refresh();
await session.sendAction("run", { value: "hello" });
const stream = session.streamRequest("req_1");
```

### `useAction(options)`

Purpose:
- Execute a single named action, optionally with `sessionId`
- Track simple `loading` and `error` fields

Required:
- `action: string`
- `flowKind` (option or context)
- `userId` (option or context)

Optional:
- `baseUrl`

Example:

```ts
import { useAction } from "@flow-state-dev/react";

const action = useAction({
  flowKind: "demo",
  action: "run",
  userId: "devuser"
});

const result = await action.execute({ value: "hello" }, "sess_1");
```

### `useRequestStream(options)`

Purpose:
- Subscribe to request stream events
- Maintain item/status/message/block-output snapshots

Required:
- `requestId: string`
- `flowKind` (option or context)

Optional:
- `baseUrl`
- `lastEventId?: string`
- `startingAfter?: number`
- `filter?: { visibility?: ItemVisibility }`
- `onCompletedRefetch?: () => Promise<...>`

Resume behavior:
- supports `Last-Event-ID` reconnect
- supports explicit `starting_after` replay
- when both are provided, `starting_after` takes precedence

Example:

```ts
import { useRequestStream } from "@flow-state-dev/react";

const stream = useRequestStream({
  flowKind: "demo",
  requestId: "req_1",
  startingAfter: 0
});

console.log(stream.items, stream.status);
stream.close();
```

### `useTypedFlowClient(options)`

Purpose:
- Build typed `actions.<actionName>(input)` clients from a compile-time flow definition

Required:
- `flow`
- `userId` (option or context)

Optional:
- `baseUrl`

Example:

```ts
import { useTypedFlowClient } from "@flow-state-dev/react";

const client = useTypedFlowClient({
  flow,
  userId: "devuser"
});

await client.actions.run({ value: "hello" });
```

## Flow Context Usage

`setFlowContext` is a convenience for shared defaults, not a requirement.

Example:

```ts
import { setFlowContext, useAction } from "@flow-state-dev/react";

setFlowContext({
  flowKind: "demo",
  userId: "devuser",
  sessionId: "sess_1"
});

const action = useAction({ action: "run" }); // flowKind/userId resolved from context
await action.execute({ value: "hello" }, "sess_1");
```

Custom block rendering:

```ts
import { registerBlockRenderer } from "@flow-state-dev/react";

registerBlockRenderer("shared-render", ({ output }) => {
  return { type: "custom", output };
});
```

## Rendering Helpers

- `ItemRenderer`: render one `OutputItem`
- `ItemsRenderer`: render ordered item arrays
- `MessagesRenderer`: render message-only subset
- `BlockRenderer`: render `fsd:block_output` with `renderName ?? blockName` key lookup and fallback payload

## Canonical Chat Example (Send + Stream + Render)

The example below shows the full flow:
1. send a chat action
2. get back `request.id`
3. open request stream
4. update UI while streaming
5. render stream items/messages

```tsx
import { useEffect, useState } from "react";
import {
  ItemsRenderer,
  MessagesRenderer,
  useAction,
  useRequestStream,
  useSession
} from "@flow-state-dev/react";
import type { OutputItem, RequestStatus } from "@flow-state-dev/core/items";

export function ChatPanel(props: { sessionId: string; userId: string }) {
  const flowKind = "chat";
  const actionName = "sendMessage";
  const [input, setInput] = useState("");
  const [requestId, setRequestId] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<OutputItem[]>([]);
  const [status, setStatus] = useState<RequestStatus>("in_progress");
  const [isStreaming, setIsStreaming] = useState(false);

  const session = useSession({
    flowKind,
    sessionId: props.sessionId,
    userId: props.userId
  });

  const action = useAction({
    flowKind,
    action: actionName,
    userId: props.userId
  });

  useEffect(() => {
    if (requestId === undefined) {
      return;
    }

    const stream = useRequestStream({
      flowKind,
      requestId,
      onCompletedRefetch: async () => {
        await session.refresh();
      }
    });

    setIsStreaming(true);

    // Current wrapper APIs are imperative snapshots; poll them into React state.
    const interval = setInterval(() => {
      setItems([...stream.items]);
      setStatus(stream.status);
      setIsStreaming(stream.isStreaming);
    }, 50);

    return () => {
      clearInterval(interval);
      stream.close();
      setIsStreaming(false);
    };
  }, [flowKind, requestId, session]);

  const send = async () => {
    const value = input.trim();
    if (value.length === 0) {
      return;
    }

    const response = await action.execute(
      { message: value },
      props.sessionId
    );
    setRequestId(response.request.id);
    setInput("");
  };

  const renderedItems = ItemsRenderer({ items });
  const renderedMessages = MessagesRenderer({ items });

  return (
    <section>
      <header>
        <strong>Session:</strong> {props.sessionId}{" "}
        <strong>Status:</strong> {status}
        {isStreaming ? " (streaming)" : ""}
      </header>

      <div>
        {/* In your app, map these render payloads to your UI system/components. */}
        <h4>Messages</h4>
        <pre>{JSON.stringify(renderedMessages, null, 2)}</pre>

        <h4>All Items</h4>
        <pre>{JSON.stringify(renderedItems, null, 2)}</pre>
      </div>

      <footer>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Send a message"
        />
        <button onClick={send} disabled={action.loading}>
          {action.loading ? "Sending..." : "Send"}
        </button>
      </footer>
    </section>
  );
}
```

## AI Elements Integration Pattern

You can map the same stream data into Vercel AI UI Elements:
- [AI Elements docs](https://ai-sdk.dev/elements)

Recommended approach:
- keep `useAction` + `useRequestStream` as the transport/runtime source of truth
- adapt `stream.items` into your AI Elements message model
- render with AI Elements conversation/message/composer primitives
- continue using `onCompletedRefetch` for canonical state correctness

## Scripts

- `pnpm --filter @flow-state-dev/react build`
- `pnpm --filter @flow-state-dev/react typecheck`
- `pnpm --filter @flow-state-dev/react test`

## Notes

- Hooks are currently implemented as wrapper utilities over client APIs.
- Renderer helpers consume canonical `OutputItem` item shapes from `@flow-state-dev/core/items`.
