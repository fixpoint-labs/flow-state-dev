# @flow-state-dev/ui

First-party component library for AI/agentic UI patterns, distributed via a [shadcn-compatible custom registry](https://ui.shadcn.com/docs/registry).

Components are copied into your project — you own them completely. The only runtime-importable surface is `@flow-state-dev/ui/generative` (the generative-UI bundle pack).

For the full UI guide — overview, common components, flow-aware components, and generative UI — see [flow-state.dev/docs/ui](https://flow-state.dev/docs/ui/overview).

## Installation

```bash
# Via fsdev CLI
fsdev ui add message
fsdev ui add conversation prompt-input

# Via shadcn CLI (registry URL)
npx shadcn@latest add https://ui.flow-state.dev/r/message.json

# List available components
fsdev ui list
```

## Components

### Components

Generic, framework-agnostic components. No dependency on `@flow-state-dev/*`.

| Component | Description |
|-----------|-------------|
| `conversation` | Container for message threads with auto-scroll |
| `message` | Individual message display with streaming markdown |
| `reasoning` | Expandable reasoning/thinking display with streaming |
| `tool` | Rich tool invocation display with args, result, status, plus `ToolGroup` for Claude-Code-style grouping of consecutive calls |
| `code-block` | Syntax-highlighted code with copy action and dual-theme |
| `prompt-input` | Smart input with file upload, suggestions, submit |
| `sources` | Citation and source display with collapsible list |
| `suggestion` | Horizontal scrollable suggestion pills |
| `shimmer` | Animated text shimmer for streaming/loading states |
| `streaming-indicator` | Thinking indicator shown before assistant content arrives |
| `request-group` | Groups items by request ID with streaming and sources |
| `session-items-context` | React context for passing session items to nested components |
| `plan` | Task list display for plan snapshots from planning patterns |
| `artifact` | Composable artifact viewer shell with header, actions, and content areas |
| `file-tree` | Tree-structured file and folder display with expand/collapse and selection |
| `jsx-preview` | Live JSX/TSX renderer with streaming support and error fallback |
| `sandbox` | Source/preview tab wrapper for JSX artifacts using JSXPreview and CodeBlock |
| `info-card` | Generative-UI info card: title, optional image, fact rows. Pairs with `emitInfoCard` |
| `link-card` | Generative-UI link card: rich preview for an external URL. Pairs with `emitLinkCard` |

## Framework Integration

Components that render AI output types (`Message`, `Reasoning`, `Tool`, `Sources`, `Status`, `ErrorDisplay`) accept `@flow-state-dev/core` item types directly — no adapter layer needed.

### Chat Assistant Renderers

The `chat-assistant` component exports a pre-wired `RendererRegistry` that maps all standard Flow State item types to their default UI components:

```tsx
import { chatAssistantRenderers } from "@/components/flow-state/chat-assistant";

<FlowProvider flowKind="my-flow" userId={userId} renderers={chatAssistantRenderers}>
  <Conversation>
    <ItemsRenderer items={session.items} />
    <SourcesGroup items={session.items} />
  </Conversation>
</FlowProvider>
```

Sources are excluded from the renderer map (`source: false`) — render them grouped separately via `<SourcesGroup>` to display as a collapsed list after the message thread.

The `chatAssistantRenderers` includes `component: { plan: Plan }` by default, so plan snapshots emitted by `planAndExecute` and `supervisor` patterns render automatically. To disable or override:

```tsx
const renderers = {
  ...chatAssistantRenderers,
  component: { plan: false },   // suppress plan rendering
};
```

### Plan Component

The `plan` component renders `ComponentItem` snapshots emitted via `emitPlanSnapshot()`. It displays the plan goal, task list, and per-task status with icons:

```tsx
import { Plan } from "@/components/flow-state/plan";

<FlowProvider renderers={{ component: { plan: Plan } }}>
  {/* plan snapshots appear automatically in the item stream */}
</FlowProvider>
```

Status icons: gray circle (pending), blue spinner (in\_progress), green check (completed), red X (failed), gray dash (skipped), orange triangle (needs-revision), purple arrow (escalated).

### TaskPlan Component

`TaskPlan` is the generalized renderer for any TaskCollection (the unified Plan/Task primitive from `@flow-state-dev/tasks`). Pass a `collectionId` and it subscribes to `task-change` and `task-board-meta` component items in the session stream, latest-wins per task, grouped into sections by status.

```tsx
import { TaskPlan } from "@/components/flow-state/task-plan";

// inside a session-aware view (SessionItemsProvider in scope)
<TaskPlan collectionId="research-board" />

// with assignee sub-grouping
<TaskPlan collectionId="research-board" groupByAssignee />

// with pattern-extended status vocabulary (e.g. plan-and-execute's "replanning")
<TaskPlan
  collectionId="research-board"
  statusConfig={{ replanning: { icon: RotateCcwIcon, iconClassName: "text-amber-500", label: "Replanning" } }}
/>
```

Sections render in canonical order (`pending → in_progress → blocked → awaiting_review → completed → errored`), empty sections hide, `cancelled` is hidden by default. Statuses outside the canonical seven trail at the end with a humanized label, so pattern wrappers that emit extended states (`planning`, `replanning`, `reviewing`) still render. Pass `statusConfig` to customize their presentation.

`TaskPlan` reads its items from `useSessionItems()` by default; pass an explicit `items` prop when rendering outside that context (tests, replayed snapshots).

`TaskPlan` does NOT replace `Plan`. The legacy `Plan` container renderer continues to handle `plan-meta` / `plan-task` items emitted by `planAndExecute` and `supervisor` until those patterns migrate onto the unified primitive.

### Generative UI

`@flow-state-dev/ui/generative` is the *only* runtime-importable surface in this package. It ships a starter pack of generative-UI shapes — each shape is a bundle of (Zod schema, React renderer, `emit*` tool block) that travels as a unit.

Generators load the tool factories so the LLM can pick a rendering shape per turn; FlowProvider loads the renderers so the emitted items render in place.

```ts
// flow.ts (server-side)
import { generativeUI } from "@flow-state-dev/ui/generative";

const tripGenerator = generator({
  name: "trip-concierge",
  agentType: "primary",
  prompt: TRIP_CONCIERGE_PROMPT,
  tools: [...generativeUI.tools(), webSearch],
});
```

```tsx
// app.tsx (client-side)
import { generativeUI } from "@flow-state-dev/ui/generative";

<FlowProvider
  flowKind="trip-concierge"
  userId={userId}
  renderers={{ component: generativeUI.renderers() }}
>
  <ChatUI />
</FlowProvider>
```

Use `generativeUI.pick("info-card", "link-card")` to ship a tighter palette — fewer tools yields better selection accuracy on smaller models.

#### Phase 1 starter shapes

| Tool | Component | Use for |
| -- | -- | -- |
| `emitInfoCard` | `info-card` | Profile snapshots, place summaries, contact-style info |
| `emitLinkCard` | `link-card` | Citations, source attributions, replacing bare URLs |

For a polished, project-owned variant, install the renderer via the registry (`fsdev ui add info-card`) and override the entry in `renderers.component`.

## Architecture

Components accepting primitive props (`role`, `content`, `isStreaming`) are framework-agnostic and have no dependency on `@flow-state-dev/*`. Components that render AI output types (`Message`, `Reasoning`, `Tool`, `Status`, `ErrorDisplay`) accept typed `item` props from `@flow-state-dev/core` directly — no adapter layer needed. All components are fully customizable (you own the source code).

## Development

```bash
# Build registry JSON files
pnpm --filter @flow-state-dev/ui build

# Run tests
pnpm --filter @flow-state-dev/ui test

# Typecheck
pnpm --filter @flow-state-dev/ui typecheck
```

## Adding New Components

1. Create the component in `registry/components/`
2. Add an entry to `registry.json` with dependencies and file mapping
3. Run `pnpm build` to generate the registry JSON
4. Test with `npx shadcn@latest add <local-path>/public/r/<name>.json`
