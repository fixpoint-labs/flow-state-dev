---
sidebar_position: 3
---

# Flow-aware components

Components that consume Flow State item types directly. They subscribe to session item streams, accept typed `OutputItem` shapes as props, or plug into the renderer registry on `FlowProvider`. Most only make sense inside a flow.

## ChatAssistant

A pre-wired `RendererRegistry` that maps every standard item type to its default component. Drop it onto `FlowProvider` and you get defaults for messages, reasoning, tool calls, sources, errors, and approval gates (`suspension: Approval`). The default registry renders `<TaskPlan />` from each `task-board-meta` item.

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

Sources are excluded from the default map (`source: false`) so you can render them grouped via `<SourcesGroup>`. To suppress the default board, spread the existing `component` map first so the other keyed renderers stay:

```tsx
const renderers = {
  ...chatAssistantRenderers,
  component: {
    ...chatAssistantRenderers.component,
    "task-board-meta": false,
  },
};
```

## Approval

Human-in-the-loop approval card for `suspension` items. Shows the gate's message with Approve and Reject buttons while pending, then collapses to a tinted receipt once resolved. It's included in `chatAssistantRenderers` under the `suspension` slot, so chat surfaces get it without extra wiring.

```bash
fsdev ui add approval
```

The card is presentation over the `useApproval` hook from `@flow-state-dev/react`, which owns the resume call and resolved state. It reads the resolution from `SessionItemsProvider`, so wrap your item list in one for the receipt to show on reload. For the full server-to-UI walkthrough, see the [Human-in-the-Loop guide](/guides/human-in-the-loop).

## ModelBadge

A small pill that shows which model actually answered. It reads a `ModelIdentity` (the `{ actual, requested?, gateway? }` record stamped on every generator-emitted item), renders `actual` as the label, and lists the requested string and gateway in the hover tooltip. It renders nothing when the model is undefined, so passing `item.model` straight from any item is safe.

```bash
fsdev ui add model-badge
```

```tsx
import { ModelBadge } from "@/components/flow-state/model-badge";

<ModelBadge model={item.model} />
```

## AuditAnnotation

A compact card for [Response Auditor](/docs/patterns/response-auditor) findings. It lists the surfaced results with severity indicators, per-analyzer scores, and the evidence each analyzer flagged. You don't render it by hand: the `responseAuditor` pattern emits an `audit-annotation` component item whenever a result surfaces, and `chatAssistantRenderers` maps that item to this card, so the audit shows up automatically on any chat surface wired with those renderers.

```bash
fsdev ui add audit-annotation
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

The generalized renderer for any `TaskCollection` — the unified Plan/Task primitive from `@flow-state-dev/orchestration`. Subscribes to `task-change` and `task-board-meta` component items, latest-wins per task, and groups them into sections by status.

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

The JSX is treated as untrusted. Common text, layout, list, table and form-control tags render (`div`, `p`, `h1` to `h6`, `ul`, `table`, `img`, `button`, `input`), along with static SVG (`svg`, `path`, `rect`, gradients). Nothing else does, including unknown tags, `<script>`, `<iframe>`, `<style>` and `<form>`. Event-handler props (`on*`), `dangerouslySetInnerHTML`, `srcDoc`, `srcset` and the `form` attribute are dropped, and URL attributes such as `href` and `src` keep only `http`, `https`, `mailto`, `tel` or relative URLs. A dotted tag like `<Card.Header>` renders only when `Card` is one of your `components` and `Header` is capitalized. Components you pass in the `components` prop skip these checks and render as given, so pass only components you trust.

Inside `{...}`, the JSX can read bindings, index with a literal (`items[0]`), call methods such as `.map()` with an arrow function, use ternaries and other operators, and spread an object into props. Values you pass in the `bindings` prop are readable from the JSX, which can send them out in a URL, so don't bind secrets. Other forms are refused: `this`, `new`, tagged templates, assignment, comma sequences, optional chaining (`a?.b`), computed keys (`items[i]`, `{ [k]: v }`), and anything that touches `constructor`, `prototype` or `__proto__`. Input longer than 100,000 characters is refused as well. When the input is refused or fails to parse (a half-streamed chunk, say), the error is passed to the `onError` callback and shown by the `JSXPreviewError` component, and the last good render stays on screen. The error clears once the input renders again.

```bash
fsdev ui add jsx-preview
```

## Sandbox

Source/preview tab wrapper for JSX artifacts. Pairs `JSXPreview` and `CodeBlock` so the user can switch between rendered output and the source.

```bash
fsdev ui add sandbox
```
