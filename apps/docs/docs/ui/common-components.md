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

Displays a tool call with its arguments, result, and status. `ToolGroup` folds a run of consecutive tool calls and reasoning into one collapsed line that opens to every step in order. A failed call is labelled on the line, for example "(1 failed)" on a group or "(failed)" on a single call.

```bash
fsdev ui add tool
```

`tool` also installs `tool-naming`, two pure functions (no React, no DOM) that name a call from its tool name and arguments. Install it alone to label tool calls in your own components or in non-React code.

```bash
fsdev ui add tool-naming
```

```ts
import { toolIntent, toolSubject } from "@/components/flow-state/tool-naming";

toolSubject("read_file", { path: "src/a.ts" });
// { text: "Read src/a.ts", code: false }

toolSubject("shell", { command: "cd app && pnpm test" });
// { text: "pnpm test", code: true }

toolSubject("mcp__linear__get_issue", { id: "ENG-1" });
// { text: "Calling MCP tool Linear Get Issue", code: false }

toolSubject("web_search", { query: "tool naming" });
// { text: "Search \"tool naming\"", code: false }

toolIntent("Bash", { command: "pnpm test", description: " Run the tests " });
// "Run the tests"
```

`toolSubject(toolName, args)` returns a short line naming what one call did, or `undefined` when the args give nothing to name. Which line depends on the tool:

- **Shell tools** (`shell`, `bash`, `command_execution`, `run_command`, `terminal`, in any casing) show the first line of the `command` arg, without a leading `cd <dir> &&`, and set `code: true` so you can render it in monospace.
- **MCP tools** named `mcp__<server>__<tool>` show `Calling MCP tool <Server> <Tool>`, both parts title-cased.
- **Every other tool** shows a verb and the first of these args it carries: `query`, `pattern`, `glob_pattern`, `globPattern`, `url`, `file_path`, `path`, `target_file`, `target_directory`, `dir`. The verb is the tool name title-cased, after dropping a `web_` prefix and a `_file` suffix, so `read_file` reads "Read" and `web_search` reads "Search". `ls` reads "List" and `multiedit` reads "Edit". A `query` or `pattern` is shown in quotes, a URL as is, and a path with more than three segments as `…/` plus its last three.

`toolIntent(toolName, args)` returns the `description` a call states about itself, trimmed, or `undefined` when there is none. Only the shell tools above, `Task` and `Agent` are read this way; every other tool returns `undefined`. `Tool` and `ToolGroup` use both functions for their status lines, preferring the intent.

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

In-flight status indicator for the latest request while it streams. It shows before the first step, between steps (after one finishes and before the next begins), and while the answer streams. While a [Tool](#tool) call or [Reasoning](#reasoning) step is in progress it drops the status words, because that component already shows the step, and keeps the "Working..." label and the clock. Renders the latest value from the request-scoped status slot, falling back to "Working..." when the slot is empty. When the request has finished answering but background work is still running (`useSession.isFinishing`), the indicator shows a muted "Tidying up..." instead.

```bash
fsdev ui add streaming-indicator
```

### Elapsed time

Pass `since`, the epoch milliseconds when the request began, and the indicator shows how long it has been running beside the label, counting up each second.

```tsx
import { StreamingIndicator } from "@/components/flow-state/streaming-indicator";

const startedAt = Date.now(); // when the request was sent

<StreamingIndicator message="Searching the docs" since={startedAt} />
// Searching the docs (1m 24s)
```

`message` sets the label. Without it the label is "Working...". In a chat, the request's status slot supplies it.

The timer reads `42s` under a minute, `1m 24s` from there, and `1h 3m` (no seconds) past an hour. Nothing shows for the first second. The timer shows in the "Tidying up..." state too. The count uses the browser clock, so a `since` in the future shows nothing rather than a negative time.

`RequestGroupRenderer` renders a request's items in the chat and sets `since` from the first item of the latest request, so you set `since` yourself only when you render the indicator directly. While a tool call or thought is in progress, the indicator shows "Working..." and the clock instead of the status words, so the line never collapses to a bare timer. The timer disappears when the request stops streaming. Pass `showWorkedFor` to `RequestGroupRenderer` and a finished request ends in a line like "Worked for 3m 24s • 4:28 PM" (`WorkedFor`, exported from the same file). The end time comes from the items unless you also pass `latestCompletedAtMs`, the request record's end, which is exact.

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
