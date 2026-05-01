---
sidebar_position: 3
---

# Flow-aware components

Components that consume Flow State item types directly. They subscribe to session item streams, accept typed `OutputItem` shapes as props, or plug into the renderer registry on `FlowProvider`. Most only make sense inside a flow.

## ChatAssistant

A pre-wired `RendererRegistry` that maps every standard item type to its default component. The fastest way to render a working chat surface — drop it onto `FlowProvider` and you get sensible defaults for messages, reasoning, tool calls, sources, plans, and errors.

```bash
fsdev ui add chat-assistant
```

```tsx
import { chatAssistantRenderers } from "@/components/flow-state/chat-assistant";

<FlowProvider flowKind="my-flow" userId={userId} renderers={chatAssistantRenderers}>
  <Conversation>
    <ItemsRenderer items={session.items} />
    <SourcesGroup items={session.items} />
  </Conversation>
</FlowProvider>
```

Sources are excluded from the default map (`source: false`) so you can render them grouped via `<SourcesGroup>`. Override entries individually:

```tsx
const renderers = {
  ...chatAssistantRenderers,
  component: { plan: false },   // suppress plan rendering
};
```

## SessionItemsContext

React context for passing session items down to nested components. Required by any component that needs to subscribe to the item stream without prop drilling — `TaskPlan`, `RequestGroup`, and registry components that watch their own items.

```bash
fsdev ui add session-items-context
```

```tsx
import { SessionItemsProvider } from "@/components/flow-state/session-items-context";

<SessionItemsProvider items={session.items}>
  <TaskPlan collectionId="research-board" />
</SessionItemsProvider>
```

## RequestGroup

Groups items by request id. Renders a streaming indicator while a request is in flight, surfaces sources at the bottom, and collapses consecutive tool calls into a single summary.

```bash
fsdev ui add request-group
```

## TaskPlan

The generalized renderer for any `TaskCollection` — the unified Plan/Task primitive from `@flow-state-dev/tasks`. Subscribes to `task-change` and `task-board-meta` component items, latest-wins per task, and groups them into sections by status.

```bash
fsdev ui add task-plan
```

```tsx
import { TaskPlan } from "@/components/flow-state/task-plan";

<TaskPlan collectionId="research-board" />
```

For a board-style horizontal layout, build a `TaskCollection` consumer of the same item streams rather than forking this renderer.

## Artifact

Composable artifact viewer shell with header, actions, and content slots. The base layer for any "expand to a side panel" view — code artifacts, JSX previews, file trees, etc.

```bash
fsdev ui add artifact
```

## FileTree

Tree-structured file and folder display with expand/collapse and selection. Useful inside an `Artifact` shell for code-oriented agents.

```bash
fsdev ui add file-tree
```

## JSXPreview

Live JSX/TSX renderer with streaming support and an error fallback. Renders a JSX string while it's still streaming in.

```bash
fsdev ui add jsx-preview
```

## Sandbox

Source/preview tab wrapper for JSX artifacts. Pairs `JSXPreview` and `CodeBlock` so the user can switch between rendered output and the source.

```bash
fsdev ui add sandbox
```
