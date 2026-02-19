# @flow-state-dev/react

React bindings for Flow State Dev.

`@flow-state-dev/react` is a UI-layer package:
- wraps `@flow-state-dev/client` transport APIs with React hooks
- provides renderer/context helpers for `fsd:block_output` items
- keeps transport logic out of React components

## Install

```bash
pnpm add @flow-state-dev/react
```

Peer dependency: `react ^18.0.0 || ^19.0.0`

## Quick Start

```tsx
import {
  FlowProvider,
  ItemRenderer,
  useFlow,
  useProjections,
  useSession,
} from "@flow-state-dev/react";

function App() {
  return (
    <FlowProvider
      flowKind="market-intel-agent"
      userId="devuser"
      blockRenderers={{
        "strategy-report": StrategyReportCard,
      }}
    >
      <AgentUI />
    </FlowProvider>
  );
}

function AgentUI() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession("market-intel-agent", flow.activeSessionId, {
    items: { visibility: "ui" },
  });

  const projections = useProjections(session, {
    session: ["artifactsList", "planStatus"],
  });

  return (
    <div>
      <button
        onClick={() => session.sendAction("run", { prompt: "hello" })}
        disabled={session.isStreaming}
      >
        {session.isStreaming ? "Running..." : "Run"}
      </button>

      <pre>{JSON.stringify(projections.session?.planStatus, null, 2)}</pre>

      {session.items.map((item) => (
        <ItemRenderer key={item.id} item={item} />
      ))}
    </div>
  );
}
```

## FlowProvider

Use `<FlowProvider>` to set defaults and register block renderers.

Props:
- `flowKind?: string`
- `sessionId?: string`
- `userId?: string`
- `baseUrl?: string`
- `blockRenderers?: Record<string, React.ComponentType<any>>` keyed by `renderKey`
- `children: ReactNode`

Nested providers merge `blockRenderers` (child keys override parent keys).

## Hooks

### `useFlow(options?)`

Session lifecycle helper (list/create/select sessions).

### `useSession(flowKind, sessionId, options?)`

Primary session hook.

```ts
const session = useSession("flow-kind", sessionId, {
  userId,
  baseUrl,
  items: true,
});
```

`items` options:
- `true` (default)
- `false`
- `{ visibility?: ItemVisibility; includeTransient?: boolean }`

Return shape:
- `detail` (`SessionDetail | null`)
- `snapshot` (`SessionStateSnapshotResponse | null`)
- `items`, `messages`, `blockOutputs`, `functionCalls`
- `isLoading`, `isStreaming`, `error`
- `sendAction(action, input)`
- `refresh()`

### `useProjections(session, options)`

Reads scope-grouped projection values from `session.snapshot`.

```ts
const projections = useProjections(session, {
  session: ["artifactsList"],
  user: ["topics"],
  project: ["sharedConfig"],
});
```

Typed mode:

```ts
const projections = useProjections(session, {
  session: {
    artifactsList: artifactsListSchema,
  },
});
```

### `useAction(options)`

Low-level action execution hook for direct action calls.

### `useRequestStream(options)`

Low-level request-stream hook with reactive item/status views.

## Render Helpers

- `ItemRenderer`
- `ItemsRenderer`
- `MessagesRenderer`
- `BlockRenderer`
- `useBlockContext()` inside a registered block renderer component

Registered block renderer components receive spread output props from the
`fsd:block_output` item payload.

## Scripts

```bash
pnpm --filter @flow-state-dev/react build
pnpm --filter @flow-state-dev/react typecheck
pnpm --filter @flow-state-dev/react test
```
