# @flow-state-dev/ui

First-party component library for AI/agentic UI patterns, distributed via a [shadcn-compatible custom registry](https://ui.shadcn.com/docs/registry).

Components are copied into your project — you own them completely. No runtime dependency on this package.

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
