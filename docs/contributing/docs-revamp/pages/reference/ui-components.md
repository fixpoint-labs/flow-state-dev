---
title: UI components
type: reference
description: "Every component the UI registry installs, with its exports, props and what it needs around it, the renderer registry, the status tokens, the generative cards and the workforce panels."
---

# UI components

A chat screen for an AI app is mostly the same dozen parts: a scrolling conversation, a message, a collapsible reasoning block, a tool call, an approval card, a prompt box. The UI registry ships those parts as React source you copy into your project, so you can edit them, and the `renderers` prop of `FlowProvider` maps each kind of item a flow emits to the component that draws it.

A **common** component takes props and reads no provider. A **flow-aware** component reads context: `FlowProvider`, `SessionItemsProvider` or `SuspensionResolverProvider`. [What needs a provider](#what-needs-a-provider) says which component reads which one. [Install](#install) says which items import a `@flow-state-dev` package at runtime.

This page uses one app. Its `support` flow answers a ticket, and its screen draws the flow's items.

```bash
fsdev ui add chat-assistant conversation prompt-input session-items-context
```

```tsx title="src/app/support/chat.tsx"
"use client";

import type { OutputItem } from "@flow-state-dev/core/items";
import { FlowProvider, ItemsRenderer } from "@flow-state-dev/react";
import { chatAssistantRenderers } from "@/components/flow-state/chat-assistant";
import { Conversation, ConversationContent } from "@/components/flow-state/conversation";
import { SessionItemsProvider } from "@/components/flow-state/session-items-context";
import { OrderCard } from "@/components/order-card";

const renderers = {
  ...chatAssistantRenderers,
  data: { ...chatAssistantRenderers.data, "order-card": OrderCard },
};

export function Chat({ userId, items }: { userId: string; items: OutputItem[] }) {
  return (
    <FlowProvider flowKind="support" userId={userId} renderers={renderers}>
      <SessionItemsProvider value={items}>
        <Conversation>
          <ConversationContent>
            <ItemsRenderer items={items} />
          </ConversationContent>
        </Conversation>
      </SessionItemsProvider>
    </FlowProvider>
  );
}
```

## Install

| Command | Effect |
| --- | --- |
| `fsdev ui add <components...>` | Copies the named registry items, and the items they depend on, into `components/flow-state/` |
| `fsdev ui list` | Lists the registry's items |
| `--registry <url\|path>` | Registry to read. Default `https://ui.flow-state.dev/r` |
| `--cwd <dir>` | Project to install into |

`fsdev ui add` runs `npx shadcn@latest add` against the registry. `npx shadcn@latest add https://ui.flow-state.dev/r/message.json` installs one item directly. `info-card` and `link-card` land under `components/flow-state/generative/`. Imports use `@/components/flow-state/<file>`.

An item brings the registry items it depends on. `fsdev ui add tool` writes `tool.tsx` and `tool-grouping.ts`, and also installs `tool-naming`, `tokens` and `code-block`.

Most items import only item types from `@flow-state-dev/core`, which compile away, or nothing. These import a package at runtime:

| Package | Items |
| --- | --- |
| `@flow-state-dev/react` | `conversation`, `session-overlay`, `prompt-input`, `approval`, `review-hold`, `request-group`, `chat-assistant` (with its cards) |
| `@flow-state-dev/core` | `tool`, `conversation-lines`, `task-plan`, `attachments`, `message`, `prompt-input`, `request-group`, `chat-assistant` |
| `@flow-state-dev/orchestration/tasks` | `task-signals` |
| `@flow-state-dev/workforce/browser` | `workforce-lines` |

## What needs a provider

Two providers matter. `FlowProvider` is read by `Approval`, `Question`, `Form` and `Selection` (for `flowKind`) and by `SuspensionCard` and `RequestGroupRenderer` (for `renderers`). `SessionItemsProvider` is read by `TaskPlan`, `Debate`, `EventedActors` and `RoutedSpecialists`, which need no `FlowProvider`. `chatAssistantRenderers` is not a component: it is a value you pass to `FlowProvider`'s `renderers` prop.

Outside a `FlowProvider` the context is empty, so a component that reads it does not throw. It gets no `flowKind`, no `renderers` and no `userId`, and loses only the job below.

| Component | Reads | Without it |
| --- | --- | --- |
| `Approval` | `flowKind` from `FlowProvider`, or a `SuspensionResolverProvider`; resolved state from `SessionItemsProvider` | Approve and Reject are disabled, and a console warning fires once on mount |
| `Question`, `Form`, `Selection` | `flowKind`, or a `SuspensionResolverProvider` | Submit shows "Cannot resume without flowKind on `<FlowProvider>` or a SuspensionResolverProvider." and sends nothing |
| `SuspensionCard` | `renderers` from `FlowProvider` (for `render.component`); `SessionItemsProvider` | A `render.component` is not honoured; resolved state is not shown |
| `ReviewSuspension` | `SuspensionResolverProvider` | Shows the review and a line saying it cannot be answered here; no buttons |
| `RequestGroupRenderer` | `renderers` from `FlowProvider`; an enclosing `Conversation` (optional) | Draws with no custom renderers; the user's line is not marked for scroll |
| `TaskPlan` | `SessionItemsProvider`, unless given `items` | Reads an empty list and shows its empty state |
| `Debate`, `EventedActors`, `RoutedSpecialists` | `SessionItemsProvider` | Find no nested records and draw their empty state |

Every other component on this page reads no provider. `PromptInput` takes an uploader as the `client` prop, or reads a `PromptInputProvider`; with neither, an attached file is refused and the refusal names the file.

`SuspensionResolverProvider` comes from `@flow-state-dev/react`. Its `resolve` prop is typically `session.answerSuspension`. `SessionItemsProvider` takes `value={OutputItem[]}`, and `useSessionItems()` returns `[]` outside one.

## Common components

### Conversation and messages

| Install name | Exports | Props and behaviour |
| --- | --- | --- |
| `conversation` | `Conversation` | `div` props plus `feed?: JumpToLatest` and `resetKey?: string \| null`. Renders `role="log"`. Opens at its end; a line sent with `feed.sent()` rises near the top; new content below shows the jump button. A change of `resetKey` opens the view at its end again. Imports `@flow-state-dev/react` |
| | `ConversationContent`, `ConversationEmptyState` | Empty state props `title`, `description`, `icon`. Defaults "No messages yet" and "Start a conversation to see messages here" |
| | `ConversationScrollButton` | `feed?`. Label "Jump to latest"; draws nothing at the end. With no `feed` and no `Conversation` around it, it throws |
| | `useConversationFeed()` | Returns `JumpToLatest \| null`; `null` outside a `Conversation` |
| | `ConversationDownload`, `messagesToMarkdown` | `messages: ConversationMessage[]` (`{ role, content }`), `filename = "conversation.md"`, `formatMessage` |
| `message` | `Message` | `item: MessageItem`, `readBase?`, `readFile?(file, url) => Promise<Blob>`. Draws nothing for a role other than `user` or `assistant`, or a message with no text and no files. A `user` message is plain text with thumbnails and chips for files; an `assistant` message is Markdown. `readBase` is where the server's API is mounted when it is not this page's origin; `readFile` reads thumbnail bytes when a plain image request cannot authenticate |
| | `MessageShell`, `MessageContent`, `MessageActions`, `MessageAction`, `MessageToolbar`, `MessageFiles`, `MessageBranch*` | Parts for building your own message. `MessageRole` is `"user" \| "assistant" \| "system" \| "data" \| "tool"` |
| `message-response` | `MessageResponse`, `MarkdownText` | `MessageResponse` takes Streamdown props. `MarkdownText({ text, className, inline = false })` shows HTML in the text as text; `inline` keeps one truncated line of inline Markdown |
| `reasoning` | `Reasoning` | `item: ReasoningItem`. Draws nothing for an item with no text that is not `in_progress` |
| | `ReasoningShell`, `ReasoningTrigger`, `ReasoningContent`, `useReasoning` | `ReasoningShell` takes `Collapsible` props plus `isStreaming`, `open`, `defaultOpen` (default `false`), `onOpenChange`, `duration`. Closes once, one second after streaming ends |
| `status` | `Status` | `item: StatusItem`. Shimmer text while `in_progress`, muted text otherwise |
| `error` | `ErrorDisplay`, `ErrorBody` | `ErrorDisplay({ item: ErrorItem })`. `ErrorBody({ message, code, details })` draws the message, `Code: <code>` and an openable "Details" block |
| `sources` | `Sources`, `SourcesTrigger`, `SourcesContent`, `Source`, `SourcesGroup` | `Source({ href, favicon?, children })` opens in a new tab; label is `children`, else the hostname, else the href. `SourcesGroup({ items })` collects `source` items into one collapsible panel and draws nothing when there are none |
| `model-badge` | `ModelBadge` | `model: ModelIdentity \| undefined`, `className`. Label is `model.actual`; the tooltip lists `actual`, `requested` and `gateway`. Draws nothing for `undefined` |
| `suggestion` | `Suggestions`, `Suggestion` | `Suggestion({ suggestion: string, onClick?(suggestion), variant = "outline", size = "sm" })` |
| `shimmer` | `Shimmer` | `children: string`, `as = "p"`, `className`, `duration = 2`, `spread = 2` |
| `code-block` | `CodeBlock`, `highlightCode`, `CodeBlock*` parts | `CodeBlock({ code, language, showLineNumbers = false, className, children })` |

### Tool calls

| Install name | Exports | Props and behaviour |
| --- | --- | --- |
| `tool` | `Tool` | `item: BlockTraceItem \| ToolOutputItem`. Draws nothing without a `toolCall`. Imports `@flow-state-dev/core` at runtime |
| | `ToolGroup` | `items`, `defaultOpen = false`, `live = false`, `className`. Folds a run of tool calls and reasoning into one collapsed line that opens to each step. With `live`, the line names the latest step |
| | `ToolRow` | `item`, `redone = false`, `defaultOpen = false`, `className`. One step |
| | `ToolInput`, `ToolOutput`, `getStatusBadge` | Parts |
| `tool-naming` | `toolSubject(toolName, args, output?)` | Returns `{ text, code } \| undefined`. `output` adds detail once the call is done (a search's match count, a task by its title). Text is clipped at 80 characters |
| | `toolIntent(toolName, args)` | The trimmed `description` argument, else `undefined`. Read only for the shell tools, `Task` and `Agent` |
| | `toolOutcome(toolName, output)` | `"failed"` for `{ ok: false }`, `{ kind: "refused" }`, `{ status: "failed", error }` and a `readProjectSource` result whose `status` is not `ok`; else `"ok"`. A call that threw shows in the item's `status`; `toolOutcome` reads only the result |
| `tool` (file `tool-grouping.ts`) | `composeToolGroupLabel(names)` | Joins verb phrases: "Ran 2 searches and wrote a file". More than four distinct phrases read "Ran N tools"; an unknown tool reads "ran `name`" |
| | `composeToolCallsLabel(calls)`, `withToolState(label, state, count, total)` | Intents joined with " · ", ending "· +N more" past three. State adds "…" while running, "(failed)" or "(waiting)" on one step, "(2 failed)" on a run. A failed step that a later step of the same tool completed reads "Tried …" |

`toolSubject` picks its text in this order:

1. A workforce or task tool, in its own words.
2. An MCP tool `mcp__<server>__<tool>`, as `Calling MCP tool <Server> <Tool>`.
3. A shell tool (`shell`, `bash`, `command_execution`, `run_command`, `terminal`, any casing): the first non-blank line of `command`, with a leading `cd <dir> &&` removed. `code` is `true`.
4. `file_change`: `Edit <path>`, plus "and N more".
5. Any other tool: a verb (the tool name title-cased, minus `web_` and `_file`) plus the first present of `query`, `pattern`, `glob_pattern`, `globPattern`, `url`, `file_path`, `path`, `target_file`, `target_directory`, `dir`. `query` and `pattern` are quoted, a `url` is kept whole, a path is cut to its last three segments.

### Prompt input and attachments

`prompt-input` and `attachments` install together. `PromptInput` imports `@flow-state-dev/react`.

| Export | Props and behaviour |
| --- | --- |
| `PromptInput` | `onSubmit(message: PromptInputMessage, event)` (required); `attachments?`; `client?: AttachmentUploader \| null`; `sessionId?`; `accept?`; `multiple?` (default `true`); `globalDrop?`; `maxFiles?`; `maxFileSize?`; `onError?({ code, message })` with `code` one of `max_files`, `max_file_size`, `accept`, `upload`; plus `form` props except `onSubmit` and `onError`. `client`, `sessionId`, `accept`, the limits and `onError` are ignored when `attachments` is passed or a `PromptInputProvider` is above it |
| `PromptInputMessage` | `{ text: string; attachments: FileContent[] }` |
| `AttachmentUploader` | Anything with `upload({ data: Blob, mediaType?, filename? }): Promise<FileContent>`: a `@flow-state-dev/client` client, or a flow handle from one |
| `PromptInputSubmit` | `status?: "ready" \| "submitting" \| "streaming" \| "error"`, `onStop?`. Acts as a stop button while `submitting` or `streaming` |
| `PromptInputProvider` | `UseAttachmentsOptions & { initialInput?: string }`. Lifts text and attachment state out of `PromptInput`. Hooks: `usePromptInputController`, `usePromptInputAttachments`, `useProviderAttachments` |
| `useAttachments(options)` | Options: `client`, `sessionId` (a change drops the draft's files), `accept`, `limits?: { imagesPerMessage, documentsPerMessage, maxFiles, maxFileBytes }`, `prepare?(file) => Promise<Blob>`, `onRefused?`. Returns `files`, `refusals`, `uploading`, `dragging`, `accept`, `add`, `remove`, `clear`, `settle`, `take`, `consume`, `openFileDialog`, `fileInputRef`, `onPaste`, `dropTarget` |
| `AttachmentPreview`, `AttachmentStrip` | `AttachmentPreview({ filename, mediaType, size?, src?, status?, refusal?, unavailable?, onRemove?, className? })`: a thumbnail for an image with a readable `src`, a chip otherwise |
| Compound parts | `PromptInputBody`, `PromptInputTextarea`, `PromptInputHeader`, `PromptInputFooter`, `PromptInputTools`, `PromptInputButton`, `PromptInputAttachments`, `PromptInputAttachButton`, `PromptInputActionAddAttachments`, and the `PromptInputActionMenu*`, `PromptInputSelect*`, `PromptInputHoverCard*`, `PromptInputTab*` and `PromptInputCommand*` families |

Enter sends, Shift+Enter starts a new line, and an Enter that confirms an input method's word never sends. Backspace in an empty box removes the last attached file. A pasted file is attached; pasted text is left alone. The placeholder is "What would you like to know?".

By default an image is downscaled to 1568 pixels on its longest side before upload. A refusal has one of the codes `type`, `size`, `count`, `upload`, `unavailable`. A pending file's `status` is `uploading`, `ready` or `refused`.

### Status of a run

| Install name | Exports | Props and behaviour |
| --- | --- | --- |
| `streaming-indicator` | `StreamingIndicator` | `message?`, `isFinishing = false`, `since?` (epoch ms). Label "Tidying up..." when finishing, else `message`, else "Working...". With `since`, a timer: `42s`, `1m 24s`, `1h 3m`. Shows no timer for the first second |
| | `WorkedFor` | `startedAt`, `endedAt`. "Worked for 3m 24s • 4:28 PM"; draws nothing under a second |
| `spend` | `Spend` | `spend: SpendSummary \| null \| undefined`, `className`, `split?`, `harnessLabel?`, `attempts?`, `durationMs?`. One line: harness, model, tokens (`12.4k tokens`), cost (`$0.0042` under a cent, else `$0.42`), "N attempts" from 2, duration. `split` reads `10.1k in · 2.3k out`. `unreported` adds "(partial)". The span carries `data-spend="live"` or `"final"`. Draws nothing without a line |
| `run-checks` | `RunChecks`, `runCheckPassed` | `checks: RunCheck[] \| null`, `defaultOpen`, `className`. `RunCheck` is `{ command, exitCode, timedOut, skipped, durationMs, tail }`. Header "Checks n/m passed"; opens by itself when any check failed. `null` or empty draws nothing |
| `run-changes` | `RunChanges` | `files: { path, added, removed }[] \| null`, `fileCount?`, `added?`, `removed?`, `loadPatch?(path) => Promise<{ patch, truncated, verified? }>`, `defaultOpen = false`, `className`. A file opens only when `loadPatch` is given; the patch is read on open and kept. `null` counts read "binary". `verified: false` shows that git could not read the patch, and reads again on reopen |
| `work-place` | `WorkPlace` | `place: { branch, commits, name?, state?, attachedTo?, commands: { switch, cd, log } } \| null`, `className`. "N commits on `…/last-two-branch-segments`"; `commits: null` reads "commits unknown". Copy buttons for `git switch`, `cd` and `git log`, the last two only when not `null`. `place` comes from `workPlace` in `@flow-state-dev/harness-manager/work-place` |
| `harness-readiness` | `HarnessReadiness` | `rows: { harness, label, ready, reason, remedy, unanswered }[] \| undefined`, `recheck?`, `className`. `undefined` reads "Checking the coding harnesses…". Marks: ✓ ready, ✗ not ready, ? no answer. "Re-check" shows only with `recheck` |
| `task-actions` | `TaskActions` | `id`, `status`, `actions: { cancel, steer, release, retry }`, `steer = false`, `rerun = []`, `onSettled`. `pending`, `held` and `in_progress` draw Cancel and Steer (with `steer`), and `held` also draws Release; `errored` and `cancelled` draw Retry and one `Re-run on <label>` per `rerun` entry `{ label, run() }`; any other status draws nothing. Cancel asks once inline, then reports "Cancelled." or `Cancelled, with the tasks waiting on it: <ids>.` |
| `task-signals` | `taskSignal`, `TaskTime`, `taskCounts`, `agoText` | `TaskTime({ view, run?, now, stale?, tone?, fallback })`. Signals: `working` ("working · 4m 12s"), `quiet` ("quiet for 7m"): shown for a running row once `run.leaseUntil` has passed, counted from the row's last update, unless `stale` is true; `ended` ("12m ago"). A queued, held or waiting row has none. The component runs no timer; pass `now`. `taskCounts(views)` reads "2 running · 1 waiting · 1 failed · 28 done", dropping zeros. Imports `@flow-state-dev/orchestration/tasks` |

### Connection and recovery

`ConnectionFeedStatus` is `"connecting" | "live" | "reconnecting" | "lapsed" | "stopped"`, the states `sessionFeed` in `@flow-state-dev/client` reports. `isFeedStale(state)` is true for `lapsed` and `stopped` only.

| Install name | Exports | Props and behaviour |
| --- | --- | --- |
| `connection-banner` | `ConnectionBanner` | `feed: { state }`, `onRetry?`, `className`. Draws only when stale. `lapsed` reads `Lost the server <age> ago, retrying…`. `stopped` says the server stopped the feed and that what shows is the last it sent, with a Retry button only when `onRetry` is passed. Age counts from when the feed left `live` (`12s`, `3m`, `1h`) |
| | `STALE_CLASS` | Greys an area and stops its `animate-pulse` and `animate-spin` |
| `connection-screen` | `ConnectionScreen` | `kind: "refused" \| "unreachable"`, `title`, `children?`, `failure: { httpStatus?, message }`, `onRetry?`, `className`. `refused` has no retry. `unreachable` with `onRetry` has a Retry button and retries on its own after 2, 4, 8, up to 30 seconds. A click retries at once and restarts the wait |
| `request-recovery` | `RequestRecovery` | Three prop shapes: failed (`reason`, `code?`, `details?`, `who?`, `onRetry?`), interrupted (`onContinue` and/or `onDiscard`, `reason?`, `who?`) and stopped (`stopped: true`, `stillRunning?`, `onView?`). Actions are `() => Promise<unknown>`. Buttons disable while one runs; a rejection adds `Retry failed: <message>` (or `Continue` or `Discard`) |
| `stuck-request-banner` | `StuckRequestBanner` | `session: { isStuck, dismissRequest(requestId?) }`, `className`; the shape `useSession` returns for those fields. Draws nothing unless `isStuck`; otherwise a message and a Dismiss button |

### Artifacts and previews

| Install name | Exports | Props and behaviour |
| --- | --- | --- |
| `artifact` | `ArtifactShell`, `ArtifactHeader`, `ArtifactTitle`, `ArtifactDescription`, `ArtifactActions`, `ArtifactAction`, `ArtifactContent`, `ArtifactClose` | `ArtifactAction` takes `tooltip?` |
| `file-tree` | `FileTree`, `FileTreeFolder`, `FileTreeFile`, `FileTreeIcon`, `FileTreeName`, `FileTreeActions` | `FileTree({ selectedPath, onSelect(path), expanded?: Set<string>, defaultExpanded?: Set<string> })`. `FileTreeFolder` and `FileTreeFile` take `path`, `name`, `icon?`. Enter or Space on a file selects it |
| `jsx-preview` | `JSXPreview`, `JSXPreviewContent`, `JSXPreviewError` | `JSXPreview({ jsx, isStreaming = false, components?, bindings?, onError?, children?, className? })`. `isStreaming` closes unclosed tags. A parse or guard error goes once to `onError` and the last good render stays. Input over 100,000 characters is refused |
| `sandbox` | `Sandbox` | `jsx`, `isStreaming?`, `components?`, `bindings?` and `div` props. Preview and Source tabs over `JSXPreview` and `CodeBlock` |
| `session-overlay` | `SessionOverlay`, `SessionOverlayProvider`, `SessionOverlayArea` | `variant: "sheet" \| "modal"`, `label`, `title`, `status?`, `meta?`, `toolbar?`, `onClose`, `feed?`, `children`, `footer?`. A `sheet` draws inside a `SessionOverlayArea` under a `SessionOverlayProvider` and leaves a side pane usable; a `modal` draws over the page and holds Tab. Esc, the close button and a backdrop click close it and return focus. A `footer` past 60% of the height scrolls on its own. Imports `@flow-state-dev/react` |

`JSXPreview` renders model-written JSX with a guard:

- Tags are limited to text and layout, lists, tables, `img`, `button`, `input`, `select`, `textarea` and static SVG. `<form>` is not allowed.
- URL attributes keep only `http:`, `https:`, `mailto:`, `tel:` or relative values.
- `on*` props, `dangerouslySetInnerHTML`, `srcDoc`, `form` and `srcset` are dropped.
- A dotted tag works only for a capitalized member of one of your `components`. Components you pass render as given; `bindings` are readable by the JSX.

## Flow-aware components

### Renderers

`chatAssistantRenderers` is a `RendererRegistry` for `FlowProvider`'s `renderers` prop. `chat-assistant` installs it with the suspension cards, `Debate`, `EventedActors` and `RoutedSpecialists`.

| Slot | Value |
| --- | --- |
| `message` | `Message` |
| `reasoning` | `Reasoning` |
| `tool_output` | `Tool` |
| `status` | `Status` |
| `error` | `ErrorDisplay` |
| `suspension` | `SuspensionCard` |

`block_trace` and `source` are `false`; draw sources with `<SourcesGroup items={...} />`. Its `container` slot maps `evented-actors`, `debate` and `routedSpecialists` to `EventedActors`, `Debate` and `RoutedSpecialists`. Its `data` slot maps `audit-annotation` to `AuditAnnotation` and `task-board-meta` to a `TaskPlan` for that item's `collectionId`, which draws nothing without one. A `task-change` item needs no entry, since `TaskPlan` reads it. To hide the task board in the chat, set the `task-board-meta` entry of the `data` slot to `false`. `false` draws nothing. To drop any other entry, set it to `false` under its slot the same way. To draw a data type of your own, add an entry under its `dataType`, as the example at the top does for the support flow's `order-card` items.

A nested `FlowProvider` merges onto its parent. For each slot the child wins, `false` included, and `component`, `container` and `data` merge key by key. A child that sets only `data: { "task-board-meta": false }` keeps the parent's other `data` entries and every other slot.

`RendererRegistry` is the type of the `renderers` prop:

| Key | Type | What it draws |
| --- | --- | --- |
| `message`, `reasoning`, `block_trace`, `tool_output`, `status`, `source`, `error`, `suspension` | component or `false` | An item of that `type`. `false` draws nothing |
| `stopped` | component or `false` | A "stopped" conversation line, given `{ line }`. Unset draws a plain "Stopped" |
| `container` | `Record<string, component \| false>` | A `container` item, by its `component` name |
| `data` | `Record<string, component \| false>` | A `data` item, by its `dataType`. With no entry it draws nothing |
| `component` | `Record<string, component \| false>` | The renderer a `suspension` names in `render.component` |

What a renderer receives: [Client configuration](./client.md).

`ItemsRenderer` comes from `@flow-state-dev/react`, not the registry.

| Prop | Meaning |
| --- | --- |
| `lines?`, `items?` | The conversation lines or the items to draw |
| `deduplicateByKey` | Default `true`: only the latest `data` item per `key` within a request |
| `showSubAgents` | Default `false`. When false, `message`, `reasoning` and `tool_output` items with `itemVisibility.history` false, and `block_trace`, `router_decision` and `state_snapshot` items, are left out |
| `toolGroupRenderer?` | Draws a run of tool calls and thinking as one unit. Default draws each alone |
| `live?` | The request is running |

What `ItemsRenderer` draws and skips, including container items, failed and stopped requests, and the fallback for a type with no renderer: [Items and the stream](./items.md).

### Suspension cards

| Install name | Exports | Props and behaviour |
| --- | --- | --- |
| `approval` | `Approval` | `item: SuspensionItem`, `isResolved?`, `resolution?`, `canAnswer = true`. Pending: the message as Markdown, a "Details" block when `item.data` has fields other than `approveOptions`, Approve and Reject, and one extra button per `data.approveOptions` entry `{ label, data }` that sends that data with the approval. Resolved: a receipt, green for `approved`, red for `rejected`. With `canAnswer={false}` it says it is waiting. It finds its resolution from a `suspension_resume` item with the same `suspensionId` in `SessionItemsProvider`, unless `isResolved` is passed |
| `chat-assistant` | `Question` | `item`, `isResolved?`, `resolution?`. A three-row text area; submits the string |
| | `Selection` | Radios for a single `enum`, checkboxes for an array of `enum` |
| | `Form` | One control per property of a flat `resumeSchema`: text, number, checkbox, select, multi-select. A nested, array-of-objects or union schema needs a custom renderer |
| | `SuspensionCard` | `item`. Picks, in order: a `render.component` registered in `renderers.component` and not `false`; `ReviewSuspension` for a `kind: "review"` stop whose resume schema takes a review verdict; then `Form`, `Selection`, `Question`, else `Approval` |
| `review-hold` | `ReviewHold` | `prompt?`, `review?: ReviewDetail`, `answer?(answer: ReviewAnswer) => Promise<void>`, `unanswerable?`, `resolved?`, `holdId?`, `loadPatch?`, `children`. Buttons Accept and Ask for changes; when `review.lands` is not empty, Accept is replaced by one button per land, "Accept: Open a PR" and/or "Accept: Merge locally". After a failed landing the retried way reads "Retry: Open a PR" or "Retry: Merge locally" and comes first. Buttons disable while the answer is in flight, and a failure shows under them with the words kept. `resolved` (`"accepted"`, `"revise"` or `"answered"`) collapses to a receipt. With no `answer`, or `unanswerable` set, it shows the review and no buttons |
| | `ReviewSuspension` | `item`, `review?`, `isResolved?`, `resolution?`, `loadPatch?`. Answers through `SuspensionResolverProvider` with `action: "submit"` |

The answer a review hold sends back, and the shape of the review it draws: [Harness runs](./harness-runs.md).

### Task plan and request groups

| Install name | Exports | Props and behaviour |
| --- | --- | --- |
| `task-plan` | `TaskPlan` | `collectionId` (required); `requestId?` (bind to one run; without it, the latest request that emitted events for the collection); `items?`; `groupByAssignee?`; `statusConfig?: Record<string, StatusConfig>`; `renderTaskAction?(task)`; `hiddenStatuses?` (default `["cancelled"]`); `title?`; `hideEmpty?`; `className?` |
| `request-group` | `RequestGroupRenderer` | `items`, `isStreaming` (both required), `statusMessage?`, `isFinishing = false`, `showWorkedFor = false`, `latestCompletedAtMs?`, `turns?: readonly LineTurn[]`. Groups items by `requestId`; draws each with `ItemsRenderer` and `ToolGroup`, then `SourcesGroup`, then for the last group while streaming a `StreamingIndicator` timed from that group's first item. With `showWorkedFor` and no stream, a `WorkedFor` line. With `turns`, a failed turn offers Retry on the last group only, and a stopped request draws its stopped line once, after its last group. Without `turns`, no line offers Retry and no turn draws as stopped. Hides the items a task owns so they are not drawn twice. Imports `@flow-state-dev/react` |
| `audit-annotation` | `AuditAnnotation` | `item: DataItem`. Registered under `data["audit-annotation"]` in `chatAssistantRenderers`; `fsdev ui add audit-annotation` installs it alone. Draws the surfaced analyzer results with severity (`info`, `warning`, `critical`), per-analyzer scores and the evidence flagged. Draws nothing when `surfacedResults` is empty. The `responseAuditor` pattern emits it |
| `session-items-context` | `SessionItemsProvider`, `useSessionItems` | `value={OutputItem[]}` |

`TaskPlan` reads `data` items of `dataType` `task-change` and `task-board-meta`, the latest per task. Its sections, in order, are `pending` "Todo", `in_progress` "In progress", `held` "Held", `completed` "Done", `errored` "Failed" and `cancelled` "Cancelled". Empty sections are hidden, and an unknown status draws with a fallback config. `groupByAssignee` sub-groups each section by `task.assignee`, "Unassigned" last. `title` defaults to "Tasks" (the collection id is read out to screen readers only); `hideEmpty` defaults to showing "No tasks yet". `renderTaskAction` adds a control beside each task's title. A click on it also opens or closes the task unless its handler calls `event.stopPropagation()`. `fsdev ui add task-plan` installs it, and it needs a `SessionItemsProvider` or `items`, not a `FlowProvider`.

### Conversation lines

| Install name | Exports | Props and behaviour |
| --- | --- | --- |
| `conversation-lines` | `conversationLineRenderers` | `{ error: FailedLine, stopped: StoppedLine, suspension: ApprovalLine }`. Spread after `chatAssistantRenderers` so these win |
| | `LineContext`, `CompactSteps` | `LineContext` carries optional `who`, `nameOf`, `avatarOf`, `openTask`, `openMessage`, `sentStatusOf`, `retry`, `stillRunning`, `onViewRunning`, `canAnswer` and `readFile`. Outside a provider a line draws with no action |
| `workforce-lines` | `workforceLineRenderers`, `withBrief` | `workforceLineRenderers` goes in the `data` slot, keyed `workforce:received`, `workforce:sent`, `workforce:task` and `workforce:result`. `withBrief(Message)` folds a task brief to one "Task brief" line. Headers read "Messaged ada", "Asking ada…", "Asked ada", "Not sent to ada", "Not answered by ada", "Filed a task for ada: …" and "ada finished: …". Imports `@flow-state-dev/workforce/browser` |

`Debate`, `EventedActors` and `RoutedSpecialists` each take `{ item: ContainerItem }` and read their nested records from `SessionItemsProvider`.

## Tokens

The `tokens` item holds the colour variables the components read, in light and dark. Any component that needs it brings it in when you install the component. It writes them in `@layer base` under `:root` and `.dark`, so a value you declare in your own stylesheet wins. Components copied in against a stylesheet with no tokens draw their status parts with no colour.

The semantic tokens are `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, each with a `-foreground` partner (`background` pairs with `foreground`), plus `border`, `input` and `ring`.

| Token | Used for | Light | Dark |
| --- | --- | --- | --- |
| `success` | Done, approved, a passing result | `hsl(142 76% 36%)` | `hsl(142 69% 58%)` |
| `warning` | Something is off and nobody is asked: a blocked task, a stuck request, a denied call | `hsl(32 95% 44%)` | `hsl(43 96% 56%)` |
| `info` | Running, in progress | `hsl(217 91% 60%)` | `hsl(213 94% 68%)` |
| `attention` | A user must act: a tool call awaiting approval, an interrupted request | `hsl(41 96% 40%)` | `hsl(48 96% 53%)` |
| `destructive` | Failed, rejected, an error | `hsl(0 84.2% 60.2%)` | `hsl(0 62.8% 58%)` |

Each has a `-foreground` partner for text on a filled background. `success`, `warning`, `info` and `destructive` light foregrounds are `hsl(0 0% 98%)` and dark ones `hsl(240 10% 3.9%)`; `attention`'s foreground is `hsl(240 10% 3.9%)` in both. `attention` is used as a fill (`bg-attention` with its foreground on top), and `Approval` and `AuditAnnotation` fill with `success`, `info`, `warning` and `destructive` too; elsewhere the status tokens are text and icon colours. To change one, set the variable in `:root` and `.dark`: `--attention`, `--attention-foreground`, `--warning`.

## Generative UI

Generative UI lets a model draw a card by calling a tool. Each shape is a Zod schema, a renderer and an `emit*` tool block that emits a `data` item.

| Import path | Runs | Exports |
| --- | --- | --- |
| `@flow-state-dev/ui/generative/tools` | Server | `generativeTools()`, `generativeTools.pick(...names)` (both return `BlockDefinition[]`); `InfoCardSchema`, `LinkCardSchema`; `emitInfoCardTool`, `emitLinkCardTool`; `GenerativeTool`, `GenerativeToolOptions` |
| `@flow-state-dev/ui/generative/renderers` | Browser | `generativeRenderers()`, `generativeRenderers.pick(...names)` (both return `Record<string, ComponentType<{ item: DataItem }>>`); `InfoCardRenderer`, `LinkCardRenderer`; `GenerativeRenderer` |

The renderers entry imports neither `@flow-state-dev/core` nor `zod` at runtime. `.pick` takes component names (`"info-card"`), not tool names, and ignores a name it does not know. The renderer map goes in the `data` slot, since the tool emits a `data` item whose `dataType` is the component name:

```tsx title="src/app/support/renderers.ts"
import { generativeRenderers } from "@flow-state-dev/ui/generative/renderers";

export const renderers = { data: generativeRenderers() };
```

| Tool (block name) | Component | Use for | Returns to the model |
| --- | --- | --- | --- |
| `emitInfoCard` | `info-card` | Profile snapshots, place summaries, contact-style info, quick reference cards | `{ rendered: true, kind, id }` |
| `emitLinkCard` | `link-card` | Citations, further-reading suggestions, source attributions, replacing bare URLs | `{ rendered: true, kind, url }` |

How the tool descriptions are laid out, and how `GenerativeToolOptions.keyFrom` picks the key that replaces a card: [Tools](./tools.md).

| Shape | Fields |
| --- | --- |
| `info-card` | `id` (min 1), `title` (min 1), `subtitle?`, `imageUrl?` (URL), `facts` (up to 8 of `{ label, value }`, each min 1), `footer?` |
| `link-card` | `url` (URL), `title` (min 1), `description?`, `siteName?`, `imageUrl?` (URL), `favicon?` (URL) |

`fsdev ui add info-card` or `link-card` copies a renderer into `components/flow-state/generative/<name>.tsx`, exporting `InfoCardRenderer` or `LinkCardRenderer`. Both versions are plain Tailwind class names. To use the copy, override its entry: `data: { ...generativeRenderers(), "info-card": InfoCardRenderer }`.

## Workforce panels

These screens ship from `@flow-state-dev/workforce/react`, not the registry. Read-only behaviour, `groupIntoColumns` and `BOARD_STATUS_COLUMNS`: [Workforce](./workforce.md).

| Component | Props | Draws |
| --- | --- | --- |
| `Roster` | `sessionId` (required), `collectionRef = "roster"`, `problems?: readonly string[]`, `limit?`, `slots?: { rowTrailing?(row), empty?() }`, `client?`, `live?` | One row per worker: `workerId`, then `flow`. Empty: "No workers have been hired in this organization yet." `problems` adds "N worker(s) could not be loaded". The organization is the session's |
| `BoardColumns` | `sessionId`, `boardRef` (one path segment), both required; `limit?`, `slots?: { card?(row), columnHeader?(column), empty?() }`, `client?`, `live?` | Columns `pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled`, plus one column per status it does not know. A card shows `title`, else `goal`, else `id`, and the `assignee`. Empty column: "Nothing here" |
| `BoardList` | `sessionId`, `boardRef`, `limit?`, `slots?: { row?(row), empty?() }`, `client?`, `live?` | Rows newest first by `createdAt`; a row without one follows the dated rows. Each row shows title (else goal, else id), the status word as written and the assignee. No row is hidden by status |
| `WorkerDetail` | `sessionId`, `kind`, `workerId?`, `collectionRef?`, `client?` | A worker's instructions. States, by `data-state`: instructions, none given, not published, reading, could not be read. With no `workerId` it shows "not published" and reads nothing |

- The board card row shape and `slots.card`, paging, `live` and the empty and failed-read states: [Workforce](./workforce.md).
- `FlowNavigator` comes from `@flow-state-dev/react`. Its session row reads "Waiting on you" with ◆ when the latest request is suspended, or "Waiting" with ◇ when the request waits on other work.

Set the panels' text with `--fsd-panel-fg`, `--fsd-panel-font-size`, `--fsd-panel-muted-fg`, `--fsd-panel-note-font-size` and `--fsd-panel-heading-font-size`. `FlowNavigator` reads a separate family, `--fsd-nav-*`: `attention`, `bg`, `fg`, `font-size`, `guide`, `muted-fg`, `note-font-size`, `section-font-size`, `selected-bg` and `selected-fg`.

## Related

- [Items and the stream](./items.md): the item types these components draw.
- [Tools](./tools.md): the tools whose calls `Tool` and `ToolGroup` draw.
