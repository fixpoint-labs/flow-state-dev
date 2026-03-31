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

### AI Elements (Tier 1)

Generic, framework-agnostic components. No dependency on `@flow-state-dev/*`.

| Component | Description |
|-----------|-------------|
| `conversation` | Container for message threads with auto-scroll |
| `message` | Individual message display with streaming markdown |
| `reasoning` | Expandable reasoning/thinking display with streaming |
| `tool` | Rich tool invocation display with args, result, status |
| `code-block` | Syntax-highlighted code with copy action and dual-theme |
| `prompt-input` | Smart input with file upload, suggestions, submit |
| `sources` | Citation and source display with collapsible list |
| `suggestion` | Horizontal scrollable suggestion pills |
| `shimmer` | Animated text shimmer for streaming/loading states |

### Framework Adapters

Thin adapters that connect `@flow-state-dev/core` item types to the AI Element components. Install these if you're using the framework.

| Adapter | Maps From | Maps To |
|---------|-----------|---------|
| `message-adapter` | `MessageItem` | `Message` |
| `reasoning-adapter` | `ReasoningItem` | `Reasoning` |
| `tool-adapter` | `BlockToolOutputItem` | `Tool` |
| `error-adapter` | `ErrorItem` / `StepErrorItem` | Error display |
| `status-adapter` | `StatusItem` | `Shimmer` |
| `source-adapter` | `SourceItem[]` | `Sources` |

### Usage with RendererRegistry

```tsx
import { FlowProvider } from "@flow-state-dev/react";
import { MessageAdapter } from "@/components/flow-state/adapters/message-adapter";
import { ReasoningAdapter } from "@/components/flow-state/adapters/reasoning-adapter";
import { ToolAdapter } from "@/components/flow-state/adapters/tool-adapter";

<FlowProvider
  renderers={{
    message: MessageAdapter,
    reasoning: ReasoningAdapter,
    block_tool_output: ToolAdapter,
  }}
>
  {children}
</FlowProvider>
```

## Architecture

Two-layer component model:

1. **AI Elements** — Generic components accepting primitive props (`role`, `content`, `isStreaming`). No framework dependency.
2. **Adapters** — Thin components accepting typed `item` props from `@flow-state-dev/core/items` and mapping to AI Element props.

This separation means:
- Users without the framework install AI Elements only
- Users with the framework add adapters for automatic `RendererRegistry` integration
- All components are fully customizable (you own the source code)

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

1. Create the component in `registry/components/` (or `registry/adapters/`)
2. Add an entry to `registry.json` with dependencies and file mapping
3. Run `pnpm build` to generate the registry JSON
4. Test with `npx shadcn@latest add <local-path>/public/r/<name>.json`
