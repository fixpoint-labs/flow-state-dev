# @flow-state-dev/codex

## 0.3.0

### Minor Changes

- 4b4a7d4: A turn's images reach Claude Code, Codex and Cursor (FIX-2519).

  - **core:** `HarnessRunInput` takes `attachments`, the turn's files as stored references (`FileContent` whose `data` is `fsd-blob:<id>`); `harnessRunInputSchema` refuses bytes in their place. A harness block declares the types it takes on `accepts`. From `@flow-state-dev/core/harness`: `readHarnessAttachments(ctx, files)` reads the bytes through the engine for the conversation the request runs in, `refuseUnacceptedAttachments(harness, accepts, files)` refuses a type a harness can't take, and the two named errors, `HarnessAttachmentRefusedError` and `HarnessAttachmentUnavailableError`.
  - **engine:** a block's context can read the request's files for a harness, for its own conversation and person only. A server with no blob store reads none, and the harness refuses the turn.
  - **claude-code:** a turn with images sends one user message on the SDK's streaming input: the prompt's text, then each image as a base64 image block. Takes PNG, JPEG, WebP and GIF.
  - **codex:** a turn with images writes them to a folder of the turn's own under this user's private temp folder (`<tmpdir>/fsd-codex-<uid>/turn-…`), never the checkout, and hands Codex their paths as `local_image`. The folder is removed when the turn ends, however it ends. A host whose sandbox limits what Codex reads must allow that folder. Takes PNG, JPEG, WebP and GIF. Now depends on `@flow-state-dev/workspace`.
  - **cursor:** a turn with images sends them as base64 with the prompt on `agent.send`. Takes PNG, JPEG, WebP and GIF. Now depends on `@flow-state-dev/workspace`.
  - **every harness:** a file of a type the harness doesn't take refuses the turn before it starts, naming the file and the harness. A file that can't be read refuses it too. A turn never runs without a file the person sent.
  - **harness-manager:** `harnessSessionFlow`'s `turn` hands the harness the request's files. A harness that declares no `accepts` is never handed one: the turn fails on its record, naming the file.
  - **react:** `useHarnessLines().send(prompt, { attachments })` sends a line with files. A line with files never steers: while a turn runs it waits as the next turn, files and all.

  Docs: the harness table in the attachments guide (what each harness takes, how a file reaches it, what it refuses); a line in packages/claude-code/README.md, packages/codex/README.md and packages/cursor/README.md on images; packages/react/README.md (`attachments` on `useHarnessLines().send`); packages/core/README.md (`attachments` on `HarnessRunInput`, `accepts`).

- 5b2bd16: Documents: PDFs, text, Markdown, CSV and code files reach every model and harness (FIX-2520).

  - **contracts / core:** the attachment list takes text-like files (`ATTACHMENT_TEXT_TYPES`: text, Markdown, CSV, JSON, YAML, HTML, XML; source files as `text/plain`) beside images and PDFs. Each counts as a document against the five per message. `attachmentMediaType({ name, type })` types a picked file by its extension for text-like files (a browser types `.ts` as video); `ATTACHMENT_ACCEPT` is the `<input accept>` list for everything the list takes. `attachmentSentAs(mediaType, accepts)` says how a file reaches a target: a text-like file always as text headed `### <filename>` (`formatAttachmentText`), a PDF as a file where the target's `accepts` lists it and as its text elsewhere, an image only as a file. `AttachmentTextTooLargeError` (`code: "pdf_text_too_large"`) names a PDF whose text is over 200 KB.
  - **core:** a generator's model calls send a PDF as a file where the model's provider reads PDFs (Anthropic, OpenAI, Google) and as its extracted text for any other provider; `ModelResolver.prepareMessages` takes an optional `{ accepts }` target. The provider is read from `providerOf`, so a resolver that maps its own model aliases should map `providerOf` too. From `@flow-state-dev/core/harness`: `readHarnessTurnFiles(harness, ctx, accepts, files)` refuses, reads and splits a turn's files into those the harness reads and the text of the rest, and `promptWithTurnText(prompt, turn)` puts that text after the prompt. `HarnessAttachmentBytes` gains `text()`. `refuseUnacceptedAttachments` now passes a PDF or text-like file to a harness that declares `accepts`, since it can take the document's text.
  - **engine:** the upload route checks a document before storing it: a text-like file must be UTF-8 with no NUL bytes and at most 200 KB, refused over it with its size, never cut (413 `attachment_text_too_large`, 415 `attachment_not_text`); a PDF must open and have at most 100 pages (413 `pdf_too_many_pages`, 415 `pdf_unreadable`). A PDF's text is extracted once at upload, page by page, a page with no text layer saying so, and kept in the blob store beside the PDF, claimed and deleted with it. A turn whose target gets a PDF's text fails before the target is called when that text is over 200 KB. New dependency: `unpdf`.
  - **claude-code:** reads PDFs as document blocks; a text-like file goes as text after the prompt.
  - **codex / cursor:** a PDF and a text-like file go as their text after the prompt. A scanned page has no text to hand over, and says so.
  - **ui:** the composer takes every type the list takes by default, types text-like files by name, and refuses a text file over 200 KB, and a PDF the server counts over 100 pages, by name.

  Docs: the documents table in the attachments guide (each type by target: a generator by provider, Claude Code, Codex, Cursor; that a scanned page has no text for Codex, Cursor and a provider that can't read PDFs; text files whole up to 200 KB, refused over it; PDFs to 100 pages; Word, Excel and PowerPoint refused); the limits line for PDFs and text files in packages/contracts/README.md; `readHarnessTurnFiles` and `promptWithTurnText` in packages/core/README.md; a line in packages/claude-code/README.md, packages/codex/README.md and packages/cursor/README.md on documents; the composer's default `accept` in the ui registry docs.

- c7c2a14: `@flow-state-dev/claude-code` has one entry, the package root, and every name on it says `ClaudeCode`, the way Codex's say `Codex` and Cursor's say `Cursor`. The three harnesses keep their translation and emitter internals off their public entries (FIX-2458).

  - **claude-code:** import from `@flow-state-dev/claude-code`. The `./sdk` and `./cli` entries are gone. `./cli` (`defaultResolveClaudeCli`, `defaultClaudeCliExec` and their types) is removed outright.
  - **claude-code renames, with no alias:**
    - `SDK_SESSION_ID_KEY` → `CLAUDE_CODE_SESSION_ID_KEY` and `SDK_AGENT_RUNS_KEY` → `CLAUDE_CODE_AGENT_RUNS_KEY`. The stored key values are unchanged.
    - `claudeAgentSessionStateSchema` → `claudeCodeSessionStateSchema`.
    - `SandboxSettings` → `ClaudeCodeSandboxSettings`.
    - `defaultResolveClaudeAgent` → `defaultResolveClaudeCodeAgent`, `createDefaultResolveClaudeAgent` → `createDefaultResolveClaudeCodeAgent`, and `SdkImporter` → `ClaudeCodeSdkImporter`.
    - `CLAUDE_SIGN_IN_REMEDY` → `CLAUDE_CODE_SIGN_IN_REMEDY`, `probeClaudeAccount` → `probeClaudeCodeAccount`, `ClaudeAccountProbe` → `ClaudeCodeAccountProbe`, and `ProbeClaudeAccountOptions` → `ProbeClaudeCodeAccountOptions`.
    - `createClaudeAgentSessionProvider` → `createClaudeCodeSessionProvider` and `ClaudeAgentSession` → `ClaudeCodeSession`.
    - `CLAUDE_SDK_SOURCE` → `CLAUDE_CODE_SOURCE`. Its value, `claude-code/sdk`, is unchanged.
    - Handle and wire types: `sdkAgentHandleSchema` → `claudeCodeAgentHandleSchema`, `SdkAgentHandle` → `ClaudeCodeAgentHandle`, `SdkResultSubtype` → `ClaudeCodeResultSubtype`, and `SdkMessageLike` → `ClaudeCodeSdkMessage`.
    - Resolver and query types: `ResolveClaudeAgent` / `ResolvedClaudeAgent` → `ResolveClaudeCodeAgent` / `ResolvedClaudeCodeAgent`, `ClaudeAgentQuery` / `ClaudeAgentQueryOptions` → `ClaudeCodeQuery` / `ClaudeCodeQueryOptions`, `ClaudeAgentSettingSource` → `ClaudeCodeSettingSource`, and `ClaudeAgentSystemPrompt` → `ClaudeCodeSystemPrompt`.
    - Approval types: `ToolApprovalRequest` / `ToolApprovalDecision` → `ClaudeCodeToolApprovalRequest` / `ClaudeCodeToolApprovalDecision`.
    - Work record: `OBSERVED_FILE_OPS` → `CLAUDE_CODE_FILE_OPS` and `OBSERVED_GAPS` → `CLAUDE_CODE_GAPS`. Their storage keys are unchanged.
    - Work record, continued: `observedFileOpsCollection`, `observedGapsCollection`, `observedFileOpStateSchema`, `workRecorderResources` and `ObservedFileOpKind` → `claudeCodeFileOpsCollection`, `claudeCodeGapsCollection`, `claudeCodeFileOpStateSchema`, `claudeCodeWorkRecorderResources` and `ClaudeCodeFileOpKind`.
    - Errors: `ClaudeAgentSdkNotInstalledError` → `ClaudeCodeSdkNotInstalledError` and `ClaudeAgentRunError` → `ClaudeCodeAgentRunError`. Their `code` values are unchanged.
    - Usage: `readClaudeUsage` / `ReadClaudeUsageOptions` → `readClaudeCodeUsage` / `ReadClaudeCodeUsageOptions`.
    - Workspace capability and options: `createWorkspaceAgentCapability` → `createClaudeCodeWorkspaceCapability`, `containmentSandbox` → `claudeCodeContainmentSandbox`, and `WorkspaceAgentCapabilityOptions` / `WorkspaceCollectionSpec` → `ClaudeCodeWorkspaceCapabilityOptions` / `ClaudeCodeWorkspaceCollectionSpec`.
    - Workspace outcomes: `WORKSPACE_OUTCOMES` → `CLAUDE_CODE_WORKSPACE_OUTCOMES`, with its storage key unchanged. `workspaceOutcomesCollection`, `workspaceOutcomeStateSchema` and `workspaceResources` → `claudeCodeWorkspaceOutcomesCollection`, `claudeCodeWorkspaceOutcomeStateSchema` and `claudeCodeWorkspaceResources`.
  - **claude-code: newly on the entry.** Every type a public option names is now exported too: `ClaudeCodeCanUseTool` and `ClaudeCodeSdkToolDecision` (`ClaudeCodeQueryOptions.canUseTool`) and `ClaudeCodeSpawnOptions` (`ClaudeCodeQueryOptions.spawnClaudeCodeProcess`). An option callback's context is core's `HarnessCallbackContext`, from `@flow-state-dev/core/harness`.
  - **cursor:** `CursorAgentOptions.model` spells out its type, `string | CursorModelSelection` or a resolver of one, instead of naming a type the entry didn't export.
  - **claude-code: removed from the entry, with no alias:**
    - The plan record names, which were re-exported from core: `OBSERVED_PLAN`, `OBSERVED_PLAN_LIST`, `observedPlanCollection`, `observedPlanListCollection`, `observedPlanItemStateSchema` and `ObservedOutcome`. Import them from `@flow-state-dev/core/harness`.
    - `runNamespace`, which was core's `harnessRunNamespace` under a second name.
    - The translation layer and the item emitter: `createTranslateState`, `drainUnsettledObservations`, `translateSdkMessage`, `TranslateState`, `createEmitState`, `emitTranslatedEvent`, `closeStreamingItems`, `finalizeOpenItems`, `EmitState` and `TranslatedEvent`.
    - The work recorder, `createWorkRecorder`, `WorkRecorder` and `WorkRecorderOptions`. It reads the translation layer's events, so no host could feed it. The block records its own work with `recordWork`, and the two collections it writes stay on the entry.
    - Internal helpers: `canonicalFilePathKey`, `UpsertableCollection` and `usageWindowOf`.
  - **codex, cursor:** the translation layer and the item emitter leave the public entry, with no alias: `translateCodexEvent`, `translateCursorMessage`, and both packages' `createEmitState`, `emitTranslatedEvent`, `finalizeOpenItems` and `EmitState`. No app imports them. A host reads a run through its block's items and handle.

  Docs: packages/claude-code/README.md (one entry, `@flow-state-dev/claude-code`; every renamed name; the `/cli` paragraph goes; the plan record is imported from `@flow-state-dev/core/harness`), packages/codex/README.md and packages/cursor/README.md (no translation or emitter names on the entry), apps/docs/docs/tools/claude-code-sdk.md (the entry and the renamed names), apps/docs/docs/orchestration/harness-manager.md (`readClaudeCodeUsage`), apps/docs/docs/workforce/projects.md (the renamed Claude Code names it shows), apps/docs/docs/api/package-roots.md (rows for claude-code, codex and cursor: each root runs one vendor's coding agent as a block, through one public entry, and shared shapes come from `@flow-state-dev/core/harness`), packages/shift-manager/README.md (the claude-code import path)

- a06ad2d: The three coding harnesses list their models in one shape, and build their environment from one base (FIX-2458).

  - **core:** `@flow-state-dev/core/harness` exports `HarnessModelInfo` and `HarnessModelList`, the shape every harness's model list answers in, and `HARNESS_BASE_PASS`, the 13 variables every harness's child process needs (`PATH`, `HOME`, `USER`, `SHELL`, `TMPDIR` and the proxy settings in both cases). Build a harness environment of your own with `harnessEnv({ pass: [...HARNESS_BASE_PASS, "MY_KEY"] })`.
  - **cursor:** `listCursorModels({ env })` asks the Cursor SDK which models the signed-in account can run, with no run. It asks in a process whose environment is exactly `env`, as a run with that `env` runs, so the list is the account that run signs in as (its `CURSOR_API_KEY`, or else the stored login under its `HOME`), never the server's own key. It answers a `HarnessModelList` whose models carry the variants Cursor runs each at (`CursorModelVariant`: the `params` to hand the block's model selection). It never throws: a list it can't read is `failed` with the reason. `ListCursorModelsOptions` is its options. If your app stores a variant pick as one string, the reference app's form is `model?param=value` (`grok-4.7?reasoning_effort=high`). A pick stored in an older `model:variant` form (`grok-4.7:high`) reaches Cursor as an unknown model id, and Cursor refuses the run with its own error. It never runs another model.
  - **claude-code:** `listClaudeModels` is renamed to `listClaudeCodeModels`, and `ListClaudeModelsOptions` to `ListClaudeCodeModelsOptions`. `ClaudeModelInfo` and `ClaudeModelList` are removed; use `HarnessModelInfo` and `HarnessModelList` from `@flow-state-dev/core/harness`. The old names are removed, with no alias.
  - **codex:** `CodexModelInfo` and `CodexModelList` are removed; `listCodexModels` answers a `HarnessModelList` from `@flow-state-dev/core/harness`. The old names are removed, with no alias.
  - **claude-code, codex, cursor:** `CLAUDE_CODE_PASS`, `CODEX_PASS` and `CURSOR_PASS` are `HARNESS_BASE_PASS` plus each harness's own keys and certificates. Their names are unchanged.

  Docs: packages/core/README.md (`HarnessModelInfo`, `HarnessModelList` and `HARNESS_BASE_PASS` on the harness subpath), packages/cursor/README.md (a model-list section for `listCursorModels`, its variants and its never-throws contract), packages/claude-code/README.md (`listClaudeCodeModels` for `listClaudeModels`; the list answers core's `HarnessModelList`), packages/codex/README.md (`listCodexModels` answers core's `HarnessModelList`; the pass-list is the base plus Codex's names), apps/docs/docs/tools/coding-agents.md (the model list and the shared environment base, the same for all three), apps/docs/docs/tools/claude-code-sdk.md (`listClaudeCodeModels` in "Choosing the model"), apps/docs/docs/tools/codex.md (`HarnessModelList` in its model-list section), apps/docs/docs/tools/cursor.md (`listCursorModels` and picking a variant)

- ec679dd: The three coding harnesses refuse an SDK they weren't tested against, the same way, and their readiness checks say so first (FIX-2458).

  - **claude-code:** the peer range for `@anthropic-ai/claude-agent-sdk` is `>=0.3.316 <0.4.0` instead of `*`. `claudeCodeAgent` now refuses to build against an installed SDK outside that range, as Codex and Cursor already did. A different SDK version can change the wire this package translates, which shows up as malformed items. Install a version in the range.
  - **claude-code, codex, cursor:** each readiness check now reports the SDK first. An SDK outside the tested range answers `ready: false` with a reason naming both versions. A missing SDK answers `ready: false` too. Either way the remedy is to install the tested range. `checkClaudeCodeReadiness`, `checkCodexReadiness` and `checkCursorReadiness(env, options)` take `readInstalledSdkVersion` for a host's own check. The block always reads the installed SDK, and there is still no option to bypass its refusal. New option types: `ClaudeCodeReadinessOptions`, `CodexReadinessOptions` and `CursorReadinessOptions`.
  - **codex, cursor:** the version helpers leave the public entry: `TESTED_SDK_VERSION`, `assertTestedSdkVersion`, `readInstalledCodexSdkVersion` and `readInstalledCursorSdkVersion`, the `InstalledSdkVersion` and `InstalledSdkVersionReader` types, and `CodexSdkVersionMismatchError` and `CursorSdkVersionMismatchError`. They are removed, with no alias. To ask whether the SDK will run, call the package's readiness check. All three packages now throw the same refusal from core's SDK gate. Its `code` is `HARNESS_SDK_VERSION_MISMATCH`, replacing `CODEX_SDK_VERSION_MISMATCH` and `CURSOR_SDK_VERSION_MISMATCH`. The refusal is thrown when the block is built, never written into an item or stored.
  - **core, claude-code, codex, cursor:** `engines.node` is now `>=22.3.0` (was `>=22`). Core's SDK gate reads the installed SDK through `process.getBuiltinModule`, which Node added in 22.3. On an older Node, the gate can't read the version and refuses the SDK.
  - **codex, cursor:** `TranslatedEvent`, the type of the translation layer's output, leaves the public entry. No app imports it. Removed, with no alias.

  Docs: packages/claude-code/README.md (the peer range, the build-time refusal, and readiness reporting the SDK), packages/codex/README.md and packages/cursor/README.md (the version helpers and mismatch classes are gone; readiness answers whether the SDK will run; the refusal's code is `HARNESS_SDK_VERSION_MISMATCH`), apps/docs/docs/tools/coding-agents.md (an unusable SDK is a readiness answer, the same for all three), apps/docs/docs/tools/cursor.md (the failure table names `HARNESS_SDK_VERSION_MISMATCH`, not a Cursor version class), apps/docs/docs/tools/claude-code-sdk.md (the supported SDK range)

- 5e9123d: A stopped run reads as a stop in all three coding harnesses, whatever stopped it (FIX-2458).

  - **claude-code, codex, cursor:** the error a stopped run throws is abort-like to core's `isAbortLike`, whether the signal fired with no reason, a deadline's `TimeoutError` or a plain `Error`. The root of its `cause` chain is an `AbortError` whose message is the reason. Tell a stop from a failure with `isAbortLike(err)`, the same way for all three. A harness block used as a generator's tool now stops the generator when its run is stopped, where before the model was handed a failed call.
  - **claude-code:** a stopped run throws the new `ClaudeCodeAgentAbortedError` (`code: "CLAUDE_CODE_AGENT_ABORTED"`), with `sessionId`, the session to resume, and `reason`, the signal's own reason. Before, it threw the signal's reason itself. If you compared the thrown error with your signal's reason, or checked it for `TimeoutError`, read `err.reason` instead. The error item a stopped run shows is unchanged.
  - **codex, cursor:** `CodexAgentAbortedError` and `CursorAgentAbortedError` take the signal's reason as a second constructor argument and expose it as `reason`. Their `sessionId`, `code` and message are unchanged.

  Docs: packages/claude-code/README.md (`ClaudeCodeAgentAbortedError` among the errors; a stop is read with `isAbortLike`), packages/codex/README.md and packages/cursor/README.md (their stop errors are abort-like whatever the reason, with `reason`), apps/docs/docs/tools/coding-agents.md (telling a stop from a failure with `isAbortLike`, the same for all three), apps/docs/docs/tools/claude-code-sdk.md (a stop throws `ClaudeCodeAgentAbortedError`, no longer the signal's reason)

- 8be59f1: The Codex and Cursor package roots now match Claude Code's: the run's cost is read from its handle, and the handle, its source, the client seam and the error classes are documented public API (FIX-2605).

  - **Removed from the root, with no alias:**
    - `estimateCodexCost` (`@flow-state-dev/codex`). Read the run's estimate from the block's handle instead: `handle.cost` (`{ usd, … }`, or `null` when it cannot be priced). The block fills it with the same price-table estimate.
    - `estimateCursorCost` (`@flow-state-dev/cursor`). Read `handle.cost` on the Cursor block's handle the same way.
  - **Documented on the root, unchanged:**
    - The handle a run returns: `CodexAgentHandle` and its runtime validator `codexAgentHandleSchema`, whose `source` is `CODEX_SOURCE` (`"codex/sdk"`) and whose `codexUsage` is a `CodexRunUsage`. Cursor's is `CursorAgentHandle`, `cursorAgentHandleSchema`, `CURSOR_SOURCE` and `CursorRunUsage`. These match Claude Code's `ClaudeCodeAgentHandle`, `claudeCodeAgentHandleSchema` and `CLAUDE_CODE_SOURCE`.
    - Cursor's client seam: `createDefaultResolveCursorClient(importer)` builds the default `resolveCursorClient` from a `CursorSdkImporter`, as Codex's `createDefaultResolveCodexClient` and Claude Code's `createDefaultResolveClaudeCodeAgent` do.
    - The error classes, vendor detail beside core's readers (`isAbortLike`, `harnessFailureKind`): Codex's `CodexAgentConfigError` (a refused option, when the block is built) and `CodexSdkNotInstalledError` (the SDK is absent, on the first run), beside `CodexAgentRunError` and `CodexAgentAbortedError`. Cursor's `CursorAgentConfigError`, `CursorSdkNotInstalledError` and `CursorAgentRunError`, beside `CursorAgentAbortedError`.

  Docs: packages/codex/README.md (`handle.cost` replaces `estimateCodexCost`; the handle section names `CodexAgentHandle`, `codexAgentHandleSchema`, `CODEX_SOURCE` and `CodexRunUsage`; the errors section names `CodexAgentConfigError` and `CodexSdkNotInstalledError`), packages/cursor/README.md (`handle.cost` replaces `estimateCursorCost`; the handle section names `CursorAgentHandle`, `cursorAgentHandleSchema`, `CURSOR_SOURCE` and `CursorRunUsage`; the client seam names `createDefaultResolveCursorClient` and `CursorSdkImporter`; the errors section names `CursorAgentConfigError`, `CursorSdkNotInstalledError` and `CursorAgentRunError`), apps/docs/docs/tools/codex.md and apps/docs/docs/tools/cursor.md (the run's cost is `handle.cost`)

- de09b77: **Breaking:** 1,107 exports are removed from the roots of the published `@flow-state-dev/*` packages, with no deprecated aliases, so importing one from a package root no longer compiles; some of them are still exported from another entry of the same package (FIX-2562).
- f63ef40: Workforce and the coding harnesses install as kits (FIX-2627).

  - **workforce:** `workforce` (`@flow-state-dev/workforce/kit`) installs workforce with one config object: `createFlowState({ kits: [workforce({ agent: { model } })] })`. It reads the app's `workforce/` folder, builds every worker, and serves one copy of each worker flow and the roster flow. Every file in the folder is used or refused: a file workforce doesn't read, or one a reader can't load, stops the app starting, named. Three slots take what other kits and the app add: `workerFlows` (worker flows, built on the installation by `workerFlow(…)`; one keyed `agent` or `coordinator` replaces the kit's own), `uses` (capabilities for the agent and coordinator flows the kit builds), and `flows` (flows that aren't worker flows but are built on the installation, such as an app's projects flow: each entry is handed the installation and returns flows the kit serves). Config: `agent`, `coordinator`, `consult`, `routines`, `github`, `generated` (the app's `workforce.gen.ts`), `taskChainLimit`, `messages` (`MessageLimits`), `projectCoordinator`, `sessionFields`, `internalEvents`.
  - **workforce:** `sessionFields`, a zod schema per field the app declares on every worker session (`createWorkerInstallation({ sessionFields })` takes the same option; `installation.session()` declares them). Only the server writes one: once on a user's own conversation, through the agent and coordinator flows' `setSessionFields` action (`SET_SESSION_FIELDS_ACTION`, input `{ fields, worker? }`), which refuses a field already set, one the app doesn't declare, a value its schema refuses, and a task's, a delegate's or a project coordinator's session; and on a task's session at each hand-over, which carries the filer's values down beside the filing project. A session create that seeds a field is refused with a 400 naming it, and the client reads it in the session's client data. Every field is visible to the session's browser: never put a secret in one. A field named like one workforce keeps on the session refuses start.
  - **workforce:** `internalEvents` in the kit's config serves the internal service flow for its `topics` and adds its provider to routines; a worker flow built on the installation reaches its `publishEvent`, resources and tool with `internalEventsOf(installation)` (`./kit`).
  - **workforce:** `readWorkforceFolder` (`./loader`) is the kit's folder reader.
  - **workforce:** **Breaking:** `hireWorkforce`, `createWorkerInstallation` (with `HireWorkforceOptions` and `WorkerInstallationOptions`) leave the package root, and `./loader` exports `readWorkforceFolder` and `WorkforceFolder` only: `readDeclaredRoster`, `readWorkforce`, the per-convention readers and `walkTeams` are gone from it, with no alias. In place of `createWorkerInstallation` and `hireWorkforce`, install workforce with the kit: `createFlowState({ kits: [workforce({ directory })] })`, `workforce` from `@flow-state-dev/workforce/kit`; a worker flow of the app's own is a `workerFlow(build)` in the kit's `workerFlows` slot, and its builder is handed the installation. In place of the readers, `readWorkforceFolder` (`./loader`) reads the folder the way the kit does.
  - **workforce:** Starter files: `fsdev ui add workforce-starter` copies one team with one worker on the built-in agent flow (`workforce/teams/team/TEAM.md`, `workforce/teams/team/workers/assistant/WORKER.md`) into an app, and the kit starts on them.
  - **workforce:** `sourceReadCapability({ workspace })`: a worker reads the source its workspace host runs on (`globSource`, `readSource`, `grepSource`, under the `read` preset) with no coding run and no project; it names no project to the model and installs no project resources. `projectSourceCapability` keeps its tools and the project resources.
  - **harness-manager:** `harnesses` (`@flow-state-dev/harness-manager/kit`) requires workforce and declares a `harnesses` slot of harness values. It contributes `coder`, one coding worker flow every coding worker names in `flow:` and picks its harness for in `harness:`, and serves the `harnesses` flow's `readiness` view, one entry per harness filled. Its policy is config: `workspace`, `defaultHarness`, `review`, `pullRequests`, `judge`, `checks`, `project`, `runTimeoutMs`, `logReadiness`. `codingDrainBudgetMs` gives the shutdown wait for `dispatchDrainTimeoutMs`. An app with a coding flow of its own switches `coder` off with `harnesses(…).without(workforce.slots.workerFlows, "coder")`. The package root never imports workforce.
  - **harness-manager:** `Harness`, one coding harness as a value: `{ id, label?, agent, readiness, pass, usage?, models? }`. `CODER_FLOW` is on `./browser`.
  - **workforce:** `@flow-state-dev/workforce/react` carries the workforce components: `Roster` (which reads the roster view by default), `BoardColumns`, `BoardList`, `WorkerDetail`, `groupIntoColumns`, `BOARD_STATUS_COLUMNS` and their types. React is an optional peer, used only behind this entry.
  - **react:** **Breaking:** `@flow-state-dev/react/workforce` is removed, with no alias. Import those components from `@flow-state-dev/workforce/react`.
  - **codex:** `codexHarness(options?)`. **cursor:** `cursorHarness(options?)`, Cursor's `"default"` model unless the options name one.
  - **claude-code:** `claudeCode()`, a kit: it fills the harness slot with Claude Code (and, with `{ plan: true }`, `claude-code-plan`) and serves the collections a run records into.

  Docs: apps/docs/docs/workforce/overview.md (the kit, its folder's claim, its slots, `sessionFields`, starting from `fsdev ui add workforce-starter`), every Workforce page that installs workforce, apps/docs/docs/orchestration/harness-manager.md (the harness kit, the harness value, the coding worker flow's config, readiness), apps/docs/docs/api reference entries for the kits, packages/workforce/README.md, packages/harness-manager/README.md, packages/claude-code/README.md, packages/codex/README.md, packages/cursor/README.md, packages/react/README.md (the panels section imports from `@flow-state-dev/workforce/react`), apps/docs/docs/workforce/ui.md (components from `@flow-state-dev/workforce/react`), apps/docs/docs/api/react.md (the workforce panels left for `@flow-state-dev/workforce/react`), apps/docs/guides/writing-ui-stories.md (the `Roster` story import)

### Patch Changes

- 714e98f: A harness run that is still working is no longer stopped at a short limit on how long it has run. Coding runs and harness session turns are stopped once the harness has sent nothing for 20 minutes, and they fail with a message that names the harness, such as "No output from Claude Code for 20 mins; stopped." A cap on total run time, 4 hours by default, stops a run that loops while still sending events. (FIX-2794)

  - **Coding runs.** `harnessManager` and the harness kit take `idleTimeoutMs` (default 20 minutes). `runTimeoutMs` is now an optional cap on a run's total time, 4 hours by default; pass `0` to turn it off. Before, it was required, and the kit capped every run at 20 minutes. A run stopped at its cap fails saying so, such as "Claude Code ran for 1 hr, its cap on run time; stopped.", not with the harness's aborted error. `harnessManager` also takes `harnessLabel`, the harness's name in the stop message, which the kit fills from each harness's `label`. `codingDrainBudgetMs` takes `idleTimeoutMs` too. A shutdown waits out a cap you set; with the default cap, or with it off, `codingDrainBudgetMs` gives a run's harness 20 minutes before the run is cancelled.
  - **Session turns.** `harnessSessionFlow` takes `idleTimeoutMs` (default 20 minutes) and `harnessLabel`. `turnTimeoutMs` is now an optional cap, 4 hours by default; pass `0` to turn it off. Before, every turn was capped at 60 minutes. A turn stopped at its cap ends with the same words as a coding run's cap. A turn stopped for silence is recorded as `timedOut`, like one stopped at the cap.
  - **The harness contract.** A new optional feed, `onEvent` (type `HarnessEventHook`, helper `reportHarnessEvent` in `@flow-state-dev/core/harness`), is called on every event a run sends. `claudeCodeAgent`, `codexAgent` and `cursorAgent` call it, and `codexHarness()` and `cursorHarness()` pass it on. **If you write your own harness slot and pick feeds by name, pass `onEvent` on too.** A harness that never calls it is stopped after the idle window, however busy it is.
  - **Checkout locks.** A coding run's checkout lock is marked live on its events, so a long run keeps its lock. The stale window is sized from the idle window rather than from a run's length.

  Docs: apps/docs/docs/orchestration/harness-manager.md (`runTimeoutMs` is an optional cap, 4 hours by default, `0` for none; `idleTimeoutMs` and `harnessLabel`; the drain budget's run term), the harness kit page (the `idleTimeoutMs` key; `runTimeoutMs` 4 hours by default, `0` for none), the session flow's `turnTimeoutMs` (4 hours by default, `0` for none), apps/docs/docs/tools/codex.md and cursor.md (`onEvent` on the block's options), the harness contract reference (`onEvent`, `HarnessEventHook`, `reportHarnessEvent`).

- Updated dependencies [04812f3]
- Updated dependencies [61efa05]
- Updated dependencies [ffbe992]
- Updated dependencies [ec99b11]
- Updated dependencies [4b4a7d4]
- Updated dependencies [8e111c9]
- Updated dependencies [d30f516]
- Updated dependencies [f888e69]
- Updated dependencies [2cb6326]
- Updated dependencies [2876f11]
- Updated dependencies [84b912d]
- Updated dependencies [a27cf26]
- Updated dependencies [abed271]
- Updated dependencies [e5a9596]
- Updated dependencies [aa28006]
- Updated dependencies [e3ca793]
- Updated dependencies [7a2bb7e]
- Updated dependencies [ad80d4e]
- Updated dependencies [9d8f2be]
- Updated dependencies [0b56b1c]
- Updated dependencies [e505adf]
- Updated dependencies [5b2bd16]
- Updated dependencies [fe85f56]
- Updated dependencies [a06ad2d]
- Updated dependencies [ec679dd]
- Updated dependencies [4394069]
- Updated dependencies [5f1c26a]
- Updated dependencies [7ddae5c]
- Updated dependencies [c7ce9ff]
- Updated dependencies [95d9686]
- Updated dependencies [1600ca1]
- Updated dependencies [dde9a4b]
- Updated dependencies [6b360fa]
- Updated dependencies [41dcd7e]
- Updated dependencies [1d23553]
- Updated dependencies [e238e18]
- Updated dependencies [cc91d7a]
- Updated dependencies [3f23173]
- Updated dependencies [e9722ee]
- Updated dependencies [c049036]
- Updated dependencies [c049036]
- Updated dependencies [74a7b9d]
- Updated dependencies [b43424c]
- Updated dependencies [23517c7]
- Updated dependencies [3ef3979]
- Updated dependencies [33c4312]
- Updated dependencies [3c22491]
- Updated dependencies [de09b77]
- Updated dependencies [c82adfa]
- Updated dependencies [aa45e92]
- Updated dependencies [4fdcaed]
- Updated dependencies [6b68a97]
- Updated dependencies [546603f]
- Updated dependencies [4a6643c]
- Updated dependencies [e77c376]
- Updated dependencies [246f0ba]
- Updated dependencies [4698256]
- Updated dependencies [9f8b8d3]
- Updated dependencies [0454257]
- Updated dependencies [85ca2a3]
- Updated dependencies [714e98f]
- Updated dependencies [1e58902]
- Updated dependencies [81c145c]
- Updated dependencies [13e3970]
- Updated dependencies [d23352d]
- Updated dependencies [1970b12]
- Updated dependencies [c36ffa0]
- Updated dependencies [23bac7e]
- Updated dependencies [1f46aaf]
- Updated dependencies [89b40bc]
- Updated dependencies [b5b52b9]
- Updated dependencies [f63ef40]
  - @flow-state-dev/core@0.6.0
  - @flow-state-dev/harness-manager@0.6.0
  - @flow-state-dev/workspace@0.5.0

## 0.2.1

### Patch Changes

- Updated dependencies [531bf32]
- Updated dependencies [05a7022]
- Updated dependencies [c67aa49]
- Updated dependencies [f1e6315]
- Updated dependencies [da4a4bb]
- Updated dependencies [5f569fd]
- Updated dependencies [844a4f9]
  - @flow-state-dev/core@0.5.0

## 0.2.0

### Minor Changes

- 151309c: Harness readiness: which coding harnesses can run on this machine, and what to do about one that can't. Core adds the neutral `HarnessReadiness` and `HarnessReadinessCheck`. Each integration ships a check: `checkClaudeCodeReadiness`, `checkCodexReadiness` and `checkCursorReadiness`, each with its sign-in remedy. `@flow-state-dev/harness-manager` adds `harnessReadiness(slots)`, which checks once and re-checks on request. It also adds `harnessReadinessAction` for a read with Re-check, `harnessReadinessCapability` for the coordinator's context, `formatHarnessReadiness` for the start log, and `refusal(harness)` for a coding flow's pre-start gate (FIX-2391).

### Patch Changes

- Updated dependencies [e0daf6e]
- Updated dependencies [151309c]
- Updated dependencies [824ce87]
- Updated dependencies [7d92efe]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
  - @flow-state-dev/core@0.4.0

## 0.1.0

### Minor Changes

- 0d55d46: A session keeps a record of the pull requests it opened (FIX-2268). Core adds the `observed-pull-requests` collection (`observedPullRequestsCollection`), one writer (`writePullRequests`), a replaceable GitHub rule (`githubPullRequestRule`, `DEFAULT_PULL_REQUEST_RULES`) and the recorder: `recordPullRequests(ctx)` for a block, and `pullRequestRecorder()` for a flow with no harness to add as a `.tap` step. A `gh pr create` command or a `create_pull_request` tool whose output holds the link is one row, written as the call settles. Each row carries the `requestId` that opened it.

  The Codex, Claude Code and Cursor blocks record by default; `recordPullRequests: false` turns it off. Workspace adds `recordBranchPullRequests`, a host-side check that asks GitHub through `gh` which pull requests a checkout's branch has. The harness manager declares the record and runs that check before its verdict and when a run fails.

  **Migration.** A Codex, Claude Code or Cursor block now declares the `observed-pull-requests` session collection by default. A test that asserts the block declares no resources must pass `recordPullRequests: false`.

- 7d39c0d: A turn Codex reports as failed (`turn.failed`) now returns an `errored` handle with `outcome: "failed"` even when the Codex CLI then exits non-zero, instead of throwing. The run's one `error` item still carries the failure line and the CLI's output on `details.output`; the closing "Codex run errored" status is no longer emitted after an error item that already says why. A caller that caught the throw to detect a failed turn should read `handle.outcome` instead (FIX-1988).
- 7d39c0d: Adds `listCodexModels`, which asks Codex for the models its picker offers the signed-in account, its default first, without a run (FIX-1988).
- 2525674: Codex's non-fatal warnings (an `error` item, such as a service tier the model doesn't advertise) are now kept `status` notes instead of `error` items, and its stream-level `error` events (retry progress) are transient `status`; when the stream ends on one with no turn result, that error becomes the run's failure. A failed turn the CLI then exits on fails with the turn's own message, read down to one line from the API's JSON body, and the CLI's output rides on the error item's `details.output`. `TranslatedEvent` gains `notice` and `stream_error` kinds: a `switch` over it that covers every kind needs a case for each (FIX-1988).
- 5e7aab8: Require @openai/codex-sdk 0.164.0 so Codex runs support current models (FIX-1988).

### Patch Changes

- 82eea02: A running coding task now says how it's doing. The harness contract gains an optional `onActivity` hook (`HarnessActivityHook`), called with each completed assistant message and each tool call a run starts; `claudeCodeAgent`, `codexAgent` and `cursorAgent` (tool calls only) take it, and `reportHarnessActivity` / `harnessActivityOf` in `@flow-state-dev/core` map a harness's events to it. `harnessManager` hands the feed and keeps the task's `statusNote` set to the run's latest activity: the first at once, then at most one write per `PROGRESS_NOTE_MS` (30 s), fenced by the run's claim. A slot that builds its harness from named feeds must pass `onActivity` through to get notes (FIX-2290).
- 16a8dab: See how much of Claude Code's subscription is used. Core's `HarnessUsageWindow` gains `level` (`ok`, `warning`, `reached`, or `null`) and its `usedPercent` may be `null` when a harness sends no percent; core adds `HarnessUsageHook` and `HarnessUsageReport`, the run-time twin of `HarnessSessionHook`. `claudeCodeAgent` takes `onUsage` and hands it each window a run's `rate_limit_event` reports, with the run's account; `readClaudeUsage` reads who is signed in for the usage query, and `probeClaudeAccount` takes a `signal` that stops and closes the probe, and marks a `none` it got no answer for with `unanswered: true`. `@flow-state-dev/harness-manager` feeds `onUsage` at both of its harness slots (`HarnessFeeds.onUsage`, now required, so code that builds `HarnessFeeds` itself must add it), writing into the run owner's usage record, and keeps a stored record's account and windows together across a sign-in change. Codex windows now carry `level: null`. Shift Manager's Usage view shows Claude Code's windows, saying "limit reached" or "under Claude Code's warning line" where there is no percent (FIX-2142).
- b4cb383: `CODEX_PASS` names the only variables of the server's environment a Codex run needs. Build the run's environment with `client: { env: harnessEnv({ pass: CODEX_PASS }) }` so the Codex CLI doesn't inherit the server's whole `process.env` (FIX-2154).
- 3857508: `probeCodexAccount({ env, timeoutMs?, signal? })` asks whether Codex has a credential to run on, with no run (FIX-2014). With a `CODEX_API_KEY` in `env`, it reads `account` with `source: "api-key"` without asking the CLI; otherwise it runs the SDK's own `codex login status` and reads `account` with `source: "login"`, `none` with Codex's reason (plus `unanswered: true` when Codex timed out, was stopped, or couldn't start), or `sdk-missing`. It never throws, and its shape follows `probeClaudeAccount` in `@flow-state-dev/claude-code`.
- 9815f94: Codex reasoning items now carry their text in `summary` as `reasoning_text` parts, the shape the `ReasoningItem` contract declares, so reasoning renderers display them instead of throwing (FIX-1699). Message items are unchanged.
- 20cd81e: A resume Codex refuses because it no longer has the thread now fails with a `CodexAgentRunError` whose `harnessFailure` is `"unknown-conversation"`, so `harnessFailureKind(error)` from `@flow-state-dev/core` tells it apart from other failures (FIX-1916).
- 701f00d: Each harness block takes a `model` option: a fixed id, or a resolver asked once per run like `cwd` and `resume`, so one block can run a different model per session. The harness gets it on a fresh run and a resumed one alike. Codex's `thread.model` and Cursor's `agent.model` still work for a fixed id; setting one beside `model` (or Cursor's `send.model`) is refused when the block is built. `@flow-state-dev/claude-code/sdk` adds `listClaudeModels`, which asks Claude Code for the models it offers without a model turn, each under the concrete id its alias resolves to (FIX-1952).
- adc3219: A settled item keeps the `itemIndex` it was added with. Both emitters re-read `ctx.response.getItemCount()` when closing an item the stream already held — a tool call settling with its result, and in `@flow-state-dev/claude-code` a streamed message or reasoning item closing, or a sub-agent container closing. The count does not grow when an existing item is closed, so the re-read returned the index the NEXT item was about to take, and two items in one request ended up sharing one. `itemIndex` orders a request's items and core's replay picks among same-id traces by the highest one, so the collision made that order a guess. `@flow-state-dev/cursor` already carried the opened index forward; these two now do the same.
- 08a9b05: See how much of each coding harness's subscription is used. Core adds the neutral usage window and the on-demand reader signature (`HarnessUsageWindow`, `HarnessUsageReading`, `HarnessUsageReader`). `@flow-state-dev/codex` adds `readCodexUsage`, which asks the Codex CLI's app-server for every window's percent used and reset time with no run (local only), and exports `findCodexProgram`. `@flow-state-dev/harness-manager` adds the per-person `harness-usage/**` record and `harnessUsageAction({ readers })`, the one query that returns each window with its age and whether it has rolled over, refreshing a reader at most once a minute. Shift Manager shows it on a new Usage view (FIX-2141).
- 0d6278e: Each worker's token usage is recorded per person and day, with harness runs reporting their spend through `reportHarnessSpend`, read through the `workerUsage` query, and shown on Shift Manager's Usage view (FIX-2145).
- 9af8ce5: A dispatched task records what its runs spent on its row (`spend`), every attempt counted, rising while a run works: the board writes it every 2 s and as the request ends, through the new `recordSpend` verb on `TaskCollectionRef`. `listTasks` from `taskToolActions` returns it folded (`taskSpendView`: harness, model, input and output tokens, `null` until reported). Harness runs report spend as they go, keyed by a `runId` with the model the run named, each report replacing the run's last; `readRequestSpend(ctx)` reads a running request's spend so far, and `requestSpendSources` moves from Workforce into core (FIX-2288).
- Updated dependencies [92b2b70]
- Updated dependencies [20aa58f]
- Updated dependencies [5d31955]
- Updated dependencies [bea14a0]
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [82eea02]
- Updated dependencies [e2c190e]
- Updated dependencies [0d55d46]
- Updated dependencies [1abab86]
- Updated dependencies [8e67ce5]
- Updated dependencies [dd353e2]
- Updated dependencies [3221d05]
- Updated dependencies [58ffc93]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [53b50f0]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
- Updated dependencies [9d02ac6]
- Updated dependencies [d5ce1e0]
- Updated dependencies [8dc242e]
- Updated dependencies [89af7db]
- Updated dependencies [7d4158f]
- Updated dependencies [5492a77]
- Updated dependencies [6819520]
- Updated dependencies [ad5df6f]
- Updated dependencies [211679a]
- Updated dependencies [dd80e01]
- Updated dependencies [2ce15c7]
- Updated dependencies [5181ddb]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [e71ea1a]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [fe5df7d]
- Updated dependencies [423a405]
- Updated dependencies [08a9b05]
- Updated dependencies [7da156e]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [f9995b1]
- Updated dependencies [a7f1c41]
- Updated dependencies [3a6c910]
- Updated dependencies [80f6e25]
- Updated dependencies [3cbab3a]
- Updated dependencies [849f6ec]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [eb831f8]
- Updated dependencies [41638f3]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [839e915]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [9510a03]
- Updated dependencies [adbcf0b]
- Updated dependencies [1027b98]
- Updated dependencies [1cfd80c]
- Updated dependencies [3b0161c]
- Updated dependencies [385d01e]
- Updated dependencies [d1a4cab]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [60c8192]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [295e96a]
- Updated dependencies [97894aa]
- Updated dependencies [334c1e3]
- Updated dependencies [9ed6b29]
- Updated dependencies [b552b50]
- Updated dependencies [a021cd1]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [e11764a]
- Updated dependencies [872a088]
- Updated dependencies [9cd314d]
- Updated dependencies [9af8ce5]
- Updated dependencies [30aa133]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [d97031f]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [96ff077]
- Updated dependencies [84cc226]
  - @flow-state-dev/core@0.3.0

## 0.0.4

### Patch Changes

- Updated dependencies [b597600]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/core@0.2.0

## 0.0.3

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2

## 0.0.2

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1

## 0.0.1

### Patch Changes

- d7208f7: LAB-153: new package `@flow-state-dev/codex` runs OpenAI's Codex agent as a block, returning the same neutral harness handle `@flow-state-dev/claude-code` returns.

  `codexAgent()` starts or resumes a Codex thread in a directory you resolve, mirrors the run into the item stream, and returns the handle; `createCodexAgentCapability()` exposes it to a generator as a tool. The block's input is the prompt — where a run writes (`cwd`) and which thread it continues (`resume`) are resolvers you supply, and `onSession` is called with the thread id mid-run so a cancelled run stays resumable.

  Requires `@openai/codex-sdk` at exactly 0.152.1 as an optional peer. Building against any other installed version throws, and so does a version that cannot be determined; there is no override. Cost on the handle is an estimate and is `null` — never `0` — when the model is unknown, unpriced, or the turn reported no usage.

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
