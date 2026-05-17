---
sidebar_position: 2
---

# Common components

Generic chat and content primitives. They take primitive props and have no runtime dependency on `@flow-state-dev/*`, so you can use them outside a flow as well as inside one.

## Conversation

Container for message threads with auto-scroll and stick-to-bottom behavior.

```bash
fsdev ui add conversation
```

```tsx
import { Conversation } from "@/components/flow-state/conversation";

<Conversation>
  {/* messages */}
</Conversation>
```

## Message

Individual message display with streaming Markdown rendering. Accepts either primitive props (`role`, `content`) or a Flow State `MessageItem` directly.

```bash
fsdev ui add message
```

```tsx
import { Message } from "@/components/flow-state/message";

<Message role="assistant" content="Hello!" isStreaming />
```

## PromptInput

Smart input with auto-resize, file upload, and submit handling. Designed to drive `sendAction` but works with any submit handler.

```bash
fsdev ui add prompt-input
```

## Reasoning

Expandable reasoning/thinking display with streaming awareness. Collapses by default and reveals on click.

```bash
fsdev ui add reasoning
```

## Tool

Rich tool invocation display: arguments, result, status, and Claude-Code-style grouping for consecutive calls. Pairs with the `tool-grouping` utility for collapsing repeated calls.

```bash
fsdev ui add tool
```

## CodeBlock

Syntax-highlighted code with a copy action and dual-theme support.

```bash
fsdev ui add code-block
```

## Sources

Citation and source display with a collapsible list and favicons. Use `<SourcesGroup>` to render sources as a single grouped panel after a message thread.

```bash
fsdev ui add sources
```

## Suggestion

Horizontal scrollable suggestion pills. Useful for "did you mean" hints or canned follow-ups.

```bash
fsdev ui add suggestion
```

## Shimmer

Animated text shimmer for loading and in-progress states. Used internally by `Status` and `StreamingIndicator`.

```bash
fsdev ui add shimmer
```

## StreamingIndicator

In-flight status indicator shown between the user's message and the first streamed token (or for the duration of any background work after that point). Renders the latest value from the request-scoped status slot, falling back to "Working..." when the slot is empty. While the request is in its background-task drain phase (`useSession.isFinishing`), the indicator switches to a muted "Tidying up..." state.

```bash
fsdev ui add streaming-indicator
```

## Status

Status message display with a shimmer animation for in-progress states. Renders the current request status slot.

```bash
fsdev ui add status
```

## Error

Error and step-error display with a recoverable / fatal distinction. Pairs with `ErrorItem` from the item stream.

```bash
fsdev ui add error
```
