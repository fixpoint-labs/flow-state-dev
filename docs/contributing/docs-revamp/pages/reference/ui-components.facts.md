# Facts for UI components (R-36, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. **[source]** marks a fact read from implementation because no exported doc comment or test states it; **[test]** where a test pins it; **[doc]** where only an existing user page states it and the code neither confirms nor contradicts it. Nothing was run; every fact is read from source.

Abbreviations (paths from the repo root):

- `R` = `packages/ui/registry/components/`. `RJ` = `packages/ui/registry.json`. `UP` = `packages/ui/package.json`. `UR` = `packages/ui/README.md`. `G` = `packages/ui/src/generative/`. `UT` = `packages/ui/test/`.
- `RC` = `packages/react/src/`. `W` = `packages/workforce/src/react/components/`. `CLI` = `packages/fsdev/src/commands/ui.ts`.
- Existing pages: `p-com` = `apps/docs/docs/ui/common-components.md`, `p-aw` = `apps/docs/docs/ui/flow-aware-components.md`, `p-ov` = `apps/docs/docs/ui/overview.md`, `p-gen` = `apps/docs/docs/ui/generative.md`, `p-wf` = `apps/docs/docs/workforce/ui.md`.

## What the page is

A Reference page: for each registry component, its install name, the names it exports, its props, and what it needs around it. Lookup it answers by name: "Which components need a `FlowProvider`?" (Table P-1). Tables and signatures, no narrative.

Package facts:

- `@flow-state-dev/ui` is `"private": true` in `UP:4`. Its only `exports` are `./generative/renderers` and `./generative/tools` (`UP:5-14`), both pointing at `.ts` source. Every other component is installed by copying (`UR:5`, `p-ov:11`). **Open flag:** `private: true` means the generative import paths cannot be installed from npm as the package stands. The page should either state how a reader gets them or leave the "runtime import" claim to whoever owns publishing. Not resolvable from the sources allowed here.
- Install: `fsdev ui add <components...>` runs `npx shadcn@latest add <registry>/<name>.json` once for all names (`CLI:60-80`); `--registry <url|path>` default `https://ui.flow-state.dev/r` (`CLI:13,58`); `--cwd <dir>` (`CLI:59`). `fsdev ui list` lists items (`CLI:87`). Also `npx shadcn@latest add https://ui.flow-state.dev/r/message.json` (`UR:17`, `p-ov:21`).
- Files land under `components/flow-state/` in the project (`RJ:118` and every item's `target`). `info-card` and `link-card` land under `components/flow-state/generative/` (`RJ:627-655` region, target `components/flow-state/generative/info-card.tsx`). Imports in examples are `@/components/flow-state/<file>` (`p-com:18`).
- The registry has 46 named items: `tokens`, 44 component items, and `workforce-starter` (a `registry:file` of `TEAM.md` and `WORKER.md`, `RJ:795`). Item names are listed in Table I-1.
- A component installed from the registry also installs its `registryDependencies`, which include other registry items (for example `tool` brings `tool-naming`, `tokens`, `code-block`; `RJ:179-199`).

## Table I-1: Registry items, what each installs, and what it imports from `@flow-state-dev/*`

"Package deps" is the item's `dependencies` in `RJ`, filtered to `@flow-state-dev/*`. "Provider" is what the component reads from React context at runtime (see Table P-1). Line is the item's `name` line in `RJ`.

| Item | Files it installs | `@flow-state-dev/*` packages it imports | `RJ` line |
| --- | --- | --- | --- |
| `tokens` | none (CSS only) | none | 7 |
| `conversation` | `conversation.tsx` | `react` (value: `useJumpToLatest`, `R/conversation.tsx:9`) | 109 |
| `session-overlay` | `session-overlay.tsx` | `react` (value: `useJumpToLatest`, `R/session-overlay.tsx:19`) | 123 |
| `message-response` | `message-response.tsx` | none | 137 |
| `message` | `message.tsx` | `core` (types, `R/message.tsx:4`) | 151 |
| `reasoning` | `reasoning.tsx` | `core` (type) | 165 |
| `tool` | `tool.tsx`, `tool-grouping.ts` | `core` (value: `isSuspensionWait`, `R/tool.tsx:23`) | 179 |
| `tool-naming` | `tool-naming.ts` | none | 200 |
| `working-status` | `working-status.ts` | `core` (type) | 216 |
| `code-block` | `code-block.tsx` | none | 232 |
| `attachments` | `attachments.tsx` | `core` (`FileContent` type; `core/attachments`, `R/attachments.tsx:34`) | 246 |
| `prompt-input` | `prompt-input.tsx` | `core` (type), `react` (value: `isSendKey`, `R/prompt-input.tsx:63`) | 260 |
| `sources` | `sources.tsx` | `core` (type) | 274 |
| `suggestion` | `suggestion.tsx` | none | 288 |
| `shimmer` | `shimmer.tsx` | none | 302 |
| `status` | `status.tsx` | `core` (type) | 316 |
| `error` | `error.tsx` | `core` (type) | 330 |
| `task-plan` | `task-plan.tsx`, `task-plan-state.ts`, `tool-summaries.ts` | `core` (items) | 344 |
| `audit-annotation` | `audit-annotation.tsx` | `core` (type) | 370 |
| `model-badge` | `model-badge.tsx` | `core` (type) | 384 |
| `spend` | `spend.tsx` | none | 398 |
| `task-signals` | `task-signals.tsx` | `orchestration` (value: `leaseLapsed`, `R/task-signals.tsx:4`) | 412 |
| `approval` | `approval.tsx` | `core`, `react` (value: `useApproval`, `approveOptionsOf`, `R/approval.tsx:8`) | 426 |
| `review-hold` | `review-hold.tsx` | `core`, `react` (value: `resolveApprovalOutcome`, `useSuspensionResolver`, `R/review-hold.tsx:6`) | 440 |
| `chat-assistant` | `chat-assistant.tsx`, `debate.tsx`, `evented-actors.tsx`, `routed-specialists.tsx`, `suspension-card.tsx`, `suspension-card-shell.tsx`, `suspension-resolution.ts`, `question.tsx`, `selection.tsx`, `form.tsx` | `core`, `react` | 454 |
| `streaming-indicator` | `streaming-indicator.tsx` | none | 515 |
| `request-group` | `request-group.tsx` | `core`, `react` (value: `conversationLines`, `ItemsRenderer`, `useFlowContext`, `R/request-group.tsx:19`) | 529 |
| `stuck-request-banner` | `stuck-request-banner.tsx` | none | 543 |
| `session-items-context` | `session-items-context.tsx` | `core` (type) | 557 |
| `artifact` | `artifact.tsx` | none | 571 |
| `file-tree` | `file-tree.tsx` | none | 585 |
| `jsx-preview` | `jsx-preview.tsx` | none | 599 |
| `sandbox` | `sandbox.tsx` | none | 613 |
| `info-card` | `generative/info-card.tsx` | `core` (type) | 627 |
| `link-card` | `generative/link-card.tsx` | `core` (type) | 641 |
| `connection-banner` | `connection-banner.tsx` | none | 655 |
| `connection-screen` | `connection-screen.tsx` | none | 669 |
| `request-recovery` | `request-recovery.tsx` | `core` (type) | 683 |
| `conversation-lines` | `conversation-lines.tsx` | `core`, `react` | 697 |
| `workforce-lines` | `workforce-lines.tsx` | `core`, `react`, `workforce` (value, from `@flow-state-dev/workforce/browser`, `R/workforce-lines.tsx:52`) | 711 |
| `run-changes` | `run-changes.tsx` | none | 725 |
| `work-place` | `work-place.tsx` | none | 739 |
| `run-checks` | `run-checks.tsx` | none | 753 |
| `task-actions` | `task-actions.tsx` | none | 767 |
| `harness-readiness` | `harness-readiness.tsx` | none | 781 |

Facts from the table:

- **The registry's own list of `@flow-state-dev/*` dependencies contradicts the existing claim that the common components have "no runtime dependency on `@flow-state-dev/*`"** (`p-com:7`, `p-ov:70`, `UR:25`). `conversation`, `session-overlay` and `prompt-input` each value-import `@flow-state-dev/react`. Most others import only item *types* from `core`, which compile away. The code supports this grouping instead: **needs no `@flow-state-dev` runtime package** = `message-response`, `reasoning`, `tool-naming`, `code-block`, `sources`, `suggestion`, `shimmer`, `status`, `error`, `streaming-indicator`, `stuck-request-banner`, `session-items-context`, `artifact`, `file-tree`, `jsx-preview`, `sandbox`, `info-card`, `link-card`, `connection-banner`, `connection-screen`, `request-recovery`, `spend`, `run-changes`, `work-place`, `run-checks`, `task-actions`, `harness-readiness`, `model-badge`, `audit-annotation`, `working-status`. **Needs `core` at runtime**: `tool`, `conversation-lines`, `task-plan`, `attachments`, `message`, `prompt-input`, `request-group`, `chat-assistant`. **Needs a runtime package** = the rows above naming `react`, `orchestration` or `workforce` as a value import.
- `artifact`, `file-tree`, `jsx-preview` and `sandbox` import no `@flow-state-dev` package at all (`RJ:571-626`), yet `p-aw:217-251` and `p-ov:80` file them under "flow-aware". The page should group by this table, not by the existing split.
- Components that pull in the `tokens` item: `tool`, `task-plan`, `audit-annotation`, `approval`, `review-hold`, `chat-assistant`, `stuck-request-banner`, `conversation-lines`, `workforce-lines`, `run-changes`, `work-place`, `run-checks`, `task-actions`, `harness-readiness`, `connection-banner`, `request-recovery` (`registryDependencies` in `RJ`, each at its item's lines above).

## Table P-1: What each component needs around it (answers "Which components need a `FlowProvider`?")

`FlowProvider` is `RC/context/FlowContext.ts:108`. Its context default is `{}` (`FlowCtx`, `RC/context/FlowContext.ts:64`), so a component that reads it **does not throw** outside a provider; it gets no `flowKind`, no `renderers`, no `userId`. "Needs" below means: it does its job only when that is present.

| Component | Reads from context | What happens without it | Cite |
| --- | --- | --- | --- |
| `Approval` | `flowKind` from `FlowProvider`, or a `SuspensionResolverProvider`; resolved state from `SessionItemsProvider` | With neither a `flowKind` nor a resolver, Approve and Reject are disabled, and `console.warn` fires once on mount ("Cannot resume suspension without flowKind on `<FlowProvider>`...") | `RC/hooks/useApproval.ts:152-190`, `R/approval.tsx:33-60,119-135` |
| `Question`, `Form`, `Selection` | `flowKind`, or `SuspensionResolverProvider`; resolved state arrives as props from `SuspensionCard` | Submit sets the error line "Cannot resume without flowKind on `<FlowProvider>` or a SuspensionResolverProvider." and does not send | `RC/hooks/useSuspensionForm.ts:183-260`, `R/question.tsx`, `R/form.tsx`, `R/selection.tsx` |
| `SuspensionCard` | `renderers` from `FlowProvider` (for `render.component`), `SessionItemsProvider` (resolved state), then as `Approval` or the form cards | `render.component` is not honoured without `renderers`; resolved state is not shown without `SessionItemsProvider` | `R/suspension-card.tsx:32-60`, `R/suspension-resolution.ts:14-25` |
| `ReviewSuspension` | `SuspensionResolverProvider` | Shows the review and the line `NO_RESOLVER_UNANSWERABLE` ("This review can't be answered here: the app draws it without a SuspensionResolverProvider to send the answer through."); no buttons | `R/review-hold.tsx:448-500` |
| `ReviewHold` | none. Takes `answer` as a prop | With no `answer`, no buttons | `R/review-hold.tsx:202-230` |
| `RequestGroupRenderer` | `renderers` from `FlowProvider` (read with `useFlowContext`); a `Conversation` around it (optional) | Without a provider it draws with no custom renderers; without a `Conversation` the user's line is not marked for scroll | `R/request-group.tsx:92-120,205-215` |
| `chatAssistantRenderers` | is a value for `FlowProvider`'s `renderers` prop; does nothing until passed there | n/a | `R/chat-assistant.tsx:47-70`, `RC/components/ItemRenderer.ts:241-250` |
| `TaskPlan` | `SessionItemsProvider`, unless given `items` | With neither, it reads an empty list and shows its empty state | `R/task-plan.tsx:201-215`, `R/session-items-context.tsx:3-10` |
| `Debate`, `EventedActors`, `RoutedSpecialists` | `SessionItemsProvider` (read with `useSessionItems`) | They find no nested records and draw their empty state | `R/debate.tsx:28,136`, `R/evented-actors.tsx:23,92`, `R/routed-specialists.tsx:14,32` |
| `Conversation`, `ConversationScrollButton`, `SessionOverlay` | none from a provider. `useJumpToLatest` keeps its own state | n/a. `ConversationScrollButton` throws `ConversationScrollButton needs a feed, or to be inside <Conversation>` when it has neither | `R/conversation.tsx:151`, `RC/hooks/useJumpToLatest.ts:103` |
| `PromptInput` | none from a provider. Takes `client` (an uploader) as a prop, or a `PromptInputProvider` | An attached file is refused by name with no `client` | `R/prompt-input.tsx:280-330`, `R/attachments.tsx:44-47,80-83` |
| every other component in Table I-1 | nothing | n/a | the file's own imports |

Providers the registry itself ships: `SessionItemsProvider` (`R/session-items-context.tsx:8`, a React context provider; value is an `OutputItem[]`), `SessionOverlayProvider` and `SessionOverlayArea` (`R/session-overlay.tsx:32,42`), `PromptInputProvider` (`R/prompt-input.tsx:154`), `LineContext.Provider` (`R/conversation-lines.tsx:69`). `SuspensionResolverProvider` is exported by `@flow-state-dev/react` (`RC/context/SuspensionResolver.ts:53`), prop `resolve` ("typically `session.answerSuspension`", `:44`).

## Common components: exports and props

Each row: install name, exported names, props. Props not listed pass through to the element named.

### Conversation (`conversation`, `R/conversation.tsx`)

- `Conversation` (`:53`): extends `div` props minus `ref`; `feed?: JumpToLatest`, `resetKey?: string | null` (`:31-50`). With no `feed` it makes its own from `useJumpToLatest({ resetKey })`; when `resetKey` changes the view opens at its end again (`:36-48`). Renders `role="log"` (`:60`).
- Behaviour from the doc comment: opens at its end; a line the app says the user sent (`feed.sent()`) rises to near the top; nothing else moves the view; new content below shows the jump button (`:47-52`).
- Also exports `ConversationContent` (`:84`), `ConversationEmptyState` (`:101`; props `title`, `description`, `icon`; defaults "No messages yet" / "Start a conversation to see messages here", `:101-110`), `ConversationScrollButton` (`:143`; prop `feed?`; label "Jump to latest"; renders nothing while `feed.atEnd`, `:151-160`), `useConversationFeed(): JumpToLatest | null` (`:22`; `null` outside a `Conversation`), `ConversationDownload` (`:208`; props `messages: ConversationMessage[]`, `filename = "conversation.md"`, `formatMessage`), `messagesToMarkdown` (`:200`), `ConversationMessage` (`{ role, content }`, `:180`).
- **`ScrollOnNewRequest`, which `p-com:18-26` imports, is not exported by any file in `R` or `packages/react/src`** (searched). Do not state it. The replacement is the `feed` prop plus `feed.sent()` (`:36-42`).

### Message (`message`, `R/message.tsx`)

- `Message({ item: MessageItem, readBase?: string, readFile?: ReadMessageFile })` (`:410`). **Takes a `MessageItem`, not `role` and `content`** (`p-com:30,39` shows `<Message role="assistant" content="Hello!" isStreaming />`, which does not match the code). It renders nothing for a role other than `user` or `assistant` and for a message with no text and no files (`:411-414`). A `user` message draws its text as plain text and its `file` content as thumbnails and chips; an `assistant` message draws Markdown through `MessageResponse` (`:415-436`).
- `readBase`: where the server's API is mounted when it is not this page's origin. `readFile: (file, url) => Promise<Blob>`: reads a thumbnail's bytes when a plain image request cannot authenticate (`:378-390`).
- Other exports: `MessageShell` (`from: MessageRole`, `:40`), `MessageContent`, `MessageActions`, `MessageAction`, `MessageBranch`, `MessageBranchContent`, `MessageBranchSelector`, `MessageBranchPrevious`, `MessageBranchNext`, `MessageBranchPage`, `MessageToolbar`, `MessageFiles({ files, readBase, readFile })` (`:390`), `MessageRole = "user" | "assistant" | "system" | "data" | "tool"` (`:34`), and re-exports `MessageResponse`.
- `message-response` (`R/message-response.tsx`): `MessageResponse` (`ComponentProps<typeof Streamdown>`, `:24,51`) and `MarkdownText({ text, className, inline = false })` (`:81`). `UR` says `MarkdownText` shows any HTML in the text as text, and with `inline` keeps it to one truncated line of inline Markdown ([doc], `UR` table row).

### PromptInput (`prompt-input`, `R/prompt-input.tsx`; `attachments`, `R/attachments.tsx`)

- `PromptInput` props (`:280-323`): `onSubmit(message: PromptInputMessage, event) => void | Promise<void>` (required); `attachments?: Attachments`; `client?: AttachmentUploader | null`; `sessionId?: string | null`; `accept?: string`; `multiple?: boolean` (default true); `globalDrop?: boolean`; `maxFiles?: number`; `maxFileSize?: number`; `onError?({ code: "max_files" | "max_file_size" | "accept" | "upload", message })`; `syncHiddenInput?` (kept so existing callers compile, no effect: drop it from the page). Plus `form` element props except `onSubmit` and `onError`. `client`, `sessionId`, `accept`, the limits and `onError` are ignored when `attachments` is passed, and inside a `PromptInputProvider` (`:281-296`).
- `PromptInputMessage = { text: string; attachments: FileContent[] }` (`:271-278`).
- `AttachmentUploader` is anything with `upload({ data: Blob, mediaType?, filename? }): Promise<FileContent>`: a `@flow-state-dev/client` client, or a flow handle from one (`R/attachments.tsx:43-47`).
- Enter sends, Shift+Enter is a new line, and an Enter that confirms an input method's word never sends. Send is skipped if the submit button is disabled (`:589-610`). Backspace in an empty box removes the last attached file (`:612-621`). Pasted files are attached, pasted text is left alone (`:633`). Placeholder default "What would you like to know?" (`:574`).
- `PromptInputSubmit` (`:790`): props `status?: PromptStatus` (`"ready" | "submitting" | "streaming" | "error"`, `:88`), `onStop?`. While `status` is `submitting` or `streaming` it acts as a stop button (`:802`).
- `PromptInputProvider` (`:154`): props `UseAttachmentsOptions & { initialInput?: string }`; lifts the text and attachment state out of `PromptInput`; hooks `usePromptInputController`, `usePromptInputAttachments`, `useProviderAttachments`.
- `useAttachments(options)` (`R/attachments.tsx:236`). `UseAttachmentsOptions` (`:80-92`): `client`, `sessionId` (a switch drops the draft's files), `accept`, `limits?: { imagesPerMessage, documentsPerMessage, maxFiles, maxFileBytes }`, `prepare?(file) => Promise<Blob>` (default `downscaleImage`, longest side `ATTACHMENT_IMAGE_MAX_EDGE = 1568`, `:135`), `onRefused?`. Returned `Attachments` (`:95-133`): `files`, `refusals`, `uploading`, `dragging`, `accept`, `add`, `remove`, `clear`, `settle`, `take`, `consume`, `openFileDialog`, `fileInputRef`, `onPaste`, `dropTarget`.
- Refusal codes: `type`, `size`, `count`, `upload`, `unavailable` (`:49-53`). `PendingAttachment.status`: `uploading | ready | refused` (`:56-70`).
- `AttachmentPreview` (`:512-528`): `filename`, `mediaType`, `size?`, `src?`, `status?`, `refusal?`, `unavailable?`, `onRemove?`, `className?`. A thumbnail for an image with a readable `src`; a chip otherwise. `AttachmentStrip({ attachments })` (`:582-592`).
- Also exported from `prompt-input`: the compound parts `PromptInputBody`, `PromptInputTextarea`, `PromptInputHeader`, `PromptInputFooter`, `PromptInputTools`, `PromptInputButton` (prop `tooltip?: string | { content, shortcut?, side? }`, `:692-700`), `PromptInputActionMenu*`, `PromptInputSelect*`, `PromptInputHoverCard*`, `PromptInputTab*`, `PromptInputCommand*`, `PromptInputAttachments`, `PromptInputAttachButton`, `PromptInputActionAddAttachments` (`:206-262,560-1034`).

### Reasoning (`reasoning`, `R/reasoning.tsx`)

- `Reasoning({ item: ReasoningItem })` (`:239`): draws the trigger and the text. Renders nothing for an item with no text and not `in_progress`.
- `ReasoningShell` (`:60`) props: `ComponentProps<typeof Collapsible> & { isStreaming?, open?, defaultOpen?, onOpenChange?, duration? }` (`:49-55`). `defaultOpen` defaults to `false` (`:65`), so the block starts collapsed, and, because that default counts as "explicitly closed", it does not open itself when streaming starts unless the caller passes `defaultOpen` true [source, `:66-69,108-113`]. After streaming ends it closes once, 1 second later (`AUTO_CLOSE_DELAY = 1000`, `:57,115-126`). It records the streaming duration in seconds (`:89-100`).
- Parts: `ReasoningTrigger` (`:169`), `ReasoningContent` (`:211`), `useReasoning` (`:41`).

### Tool (`tool`, `R/tool.tsx`, `R/tool-grouping.ts`; `tool-naming`, `R/tool-naming.ts`; `working-status`, `R/working-status.ts`)

- `Tool({ item: BlockTraceItem | ToolOutputItem })` (`:320`): one call; renders nothing when the item has no `toolCall`.
- `ToolGroup({ items, defaultOpen = false, live = false, className })` (`:344`): folds a run of tool calls and reasoning into one collapsed line that opens to each step in order. `live` = the agent is still working after the last item; the line then names the latest step (`:325-340`). `ToolRow({ item, redone = false, defaultOpen = false, className })` (`:416`): one step.
- Other exports: `ToolInput`, `ToolOutput`, `getStatusBadge` (`:88`), `toolIntent` (re-exported, `:53`).
- Line wording (`tool-grouping.ts`): `composeToolGroupLabel(names)` (`:133`) joins verb phrases, "Ran 2 searches and wrote a file"; more than `TOOL_GROUP_DISTINCT_CAP = 4` (`:36`) distinct phrases collapse to "Ran N tools"; an unknown tool reads "ran `name`" (`:96-103`). `composeToolCallsLabel(calls)` (`:170`) joins intents with " · " and, past `TOOL_GROUP_INTENT_CAP = 3` (`:167`), ends "· +N more". `withToolState(label, state, count, total)` (`:222`): "…" while running; "(failed)" or "(waiting)" on one step; "(2 failed)" on a run. A failed step that a later step of the same tool completed reads "Tried …", not failed (`withRedone`, `triedLabel`, `:242-252`). A run is shown open only while running (`toolRunOpen`, `:232`). `TOOL_VERB_MAP` (`:43`) names the tools it knows: search, fetch, read, write, create, edit, delete, bash and the other shell names, grep, glob, `load_tools`, and workforce's project reads and task tools.
- `toolSubject(toolName, args, output?)` (`tool-naming.ts:218`), returns `{ text, code } | undefined`. **Third argument `output` exists** (`p-com:91` documents two): once the call is done, a workforce or task tool says more (a search's match count, a task by its title; `WORK_TOOLS`, `:104-165`). Text is clipped at 80 characters (`SUBJECT_MAX`, `:60`). Rules, in order: a workforce or task tool by its own words (`:104-165`); an MCP tool `mcp__<server>__<tool>` as `Calling MCP tool <Server> <Tool>` (`:226`); shell tools `shell`, `bash`, `command_execution`, `run_command`, `terminal`, any casing (`:12`), first non-blank line of `command` with a leading `cd <dir> &&` removed, `code: true` (`:228-237`); `file_change` as `Edit <path>` plus "and N more" (`:240-246`); any other tool as verb plus the first present of `query, pattern, glob_pattern, globPattern, url, file_path, path, target_file, target_directory, dir` (`:56`), with `query`/`pattern` in quotes, a `url` as is, and a path as at most its last three segments (`:248-252`, `shortPath` `:68-77`). The verb is the tool name title-cased after dropping `web_` and `_file`; `ls` reads "List", `multiedit` reads "Edit" (`:46-52`).
- `toolIntent(toolName, args)` (`:23`): the trimmed `description` arg, `undefined` when none. Read only for the shell tools, `Task`, `Agent` (`:14-21`).
- `toolOutcome(toolName, output)` (`:199`) returns `"ok" | "failed"`: `failed` when the result is `{ ok: false }`, `{ kind: "refused" }`, `{ status: "failed", error }`, or a `readProjectSource` result whose `status` is not `ok` (`:187-205`). A thrown call is the item's status, not this.
- `working-status` (`:63`): `workingStatus({ inFlight, plan, note })` and `toolInFlight(items)` (`:25`); not described on the existing pages. Include one row only if the page covers it; no prose claim needed.

### CodeBlock, Sources, Suggestion, Shimmer, Status, Error, ModelBadge

- `CodeBlock({ code, language, showLineNumbers = false, className, children })` (`R/code-block.tsx:421`). Parts: `CodeBlockContainer`, `CodeBlockHeader`, `CodeBlockTitle`, `CodeBlockFilename`, `CodeBlockActions`, `CodeBlockContent`, `CodeBlockCopyButton`, `CodeBlockLanguageSelector*`, and `highlightCode` (`:175`).
- `Sources`, `SourcesTrigger` (prop `count`), `SourcesContent`, `Source({ href, favicon?, children })` (`R/sources.tsx:21-140`). `Source` opens in a new tab with `rel="noopener noreferrer"`, label is `children`, else the hostname, else the href; a globe icon when no `favicon` (`:103-135`). `SourcesGroup({ items: OutputItem[] })` (`:141`): collects the `source` items into one collapsible panel; renders nothing when none.
- `Suggestions` (scrolling row) and `Suggestion({ suggestion: string, onClick?(suggestion), variant = "outline", size = "sm" })` (`R/suggestion.tsx:15-33`): clicking calls `onClick` with the `suggestion` string.
- `Shimmer({ children: string, as = "p", className, duration = 2, spread = 2 })` (`R/shimmer.tsx:27-35`).
- `Status({ item: StatusItem })` (`R/status.tsx:6`): shimmer text while `item.status === "in_progress"`, muted text otherwise.
- `ErrorDisplay({ item: ErrorItem })` (`R/error.tsx:36`), `ErrorBody({ message, code, details })` (`:15`): message, `Code: <code>`, and an openable "Details" block (`details.output` when a string, else JSON). **The export is `ErrorDisplay`, not `Error`.**
- `ModelBadge({ model: ModelIdentity | undefined, className })` (`R/model-badge.tsx:14`): `model.actual` as the label; the tooltip (a `title` attribute) lists `actual`, `requested` and `gateway`; renders nothing when `model` is `undefined`.

### StreamingIndicator and WorkedFor (`streaming-indicator`, `R/streaming-indicator.tsx`)

- `StreamingIndicator({ message?, isFinishing = false, since? })` (`:69`). Label: `"Tidying up..."` when `isFinishing`; else `message` when non-empty; else `"Working..."` (`:78-83`). `since` is epoch ms; shows a count-up timer beside the label (`:96`).
- Timer format: `42s` under a minute, `1m 24s`, then `1h 3m` with no seconds (`formatElapsed`, `:6-12`); shows nothing for the first second; a `since` in the future is clamped to zero (`RunTimer`, `:25-31`).
- `WorkedFor({ startedAt, endedAt })` (`:38`): "Worked for 3m 24s • 4:28 PM"; renders nothing when under a second.

### Spend, WorkPlace, RunChanges, RunChecks, TaskActions, TaskSignals, HarnessReadiness, StuckRequestBanner (plain-prop components)

- `Spend({ spend, className, split?, harnessLabel?, attempts?, durationMs? })` (`R/spend.tsx:84`). `spend` is `SpendSummary | null | undefined`: `{ harness, model, inputTokens, outputTokens, costUsd?, unreported, live }` (`:20-29`). Line: `harnessLabel · model · tokens · cost · "N attempts" · duration` with empty parts dropped (`spendLine`, `:67`). Tokens read `12.4k tokens` (`tokenCount`: under 1,000 as is, `k` to 1,000,000, then `M`, `:43-48`); both counts null reads "no tokens reported yet"; `split` reads `10.1k in · 2.3k out` with "not reported" for a null side; `unreported` adds "(partial)". Cost shows only when `costUsd` is not null: `$0.0042` under a cent, else `$0.42` (`costAmount`, `:50`). `attempts` shows from 2. Renders nothing when there is no line. The span carries `data-spend="live"` or `"final"` (`:92`).
- `WorkPlace({ place, className })` (`R/work-place.tsx:76`), `place` is `{ branch, commits: number | null, name?, state?, attachedTo?, commands: { switch, cd: string | null, log: string | null } } | null` (`:18-33`). Renders nothing for `null`. Reads "`N commits` on `…/last-two-branch-segments`" (`commitsLabel`, `shortBranch`, `:35-47`); `commits: null` reads "commits unknown"; `state` shows unless `ready`; copy buttons for `git switch`, `cd`, `git log`, the last two only when not `null`. Source of the prop: `workPlace` from `@flow-state-dev/harness-manager/work-place` ([doc] `p-aw:159`; doc comment `R/work-place.tsx:10-16`).
- `RunChanges({ files, fileCount?, added?, removed?, loadPatch?, defaultOpen = false, className })` (`R/run-changes.tsx:141`, props `:31-45`). `files: { path, added: number | null, removed: number | null }[] | null`; `null` draws nothing (`:14-15`). `loadPatch(path) => Promise<{ patch, truncated, verified? }>`; read when a file is opened and kept once read; absent, files list their counts and do not open (`:9-12,42`). A binary file (`null` counts) reads "binary" (`:50-55`). `verified: false` means git could not read it; the file shows that and reads again when reopened (`:24-28`).
- `RunChecks({ checks, defaultOpen, className })` (`R/run-checks.tsx:87`, props `:31-38`). `checks: RunCheck[] | null`, `RunCheck = { command, exitCode: number | null, timedOut, skipped, durationMs, tail }` (`:22-29`). `null` or empty draws nothing (`:12-14`). Header "Checks n/m passed"; opens by itself when any failed (`defaultOpen` default: open when any failed, `:35`). `runCheckPassed(check)` = ran and exit 0 (`:40`). Ending words: "skipped", "timed out", "not run", "passed", "exit N" (`:52-58`).
- `TaskActions({ id, status, actions, steer = false, rerun = [], onSettled })` (`R/task-actions.tsx:66`). `actions` is `{ cancel(id): Promise<string[]>, steer(id, message), release(id), retry(id) }` (`:23-33`), shaped like orchestration's `BoardActions` (doc comment `:12-15`). Buttons by board `status`: open (`pending`, `held`, `in_progress`) draws Cancel, Steer (only with `steer`), Release; ended (`errored`, `cancelled`) draws Retry and one "Re-run on <label>" per `rerun` option; any other status, `completed` included, draws nothing (`:5-9,45-46,86-90`). Cancel asks once inline with `CANCEL_CONFIRM` = "Cancel? Tasks waiting on it go too" (`:47`); outcome "Cancelled." or "Cancelled, with the tasks waiting on it: <ids>." (`cancelOutcome`, `:50-52`). A refusal shows the board's own words (`:73-76`). `rerun` items are `{ label, run(): Promise<unknown> }` (`:35-40`).
- `taskSignal(view, run, now, { stale })`, `TaskTime`, `taskCounts`, `agoText` (`R/task-signals.tsx:49-110`). `TaskTime({ view, run?, now, stale?, tone?, fallback })`. Signal kinds: `working` ("working · 4m 12s", running row, timed from `run.startedAt`), `quiet` ("quiet for 7m", running row whose lease lapsed per `leaseLapsed`, never when `stale`), `ended` ("12m ago": done, failed or cancelled). A queued, held or waiting row has none (`:60-80`). The component runs no timer; the app passes `now` (`:22-23`). `taskCounts(views)` reads "2 running · 1 waiting · 1 failed · 28 done", zero counts dropped (`:82-89`). `TaskSignalView.state` is one of queued, held, running, waiting, failed, done, cancelled (`:26-28`). **Imports `@flow-state-dev/orchestration/tasks` at runtime** (`:4`).
- `HarnessReadiness({ rows, recheck?, className })` (`R/harness-readiness.tsx:47`). `rows: HarnessReadinessChipRow[] | undefined` (`undefined` = first read pending: "Checking the coding harnesses…"), `{ harness, label, ready, reason, remedy, unanswered }` (`:18-25`). Chip marks `✓` ready, `✗` not ready, `?` no answer. A "Re-check" button shows only with `recheck`; a failed re-check keeps the rows and shows the error beside the button (`:9-14`).
- `StuckRequestBanner({ session, className })` (`R/stuck-request-banner.tsx:19`). `session` is `{ isStuck: boolean, dismissRequest(requestId?): Promise<void> }` (`:8-11`), the shape `useSession` returns for those two fields. Renders nothing unless `isStuck`. Text "Connection lost — the previous request stopped responding." and a Dismiss button, disabled and reading "Dismissing…" while the call runs (`:35-58`).

### Connection banner and screen (`connection-banner`, `connection-screen`)

- `ConnectionFeedStatus = "connecting" | "live" | "reconnecting" | "lapsed" | "stopped"` (`R/connection-banner.tsx:19`), the states `sessionFeed` in `@flow-state-dev/client` reports.
- `isFeedStale(state)` is true for `lapsed` and `stopped` only (`:25`). `STALE_CLASS` greys an area and stops its `animate-pulse` and `animate-spin` (`:34`).
- `ConnectionBanner({ feed: { state }, onRetry?, className })` (`:52`): draws only when stale. `lapsed`: "Lost the server <age> ago, retrying…". `stopped`: "The server stopped this feed <age> ago. What you see is the last it sent." plus a Retry button only when `onRetry` is passed. Age is counted from when the feed left `live`, formatted `12s`, `3m`, `1h` (`:40-48,96-109`). Draws nothing on `connecting`, `live` or `reconnecting` (doc comment `:8-11`).
- `ConnectionScreen({ kind: "refused" | "unreachable", title, children?, failure: { httpStatus?, message }, onRetry?, className })` (`R/connection-screen.tsx:35`). `refused`: no retry. `unreachable` with `onRetry`: a Retry button and an automatic retry after 2, 4, 8 … seconds capped at 30 (`retryDelayMs`, `:21-23`); if `onRetry` returns a promise the next wait starts after it settles; a click retries at once and restarts the wait (`:28-33,54-80`). `failure` is drawn `<httpStatus> · <message>` or the message alone (`:91-93`).

### Request recovery (`request-recovery`, `R/request-recovery.tsx`)

- `RequestRecovery` takes one of three prop shapes (`:89`):
  - failed: `reason` (required), `code?`, `details?`, `who?`, `onRetry?`, `className?` (`:46-56`). Retry only with `onRetry`.
  - interrupted: `onContinue` and/or `onDiscard`, optional `reason` (default `INTERRUPTED_REASON` = "This turn was cut off before it finished.", `:35`), `who?`; no Retry drawn (`:58-73`).
  - stopped: `stopped: true`, `stillRunning?: number`, `onView?` (`:75-87`). Reads "Interrupted by you", plus " · N background task(s) still running" and a View button when `stillRunning > 0` and `onView` is passed (`:96-117`).
- Buttons are disabled while any action runs; the busy words are "Retrying…", "Continuing…", "Discarding…"; a rejected action adds "<Retry|Continue|Discard> failed: <message>" (`:139-160`).
- Action types are `() => Promise<unknown>` (`:33`).

## Flow-aware: exports and props

### ChatAssistant (`chat-assistant`, `R/chat-assistant.tsx`)

- `chatAssistantRenderers: RendererRegistry` (`:47-70`):

| Slot of `RendererRegistry` | Value |
| --- | --- |
| `message` | `Message` |
| `reasoning` | `Reasoning` |
| `block_trace` | `false` |
| `tool_output` | `Tool` |
| `status` | `Status` |
| `error` | `ErrorDisplay` |
| `source` | `false` (draw with `<SourcesGroup items={...} />`) |
| `suspension` | `SuspensionCard` |
| `container` | `{ "evented-actors": EventedActors, debate: Debate, routedSpecialists: RoutedSpecialists }` |
| `data` | `{ "audit-annotation": AuditAnnotation, "task-board-meta": TaskBoardMeta }` |

- `TaskBoardMeta` draws `<TaskPlan collectionId={value.collectionId} requestId={item.requestId} />` and nothing when `collectionId` is missing (`:19-26`). `task-change` items need no entry: `TaskPlan` reads them (`:14-17`). Any other `data` item with no entry draws nothing (`:38-40`, `RC/components/ItemRenderer.ts:275`).
- **The `p-aw:28-38` and `p-ov:109` override example is wrong against the code.** It suppresses the board with `component: { ...chatAssistantRenderers.component, "task-board-meta": false }`. The map is `data`: `{ ...chatAssistantRenderers, data: { ...chatAssistantRenderers.data, "task-board-meta": false } }`. The registry slot types are in Table R-1.
- Install name `chat-assistant` also installs the suspension cards, `Debate`, `EventedActors` and `RoutedSpecialists` (`RJ:454`).

### Renderer registry: the `renderers` prop (answers the routed "renderers prop" row)

`RendererRegistry` (`RC/registry/block-renderers.ts:33-66`), passed as `<FlowProvider renderers={...}>`:

| Key | Type | What it draws |
| --- | --- | --- |
| `message`, `reasoning`, `block_trace`, `tool_output`, `status`, `source`, `error`, `suspension` | `BlockComponentType \| false` | an item of that `type`; `false` draws nothing |
| `stopped` | `BlockComponentType \| false` | a "stopped" conversation line; receives `{ line }`. Unset draws a plain "Stopped" |
| `container` | `Record<string, BlockComponentType \| false>` | a `container` item, by its `component` name |
| `data` | `Record<string, BlockComponentType \| false>` | a `data` item, by its `dataType`; with no entry it draws nothing |
| `component` | `Record<string, BlockComponentType \| false>` | the renderer a `suspension` names with `render.component` |

- A renderer receives `{ item }`, and `line` too when drawn as a conversation line (`RC/components/ItemRenderer.ts:279-286`).
- A nested `FlowProvider` merges onto its parent: for each slot the child wins, `false` included; `component`, `container`, `data` merge key by key (`RC/context/FlowContext.ts:66-103`).
- Item types with **no registered renderer** (`ItemRenderer.ts:239-300`): `message`, `reasoning`, `status`, `error`, `tool_output` fall back to plain built-in markup (`:141-157`); `suspension` falls back to the built-in approval, question, selection or form card by shape (`:183-205`, `:281-289`); a `data` item draws **nothing** (`:275`); any other type (a `container` with no entry, a `source`) draws a `<pre>` of JSON with its `type`, its component key when it has one, and `status` (`:295-308`). `state_change`, `resource_change`, `suspension_resume` and `continuation` draw nothing (`:77-82`).
- **There is no `component` item type** (`packages/contracts/src/items/types.ts:507,534` define `data` and `container`). The existing pages and the routed rows that say "`component` items keyed by name" refer to `data` items keyed by `dataType`. See "Routed rows" below.

### ItemsRenderer (`@flow-state-dev/react`, not a registry item; `RC/components/ItemsRenderer.ts`)

- Props (`:20-55`): `lines?: readonly ItemLine[]`; `items?: OutputItem[]`; `deduplicateByKey` (default `true`: only the latest `data` item per `key` within a request); `showSubAgents` (default `false`); `toolGroupRenderer?` (draws a run of tool calls and thinking as one unit; default each item alone); `live?`.
- With `showSubAgents` false, items whose `itemVisibility.history` is `false`, among `message`, `reasoning` and `tool_output`, are left out, and so are `block_trace`, `router_decision` and `state_snapshot` (`RC/components/conversation-lines.ts:108-110,159-175`). Items with `itemVisibility.client` false are never drawn (`:164`).
- A container renderer in `container` claims the `data` and `tool_output` items its block owns, so they are left to it (`:140-155,176-180`).
- A failed request draws through `error`; a stopped one through `stopped`; both receive `line` (`ItemsRenderer.ts:75-100`).

### Approval, Question, Selection, Form, SuspensionCard

- `Approval({ item: SuspensionItem, isResolved?, resolution?, canAnswer = true })` (`R/approval.tsx:33-45`). Pending: the message (Markdown), a "Details" block when `item.data` has fields other than `approveOptions`, Approve and Reject buttons (words "Approving…" / "Rejecting…" while in flight), an extra button for each `data.approveOptions` entry `{ label, data }` which sends that data with the approve (`approveOptionsOf`, `:56-57,110-120`). Resolved: a tinted receipt, green for `approved`, red for `rejected`, neutral otherwise (`:73-99`). With `canAnswer={false}` it says it waits instead of drawing the buttons (`:28-30,135`). It finds its own resolution by matching a `suspension_resume` item with the same `suspensionId` in `SessionItemsProvider` items, unless `isResolved` is passed (`:46-60`).
- `Question({ item, isResolved?, resolution? })`: a three-row text area, placeholder "Type your answer…", submits the string (`R/question.tsx:18-50`). `Selection`: radios for a single `enum`, checkboxes for an array of `enum` (`R/selection.tsx:1-40`). `Form`: one control per property of a **flat** `resumeSchema` (text, number, checkbox, select, multi-select); a richer schema (nested, array of objects, union) is for a custom renderer (`R/form.tsx:11-18`).
- `SuspensionCard({ item })` (`R/suspension-card.tsx:32`) picks the card, in order: a `render.component` registered in `renderers.component` (and not `false`) wins; then a `kind: "review"` stop whose resume schema takes the review verdict (`takesReviewVerdict`) draws `ReviewSuspension`; then by `suspensionShape(item)`: `form`, `selection`, `question`, else `Approval` (`:42-82`).
- The hook beneath these, `useApproval`, is in `@flow-state-dev/react` (`RC/hooks/useApproval.ts:152`); the cards are presentation over it.

### ReviewHold and ReviewSuspension (`review-hold`)

- `ReviewHold({ prompt?, review?, answer?, unanswerable?, resolved?, holdId?, loadPatch?, children })` (`R/review-hold.tsx:202-236`). `answer(answer: ReviewAnswer) => Promise<void>`. `ReviewAnswer` = `{ verdict: "accepted", land?: "pull-request" | "merge", words? } | { verdict: "revise", words }` (`:79-82`). Buttons: Accept and Ask for changes; when `review.lands` is non-empty Accept is replaced by "Open a PR" and/or "Merge locally" (`LAND_LABEL`, `:85`), each an accept naming its `land`. Buttons disable while the answer is in flight; a failure shows under them with the words kept (`:195-200`). `resolved`: `"accepted" | "revise" | "answered"` collapses to a receipt. With `unanswerable` set or no `answer`, it shows the review and that sentence, no buttons.
- `ReviewDetail` (`:43-77`): `branch`, `commits`, `subjects`, `judge: { verdict, confidence, reason } | null`, and optional `lands`, `landFailed`, `landAttempts`, `checks`, `goal`, `answer`, `pullRequests`, `round`, `files`, `fileCount`, `added`, `removed`. Without `review` the card shows `prompt`.
- `ReviewSuspension({ item, review?, isResolved?, resolution?, loadPatch? })` (`:458`) answers through `SuspensionResolverProvider` with `action: "submit"` and the answer as `data`. A stop that ended without an answer (anything other than `submitted`) shows a receipt with the outcome label (`:476-480`).
- The card sends only the two answers above (doc comment `:19-21`).

### TaskPlan (`task-plan`, `R/task-plan.tsx`; state in `R/task-plan-state.ts`)

- Props (`:135-199`): `collectionId` (required); `requestId?` (bind to one run; without it the plan follows the latest request that emitted events for the collection); `items?` (explicit source, else `SessionItemsProvider`); `groupByAssignee?` (sub-groups each section by `task.assignee`, "Unassigned" last; a section with one assignee skips the sub-heading); `statusConfig?: Record<string, StatusConfig>` (merged over the built-in set, for extra statuses); `renderTaskAction?(task) => ReactNode` (a control on the task's line; stop the event reaching the summary); `hiddenStatuses?` (default `["cancelled"]`, `DEFAULT_HIDDEN_STATUSES`, `task-plan-state.ts:164`); `title?` (default "Tasks"; the collection id is in an `sr-only` span only, `task-plan.tsx:314,348,413,424`); `hideEmpty?` (default shows "No tasks yet"); `className?`.
- Reads `data` items of `dataType` `task-change` and `task-board-meta` (`TASK_CHANGE_DATA_TYPE`, `TASK_BOARD_META_DATA_TYPE`, `task-plan-state.ts:139-140`), latest per task. Sections in order: `pending` "Todo", `in_progress` "In progress", `held` "Held", `completed` "Done", `errored` "Failed", `cancelled` "Cancelled"; empty sections are hidden (`STATUS_SECTIONS`, `:151-158`). An unknown status renders with a fallback config (`:41-43`).
- Items a task owns are hidden from the chat stream by `RequestGroupRenderer` so they are not drawn twice (`R/request-group.tsx:185-200`).
- Exports: `TaskPlan`, `TaskPlanProps`, `StatusConfig`, `DEFAULT_HIDDEN_STATUSES`, types `Task`, `TaskEntry`, `TaskStatus` (`R/task-plan.tsx:1000-1001`).
- Install: `fsdev ui add task-plan`; import `@/components/flow-state/task-plan`. Needs `SessionItemsProvider` (or `items`), not a `FlowProvider`.

### RequestGroupRenderer (`request-group`, `R/request-group.tsx`)

- **Export name is `RequestGroupRenderer`** (not `RequestGroup`, which `p-aw:195` uses as the heading; the internal `RequestGroup` is not exported). Props (`:55-90`): `items: OutputItem[]`, `isStreaming: boolean` (both required), `statusMessage?`, `isFinishing = false` (from `useSession().isFinishing`), `showWorkedFor = false`, `latestCompletedAtMs?`, `turns?: readonly LineTurn[]`.
- Groups items by `requestId`; each group is drawn with `ItemsRenderer` and `ToolGroup`, then `SourcesGroup`, then, for the last group while streaming, `StreamingIndicator` with `since` = the group's first item `ts` (`:140-200`). While a step is running the indicator drops its words and keeps "Working..." and the clock (`:155-158,205-215`). When not streaming and `showWorkedFor`, a `WorkedFor` line; end time is `latestCompletedAtMs` for the last group, else the latest item time (`:166-173`).
- `turns` lets `conversationLines` know which turn failed or stopped and which failed one offers Retry; only the last group offers Retry; without `turns` no line offers Retry and no turn draws as stopped (`:78-90`).
- Inside a `Conversation`, the segment holding the user's message is marked so a `feed.sent()` send rises to near the top (`:88-91,176-183`).

### Lines: `conversation-lines`, `workforce-lines`

- `conversationLineRenderers` = `{ error: FailedLine, stopped: StoppedLine, suspension: ApprovalLine }` (`R/conversation-lines.tsx:254-258`), spread after `chatAssistantRenderers` so they win. `CompactSteps({ items, line })` is the compact steps line (`:223`).
- `LineContext` (`:69`) value, all fields optional (`LineContextValue`, `:43-67`): `who`, `nameOf`, `avatarOf`, `openTask`, `openMessage`, `sentStatusOf`, `retry`, `stillRunning`, `onViewRunning`, `canAnswer`, `readFile`. Outside a provider a line draws with no action.
- `workforceLineRenderers` (`R/workforce-lines.tsx:255`) goes in the registry's `data` slot, keyed by the dataTypes `workforce:received`, `workforce:sent`, `workforce:task`, `workforce:result` (constants imported from `@flow-state-dev/workforce/browser`, `:42-52,255-260`); `withBrief(Message)` wraps the message renderer so a task brief folds to one "Task brief" line (`:234`). Wording in the header: "Messaged ada", "Asking ada…", "Asked ada", "Not sent to ada", "Not answered by ada", "Filed a task for ada: …", "ada finished: …" (`:12-30`).

### Container renderers (`chat-assistant` files)

`Debate`, `EventedActors`, `RoutedSpecialists` each take `{ item: ContainerItem }`, read their nested `data` records with `useContainerItems`, and need `SessionItemsProvider`. Register under `container` keys `debate`, `evented-actors`, `routedSpecialists` (`R/chat-assistant.tsx:57-61`; `R/routed-specialists.tsx:25-31`). Do not spend page space on their internals.

### AuditAnnotation (`audit-annotation`, `R/audit-annotation.tsx:90`)

- `AuditAnnotation({ item: DataItem })`. Registered under `data["audit-annotation"]` in `chatAssistantRenderers`. Install alone with `fsdev ui add audit-annotation` (`RJ:370`).
- Draws the surfaced analyzer results with severity (`info`, `warning`, `critical`; border `border-info/40`, `border-warning/40`, `border-destructive/40`), per-analyzer scores and the evidence flagged; renders nothing when `surfacedResults` is empty (`:60-110`).
- The `responseAuditor` pattern emits it: `ctx.emit.data("audit-annotation", ..., { itemVisibility: { client: true, history: false } })` when anything surfaces (`packages/patterns/src/response-auditor/index.ts:126-141,209`). No per-response props; it needs no `FlowProvider` of its own beyond `renderers` carrying the entry.

### Others

- `SessionItemsProvider` is the context provider itself, with `value={OutputItem[]}` (`R/session-items-context.tsx:8`); `useSessionItems()` returns `[]` outside one (`:3,10`).
- `SessionOverlay({ variant: "sheet" | "modal", label, title, status?, meta?, toolbar?, onClose, feed?, children, footer? })` (`R/session-overlay.tsx:52-77`). `sheet` draws inside a `SessionOverlayArea` under a `SessionOverlayProvider`, leaving a side pane usable; `modal` draws over the page and holds Tab inside. Both close with the close button, Esc or a backdrop click, and give focus back (`:1-17`). `footer` past 60% of the height scrolls on its own (`:70`).
- `Artifact` is exported as `ArtifactShell`, `ArtifactHeader`, `ArtifactTitle`, `ArtifactDescription`, `ArtifactActions`, `ArtifactAction` (prop `tooltip?`), `ArtifactContent`, `ArtifactClose` (`R/artifact.tsx:30-170`). **No export named `Artifact`**; `p-aw:219` implies one.
- `FileTree({ selectedPath, onSelect(path), expanded?: Set<string>, defaultExpanded?: Set<string> })`, `FileTreeFolder({ path, name, icon? })`, `FileTreeFile({ path, name, icon? })`, `FileTreeIcon`, `FileTreeName`, `FileTreeActions` (`R/file-tree.tsx:58-280`). Enter or Space on a file selects it (`:215-225`).
- `JSXPreview({ jsx, isStreaming = false, components?, bindings?, onError?, children?, className? })` (`R/jsx-preview.tsx:355-402`); `JSXPreviewContent` (`:451`, "No JSX content to preview." when empty), `JSXPreviewError({ className?, children?(error) })` (`:473`). `isStreaming` auto-closes unclosed tags (`completeJsxTag`, `:42-65`). A parse or guard error goes once to `onError` and the last good render stays (`showResult`, `:374-384`). Safety, all [source]: allowed tags `ALLOWED_TAGS` (`:82-103`: text and layout, lists, tables, `img`, `button`, `input`, `select`, `textarea`, static SVG; **`<form>` is not in the list**); URL attributes (`href`, `src`, `action`, `poster`, ...) keep only `http:`, `https:`, `mailto:`, `tel:` or relative (`:106-114`); `on*` props, `dangerouslySetInnerHTML`, `srcDoc`, `form`, `srcset` dropped (`:128-140`); expression forms limited to an allowlist of node types, with `constructor`, `prototype`, `__proto__` and computed keys refused (`:146-186`); a dotted tag works only for a capitalized member of one of your `components` (`:214-219`); input over `MAX_JSX_LENGTH = 100_000` characters refused (`:186`). `components` you pass render as given; `bindings` are readable by the JSX (`:360-364`).
- `Sandbox({ jsx, isStreaming?, components?, bindings?, ...div props })` (`R/sandbox.tsx:33-60`): Preview and Source tabs over `JSXPreview` and `CodeBlock`.

## Tokens (`tokens`, `RJ:7-108`; `packages/ui/registry/token-defaults.css`)

- `tokens` is a `registry:theme` item (`RJ:7-9`), added with the first component that needs it (`RJ:10`, `p-ov:43`). It writes every token, light and dark, in `@layer base` under `:root` and `.dark`, so a value you declare in your own stylesheet wins (`RJ:10-12`, `p-ov:49`).
- Semantic tokens, 19: `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `destructive-foreground`, `border`, `input`, `ring` (`RJ:14-40`).
- Status tokens, each with a `-foreground` partner: `success`, `warning`, `info`, `attention` (in the same list, `RJ:34-41`) and `destructive` (`RJ:28-29`).

| Token | Used for (page claim, `p-ov:33-39`) | Light default | Dark default | Cite |
| --- | --- | --- | --- | --- |
| `success` | done, approved, a passing result | `hsl(142 76% 36%)` | `hsl(142 69% 58%)` | `RJ` `--success` |
| `warning` | something is off but nobody is asked: a blocked task, a stuck request | `hsl(32 95% 44%)` | `hsl(43 96% 56%)` | `RJ` `--warning` |
| `info` | running, in progress, informational | `hsl(217 91% 60%)` | `hsl(213 94% 68%)` | `RJ` `--info` |
| `attention` | a person must act: a tool call awaiting approval, an interrupted request | `hsl(41 96% 40%)` (foreground `hsl(240 10% 3.9%)`) | `hsl(48 96% 53%)` (foreground `hsl(240 10% 3.9%)`) | `RJ` `--attention` |
| `destructive` | failed, rejected, an error | `hsl(0 84.2% 60.2%)` | `hsl(0 62.8% 58%)` | `RJ` `--destructive` |

- `-foreground` values: `success`, `warning`, `info`, `destructive` light `hsl(0 0% 98%)` (`destructive` too); dark `hsl(240 10% 3.9%)` (`RJ` `.dark` block).
- The "used for" column is [test]-backed for the two that differ: awaiting approval reads `attention`, a denied call reads `warning` (`UT/render/status-tokens.test.tsx:2-30`). `attention` is a **fill** (`bg-attention` with its foreground on top), because it is unreadable as a stroke on a light ground (`UT/render/status-tokens.test.tsx:24-27`). The other four are used as text and icon colours, and as fills in `Approval` (`bg-success`, `bg-destructive`) and `AuditAnnotation` (`bg-info`, `bg-warning`, `bg-destructive`). No board phase takes `attention`; `TaskPlan` draws a held task with `warning`.
- Override: set the variables in `:root` (light) and `.dark` (`--attention`, `--attention-foreground`, `--warning`, etc.) (`p-ov:49-60`). A component copied in against a stylesheet with no tokens renders its status parts with no colour, not an error (`p-ov:62`, [doc]; consistent with `tokens` being the only source).
- `token-defaults.css` is the `@theme` form of the same values, used by Storybook (`token-defaults.css:1`); a test holds it to the item (`UT/token-defaults.test.ts:1-10,23`).
- Do **not** state "green, amber, blue, yellow and red" for the defaults (`p-ov:43`) without checking: `warning` hue 32 reads orange, not amber.

## Generative UI (`G`, `@flow-state-dev/ui/generative/*`)

Surface (`UP:5-14`, `G/renderers.ts`, `G/tools.ts`):

| Import path | Runs | Exports |
| --- | --- | --- |
| `@flow-state-dev/ui/generative/tools` | server | `generativeTools()` and `generativeTools.pick(...names)` returning `BlockDefinition[]`; `InfoCardSchema`, `LinkCardSchema` (+ `InfoCardData`, `LinkCardData` types); `emitInfoCardTool`, `emitLinkCardTool`; `GenerativeTool`, `GenerativeToolOptions` (`G/tools.ts:37-60`) |
| `@flow-state-dev/ui/generative/renderers` | browser | `generativeRenderers()` and `generativeRenderers.pick(...names)` returning `Record<string, ComponentType<{ item: DataItem }>>`; `InfoCardRenderer`, `LinkCardRenderer`; `GenerativeRenderer` (`G/renderers.ts:44-62`) |

- **Slot:** the renderer map goes in `FlowProvider`'s **`data`** slot: `renderers={{ data: generativeRenderers() }}` (`G/renderers.ts:10-12,32`). **`p-gen:180,197,247` and `p-ov` write `component:`; that does not match `RendererRegistry` (`RC/registry/block-renderers.ts:57-65`).** The tool emits a data item, `ctx.emit.data("info-card", input, { key })` (`G/info-card/tool.ts:30`), and a `data` item draws through `renderers.data[dataType]`.
- Renderer key = tool component name = `dataType`: `info-card`, `link-card` (`G/renderers.ts:23-26`, `G/tools.ts:23-26`).
- `.pick(...names)`: returns the same shape scoped to the names; **unknown names are silently ignored** (`G/renderers.ts:40-43`, `G/tools.ts:34-36`). Names are the component names (`"info-card"`), not the tool names.
- Both `.pick` and the zero-argument call build their result when called.
- **Observable guarantee:** the renderer entry value-imports neither `@flow-state-dev/core` nor `zod`. A test walks the renderer entry's runtime import graph and fails on either (`UT/generative/renderer-surface.test.ts:1-15,75-76`). Say that as one row; do not explain how the types erase.
- Each tool is a `handler` block. Starter pack:

| Tool (block name) | Component | Use for |
| --- | --- | --- |
| `emitInfoCard` | `info-card` | profile snapshots, place summaries, contact-style info, quick reference cards |
| `emitLinkCard` | `link-card` | citations, further-reading suggestions, source attributions, replacing bare URLs |

  (`G/info-card/tool.ts:14-19`, `G/link-card/tool.ts:14-19`). Each returns to the model `{ rendered: true, kind, id }` for info-card, `{ rendered: true, kind, url }` for link-card (`:31`).
- Tool description template (code): a one-line summary; `USE FOR:` followed by four examples (both shipped tools); `DO NOT USE FOR:` followed by four cases for `emitInfoCard` and three for `emitLinkCard`, each redirecting to a neighbouring tool (`G/info-card/tool.ts:14-19`, `G/link-card/tool.ts:14-19`). **The redirects name `emitDualColumn` and `emitMetricGrid`, which the pack does not ship** (only two shapes exist, `G/tools.ts:23-26`); state only that the template has the three parts, and drop the `<2–4>`/`<2–3>` counts of `p-gen:213-217`.
- `GenerativeToolOptions.keyFrom?(input) => string`: the key that dedupes and replaces a card; default `id` for info-card, `url` for link-card (`G/tool-types.ts:18-23`, `G/info-card/tool.ts:25`, `G/link-card/tool.ts:25`). Clients show only the latest item per `key` (`RC/components/conversation-lines.ts:112-130`).
- `info-card` fields (`G/info-card/schema.ts:7-34`): `id` (string, min 1), `title` (min 1), `subtitle?`, `imageUrl?` (URL), `facts` (array of `{ label, value }`, each min 1, **max 8**), `footer?`.
- `link-card` fields (`G/link-card/schema.ts:7-27`): `url` (URL), `title` (min 1), `description?`, `siteName?`, `imageUrl?` (URL), `favicon?` (URL).
- The Zod `.describe()` strings are part of the tool's model-facing `inputSchema` (`G/info-card/tool.ts:25-27`, schema `:8-34`): e.g. `id` is described as "Stable id for this card. Use a slug or short content hash so re-emissions replace prior versions in place."
- Runtime renderers vs registry renderers: both are plain Tailwind class names with no shadcn primitive (`G/info-card/renderer.tsx:1-6`, `R/generative/info-card.tsx:1-10`; `RJ:627` lists only `core` as dependency). `fsdev ui add info-card` or `link-card` copies a renderer to `components/flow-state/generative/<name>.tsx`, exporting `InfoCardRenderer` / `LinkCardRenderer`; to use it, override the entry: `data: { ...generativeRenderers(), "info-card": InfoCardRenderer }` (corrected from `component:` in `p-gen:245-252`). The registry copy types its data locally, so it does not import the tools surface (`R/generative/info-card.tsx:13-20`).

## Workforce panels (routed to R-36; not registry items)

These are real components but ship from `@flow-state-dev/workforce/react` and `@flow-state-dev/react`, not the registry. The page should keep them in a third table or hand them to the workforce screens page; flagged in "Open flags".

- **Import path:** `Roster`, `BoardColumns`, `BoardList`, `WorkerDetail`, `groupIntoColumns`, `BOARD_STATUS_COLUMNS` come from `@flow-state-dev/workforce/react` (`packages/workforce/src/react/index.ts:11-40`, export map `packages/workforce/package.json:37`). `FlowNavigator` comes from `@flow-state-dev/react` (`RC/index.ts:147`). **`p-wf:16` imports `Roster`, `BoardColumns`, `BoardList` from `@flow-state-dev/react`; `RC/index.ts` does not export them** (searched `packages/react/src`).
- `Roster` (`W/Roster.ts:179`): `sessionId` (required); `collectionRef = "roster"` (`DEFAULT_ROSTER_REF`, `:140`); `problems?: readonly string[]`; `limit?`; `slots?: { rowTrailing?(row), empty?() }`; `client?` and `live?` (a client that can only read takes no `live`, enforced by the prop type, `:116-122`). One row per worker: `workerId`, then `flow` (`:210-225`). Empty text "No workers have been hired in this organization yet." Problems block "N worker(s) could not be loaded" (`:230-250`). No organization filter prop; the organization is the session's (`:1-14`). **Shows no waiting state at all.**
- `BoardColumns` (`W/BoardColumns.ts:188`): `sessionId`, `boardRef` (required; one path segment), `limit?`, `slots?: { card?(row: BoardCardRow), columnHeader?(column), empty?() }`, `client?`, `live?`. `BoardCardRow = { topic, card: { id, status, title?, goal?, assignee?, error? } }` (`W/cards.ts:15-40`). Columns, in order: `pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled` (`BOARD_STATUS_COLUMNS`, `:48`), then one extra column per status it does not know (`groupIntoColumns`, `:145-165`, exported). Card body default: `title`, else `goal`, else `id`; plus `assignee` when present (`:172-186`). **No hold or "waiting on you" mark on a card.** The component renders the `<li data-task-id>`; `slots.card` returns what goes inside it (`:77-87,290-296`). Empty column text "Nothing here". Empty board: "This board has no rows. Boards are wired to a worker explicitly, so the likely reason is that nothing drains this one yet." (`:230`); loading "Loading this board…"; a failed read shows the error with Retry.
- `BoardList` (`W/BoardList.ts:124`): same `sessionId`, `boardRef`, `limit?`, `client?`, `live?`; `slots?: { row?(row: BoardCardRow), empty?() }` (`:36-45`). Newest first by `createdAt`; a row without one follows the dated rows in read order (`:99-115`). Each row: title (else goal, else id), the status word as written, the assignee (`:119-123`). No row is hidden whatever its status.
- `limit` on all three: rows per page; the read follows the cursor for up to 1,000 pages, and a collection with more shows the error line and Retry, not the rows read so far (`W/BoardColumns.ts:58-66`, `COLLECTION_READ_MAX_PAGES = 1000`, `packages/client/src/resource-client/read-every-page.ts:16`). **Neither `limit` nor `collectionRef` is on `p-wf`.**
- `live`: reads again when another session changes the collection or board (`W/BoardColumns.ts:68-75`). The "within about a second" and "every 3 seconds" figures of `p-wf:128,151` are not in the component source; drop the numbers.
- `WorkerDetail` (`W/WorkerDetail.ts:113`): `sessionId`, `kind`, `workerId?`, `collectionRef?`, `client?`. With no `workerId` it shows "not published" and makes no read. Five states, by `data-state`: instructions, none given, not published, reading, could not be read (`:1-50`).
- Theming: no CSS framework or icons; set `--fsd-panel-fg`, `--fsd-panel-font-size`, `--fsd-panel-muted-fg`, `--fsd-panel-note-font-size`, `--fsd-panel-heading-font-size` (`W/chrome.ts:6-33`; grep of `W/*.ts`). The navigator reads `--fsd-nav-*`: `attention`, `bg`, `fg`, `font-size`, `guide`, `muted-fg`, `note-font-size`, `section-font-size`, `selected-bg`, `selected-fg` (grep of `RC/components/flow-navigator`). The `--fsd-panel-*` and `--fsd-nav-*` sets are separate variable families.
- Read-only: there is no create-worker, invite or edit control in `Roster` or `WorkerDetail`, only the `rowTrailing`/`empty` slots (`W/Roster.ts:79-84`).
- **Where a waiting worker shows.** The navigator's session row: a session whose latest request is `suspended` reads "Waiting on you" with `◆`, or, when the request is waiting on other work (`requestWaitsForUser === false`), "Waiting" with `◇` (`RC/components/flow-navigator/session-row.ts:36-60`). `Roster` and the default `BoardColumns`/`BoardList` bodies show nothing about it (above).

## Corrections to the existing pages (the code wins)

1. `p-com:7`, `p-ov:70`, `UR:25`: "no runtime dependency on `@flow-state-dev/*`" is false for `conversation`, `session-overlay`, `prompt-input`. See Table I-1.
2. `p-com:18-26`: `ScrollOnNewRequest` does not exist. Use `Conversation`'s `feed`.
3. `p-com:36-39`: `Message` takes `item: MessageItem`.
4. `p-com:72-89`: `toolSubject` takes a third `output` argument.
5. `p-aw:11,28-38`, `p-ov:96-109`: the override example uses `component`; the map is `data`.
6. `p-aw:195`: the exported component is `RequestGroupRenderer`.
7. `p-aw:217-251`, `p-ov:80`: `artifact`, `file-tree`, `jsx-preview`, `sandbox` import no `@flow-state-dev` package.
8. `p-gen:180,197,247`: `renderers={{ component: ... }}` should be `data`.
9. `p-gen:153`: a "Migration" note about the earlier import; outsider rule, do not carry.
10. `p-wf:16`: `Roster`, `BoardColumns`, `BoardList` import from `@flow-state-dev/workforce/react`.
11. `p-gen:141`: "A guard test enforces..." is mechanism; state the guarantee only.
12. `p-aw:3-4` sidebar position text and `p-ov:117` Storybook pointer are not facts for this page.

## Routed rows: carried, corrected, dropped

Each row from the other pages' records, checked against the code.

| Routed row (short) | Verdict | Where in this sheet / why |
| --- | --- | --- |
| AuditAnnotation: shipped in `chatAssistantRenderers`, standalone install, registration key | Carried | `data["audit-annotation"]`; "AuditAnnotation" section |
| Generative entrypoints, two import paths | Carried, corrected | Slot is `data`; private-package flag. "Generative UI" |
| Renderer surface imports no authoring runtime or Zod | Carried as one row; type-erasure explanation and guard-test narrative dropped | outsider rule; `UT/generative/renderer-surface.test.ts` |
| `.pick(...)`, unknown names ignored | Carried | `G/renderers.ts:40-43` |
| Starter pack table | Carried | |
| Tool description template (corrected by pass 5) | Carried, corrected again | counts per tool differ (4/4, 4/3), redirects name unshipped tools |
| `info-card` schema, `link-card` schema | Carried | |
| Runtime vs registry-installed renderers | Carried, corrected | both plain Tailwind; override key is `data` |
| `.describe()` text reaches the tool schema | Carried | |
| Status tokens table; `-foreground` partners; override rule | Carried | "Tokens" |
| Generative surface (corrected by pass 5) | Carried, merged with the entry above | |
| `chatAssistantRenderers` map (corrected by pass 5) | Carried, corrected a third way | no `component` slot entries; `data` and `container`; `block_trace` and `source` are `false`; no "internal component types set to false" in the code |
| `BoardColumns`/`BoardList` props, scope, card contents, empty state | Carried | Workforce panels. Adds `limit`, `collectionRef`; import path corrected |
| Where a waiting worker shows | Carried in part. **Dropped: "task list (via `holds`)"** | `listTasks`/`holds` is an agent-tool read (`packages/orchestration/src/skills/task-listing.ts:15`), not a UI component |
| Styling tokens `--fsd-panel-*`; read-only scope | Carried | five variables, found by grep |
| `groupIntoColumns`, `slots.card` (corrected by pass 5) | Carried | `slots.card(row)` gets a `BoardCardRow`; the component keeps the `<li>` |
| ItemsRenderer (corrected by pass 5) | Carried, corrected: **there is no `component` item type** | `data` with no renderer draws nothing, not JSON; an unregistered `container` or `source` draws the JSON `<pre>` with `type`, component key, `status` |
| `renderers` prop map shape | Carried, corrected | table R-1; `component` key is for `render.component` of suspensions |
| Token rows, which components pull `tokens` | Carried | Tokens and Table I-1 |
| `task-plan` items, latest per key | Carried | |
| Connection states table, banner, screen | Carried | |
| `TaskPlan` install, import, items read, `FlowProvider` | Carried, corrected | needs `SessionItemsProvider`, not `FlowProvider` |
| "(about a second / 3 seconds)" live timings in `p-wf` | Dropped | not in component source |

## Stored data (the four questions)

The page's components store nothing themselves. State a component holds is in React memory only: a `PromptInput` draft's files (`useAttachments`, `R/attachments.tsx:236`), an expanded task (`R/task-plan.tsx`), the `Conversation`'s scroll feed. `PromptInput` uploads attachments through the `client` it is given; where the server stores the file is that server's, not this page's. `Roster`, `BoardColumns` and `BoardList` read collections kept by the session's flow: owner and visibility are the flow's (the roster and board are organization-scoped at the store, `W/Roster.ts:1-14`), one panel per read; they write nothing. No part of the page needs the four-question answer beyond this.

## Open flags for later passes

1. **Private package.** `UP:4` is `"private": true`; the generative paths are workspace-only as written. Confirm with the owner before the page tells a reader to import them.
2. **Scope of the third table.** The workforce panels (`Roster`, `BoardColumns`, `BoardList`, `WorkerDetail`, `FlowNavigator`) are not registry components. Rows were routed here, so they are carried, but the sitemap's two groups ("common", "flow-aware") do not fit them. Either a third group, or the catalog workforce screens page keeps them.
3. **Grouping.** The code splits components by dependency, not by the existing common/flow-aware pages. The sheet proposes: *plain props, no `@flow-state-dev` runtime* versus *needs `react`, `orchestration` or `workforce`* (Table I-1) versus *takes an item type as props* (types only). Pick one before pass 3.
4. **`working-status`, `tool-summaries`, `Debate`/`EventedActors`/`RoutedSpecialists`, `ConversationDownload`, the `PromptInput*` compound parts** are real exports with no existing prose. A reference page needs only rows for them; the sheet lists names, not behaviour.
5. **Table size.** The page's own rule ("no table has more than six rows") conflicts with a 40-item registry. Split by component family.
6. The three notes on `Reasoning`'s auto-open, `Approval`'s warn-once, and the `tokens` warning-versus-attention fill rule are [source]-only facts. Keep only if the page has room.

## Dropped or left out of the draft (pass 3)

- `syncHiddenInput`, `working-status` rows, `tool-summaries`, `LineContext` beyond its field list: no behaviour to state; omitted.
- `p-gen:153` migration note, "about a second / 3 seconds" timings, "task list via `holds`", the type-erasure and guard-test narrative: dropped (outsider rule, not in source).
- Open flag 1 (`@flow-state-dev/ui` is `private: true`): the page states the two import paths as the package exports them; owner to confirm.
- `Reasoning` auto-open and the status-token "green, amber" colour names: not stated.
- Tool description counts (4/4, 4/3) and the redirects to unshipped tools: the page says only that the description has the three parts.

## Revise round 1 corrections and moves

Corrections, each read from source:

- `OutputItem` is imported from `@flow-state-dev/core/items`, as `R/session-items-context.tsx:4` does. The package root does not export it.
- `TaskActions`: only `held` draws Release. Cancel, and Steer with `steer`, draw for `pending`, `held` and `in_progress` (`R/task-actions.tsx:119,158`). This replaces the earlier "open draws Cancel, Steer, Release".
- `ReviewHold`: with `review.lands` non-empty, Accept is replaced by one button per land, labelled `Accept: Open a PR` or `Accept: Merge locally`. After a failed landing the retried way reads `Retry: <label>` and is listed first (`R/review-hold.tsx:85,386-400`).
- `RequestGroupRenderer` `turns`: with `turns`, only the last group offers Retry on a failed turn, and a stopped request draws its stopped line once, after its last group; without `turns`, no line offers Retry and no turn draws as stopped (`R/request-group.tsx:79-84`).
- `TaskTime`: `quiet` is a running row whose `run.leaseUntil` has passed (`leaseLapsed`), counted from the row's last update (`updatedAt`); `stale: true` switches it off (`R/task-signals.tsx:60-75`).
- `toolOutcome` reads only the result: `failed` for the four shapes listed, else `ok`. A call that threw is the item's `status` (`R/tool-naming.ts:187-205`).
- `renderTaskAction`: a click on the control also toggles the task open or closed unless the handler stops propagation (`R/task-plan.tsx:173-176,618`).
- `PromptInput` with no uploader: the refusal names the file (`R/attachments.tsx:44-47,80-83`).

Moved to other Reference pages (the page keeps a one-line link; the facts above stay true here and feed these rows):

- To R-14 (`./client.md`): what a renderer receives (`{ item }`, `line` as a conversation line) and how a nested `FlowProvider` merges `renderers` (`RC/components/ItemRenderer.ts:279-286`, `RC/context/FlowContext.ts:66-103`).
- To R-06 (`./items.md`): what `ItemsRenderer` draws and skips (client visibility, container ownership of `data` and `tool_output`, failed and stopped requests, the fallback per type with no renderer, items that draw nothing) (`RC/components/ItemsRenderer.ts`, `ItemRenderer.ts:239-308`).
- To R-27 (`./harness-runs.md`): `ReviewAnswer` and `ReviewDetail` (`R/review-hold.tsx:43-82`).
- To R-42 (`./tools.md`): generative tool description layout and `GenerativeToolOptions.keyFrom` defaults (`id` for `info-card`, `url` for `link-card`), latest item per key shown.
- To R-25 (`./workforce.md`): read-only panels, no CSS framework, `groupIntoColumns` and `BOARD_STATUS_COLUMNS`; `BoardCardRow` and `slots.card`; paging (`limit`, 1,000-page cap, error plus Retry); `live` and read-only `client`; empty and failed-read states.

Declined: depth findings that moved a paragraph "to R-36". This page is R-36, the Reference page the standard sends mechanism to, so the paragraphs stay (install, provider fallbacks, `toolSubject` order, `PromptInput` keys and limits, feed states, `JSXPreview` guard, `chatAssistantRenderers`, `TaskPlan`, container renderers, tokens, generative renderers entry, panel CSS variables, `FlowNavigator`).

## Revise round 3 additions

- Runtime imports, read from value imports in `R` (`import type` excluded): `@flow-state-dev/react` in `conversation.tsx:9`, `session-overlay.tsx:19`, `prompt-input.tsx:63`, `approval.tsx:8`, `review-hold.tsx:6`, `request-group.tsx:19`, and the `chat-assistant` files (`question.tsx:5`, `form.tsx:5`, `selection.tsx:5`, `suspension-card.tsx:5`, `debate.tsx:10`, `evented-actors.tsx:9`, `routed-specialists.tsx:4`). `@flow-state-dev/core` values: `isSuspensionWait` in `tool.tsx:23` and `conversation-lines.tsx:34`; `attributeItemsToTasks`, `collectAttributedItemIds` in `task-plan-state.ts:26-29` (so `task-plan`, `request-group`, `chat-assistant`); `core/attachments` values in `attachments.tsx:30-34` (so `message`, `prompt-input`). `@flow-state-dev/orchestration/tasks` in `task-signals.tsx:4`. `@flow-state-dev/workforce/browser` values in `workforce-lines.tsx:41-52`. Every other item imports types only or nothing.
- `fsdev ui add tool` writes `tool.tsx`, `tool-grouping.ts` and installs `tool-naming`, `tokens`, `code-block` (`RJ:179-199`, `CLI:60-80`).
- Provider summary: `FlowProvider` is read by `Approval`/`Question`/`Form`/`Selection` (`flowKind`) and `SuspensionCard`/`RequestGroupRenderer` (`renderers`); `SessionItemsProvider` by `TaskPlan`, `Debate`, `EventedActors`, `RoutedSpecialists`. Context default `{}`, nothing throws (`RC/context/FlowContext.ts:64,108`).
- Hiding the board: `data: { ...chatAssistantRenderers.data, "task-board-meta": false }`. Nested `FlowProvider` merge rule stated on the page now (`RC/context/FlowContext.ts:66-103`); the client page keeps what a renderer receives.
