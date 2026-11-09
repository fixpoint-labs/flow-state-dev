# @flow-state-dev/core

## 0.6.0

### Minor Changes

- 7a2bb7e: **Breaking:** the benchmark contract types `BenchmarkTask`, `BenchmarkCategory`, `BenchmarkSubject`, `BenchmarkAdapter`, `BenchmarkAdapterOptions` and `BenchmarkRegistry` leave the `@flow-state-dev/core` root for `@flow-state-dev/testing/benchmark`, with no alias; change the import to `from "@flow-state-dev/testing/benchmark"` (FIX-2460).

  Docs: packages/core/README.md (drop the benchmark types from the root's list, if named), apps/docs/docs/api/benchmarks.md (import the contract types from `@flow-state-dev/testing/benchmark`)

- ad80d4e: **Breaking:** the coding-harness vocabulary moves to a new public subpath, `@flow-state-dev/core/harness`, its one home (FIX-2448). It holds the harness contract (`HarnessBlock`, `HarnessRunInput`, `HarnessRunHandle`, `harnessRunInputSchema`, `harnessRunHandleSchema`, the hook types, `reportHarnessSpend`), the run's plan record (`OBSERVED_PLAN`, `observedPlanCollection`, `replacePlanList`, `readPlanTarget` and the rest), the session's pull-request record (`OBSERVED_PULL_REQUESTS`, `observedPullRequestsCollection`, `recordPullRequests`, `pullRequestRecorder`, `githubPullRequestRule` and the rest), and the helpers a harness calls (`harnessEnv`, `harnessSteering`, `reportHarnessActivity`, `harnessActivityOf`, `formatRunDuration`). These names are no longer exported from the `@flow-state-dev/core` root or from `@flow-state-dev/core/types`, with no deprecated aliases: an old import fails to compile with "has no exported member"; change it to `from "@flow-state-dev/core/harness"`. Like `core/types`, the subpath is safe to import from browser code. `planConversationPrefix` and `findOpenedPullRequests` are removed from the public API with no new home.

  Docs: packages/core/README.md (the harness, plan-record and pull-request-record section becomes a `@flow-state-dev/core/harness` section; every import of these names is from `@flow-state-dev/core/harness`, not the root or `core/types`; drop `planConversationPrefix` and `findOpenedPullRequests`), packages/claude-code/README.md, packages/codex/README.md, packages/harness-manager/README.md (import `harnessEnv` from `@flow-state-dev/core/harness`), apps/docs/docs/tools/coding-agents.md (import the plan and pull-request records from `@flow-state-dev/core/harness`; drop the `planConversationPrefix` and `findOpenedPullRequests` lines), apps/docs/docs/tools/claude-code-sdk.md, apps/docs/docs/tools/codex.md, apps/docs/docs/tools/cursor.md, apps/docs/docs/orchestration/harness-manager.md (import `harnessEnv` from `@flow-state-dev/core/harness`)

- 9d8f2be: **Breaking:** core's runtime seams move off its public entries to `@flow-state-dev/core/internal`, a subpath for the framework's own packages (FIX-2448). It holds the request host (`RequestHost` and its verb types, `requireRequestHost`, `NoRequestHostError`, and the new `requestHostOf`), the wait gate (`parkOnWait`, `canHoldWait`, `waitOnRequest`, `WAIT_DEADLINE_ENTRY`, `MAX_WAIT_DEPTH`, `WaitOutcome` and the rest), the dispatch seam (`DISPATCH_SEAM`, `dispatchThroughSeam`, `NoDispatchSeamError`), the request-end and spend seams (`REQUEST_END_SEAM`, `onRequestEnded`, `REQUEST_SPEND_SEAM`, `readRequestSpend`, `RequestEnding` and the rest), the resume and board-notice seams, the request's side-chain pool, `buildReplayLog`, `resolveActiveStatusMessage`, `resolveAllowedActions`, `cacheTokensOf` and `isFiveFieldCron`. These names are no longer exported from the `@flow-state-dev/core` root, `@flow-state-dev/core/types` or `@flow-state-dev/core/errors/suspension-error`, with no deprecated aliases: an old import fails to compile with "has no exported member". `@flow-state-dev/core/items/internal` is removed; its names (`BlockValueInternal`, `RuntimeItem`, `refBlockValue`, `resolveBlockValueInternal`, `parseBlockInstanceId`) are on `@flow-state-dev/core/internal`, and `RuntimeItem` stays public on `@flow-state-dev/core/items`. The public `BlockContext` type no longer declares `requestHost` or the five symbol-keyed seam slots; they are on `InternalBlockContext`, which the engine builds. Code that read `ctx.requestHost` reads `requestHostOf(ctx)`, which is `undefined` when no host is wired, as the optional read was. Apps should not import any `/internal` path: CI refuses it from app, example and docs code.

  Docs: packages/core/README.md (drop the runtime-seam passages — `ctx.requestHost`, the dispatcher's substrate exports, the wait gate, the request-end and request-spend seams — and move them to docs/architecture/internal-execution-seams.md; no README import of these names from the root or `core/types` remains), packages/orchestration/README.md (`canHoldWait` is imported from `@flow-state-dev/core/internal`, not re-exported from the root; `ctx.requestHost` reads become `requestHostOf(ctx)`), packages/workforce/README.md (a host whose request host carries `sessions`, read with `requestHostOf(ctx)`), packages/engine/README.md (`RequestHost`, `WAIT_DEADLINE_ENTRY` and `parkOnWait` are framework seams on `core/internal`), packages/contracts/README.md (its internal items are re-exported from `@flow-state-dev/core/internal`, not `core/items/internal`), apps/docs/docs/patterns/utility-blocks/core.md (the session-history tool reads the host's `sessions.history`; drop `ctx.requestHost`)

- 0b56b1c: **Breaking:** the `@flow-state-dev/core` root now carries only the names an app author imports or the docs teach (FIX-2448). The rest leave the root with no deprecated aliases; an old import fails to compile with "has no exported member".

  - **Still public, on their subpath.** Import these from the entry named: `@flow-state-dev/core/types` for `BlockCacheableConfig`, `HistoryTurnQuery`, `SchemaInput`, `SchemaOutput`, `DEFAULT_LOCAL_USER_ID`, `resource`, `applyGetOrPatchState`, the projected-collection helpers (`ProjectedResourceCollectionRef`, `ProjectedResourceRef`, `ValidatedProjectedHit`, `isProjectedResourceCollection`, `readProjectedRecord`, `searchProjectedRecords`), the skill types (`InitialSkill`, `Skill`, `MatchedSkill`, `SkillActivationSource`, `SkillContextMode`, `SkillFile`, `SkillState`, `SkillsCollectionMeta`, `ToolCatalog`, `RunSkillInput`, `RunSkillOutput`), the dispatch helpers (`framed`, `readFramed`, `addressEntries`, `describeAction`, `resolveTaskAction`, `resolveTaskSessionTarget`), `ClientDataComputeFn`, `ClientDataContext`, `isKnownTimeZone`, `validateScheduleConfig`, `validateSchedulesConfig`, `validateWebhookConfig`, `BindingProvider`, `BindingCacheOptions`, `SuspensionSkipped`, `ApprovalAnswer`, `UserAnswer` and `SuspendForUserOptions`; `@flow-state-dev/core/models` for `createAiSdkModelResolver`, `wrapAiSdkModel`, `createFallbackModel`, `isRetryableError`, `detectAvailableProviders`, `parseModelString`, `extractProviderName`, `isModelSelection`, `applyCaching`, `DEFAULT_CACHING_CONFIG` and their types (`ResolveAiSdkLanguageModel`, `ModelGroupDefaults`, `GatewayConfig`, `GatewayType`, `ProviderName`, `ProviderAvailability`, `ParsedModelString`, `FallbackModelEntry`); `@flow-state-dev/core/capability` for `getBaseCapability`; `@flow-state-dev/core/items` for `RuntimeItem`.
  - **Framework-only, now on `@flow-state-dev/core/internal`**, which apps must not import: `parseBlockInstanceId`, `buildBlockInstanceId`, `blockPathObserver`, `logicalBlockIdOf`, `ROOT_BLOCK_PATH`, `runRescue`, `normalizeReactiveBinding`, `ReactiveBindingKind`, `SLASH_COMMAND_PATTERN`, `assertEvaluatorBlock`, `createBindingCache`, `errorDetailsWithCause`, `isTraceObservabilityEnabled`, `isManifestDomain`, and the change-notice and push wire (`ChangeKind`, `TopicScope`, `PUSH_CLOSE_CODES`, `PUSH_MINT_MAX_TOPICS`, `wireTopicKey`, `PushCapability`, `PushMintAnswer`, `PushServerFrame`).
  - **No longer exported:** `blockPathBranch`, `blockPathIteration`, `blockPathLoop`, `blockPathRescue`, `blockPathSegment`, `blockPathTool`, `extendBlockPath`, `CachedBindingProvider`, `EvaluatorSlotNames`, `GeneratorSlotRefOptions`, `ScopeClientConfig`, `resolveTracingLevel`, `warnOnceDev`, `rootCause`, `serializeError`, `SerializedError`, `PushClientFrame` and `PushMintRequest`. `WireNotice` is imported from `@flow-state-dev/client`, as before.

  The root keeps, documented: `DispatchWaitResult`, the output type of `dispatcher({ wait: true })`; `SequencerOutputSchemaError`, which a sequencer throws when its chain's output doesn't match `config.outputSchema` and a rescue catches with `when: [SequencerOutputSchemaError]`; `SequencerSchemaMismatchError`, thrown by `.validate()`; and `RecordedValueOmittedError` with its code `RECORDED_VALUE_OMITTED`, which a resumed request fails with when it would hand on a value the log stored as a placeholder; and `isAbortLike(err)`, which tells a stopped run from a failed one.

  Docs: packages/core/README.md (document `DispatchWaitResult`, `SequencerOutputSchemaError`, `SequencerSchemaMismatchError`, `RecordedValueOmittedError`, `RECORDED_VALUE_OMITTED` and `isAbortLike` as root names; any import of a name listed above reads from the entry named here), apps/docs/docs/api/package-roots.md (core's row: the root is for app authors, `core/types`, `core/models`, `core/items`, `core/capability` and `core/harness` are its public subpaths, `core/internal` is for FSD's own packages), apps/docs/docs/api/server.md and apps/docs/docs/advanced/custom-model-resolver.md (`parseModelString`, `detectAvailableProviders` and the resolver helpers are imported from `@flow-state-dev/core/models`), apps/docs/docs/fundamentals/models.md (`wrapAiSdkModel` from `@flow-state-dev/core/models`), apps/docs/docs/skills/overview.md and apps/docs/docs/workforce/workers-on-disk.md (`InitialSkill`, `MatchedSkill` and `SkillActivationSource` are on `@flow-state-dev/core/types`), apps/docs/docs/resources/projected-collections.md (`ProjectedResourceCollectionRef`, `ProjectedResourceRef` and `isProjectedResourceCollection` are on `@flow-state-dev/core/types`)

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

- 4394069: A session, user or org field that a block or capability declares with a default now reads as that default on a fresh or older record, with no restating on the flow (FIX-2576). Three upgrade refusals come with it. `defineFlow` throws when two declarations of one field (the flow's, a block's, a capability's) differ in type or default, naming the field and both declarers. It also throws on a default factory (`.default(() => ...)`) that would never run: one a block or capability declares that isn't the flow's own session factory, and any in user or org state, the flow's own schema included. Use a static default, or declare the factory on the flow's session schema. Reads now fill static defaults only and never run a factory, so a stored record always reads the same value: a factory default runs only when a new session is born. A field whose schema declares a factory default or a `z.lazy` anywhere is read exactly as stored, so a static default nested inside such a field no longer fills on read. A block, capability or user/org declaration whose field holds a `z.lazy` is refused at `defineFlow`. The one behaviour change from before: a stored session that lacks a field the flow defaults with a factory reads that field as missing, where it used to read a fresh value on every read. The server refuses to start when two flows type or default a shared user or org field differently. `hireWorkforce` no longer requires a manager flow to spread the board's `sessionStateShape` into its session schema.

  Docs: apps/docs/docs/fundamentals/state-and-scopes.md (Schema bubbling: block and capability declarations now fill defaults, drop the "only the flow's own stateSchema" paragraph and the restate advice, add the two refusals; Creating sessions: defaults from every declaration the flow reaches) · apps/docs/docs/fundamentals/capabilities.md (a line beside the `sessionStateSchema` row) · packages/workforce/README.md and apps/docs/docs/workforce/delegating-work.md (a manager flow no longer needs to spread `sessionStateShape`)

- 1600ca1: A coding task that opens a GitHub pull request hears each review, comment and CI result on it once, through a signed webhook, from `service:github` (FIX-2535).

  - **workforce:** `githubServiceFlow({ provider, installation, trustedBots, agentHandles })` is GitHub's service flow, with the webhook route declared. `githubSubscriptionProvider({ token })` answers who can read a repository and who the user is on GitHub, on the user's own token. `followPullRequest({ providers })` subscribes a coding session to each pull request it records, hearing its reviews, comments and CI until it merges or closes. `normalizeGitHubEvent` maps a webhook payload, or a poll's object of the same shape, to normalized events; `defineSubscriptionServiceFlow` takes `normalize` (declares the webhook route) and `maxOwnerRuns` (the most subscriptions one event reaches, 100 by default).
  - **core:** a webhook provider entry can be a service route, `webhooks: { <provider>: { service: { entry, normalize } } }`, instead of `on`. `WebhookSubscriptionConfig` is now a union of the two, so code that reads `.on` off it must check for `undefined`. The normalized subscription event gains an optional `addressed: true` when it asks the app's agent. `writePullRequests` takes `onRecorded`, called once per newly recorded pull request; `followRecordedPullRequests(ctx, follower)` hands a request's new pull requests to a `PullRequestFollower`.
  - **engine:** the webhook transport routes a service route's events through `routeServiceEvent`, as `service:<provider>`, answering 202 once each owner run is recorded, 503 when one wasn't.
  - **harness-manager:** `harnessManager({ onPullRequestRecorded })` hands each pull request a run records to the follower, mid-turn.
  - **workspace:** the branch check hands the pull requests it records to the request's follower.

  Docs: packages/workforce/README.md (GitHub's service flow, the provider, `followPullRequest`, the webhook mount), packages/core/README.md (the `service` webhook form, `addressed`, `onRecorded`), packages/engine/README.md (the service route in the webhook transport), packages/harness-manager/README.md (`onPullRequestRecorded`), apps/docs/docs/server/webhooks.md (the service route beside bindings), apps/docs/guides/webhooks-github.md (mount the flow; a task follows its pull request; `sessionId` routing for GitHub is gone)

- c049036: A three-part `gateway/provider/model` model string now fails as an invalid model format, with no message pointing at the colon spelling; write `"gateway:provider/model"`. `defineFlow` and the block builders no longer refuse `middleware` or `work` by name, and a stop recorded under the model tool name `waitForUser` no longer resumes as `suspendForUser` (FIX-2454).

  Docs: none. The old names and shapes are removed outright, with no refusal message.

- 3ef3979: **Breaking:** core's names that another entry also exports for something else are renamed, so one name means one thing (FIX-2449). No deprecated aliases: an old import fails to compile with "has no exported member".

  - `SessionView`, what the request host's `sessions.read` answers, is renamed `PeerSessionView`. React's `useSession` result keeps the name `SessionView`.
  - On `@flow-state-dev/core/models`, the model resolver's `RetryPolicy` is renamed `ModelRetryPolicy`. A block's retry setting keeps the name `RetryPolicy`.
  - `@flow-state-dev/core/blocks/sequencer` exports only the `sequencer` builder. Its other helpers, `executeBlock` among them, are no longer on that subpath.

  Docs: packages/core/README.md (`PeerSessionView` in the request-host types list; the block-builder subpaths section says `@flow-state-dev/core/blocks/sequencer` carries only `sequencer`), apps/docs/docs/configuration/runtime.md (the `retryPolicy` row's type is `ModelRetryPolicy`)

- c82adfa: **Breaking:** one word for a stored thing, _resource_, and _Status_ for a lifecycle (FIX-2479). Exported names that said _row_ or _collection item_ for a resource, or _row_ for a task, are renamed, with no aliases. Stored field names, storage keys and HTTP paths do not change: a worktree record keeps its `state` field, now typed `WorktreeStatus`.

  ### Renamed exports

  | Package                            | Old                                                      | New                                                                                        |
  | ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
  | `core` (`/internal`)               | `WaitRow`                                                | `TaskAddress`                                                                              |
  | `core` (`/harness`)                | `planRowsPrefix`                                         | `planResourcesPrefix`                                                                      |
  | `core` (`/harness`)                | `readPlanTarget(...)` result field `rowsPrefix`          | `resourcesPrefix`                                                                          |
  | `core`                             | `SessionCreateCheckInput.readCollectionItem(ref, topic)` | `readCollectionResource(ref, topic)`                                                       |
  | `engine`                           | `DebugCollectionItem`                                    | `DebugCollectionResource`                                                                  |
  | `engine`                           | `DebugCollectionItemsResponse`                           | `DebugCollectionResourcesResponse` (its `items` wire field is unchanged)                   |
  | `engine`                           | `ResourceIndexBuildState`                                | `ResourceIndexBuildStatus`                                                                 |
  | `workspace`                        | `WorktreeRow`                                            | `WorktreeResourceState`                                                                    |
  | `workspace`                        | `worktreeRowSchema`                                      | `worktreeResourceStateSchema`                                                              |
  | `workspace`                        | `WorktreeState`                                          | `WorktreeStatus`                                                                           |
  | `workspace`                        | `worktreeStateSchema`                                    | `worktreeStatusSchema`                                                                     |
  | `scheduled`                        | `ScheduleIndexRow`                                       | `ScheduleIndexEntry` (one schedule's entry in the schedule index)                          |
  | `client`                           | `CollectionItemHandle`                                   | `CollectionResourceHandle`                                                                 |
  | `client`                           | `CollectionItemState`                                    | `CollectionResourceState`                                                                  |
  | `client`                           | `CreateCollectionItemOptions`                            | `CreateCollectionResourceOptions`                                                          |
  | `client`                           | `ListCollectionItemsOptions`                             | `ListCollectionResourcesOptions`                                                           |
  | `client`                           | `DebugCollectionItem`                                    | `DebugCollectionResource`                                                                  |
  | `client`                           | `DebugCollectionItemsResponse`                           | `DebugCollectionResourcesResponse` (its `items` wire field is unchanged)                   |
  | `client`                           | `ListDebugCollectionItemsOptions`                        | `ListDebugCollectionResourcesOptions`                                                      |
  | `client`                           | `client.resources.listCollectionItems`                   | `listCollectionResources`                                                                  |
  | `client`                           | `client.resources.createCollectionItem`                  | `createCollectionResource`                                                                 |
  | `client`                           | `client.resources.getCollectionItemState`                | `getCollectionResourceState`                                                               |
  | `client`                           | `client.resources.getCollectionItemContent`              | `getCollectionResourceContent`                                                             |
  | `client`                           | `client.resources.deleteCollectionItem`                  | `deleteCollectionResource`                                                                 |
  | `client`                           | `client.sessions.debug.listCollectionItems`              | `listCollectionResources` (the debug route's URL is unchanged)                             |
  | `client`                           | `client.sessions.debug.fetchCollectionItemContent`       | `fetchCollectionResourceContent`                                                           |
  | `client`                           | `SessionConnectionState`                                 | `SessionConnectionStatus`                                                                  |
  | `react`                            | `useResourceCollectionItem`                              | `useCollectionResource` (its result's `item` field is unchanged)                           |
  | `react`                            | `UseResourceCollectionItemResult`                        | `UseCollectionResourceResult`                                                              |
  | `react` (`/workforce`)             | `PanelRowSource`, `PanelItemSource`                      | unchanged names; they now pick `listCollectionResources` and `getCollectionResourceState`  |
  | `orchestration` (`/tasks`)         | `rowHoldSchema`                                          | `ownHoldSchema` (a task's own hold: a question, a confirm or an external wait)             |
  | `orchestration` (`/tasks`)         | `RowHold`                                                | `OwnHold`                                                                                  |
  | `orchestration` (`/inbox`)         | `RowHoldSource`                                          | `OwnHoldSource` (its `kind` is `"task"`, was `"row"`)                                      |
  | `orchestration` (`/inbox`)         | `InboxRow`                                               | `InboxTaskInput`                                                                           |
  | `orchestration` (`/inbox`)         | `RefileRow`                                              | `RefiledTask`                                                                              |
  | `orchestration` (`/inbox`)         | `taskRowView(row, holds?)`                               | `taskView(task, holds?)`                                                                   |
  | `orchestration` (`/inbox`)         | `TaskRowView`                                            | `TaskView`                                                                                 |
  | `orchestration` (`/inbox`)         | `TaskViewRow`                                            | `TaskViewInput`                                                                            |
  | `orchestration` (`/inbox`)         | `TaskRowState`                                           | `TaskViewStatus`                                                                           |
  | `orchestration` (`/inbox/check`)   | `RowTruth`                                               | `TaskTruth` (its `rowHolds` field is `ownHolds`)                                           |
  | `orchestration` (`/inbox/check`)   | `rowTruthOf`                                             | `taskTruthOf`                                                                              |
  | `orchestration` (`/internal`)      | `isRowHold`, `openRowHolds`                              | `isOwnHold`, `openOwnHolds`                                                                |
  | `orchestration` (`/internal`)      | `rowsInSession`                                          | `tasksInSession`                                                                           |
  | `engine` (`/internal`)             | `OwnerRunRefusal` value `"no_row"`                       | `"no_resource"`                                                                            |
  | `harness-manager`                  | `HarnessReadinessRow`                                    | `HarnessReadinessView`                                                                     |
  | `harness-manager`                  | `harnessReadinessRowSchema`                              | `harnessReadinessViewSchema`                                                               |
  | `harness-manager`                  | `HarnessUsageRow`                                        | `HarnessUsageView`                                                                         |
  | `harness-manager`                  | `HarnessUsageWindowRow`                                  | `HarnessUsageWindowView`                                                                   |
  | `harness-manager` (and `/browser`) | `PullRequestRecordRow`                                   | `PullRequestRecordResourceState`                                                           |
  | `harness-manager` (and `/browser`) | `PullRequestWaitRow`                                     | `PullRequestWaitInput`                                                                     |
  | `harness-manager`                  | `PlaceState`                                             | `PlaceStatus` (a run record's place keeps its `state` field, now typed `PlaceStatus`)      |
  | `harness-manager`                  | `placeStateSchema`                                       | `placeStatusSchema`                                                                        |
  | `harness-manager`                  | `readRunRow`                                             | `readRunRecord`                                                                            |
  | `workforce`                        | `WorkerRow`                                              | `WorkerResourceState` (the worker's configuration, as stored)                              |
  | `workforce`                        | `workerRowSchema`                                        | `workerResourceStateSchema`                                                                |
  | `workforce`                        | `parseWorkerRow(value)`                                  | `parseWorkerResourceState(value)`, answering `{ worker }` (was `{ row }`) or `{ problem }` |
  | `workforce`                        | `StandardWorkerRow`                                      | `StandardWorkerResourceState`                                                              |
  | `workforce`                        | `standardWorkerRowSchema`                                | `standardWorkerResourceStateSchema`                                                        |
  | `workforce`                        | `ProjectRow`                                             | `ProjectResourceState`                                                                     |
  | `workforce`                        | `projectRowSchema`                                       | `projectResourceStateSchema`                                                               |
  | `workforce`                        | `WorkerInventoryRow`                                     | `WorkerInventoryResourceState`                                                             |
  | `workforce`                        | `workerInventoryRowSchema`                               | `workerInventoryResourceStateSchema`                                                       |
  | `workforce`                        | `SubscriptionRow`                                        | `SubscriptionResourceState`                                                                |
  | `workforce`                        | `subscriptionRowSchema`                                  | `subscriptionResourceStateSchema`                                                          |
  | `workforce` (and `/browser`)       | `WorkerMessageRow`                                       | `WorkerMessageResourceState`                                                               |
  | `workforce` (and `/browser`)       | `workerMessageRowSchema`                                 | `workerMessageResourceStateSchema`                                                         |
  | `workforce`                        | `WorkerUsageRow`                                         | `WorkerUsageView` (one worker's line in the `workerUsage` query's answer)                  |
  | `workforce`                        | `ReportRow`                                              | `ReportResourceState`                                                                      |

  ### For client developers: values and messages an app branches on or matches

  Code that branches on one of these values, or matches one of these messages, changes when it upgrades. In each message only the noun changes; the rest of the sentence is the same.

  | What                                                                                            | Old                                                                             | New                                                                                                                  |
  | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
  | A task's own hold (`Task.holds[].source.kind`, and the Inbox's `InboxHold.source.kind`)         | `"row"`                                                                         | `"task"`. A hold stored as `"row"` still reads as `"task"` and can still be answered; `"row"` is never written again |
  | Dispatch refusal (`DispatchOutcome.refused`)                                                    | `"external-dispatcher"`                                                         | `"external-flow-runner"`                                                                                             |
  | Owner-private refusal                                                                           | starts "A row of an owner-private …"                                            | "A resource in an owner-private collection is readable only by the user it belongs to."                              |
  | Owner-writes refusal                                                                            | starts "A row of an owner-writes …"                                             | "A resource in an owner-writes collection is written only by the user it belongs to."                                |
  | Startup overlap error                                                                           | `Collection pattern "<P>" can reach the rows of owner-<mode> collection "<Q>".` | `Collection pattern "<P>" can reach the resources of owner-<mode> collection "<Q>".`                                 |
  | Owner-segment refusal ("That segment is reserved for the user an owner-private collection's …") | "… row belongs to, …"                                                           | "… resource belongs to, …"                                                                                           |

  Every other error and refusal message that said _row_ follows one rule: _task_ where the row was a task (dispatch, the task board, the ledger), _resource_ elsewhere, and _collection resources_ for _collection items_. In this release that covers the task board's, the task entry's, the ledger's and the task collection's errors in `orchestration` (and the `listTasks` tool's description a model reads), the Inbox check's drift lines, the dispatcher's and `defineFlow`'s task-entry errors, the faceted and owner-writes collection errors in `core`, the parent-task, owner-run and cross-board errors in `engine`, the schedule-index warning in `scheduled`, the harness manager's superseded-attempt, run-record, worktree-resource, phase-mismatch and foreign-run errors and the scripted coder's steps and commit message in `harness-manager`, the worker inventory's, the shadowed-reference, the hire and roster-loader document, the project-read tool's description and the project-link errors in `workforce`, and the DevTool's "Failed to fetch collection resources" (was "…collection items").

  Docs: every published page and package README that still names a renamed export or value, by page, with the names it uses. Pages: `docs/glossary.md` ("A task is a row", "A project is one row", "One row, in user or org scope", "A resource row") and `docs/resources/collections.md` (the collections pages say _resource_; collections.md also quotes the owner-private and owner-writes refusals and the overlap error, and names `CollectionItemHandle`); `docs/workforce/projects.md` (quotes the owner-writes refusal; `getCollectionItemContent`); `docs/orchestration/task-substrate.md` (the hold marker `"row"` is `"task"`, and its refusal tables' `external-dispatcher` is `external-flow-runner`); `docs/advanced/concurrency-policies.md`, `docs/server/background-work.md` and `guides/keeping-a-flow-running.md` (`external-dispatcher`); `docs/tools/coding-agents.md` (`planRowsPrefix`, `readPlanTarget`'s `rowsPrefix`); `docs/fundamentals/state-and-scopes.md` (`readCollectionItem`); `docs/api/client.md` (`CollectionItemState` and the client methods `listCollectionItems`, `createCollectionItem`, `getCollectionItemState`, `getCollectionItemContent`, `deleteCollectionItem`); `docs/client/overview.md` (`listCollectionItems`, `getCollectionItemState`); `docs/client/react.md` (`CollectionItemHandle`, `useResourceCollectionItem`); `docs/resources/client-access.md` (`createCollectionItem`, `getCollectionItemContent`, `deleteCollectionItem`, `useResourceCollectionItem`); `docs/workforce/delegating-work.md`, `docs/workforce/inventory.md` and `docs/workforce/ui.md` (`listCollectionItems`); `guides/writing-ui-stories.md` (`resources.listCollectionItems`, `getCollectionItemState`, and the story fixtures `loadingRowsSource` and `failingRowsSource`, now `loadingResourcesSource` and `failingResourcesSource`); `docs/workforce/messaging-workers.md` (`workerMessageRowSchema`); `docs/orchestration/harness-manager.md` (its readiness section: `HarnessReadinessRow`, `harnessReadinessRowSchema`); `docs/orchestration/task-board.md` (`taskRowView`); `docs/server/schedule-index.md` and `guides/scheduled-dynamic.md` (`ScheduleIndexRow`). READMEs, each with the old names it still uses (the tables above give the new ones): packages/core/README.md (`planRowsPrefix`, `readPlanTarget`'s `rowsPrefix`, `useResourceCollectionItem`, `external-dispatcher`, and a quote of the owner-writes refusal); packages/claude-code/README.md and packages/cursor/README.md (`readPlanTarget`'s `rowsPrefix`); packages/client/README.md (`CollectionItemState`, `listCollectionItems`, `createCollectionItem`, `getCollectionItemState`, `getCollectionItemContent`, `deleteCollectionItem`, `SessionConnectionState`); packages/react/README.md (`CollectionItemHandle`, `resources.listCollectionItems`, `resources.getCollectionItemState`, `useResourceCollectionItem`); packages/orchestration/README.md (`taskRowView`, `rowsInSession`); packages/harness-manager/README.md (`openRowHolds`, `HarnessReadinessRow`, `harnessReadinessRowSchema`, `HarnessUsageRow`, `readRunRow`); packages/workforce/README.md (`listCollectionItems`, `taskRowView`, `workerRowSchema`, `parseWorkerRow`, `WorkerInventoryRow`, `workerInventoryRowSchema`, `subscriptionRowSchema`, `WorkerMessageRow`, `workerMessageRowSchema`, `WorkerUsageRow`, and a quote of the owner-writes refusal); packages/engine/README.md (`no_row`). packages/workspace/README.md (a worktree record is `WorktreeResourceState`, its `state` field typed `WorktreeStatus`, parsed with `worktreeStatusSchema`).

- 13e3970: A block's own `ctx` passes to any helper typed `BlockContext`, with no cast, however the block is typed (FIX-2457).

  - **core:** a block with `uses: [capability]` hands its `ctx` to a `BlockContext` helper (`resolveResourceCollection`, `getOrCreateTaskCollection`, `waitOnTask` and the rest). Before, a capability that declared no targets gave the block an open `ctx.targets` that no helper accepted, so the call needed `ctx as never`. A block that uses such a capability now reads a closed `ctx.targets`, as a block with no targets always did.
  - **core:** a block that declares `targetStateSchemas` passes its `ctx` as a `BlockContext` too, and its own `ctx.targets` keeps exactly the handles it declared. A helper's plain `BlockContext` reads `ctx.targets` as an open map of untyped handles (`Record<string, StateRef | undefined>`); it was `Record<string, never>`.
  - **core:** a capability with no `sessionStateSchema` no longer opens the session state of a block that uses it. Before, the block's `ctx.session.state` gained an index signature typing every key as `any`, though a run fills nothing from that capability. It now carries the block's and its capabilities' declared fields only, which is what a fresh session reads. Reading an undeclared key is a compile error.
  - **core:** breaking for type checks only: `CapabilityPresetCtx<S>` is the consuming block's `BlockContext`, with session state `S` from the capability's `sessionStateSchema`. A preset callback (`tools`, `controlTools`, `context`, `model`, `providerOptions`, `caching`) passes its `ctx` to `BlockContext` helpers and reads `ctx.request`, `ctx.signal` and the rest typed. A key `BlockContext` does not declare is now a compile error instead of `any`, and a hand-built partial context no longer satisfies the type: build one with `createTestContext` from `@flow-state-dev/testing`. The runtime always passed the full block context; only the type changes.

  Docs: apps/docs/docs/fundamentals/type-system.md (_When to reach for `LooseBlockContext`_: a typed block, one with targets or capabilities included, passes its `ctx` to a `BlockContext` helper as it is; stop sending readers to `LooseBlockContext` for typed targets), apps/docs/docs/fundamentals/capabilities.md (a preset callback's `ctx` is the block's `BlockContext`, session state typed from the capability; test one with `createTestContext`), packages/core/README.md (the `BlockContext` and `LooseBlockContext` entries, and `CapabilityPresetCtx`). FIX-2457.

### Patch Changes

- 2cb6326: A coding task can wait for its pull request to merge before it completes (FIX-2578).

  - **harness-manager:** new option `awaitPullRequests` (off by default). When it is on, a task whose run opened a pull request does not complete at its settle. It waits on its pull requests, and each wake reads them through `gh`: all merged completes the task with no new run; none open with some merged completes it and the output notes the closed ones; all closed without merging cancels it with the reason "its pull request was closed without merging"; any still open runs the wake's words as a steer on the same attempt and session, then waits again. A pull request that can't be read never settles the task: it runs the steer, waits again, and adds a status note. A completed run's output gains `pullRequests` (`{ url, number, title, state }[]`, `null` when no wait ran).
  - **harness-manager:** `pullRequestWait(row, records?)` and `PULL_REQUEST_EVENT`, from the package root and from `./browser`, read a task's open pull-request wait for a screen: the hold, when it opened, and each pull request's number, link and title. `CLOSED_WITHOUT_MERGING` is the cancel reason.
  - **orchestration:** a new row hold, `external`, for a running task that waits on something outside the board. It is the system's (`actor: "system"`), never a question: the filer is not told of it, the Inbox does not list it, and `waitsOnUser` is false. It holds the row as a question does (no lease, unclaimable, the waiting turn cannot settle). Open one from the turn holding the claim with `waitExternally(ctx, ledger, { prompt, events })` (`./task-board`) or `ref.awaitExternal(id, wait, { claim })`. A user's line in the task's session answers it, and so does an answer from `"service"`. New readers `holdActorOf(row)` (`"user"`, `"system"` or `undefined`), `externalHoldOf(row)` and `isExternalHold(hold)` from `./tasks`. A board whose only open rows wait on an event ends with the reason `waiting-on-an-event`.
  - **orchestration:** steers and answers gain the source `"service"`, for words from outside the app, with the sender's handle as `by`. A run reads them quoted as the sender's, never as the user's. The filer's answer through `updateTask` on an `external` hold is refused (`wait_is_not_a_question`).
  - **workspace:** `readPullRequest({ cwd, number, repository?, host? })` reads a pull request's `state` and `merged`, a fork's included. `pullRequestHead` also returns `state` and `merged`.
  - **core:** `writePullRequests` keeps a pull request's `state` current: a sighting's state replaces the stored one. Other fields still fill only when null.
  - **workforce:** a message delivered to a task's session whose task waits on an `external` hold answers that wait, as `"service"` from its sender, instead of queueing behind it.

  Docs: packages/harness-manager/README.md (settling: a section "Waiting on a pull request" for `awaitPullRequests`, the four outcomes, the unreadable case, `pullRequestWait` in the `./browser` list, the `pullRequests` output field), packages/orchestration/README.md (the `external` hold beside questions and confirms, `waitExternally` / `awaitExternal`, `holdActorOf`, the `"service"` steer source, the `waiting-on-an-event` reason), packages/workspace/README.md (`readPullRequest`), packages/workforce/README.md (a message to a task waiting on an outside event answers its wait).

- 0454257: Building a flow now warns, once and in dev only, when a caller action's block is a generator with no `itemVisibility` (FIX-2452). Such a generator emits no items, so a chat mounted on the action renders nothing. The warning names the flow, the action and both fixes: `itemVisibility: { client: true, history: true }` to show the reply in chat, or `itemVisibility: { client: false, history: false }` to stay headless on purpose. Internal, task, webhook and schedule entries are not warned, nor is anything under `NODE_ENV=production` or `FSD_QUIET_WARNINGS=1`.

  Docs: FIX-2452. `configuration/blocks.md`, beside its `itemVisibility` table: the warning, when it fires, and the two fixes.

- 85ca2a3: `GET /api/flows/:flowKind/requests/:requestId/status?include_result_output=true` returns the request's stored action result, read by the request's id, so a caller holding a request id reads what the action answered without listing the session's requests (FIX-2455). The snapshot gains an optional `result` (`output`, `outputNotRecorded`, `error`, `hasOutput`), the same projection `GET /sessions/:id/requests` sends with that flag; `RequestStatusSnapshot` in `@flow-state-dev/core/types` declares it. Without the flag the snapshot is unchanged and carries no `result`.

  Docs: packages/engine/README.md (the read-only status endpoint row: `include_result_output=true` adds the stored `result`, same shape as the session request list), apps/docs/docs/server/connection-resilience.md (the status endpoint step: the optional `result` behind the flag), apps/docs/docs/api/client.md (the `RequestStatusSnapshot` shape gains an optional `result`)

- Updated dependencies [3ef3979]
- Updated dependencies [da9484b]
  - @flow-state-dev/contracts@0.5.0

## 0.5.0

### Minor Changes

- f1e6315: Resource collections can declare field indexes and look rows up by them with `findBy` (FIX-2532).

  - **core:** `defineResourceCollection` takes `indexes: { name: (key, state) => value }`, or `{ version, value }` to version an index. `ResourceCollectionRef` gains `findBy(index, value)`, which returns the matching instances in key order. New types `ResourceIndexDeclaration`, `ResourceIndexFunction`, `ResourceIndexValue`. `findBy` is a required member of `ResourceCollectionRef`, so a hand-written object typed as one (a test double, a partition view) needs it too.
  - **engine:** the stores `createFlowState` resolves, and those a router built with `createFlowApiRouter` resolves, write every resource row with the entries of every registered index whose scope and pattern match it. On SQLite and Postgres `findBy` reads the index, building it from the collection's rows on the first lookup in each scope; on the memory and filesystem stores it scans. Registration refuses one index name at two versions on collections in one scope whose patterns can match the same keys. `FlowRegistry` gains `indexedCollections()`. `createFindByConformanceTests` in `@flow-state-dev/engine/testing` runs the shared `findBy` cases against a store registry.

- da4a4bb: A worker's conversation can follow a thread on an outside service, and hears each event on it once, as a message from `service:<provider>` (FIX-2534).

  - **workforce:** `subscriptionTools({ providers })` gives the `subscribe` and `unsubscribe` tools; `defineSubscriptionServiceFlow({ kind, provider, installation, trustedBots?, capPerHour? })` builds a provider's service flow, which routes each event through five code screens (`sender`, `own`, `labels`, `words`, `allow`) and delivers once per conversation, under the subscribing session's tenant. A subscription ends on `unsubscribe`, when the thread it follows closes (a PR's closing leaves a subscription to its repository running), or when the task whose session made it fails or is cancelled. See the README's Subscriptions section.
  - **engine:** `fireOwnerRunThrough(host, run)` starts an internal entry as the user whose stored row it names, only when the row is there, names the same org and tenant, and isn't `enabled: false`; `routeServiceEvent(host, …, { concurrency? })` runs a service flow's entry, reads the owner runs it names, and fires them a few at once, recording each one's failure. `resolveSharedUserCellKey(userId, orgId, flowKind)` is the storage key both read a user's shared rows at.
  - **core:** `subscriptionEventSchema` / `SubscriptionEvent`, the normalized event a webhook or a poll maps into.

- 5f569fd: A task's session tells what a person said from what the task was handed (FIX-2574, FIX-2575).

  - **core / engine:** an action's `userMessage` can return `{ text, metadata }`. The echo is still the request's `user` line, and it carries `metadata` for a client to read. A plain string works as before.
  - **orchestration:** a steer from a person (sent from a screen, or a coding review's request for changes) now shows in the task's session as a `user` line with their words alone, not as an assistant line reading "Message from the user: …". A filer's or the board's steer reads as before. **Breaking:** `showTakenSteers` is now async; await it.
  - **workforce:** a task request's opening `user` line (the task as filed, or re-queued with its steers) is marked as the task's brief. Read it with `taskBriefOf(item)` from `@flow-state-dev/workforce/browser` to draw it as a brief, not as the person's line.

- 844a4f9: Screens can read again when something they show changes, without polling on the Node host (FIX-2428).

  - **client:** `fsd.subscribe(topics, { onChange, pollIntervalMs? })` calls `onChange` with the notice that woke it (`{ topic, kind, origin? }`), or `null` for a connect, a reconnect or a timer tick. Build topics with `topic.session(id)`, `topic.user()` and `topic.org()`, now exported from the client too. On a host with push, one WebSocket per client carries the notices, signed in through the client's fetcher; elsewhere `onChange(null)` runs every `pollIntervalMs`. `FlowCapabilities` gains `push`. **Breaking:** `fsd.stream()` is removed. It never worked (the server answered 501); use `fsd.subscribe()`. `UserStreamOptions`, `UserSSECallbacks` and `UserStreamHandle` are removed with it. Migration: replace `fsd.stream({ onResourceChanged, onScopeStateChanged, ... })` with `fsd.subscribe([topic.user(), topic.org()], { onChange: () => reread() })`, and read what you show in `onChange`. A notice carries no rows, so the read is what tells you what changed.
  - **react:** `useSubscription(topics, read, { pollIntervalMs?, enabled? })` runs a screen's read again on a change, one read in flight and one waiting.
  - **node:** `serve()` serves the change-notice WebSocket at `<basePath>/users/:userId/stream`. New options: `push` (default `true`) and `pushSecret` (default `FSD_PUSH_SECRET`, then a random key), which every process behind one address must share.
  - **engine:** `GET /capabilities` answers `{ userStream: false, push }`. `POST /users/:userId/stream` checks each topic with its scope's read check and answers a short ticket for the granted ones; a refused topic is left out, as a missing session is. `GET /users/:userId/stream` answers 426 instead of 501. `enablePushDelivery(router, { secret? })` turns push on for a host that serves the socket.
  - **contracts / core:** the push wire types (`PushCapability`, `PushMintAnswer`, `PushServerFrame`, `PushClientFrame`, `WireNotice`). **Breaking:** the user-stream event types `UserStreamEvent`, `UserEventBase`, `UserResourceChangedEvent`, `ResourceContentUpdatedEvent`, `ResourceContentCreatedEvent`, `ResourceContentDeletedEvent`, `ScopeStateChangedEvent`, `UserDebugEvent` and `UserPingEvent` are removed; `StreamEvent` is `RequestStreamEvent`.

### Patch Changes

- 531bf32: A task board's change reaches every open view of the board, from whichever session or process settles the task (FIX-2429).

  - **orchestration:** every change to a board built by `getOrCreateTaskCollection` also publishes a `board` change notice on the topic of the session that filed the row (`Task.filer`, else the ledger's legacy filer, else the running session), narrowed to the board's `collectionId`. A screen subscribes `topic.session(conversationId, { resource: "tasks" })` and reads again. Nothing to wire: the `task-change` item is unchanged. The board's `listTasks` action (a client's read, not the model's tool) also answers each row's `updatedAt`, so a client holding a row from two sources keeps the newer.
  - **engine:** the block context carries the seam that publishes a board notice on the running request's bus, under its tenant, with the request as `origin`.
  - **react:** **Breaking for a hand-built client slice:** a live `BoardList`'s `client` takes `subscribe` in place of `sessions.stream`. A client from `createClient` works as before. The list now hears a task that settles in another session or process, never wakes on a reply streaming in the session, and reads every 3 s where push can miss a change. `useSubscription` takes `client`, for an app that builds its own client, and hands `read` an `AbortSignal` that aborts when the subscription ends.
  - **core / contracts:** `ChangeKind` gains `"board"`; `publishBoardChange` and `BOARD_NOTICE_SEAM` (framework-facing) in `@flow-state-dev/core/types`.
  - **shift-manager:** the conversation's task panel and task cards read on board notices; they keep their 3 s timer only while a task is open, and only where push can miss a change.

- 05a7022: An action's optional `taskOf(input)` names the task a request is for, and the request's user message and items carry it as `taskId`; Workforce's built-in doors take an optional `taskId` through `doorTask`, and the inventory row says so as `doorTakesTask` (FIX-2422).
- c67aa49: `fsdev run` says why an `intent/*` model has nothing to resolve to when no `fsdev.config.*` is found (FIX-2451). After the run's error, stderr names the directory searched, says that the file which calls `createFlowState` is not read, and points at default-exporting `createFlowState(...)` from `fsdev.config.ts` or passing `--config <path>`. `--quiet` suppresses it. Runs that load a config, and failures of any other kind, are unchanged.

  `@flow-state-dev/core` now throws that resolver failure as `UnresolvedIntentError`, a `FlowError` with `code: UNRESOLVED_INTENT_CODE` (`"unresolved_intent"`) and `details.intent`, so callers can recognise it without matching the message. Both are exported from the `@flow-state-dev/core/errors/unresolved-intent-error` subpath, not the package root. The message is unchanged.

- Updated dependencies [531bf32]
- Updated dependencies [bc65135]
- Updated dependencies [5f569fd]
- Updated dependencies [844a4f9]
  - @flow-state-dev/contracts@0.4.0

## 0.4.0

### Minor Changes

- e0daf6e: Stores profiles take a `bus` slot: a change bus that carries notices that something under a session, user or org changed (`ChangeBus`, `ChangeNotice`, `BusTopic`, `createInMemoryBus`). Every request and session write publishes on its session's topic, through `withChangeBus`, which `resolveStores`, `createFlowState`, `runAction`, BullMQ's job processor and `fsdev run` / `chat` apply. The session stream (`GET /sessions/:id/stream`) now reads when a notice wakes it, at most once a second; on a bus that crosses processes it reads nothing while the session is idle. The in-memory bus, the default and the only one that ships today, keeps the once-a-second read as well, so nothing changes for a deployment that sets no `bus`. A `bus` adapter declares `"bus"` in its capabilities and resolves `{ bus }`. `@flow-state-dev/contracts` (re-exported by core) adds `ChangeKind` and the wire topic constructors `topic.session(id)`, `topic.user()` and `topic.org()` (FIX-2426).
- 151309c: Harness readiness: which coding harnesses can run on this machine, and what to do about one that can't. Core adds the neutral `HarnessReadiness` and `HarnessReadinessCheck`. Each integration ships a check: `checkClaudeCodeReadiness`, `checkCodexReadiness` and `checkCursorReadiness`, each with its sign-in remedy. `@flow-state-dev/harness-manager` adds `harnessReadiness(slots)`, which checks once and re-checks on request. It also adds `harnessReadinessAction` for a read with Re-check, `harnessReadinessCapability` for the coordinator's context, `formatHarnessReadiness` for the start log, and `refusal(harness)` for a coding flow's pre-start gate (FIX-2391).
- 824ce87: `resourceTools()`'s `readResource` now reads only from a collection that opted in with `llmReadable`, and leaves out the fields the collection names in `secret`. A path into a collection that didn't opt in answers as a path no collection matches. Mark a collection `llmReadable: true` if a model should read its state through this tool (FIX-2436).
- 7d92efe: A harness run reported without a `runId` gets a `settled_…` id when the request counts it. Request-end hooks, `readRequestSpend`, and a continuation that recovers the run from the log all see that same id. A request's record now carries its harness runs across a suspension or an interruption (`spentHarnessRuns`), as it already carried model calls. The new `readRequestTotalSpend(ctx)` reads everything the request has spent across all its runs, so a record of the whole request, such as a harness turn, reads the same after a resume (FIX-2398).

### Patch Changes

- 387bee2: A durable sequencer saves its state at a suspension, and restores it before the resumed step runs. A `patchState` a step makes before `ctx.suspend()` or `ctx.suspendForUser()` is now kept across a restart, and the re-run of that step reads it. Sequencer-state writes the step made before the pause (including `incState` and `pushState`) apply once: when the re-run reaches the pause, the sequencer's state is set back to what was saved there, and writes after it apply as usual. A request that was already parked before this change resumes as it did before (FIX-2444).
- 6c4a3b3: A conversation's line about a task now says which task it is, as data, so an app reads it without parsing the words (FIX-2378).

  - `ctx.emit.message(text, { metadata })` attaches `metadata` to the message item. Clients read it; the model never sees it. `EmitMessageOptions` is exported from core.
  - Orchestration adds `noticeMetadata(notice, task)` and `parseNotice(item)` beside `noticeText`. `parseNotice` returns the task, its ending, title and what came back, and still reads lines stored before this from their words.
  - Workforce marks every task line it emits, and a delegate's answer carries the worker and the task it answered. Read it with `delegateAnswerOf(item)`, from the root or `./browser`.

- Updated dependencies [e0daf6e]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
  - @flow-state-dev/contracts@0.3.0

## 0.3.0

### Minor Changes

- 92b2b70: A conversation longer than its history window can keep what it said before the window (FIX-1613). `utility.historySummary({ summarize })` returns a `capability` for the generator that answers and a `fold` step to run before it: the fold writes the turns about to leave the window into a running summary, the capability hands that summary to the model and starts the generator's history after it. A capability preset may now declare `history` (a query added to that generator's history reads; generators only). The engine records `historyStart` on a request when earlier turns are out of view, exposes `ctx.session.window`, `ctx.session.items.turns()` and `history({ afterRequestId })`, and the client's request summary carries `historyStart`. Workforce's `defineAgentWorkerFlow` takes `beforeAnswer`, a block run before the worker answers.
- 5d31955: A flow can declare `reads`: blocks an app runs on a session to look at something the flow computes, stored nowhere. The engine serves them at `POST /:flowKind/:sessionId/reads/:readName`, answering `200 { output }` with no request record and no concurrency slot; any write a read's block tries is refused with `read_only`, and another user's session answers 404 as the action route does. The client calls one with `flow(kind).read(name, input, { sessionId })`. Orchestration adds `taskToolReads(collectionId, resolve)`, the `listTasks_<suffix>` listing as a read, and Workforce's coordinator and agent-worker flows now serve `listTasks_tasks` as a read, so an app polling a conversation's task board no longer stores a request per poll. The action of the same name is unchanged (FIX-2286).
- bea14a0: A coding harness's plan now lasts as long as its conversation. Core adds `harnessConversationNamespace(conversationId)`, `planConversationPrefix(conversationId, key?)` and `readPlanTarget(requestId, markers)`, which finds a request's plan from the pointer its run left (`conversation` on the run's `observed-plan-list` marker) or falls back to the request's own per-run rows. Plan rows gain a nullable `requestId`, the request that last wrote them, and `replacePlanList` takes it as an option. The Claude Code block (`recordWork`) keys plan rows by its session id and the Cursor block (`recordPlan`) by its agent id, so a later turn keeps the titles and progress an earlier one recorded; file-operation rows stay per run (FIX-2259).
- 24afa6e: A question is one kind of task hold (FIX-2317, FIX-2131, FIX-2133). The two ways to stop for the user are named for what stops, and a task's open stops live in one list.

  - **`suspendForUser`** (new) suspends the request and resumes it with the answer: `ctx.suspendForUser({ kind, prompt, deadline? })` in `core`, `suspendForUserOn`, `createSuspendForUserTool`, `SuspendForUser`, `SuspendForUserOptions`, `SuspendForUserContext`, `SuspendForUserCancelled`, and `SuspendForUserKind` / `suspendForUserKindOf` (`contracts`, re-exported by `core`). `kind` is `"approval"`, `"review"` or `"input"`.
  - **`holdTaskForUser({ question })`** holds the task until the user answers, built with `createHoldTaskForUser`. The turn ends; the next turn on the same attempt spends no retry.
  - **`Task.holds`** lists what stops the task being claimed until the user answers. There is no `kind` field on a hold: an entry is told apart by `source.kind` (`"row"` or `"suspension"`) and `ask.kind` (`question`, `confirm`, `approval`, `review`, `input`). `getTask`, `listTasks` and Inbox items list `holds`.

  `createTask({ questions })` files a task that stays `pending` until each question is answered: a plain string is a question, `{ kind: "confirm", prompt, onNo? }` asks for a yes or a no. Answer with `updateTask({ id, answers, message })`. The Inbox client's `answerOne` takes `questionId`. A deadline applies only when the host sets `userDeadlineMs`.

  **Breaking, from the last publish.** The `parked` status is gone, with `counts.parked`, `TaskCollectionRef.awaitReview` / `unpark`, `board.unparkAndDrain`, a board's `onReview`, and `@flow-state-dev/react`'s `BOARD_STATUS_COLUMNS` `parked` column. Ask for a review with `ctx.suspendForUser({ kind: "review", prompt })`. The filer's hold is unchanged: status `held`, `hold()`, `release()`. `keptOpenBy: "suspended"` means the task's own request is suspended. Stores are reset: a stored `parked` row is not read. Also removed with `parked`: `TaskTransitionOptions.refuseWhenParked`, `CheckBoardOptions.excuseParked`, the `"parked-for-review"` termination reason, the `"review_requested"` change kind, the `"parked"` write-decline reason, `unparkAndDrainInputSchema` / `UnparkAndDrainInput`, and the task-board exports `TaskBoardOnReview` and `assertParkExitSupported`. React no longer maps a legacy `awaiting_review` card status. `TaskClaimTicket.turn` is required: every claim advances the row's `turn`, and a ticket from an earlier turn of the same attempt is declined `lost-claim`.

  A row stored with `questions` still reads as `holds` (`withRetiredShapes` from `@flow-state-dev/orchestration/tasks`). Shift Manager and the DevTool read them as holds.

- e2c190e: A running coding turn can take a message mid-turn (FIX-2254). Core declares the optional harness hook `onSteerable(steer | null, ctx)` (`HarnessSteer`, `HarnessSteerHook`): a harness whose run can take a line calls it with a `steer` that answers `"delivered"` or `"refused"`, and with `null` when the turn is over. `cursorAgent({ onSteerable })` offers Cursor's own run steering on local runs, through the `env` process too. The harness manager hands down `onSteerable` as an optional fifth feed; passed through, a message sent to the task while a step runs goes straight into that step, with no stop, extra step or new attempt. A line the run refuses is taken by the next step, as before.

  `autoResume: false` on an action (core's `ActionCore`, honoured by the engine) keeps a request on it from becoming its session's auto-resume target (`latestRequestId`), so a control sent beside a running request, such as that line, doesn't stop a reloading client from reattaching to the running one.

  Any app can steer a harness turn run in a session: `harnessSteering()` in core keeps each session's offer and builds the `steer` action (`{ taken, live }`), and the client's `sendHarnessLine` and `steerRunningTurn` send a typed line into the running turn, falling back to the next turn when it isn't taken.

- 0d55d46: A session keeps a record of the pull requests it opened (FIX-2268). Core adds the `observed-pull-requests` collection (`observedPullRequestsCollection`), one writer (`writePullRequests`), a replaceable GitHub rule (`githubPullRequestRule`, `DEFAULT_PULL_REQUEST_RULES`) and the recorder: `recordPullRequests(ctx)` for a block, and `pullRequestRecorder()` for a flow with no harness to add as a `.tap` step. A `gh pr create` command or a `create_pull_request` tool whose output holds the link is one row, written as the call settles. Each row carries the `requestId` that opened it.

  The Codex, Claude Code and Cursor blocks record by default; `recordPullRequests: false` turns it off. Workspace adds `recordBranchPullRequests`, a host-side check that asks GitHub through `gh` which pull requests a checkout's branch has. The harness manager declares the record and runs that check before its verdict and when a run fails.

  **Migration.** A Codex, Claude Code or Cursor block now declares the `observed-pull-requests` session collection by default. A test that asserts the block declares no resources must pass `recordPullRequests: false`.

- 58ffc93: Add `block.as({ name?, description? })`: a copy of any block under a new name and/or description, for showing it to a model as a tool or registering it under a catalog key that must match its name. The copy's name is used everywhere, in tool calls, items, traces, errors and resume; the original block is unchanged. No wrapper is added at run time (FIX-1811).
- f97b0ed: The task board's last old words are gone (FIX-2246), with no alias and no old spelling read. Stores written by an earlier version are not upgraded: a request left in flight across the upgrade may not resume.

  - `@flow-state-dev/workforce`: a coordinator's routing record and a routed task's brief name the message by `messageRequestId`.
  - `@flow-state-dev/orchestration`: a task notice's waited-on flag is `waitedOn`, the word `listTasks` uses. A wait gate's id starts `wait:`. The board's dispatch blocks are named `<board>-dispatch-<assignee>` and `<board>-dispatch-fallback`.
  - `@flow-state-dev/core`: `isWaitGate` is true only for a gate with the reason `"wait"`.
  - `@flow-state-dev/engine`: a wait gate the waiting turn's own conversation resolves records `wait:<session>` as its resolver.

- 62133c4: Add the `hold` and `defer` concurrency policies. A `hold` request runs at once and marks its key busy while it runs; it never waits and is never refused. A `defer` request waits until nothing on its key is running or waiting, then runs, so follow-up work for a conversation lands after the current reply instead of beside it. Deferred requests run one at a time, and the wait ends when the request ahead settles, or when a crashed process's place on a shared lease backend expires. At most 32 deferred requests wait on a key per process; the next is refused with the new `ConcurrencyDeferLimitError` (a `ConcurrencyRejectedError`). A deferred request yields to newer `hold` requests for 30 seconds, then waits only for the ones it found. Both policies apply to in-process runs; a run handed to an external dispatcher under either runs as `allow` (FIX-1834).
- d5ce1e0: A worker can answer a question from another of the user's conversations without waking it (FIX-2173).

  - `requestHost.sessions.history(sessionId, { limit })` reads a session's finished turns, oldest first, with `asOf` and `running`. Like `sessions.read`, it answers only for the caller's own sessions; anything else reads as `undefined`.
  - `utility.consultSessionHistoryTool()` (core) reads that history under a hard token budget (default 24,000) and answers on one tool-less generator, `intent/utility` by default. It returns a reading as of a time, and writes nothing to the other session.
  - `consultSessionsCapability(installation)` (workforce) puts it on a worker's turns as `consultSessionHistory`, with `of` naming a worker, `{ task }` or `{ session }`. Its `consult` preset is off until a worker's `WORKER.md` names `consultSessions: [consult]`. Set `models: { default, intents: { utility: [...] } }` in `createFlowState` to pick the cheaper model.

- 5492a77: A board can start work on another worker now: on a board that dispatches (a Workforce conversation's, or one built with `{ dispatches: true }`), a task is handed over as soon as it is filed, and one filed held waits until it is released. Filing a task never waits: it refuses `waitForResponse` and `timeoutMs` by name. The wait names are renamed with no alias (`canHoldAsk` → `canHoldWait`, and the rest of the `Ask` names to `Wait`) (FIX-1875).
- 6819520: A task board that starts a row on another worker now **dispatches** it; **hand-off** means only passing work that is already under way (FIX-1876).

  - The board's ending for "every remaining row is running in a dispatch run" is now `terminationReason: "dispatched"` (was `"handed-off"`).
  - The row-dispatch block's output is now `{ dispatched: true, taskId, sessionId, requestId, adopted }` (was `handedOff: true`).

  The old exports are gone, with no alias, so an import of one fails to compile and names it:

  - `@flow-state-dev/orchestration`: `createHandOff` → `createRowDispatch`, `HandOffOptions` → `RowDispatchOptions`, `HandOffAssignee` → `DispatchingAssignee`, `handedOffTaskPredicate` → `dispatchedTaskPredicate`, `assertHandOffBoardSupported` → `assertDispatchBoardSupported`, `assertHandOffBlockSupported` → `assertDispatchEntrySupported`, and the board handle's `handedOff` → `dispatchers`.
  - `@flow-state-dev/core` and `@flow-state-dev/engine`: no export changes. Definition-time and run-time refusals say a block "dispatches to task:…" where they said it "hands off to task:…".

  The task-board page's "Assignees that hand off" section is now "Assignees that dispatch"; the old anchor still lands on it.

- ad5df6f: Durable execution is on by default wherever stores persist (FIX-2063). `createFlowState` over filesystem, SQLite or Postgres stores now installs the checkpoint durability provider without `durable: true`; over in-memory stores it still installs none unless `durable: true` is set. `resolveDurabilityProvider({ stores, durable })` exports the rule for hosts that build `createFlowApiRouter` or call `runAction` themselves, and the in-memory checkpoint and suspension stores declare `persists: false`.

  `ctx.suspend()` on a host without durable execution now throws an error that names the rule and the setting to change, instead of "requires a DurabilityProvider". The durability sweeper arms for a pending stop's deadline as it does for a wait's, and reads the store's deadlines once at start.

  A no-config `fsdev run` now writes to `.fsdev/data/fsdev.db` (the SQLite file `fsdev dev` reads) instead of JSON files under `.fsdev/data`, and runs as `devuser`, the DevTool's default user (exported as `DEFAULT_LOCAL_USER_ID` from `@flow-state-dev/core`), instead of `cli-user`. `fsdev run` and `fsdev chat` use `devuser` as the default user with a config too. A run that stops for a person exits 0 with a `suspended` NDJSON event, `result.suspended` in `--capture`, and a waiting report on stderr. The no-config `fsdev dev` router is durable and sweeps. `--store filesystem` on `fsdev run` and `fsdev dev` keeps the JSON-file store, single-process.

  **Migration.** An app on persisting stores that never set `durable` now:

  - writes a checkpoint at every step of every sequencer (sequencers already default to `durable: true`),
  - resumes a request that crashed instead of rerunning it,
  - holds a raw `ctx.suspend()` until it is answered, where it used to fail the request,
  - runs the durability sweeper wherever it serves a router: a lease and a scan of pending stops on each tick, even when nothing waits.

  Set `durable: false` on `createFlowState` to keep the old behavior. Sessions a no-config `fsdev run` wrote as JSON files are not read by the SQLite default; pass `--store filesystem` to read them. Scripts that look up CLI sessions by `cli-user` should use `devuser`, or pass `--user cli-user`.

- 211679a: New core block kind: `evaluator` (FIX-1554). It asks an evaluation model typed questions (`choice`, `score`, `boolean`) and returns typed answers, with the model's confidence when it reports one. Model strings resolve through your existing providers and gateways; models that can only generate are refused before any call. `BlockKind` and the trace's `blockKind` gain `"evaluator"`: code that switches on block kind should handle it. `ai` minimum raised to the first release with evaluation. `@ai-sdk/typesafe-ai` is an optional peer. `ModelResolver` gains an optional `resolveEvaluationModel`; a custom resolver without it runs generators as before and refuses evaluator model strings. Evaluation through Vercel's AI Gateway needs `@ai-sdk/gateway` 4.0.85 or later. `@flow-state-dev/testing` adds `mockEvaluationModel`.
- 2ce15c7: Every ending of a delegated task reaches the session that filed it once, on any flow, and nothing a board owes waits for someone to touch it (FIX-2078).

  - **`onTaskSettled`.** A board that hands rows out records each ending's notice in the ending's own write and sends it to the filing session's `onTaskSettled` internal action. Build that action with `taskSettledEntry({ block })` (exported with `taskSettledInputSchema` from `@flow-state-dev/orchestration`): it takes each notice once, runs your block, and acknowledges it. A filed task now records the session that filed it (`Task.filer`, server-written).
  - **Cancels are heard.** A cancel the filer didn't make itself through its own task tool now sends a `cancelled` notice, and a failure or cancel notice names the dependents it cancelled (`cancelled`). A waited-on task resumes its waiter and sends no notice; a retry sends none.
  - **Due times.** Each owed notice has a due time, two seconds after its ending (`NOTICE_DUE_MS`). The board's pass resends only what is past due, and on a durable host the engine's wake pays it when due, after a crash too. One pass runs at a time per session; a pass asked for while one runs waits its turn.
  - **Workforce:** a final task failure goes to the Error Reporter's intake with its ending, before the notice is acknowledged, as the task occurrence it already dedupes. A report marker stored by an older version is sent once and dropped. A ready row starts on its own, without a touch.
  - **Upgrade.** Call `backfillBoardWakes(stores, { userCell })` (`@flow-state-dev/workforce`) once at host start, after the router is built: it owes a wake for every session holding a notice, report or split settle stored before this release, so its pass pays it without a touch. It is idempotent (a wake coalesces, and a pass that finds nothing clears it), and reads every user's conversation rows, so a host with many users runs it once, as a migration step. Shift Manager calls it at start.
  - **Core:** `RequestHost.wakes` (owe, read, settle, `maxDebtAgeMs`), present on durable hosts whose stores keep wakes, and `TaskBinding.requiresInternal`.
  - **Task tools:** a task's metadata from a caller (a tool call or a `_tasks` action) can't set or clear a notice marker. `cancelTask` answers `{ ok: true, cancelled: [ids] }` when its cancel also cancelled dependents. A notice its entry keeps refusing is resent with a doubling gap, up to 5 minutes.

  Migration, at upgrade, for teams outside the repo:

  - `resumeOwedWaits` is removed: the board's due-time wake pays an owed resume and a cancel owed.
  - A board that hands rows out (a dispatcher assignee, or a delegation board) on a flow with no `onTaskSettled` internal action is refused when the flow is built. Add `internal: { actions: { onTaskSettled: taskSettledEntry({ block }) } }`.
  - An `onTaskSettled` handler now receives `cancelled` endings.

- a55d07f: `defineFlow` now throws when the flow's own `resources` map declares an accessor a block also declares, with a different `defineResource()` reference. The flow's entry used to win silently, so the block read and wrote a resource it never declared. Use the block's reference, or pick a distinct accessor key (FIX-1586).
- 7db4d13: `defineFlow` takes `resourceVisibility`, a per-turn rule for which of the flow's resources the model's resource tools reach. A resource it hides is absent from listing, search and the discovery door, and answers "not found" when named; a read-only one is read but not written. Omitted, nothing changes (FIX-1788).
- fe5df7d: A request waits on a task it filed with `getTask({ id, wait: true, deadline? })`, now or in a later request, and gets the task back once it ends or as it stands at the deadline (FIX-2082). The deadline cancels nothing: the task runs on, and an ending that lands while the request still runs reaches it on its next `getTask`; one it never reads goes to `onTaskSettled`, once. A task's own request may wait too, and waits nest up to five deep, counted live. A wait's deadline is a wake on the waiting session, so a restart keeps it. Use `waitOnTask(ctx, board, id, { key })` from `@flow-state-dev/orchestration/task-board` when the wait is in application code rather than a tool.

  - `dispatcher({ wait: true })` waits for the request it starts and outputs `{ status: "completed" | "failed" | "running", output?, error?, requestId }`.
  - On a plan board a row filed `session: "new"` runs in a session of its own through `taskBoard({ newSession })`, and the drain waits on it. A plan board may hold dispatchers, whose rows it waits on; a plan board's dispatcher with `wait: false`, and a delegation board's with `wait: true`, are refused. In Workforce, a worker's step filed `session: "new"` runs in a new session of the same worker.
  - `canHoldWait(ctx)`, `dispatchWaitResultSchema` and `DispatchWaitResult` are exported from `@flow-state-dev/core`; `RequestHost.waits.ended(requestIds)` says whether a request has stopped running its work, and `checkWait` (orchestration) runs a wait's checks alone.
  - Hosts set a wait's deadline bounds with `waitDeadlines: { defaultMs, minMs, maxMs }` (5 minutes, 1 s, 24 h by default). A wait needs a store that keeps wakes. `parkOnWait` takes a `deadline` (epoch ms) and returns the `WaitOutcome`.

- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
- 3a6c910: New `GET /api/flows/users/:userId/interrupted-requests` lists a user's interrupted requests every time it is called, including ones a sweep marked before the call; `check-interrupted` still sweeps and answers only what that call marked. Both lists now name each request's `flowId` (falling back to `flowKind` for older records). `RequestStatusSnapshot` gains `sessionId`, and the status route now answers 404 for a request in another tenant or of another principal. New `createInProcessFetch(app, { basePath? })` returns a fetch-shaped function that dispatches to the engine in this process, for a client's `fetcher`; `@flow-state-dev/node`'s `createServerApp` dispatches through it (FIX-2162).
- 849f6ec: Built-in model defaults move to the current generation (FIX-2050). `utility.sessionTitleGenerator`, `utility.decomposer`, the `planAndExecute` / `routedSpecialists` pattern defaults and `workingMemoryObserve` now default to `gpt-6-luna`, as do Shift Manager's Lab default model (`LAB_DEFAULT_MODEL`) and its DevTeam workers (previously `gpt-5-nano`, `gpt-5.4-mini`, `gpt-5-mini` or `gpt-4o-mini`). Pass `model` explicitly to keep the old one. The cost tables in `core` and `testing` now price `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna` and Claude Opus, Sonnet and Haiku 5.5.
- 028af6f: **Breaking:** model strings now name a route with a colon, as in the AI SDK (`vercel:anthropic/claude-sonnet-5`, `openai:gpt-5.4`, or a `providers` key such as `triage:native`), multi-hop `gateway/provider/model` slash strings are rejected with an error naming their colon spelling, and `ParsedModelString` is now a discriminated union with no `"gateway"` kind (FIX-1495).
- eb831f8: The scheduled-dispatch endpoint fires each scheduled time at most once across retries, restarts and hosts sharing a SQLite or Postgres store, refuses crons that aren't five fields and unknown time zones, and removes `idempotencyKey`, `idempotencyWindowMs` and `idempotencyOptions`; teams outside the repo rewrite at upgrade, see the migration notes (FIX-2085).
- 7d4c413: Resource collections can be declared owner-private with `ownerPrivate: { param }`, and `ownerSegment(userId)` builds the owner key segment. Key segments beginning `~` are reserved for owner-private collections in every app, and flow registration refuses a single resource whose key has one. `defineResourceCollection` and flow registration no longer refuse collection patterns on Workforce's account, and `@flow-state-dev/core` no longer exports `assertRosterCollectionIsNotDeep`. Workforce's private roster collection is now owner-private; its refusal messages name the owner-private collection instead of the roster (FIX-1549).
- 839e915: A block output or tool result over the new `maxRecordedValueBytes` router option (default 256 KiB) is now recorded as an `omitted` placeholder with its size and a preview while the run keeps the full value, and a resumed request that would need it fails with `RECORDED_VALUE_OMITTED` (FIX-1772).
- 02ee032: Remove backward-compatibility paths (FIX-1804, FIX-850): stores read only the current on-disk and table layouts with no migration of older data, `@flow-state-dev/claude-code` drops its package-root entry and deprecated handle aliases, `@flow-state-dev/patterns` drops `legacyWorkerAdapter` and `executableTaskSchema`, and removed options such as `clientData`, `requireOrg`, `presets`, `preset/*` model strings, `prefer` and `fileFilter`/`syncMode` are no longer refused by name.
- 16bb676: `SkillState.agents` and the `AgentSpec`, `Agent`, `AgentRegistry`, `AgentOverrides`, `MaterializeAgentFn`, `MaterializeAgentOptions`, `PersonaSource` and `PersonaInlineConfig` types are removed with skill sub-agents; delegate to workers through the task board instead (FIX-1814).
- 9510a03: Requests now carry `ctx.request.incarnation`, a token that stays the same across a request's retries and resumes and that request-scoped workspace keys and local `scope: "run"` bash directories now include, so a request reusing a deleted request's id starts empty; existing run workspaces move once on upgrade, and a run in flight at deploy continues in an empty directory (FIX-1286).
- 1027b98: A block that declares `resources` now gets a `ctx` you can pass to a function typed `(ctx: BlockContext)`, with no cast. Declared refs keep their own types on `ctx.resources`, `get` still accepts only a declared name, and reading an undeclared name is still a missing-property error (FIX-2060).

  `get` and `list` on a declared `ctx.resources` are typed as functions that are also resource refs. Calling them works as before. An object literal you build by hand and type as a declared registry, such as a test mock of `ctx.resources`, no longer compiles if it uses plain functions for `get` and `list`. To test a block, run it with `testBlock` from `@flow-state-dev/testing` and seed its resources, so the block gets the real registry. If you do need a hand-built registry, cast those two members, for example `get: ((name: string) => ref) as any`.

- d1a4cab: The task hand-off envelope (`TaskDispatchInput`) names its entry in `assignee` instead of `seat`, and the discovery tool describes the workers it lists (FIX-1796).
- 3311cc2: `HIRED_ROSTER_BROWSER_PATTERN` and `HIRED_ROSTER_PRIVATE_PATTERN` are now exported from `@flow-state-dev/workforce` instead of `@flow-state-dev/core/types`, and `@flow-state-dev/core` no longer exports `HIRED_ROSTER_PRIVATE_BRAND`, `markHiredRosterPrivateCollection` or `isHiredRosterPrivateCollection` (FIX-1549).
- 60c8192: `getItems()`, `RequestRecord.items` and item subscriptions return `RuntimeItem`, which is `OutputItem` plus trace rows: `block_trace`, `router_decision`, `state_snapshot` and `generator_step` (FIX-2054). Only types change. Runtime behaviour is the same.

  These signatures return or pass `RuntimeItem`, which can break code that expects `OutputItem`:

  - `ResponseEmitterHandle.getItems()` and the `subscribeToItems` listener and filter (core).
  - `ResponseEmitter.getItems()`, `RequestRecord.items` and `RequestStore.persistItems` (engine).
  - The `testItems` selectors that don't filter by type: `all()`, `sideChain()`, `main()`, `byAgent()` and `byVisibility()` (testing). They return trace rows when given them.

  To upgrade, type arrays and callbacks that receive these values as `RuntimeItem`, imported from `@flow-state-dev/core`. Where code needs an `OutputItem`, filter out the trace rows with a type guard:

  ```ts
  import type { RuntimeItem } from "@flow-state-dev/core";
  import type { OutputItem } from "@flow-state-dev/core/items";

  const TRACE = new Set([
    "block_trace",
    "router_decision",
    "state_snapshot",
    "generator_step",
  ]);
  const isOutputItem = (item: RuntimeItem): item is OutputItem =>
    !TRACE.has(item.type);

  const visible = emitter.getItems().filter(isOutputItem);
  ```

  `.waitForCondition` predicates and `wakeOn` filters keep their `OutputItem` types. These signatures accept `RuntimeItem` as well as `OutputItem`: `resolveItemVisibility` and `collapseToCanonicalLog` (contracts, re-exported by core), `testItems` (testing), and the filter that `onTaskChangeFor` returns (orchestration). Existing callers need no change.

  `RequestStreamStore` and `createRequestStreamStore` (client) take the row type as a parameter, defaulting to `OutputItem`, so existing stores are unchanged. A store seeded with trace rows is created as `createRequestStreamStore<RuntimeItem>()`, and its `getSorted()`, `getRaw()`, `getById()` and `getOwnedBy()` return `RuntimeItem`.

- 0503c38: A schedule created with `schedules.create(key, { cron, kind, enabled })` on a `defineScheduleCollection` collection now fires and keeps firing after a reschedule: the resolver reads the row from resource state (`ScheduleResolutionStores` now requires `resourceState`), and a new `stampOrgId` collection option records the creating run's organization on the row, keeps it across updates, and refuses any write that names another organization (FIX-1545).
- 8195995: Schedule index rows are now identified by the storage cell the schedule lives in plus its key, so a person's same-named schedules in two hired seats (or a seat and their app-wide flow) are two rows and turning one off no longer stops the other (FIX-1546). `ScheduleIndexRow` gains a required `cell`, `ScheduleIndex.remove` takes `{ cell, key }` instead of `(userId, key)`, and `CollectionHookContext` gains `cell`, the storage key the instance is persisted under. A custom `ScheduleIndex` must key its storage on `(cell, key)` and store `cell`; the conformance suite covers it. The SQLite and Postgres `schedule_index` tables are re-keyed on `(cell, key)` automatically at schema init, adopting every existing row as its person's own cell; with `skipSchemaInit: true`, apply the upgrade SQL in the schedule index reference. BullMQ scheduler ids are built from the cell and key; an app-wide schedule for an ordinary user id keeps its existing scheduler id.
- 295e96a: A block's `sequencerStateSchema` now joins the state of the sequencer `ctx.sequencer` resolves to (the nearest enclosing sequencer with a `stateSchema`), with its defaults in the initial state, and a capability's `sequencerStateSchema` joins the state of the sequencer that uses it. Composing a chain now throws `SequencerSchemaMismatchError` when a sequencer `stateSchema` field disagrees in kind with a block's or capability's requirement, when two blocks or two capabilities require different kinds of one field, or when such a shared field carries a `.transform()` on one side (share one schema between both sides instead), so a flow that composed such a pair before no longer builds. A durable sequencer resumed from a checkpoint gets schema defaults for the fields the checkpoint lacks (FIX-2039).
- 97894aa: A flow can check every new session's initial state with `session.createCheck`, refuse caller-seeded fields with `session.serverOwned`, and fix a field for a session's life by declaring it `.readonly()` in its session `stateSchema`; `listSessions({ state })` and the list route's `state.<field>` filter select sessions by a readonly field. On a flow that binds its sessions this way (a readonly field or a create check), an initial state that fails the `stateSchema` is refused on every path that creates a session; other flows keep it as sent. A dispatcher's `session: { key, state }` and a task dispatcher's `state` create the child session with that state. `ensureSessionRecord` now takes the create request beside the record it builds (FIX-1788).
- 9ed6b29: A block can stop another request running in its own session with `ctx.session.stopRequest(requestId)`. It records the same stop as the abort route, reaches a request in another process on its next heartbeat, and answers `"stopped"`, `"already-finished"` or `"not-in-this-session"` (FIX-1690). Anything that implements `SessionScopeHandle` itself must add the method.
- b552b50: A dispatched task now settles once, when its work is over (FIX-2077): after its request, the background work that request started and the background work the flow's `onFinished` started have ended, with no task it filed still open or still owing its ending. Until then the row stays `in_progress`, and `Task.keptOpenBy` says what holds it (`"filed"`, `"suspended"` or `"steer"`). A row that waits has no lease, so a task that stops to ask a person or to wait on an event is no longer reclaimed and run again when its lease runs out. The output is the latest `reportProgress` checkpoint, else the last answer that counts; a message's answer never is.

  Orchestration adds `taskRequestAdmission`, `noteTaskAnswer` and `afterTaskCheck` for a request that works on a waiting task, and `endRules` on `createTaskGate` and `taskLedgers`. Core adds `onRequestEnded` (`@flow-state-dev/core/types`), a framework-facing hook the engine runs after a request's last drain, on every way it ends.

  In Workforce a split task stays running while its pieces are open, and its output is its worker's answer like any task's. Read a piece's result from its own row (`listTasks({ filedByTask })`, `getTask`). A failed piece no longer fails its task by itself: the turn its ending wakes decides, and only a turn that throws fails the attempt. A worker that ignores a failed piece completes its task anyway.

- cd180d7: Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, a turn paused on an ask cancels the asked task instead of waiting for it, and a durable host now runs the durability sweeper even without `durabilityRetention`, so a paused request past its `expiresAt` expires and an ask past its deadline times out, while pruning still waits for a retention policy (FIX-1816).
- 872a088: A task board's dispatcher can now choose its entry and its session for each row (FIX-1872). Give a `task` dispatcher an `action` of `{ among, by }` and `by` picks, per row, one of the entries listed in `among`; every listed entry is checked when the flow is defined, and an answer outside the list fails that row with `no-entry`. Give it a `session` of `{ by }` and it answers, per row, `{ key }` for a child session or `{ id }` for a session that already exists. An existing session is delivered into and never created: a missing one, or one the running user can't reach on this flow, fails the row with `session-not-found` or `session-not-addressable`. A string `action` and the `"per-task"`, `"per-worker"` and `{ key }` policies behave as before.
- 30aa133: A task can now be handed to the worker its assignee names, including one hired after the host started (FIX-1778).

  - core: a task dispatcher's `flowKind` may be a function of the task (`TaskFlowTarget`), resolved once per hand-over; an empty answer refuses it `flow-not-found`. A task entry may declare `from` to take tasks from more than one ledger; such an entry runs queued unless it sets its own concurrency. A function `flowKind` requires `session: "per-task"`.
  - orchestration: `taskLedgers({ name, resolve })` builds that `from`, resolving each dispatch's ledger by id and refusing an unknown one before any row is read. A board's `defaultWorker` may now be a task dispatcher, handing a task over under its own assignee. Tasks record `createdBy` (the user whose request added them, server-only), which a hand-over passes to a per-task target as `filedBy`.
  - workforce: `createWorkerLookup({ instanceAt, declared })` says which worker a name means for the running caller, from the live registry; its `flowKind` plugs into a board's fallback.

- d97031f: The suspension reasons that wait for a user are now `"user_approval"` and `"user_input"`, renamed from `"human_approval"` and `"human_input"`. Nothing reads the old values: `SuspensionReason` still accepts any string, so a `ctx.suspend` or a `useSuspensions({ reasons })` filter that still passes an old value compiles but is treated as a custom reason: it is not a user's stop, gets no Inbox item, and an old `"human_input"` stop defaults to approve/reject instead of submit. Search your code for both old strings and replace them. Stored suspensions with the old reasons are not migrated (FIX-2151).
- 49d2aca: A stop that waits for a user holds its task and ends exactly once (FIX-2129).

  - **`ctx.suspendForUser({ kind, prompt, deadline? })`** (`core`): stop the request for an `approval`, a `review` or an `input`. It returns the answer, or `{ cancelled: true }` when the task was cancelled while it waited. At its deadline an approval reads as a no (`deadline: true`) and a review or an input throws `SuspensionTimeoutError`, which the block may catch. With no `deadline`, the host's `userDeadlineMs` applies, else none: the stop waits until it is answered, stopped or cancelled. The model's tool is `suspendForUser`; the task's open stop is listed on `Task.holds`.
  - **The answer route** (`engine`): `POST /api/flows/:flowKind/requests/:requestId/answer` answers a user's stop in any run, a task board's included, after the resume path's ownership checks; a request handle's `answer` (`client`) calls it. Who answered is the signed-in caller.
  - **`userDeadlineMs`** (`createFlowState`, `engine`): the host's deadline for a user's stop, unset by default.
  - **Cancel one stop:** `RequestHost.resumeWait({ suspension: { requestId, suspensionId }, outcome: { cancelled: true } })`.
  - `contracts` exports `isUserSuspension` and `suspendForUserKindOf`, and `SuspensionStatus` gains `"cancelled"`.

  A raw `ctx.suspend` with `user_approval` or `user_input` now gets the same mark, cancel and stop as `suspendForUser`. A raw `user_input` stop past its `timeoutMs` now resumes its block with `SuspensionTimeoutError` instead of staying parked, and a cancelled one throws `SuspensionRejectedError` with `cancelled: true`. A filing by a cancelled task is refused (`TaskFilingRefusedError`, rule `parent_cancelled`). Shift Manager answers every ask through the answer route.

- 3c10d9d: `waitOnRequest(ctx, { requestId, gateId, planKey, deadlineMs?, deadlineAt?, message? })` is exported from core: it parks the running request on the wait gate until another request ends or the deadline passes, the half of `dispatcher({ wait: true })` that waits (FIX-2239). `RequestHost.waits.userStop()` returns the request of the running session parked for a person, if any; the engine implements it. A request's end now also resumes waits in its own session that are bound to it, when the run that ended it had resumed it.
- 96ff077: A turn waiting on another worker's task says **wait** (FIX-1876). `@flow-state-dev/core` exports `WAIT_GATE_REASON`, `isWaitGate`, `WaitGateBinding`, `WaitOutcome`, `WaitEndingErrorCode`, `parkOnWait`, `ParkOnWaitInput`, `parseWaitOutcome`, `recordedWaitOutcome`, `RequestHost.resumeWait`, `RequestHost.hasWaitSweeper`, `ResumeWaitInput` and `ResumeWaitResult`. `@flow-state-dev/orchestration` exports `waitGateId`; a row's wait slot is `Task.wait`, and `listTasks` marks a waited-on row `waitedOn: true`. `@flow-state-dev/engine`: the request host's `waitResume` and `waitSweeper` (`RuntimeConfig.requestHost`).

### Patch Changes

- 20aa58f: A create call no longer records a pull request it only names (FIX-2307). `githubPullRequestRule` reads a `create_pull_request` result's `html_url` (else `url`), so a link in the new pull request's body, such as "Follow-up to …/pull/12", is not recorded as opened. A shell command whose only link-printing `gh` verb is `gh pr create` still records every link it prints. A command that also runs `gh pr view`, `gh api` or another verb that prints links now records nothing from that call, and the turn-end branch check finds a pull request it opened on the session's branch.
- f8df86f: A flow's request and action observers (`request.onStarted`, `request.onFinished`, `onCompleted`, `onErrored`) now run on their own block path, `observer[<owner>.<hook>]`, instead of the action block's `root`. Before, an observer's trace on the root's id read as the action block running twice, and a session read (or a reload) dropped the messages the action block emitted: with `request.onStarted` under lean traces (production's default), and with `request.onFinished` in both trace modes (FIX-2299). `blockPathObserver(hook)` is exported beside the other block path helpers.
- 82eea02: A running coding task now says how it's doing. The harness contract gains an optional `onActivity` hook (`HarnessActivityHook`), called with each completed assistant message and each tool call a run starts; `claudeCodeAgent`, `codexAgent` and `cursorAgent` (tool calls only) take it, and `reportHarnessActivity` / `harnessActivityOf` in `@flow-state-dev/core` map a harness's events to it. `harnessManager` hands the feed and keeps the task's `statusNote` set to the run's latest activity: the first at once, then at most one write per `PROGRESS_NOTE_MS` (30 s), fenced by the run's claim. A slot that builds its harness from named feeds must pass `onActivity` through to get notes (FIX-2290).
- 1abab86: A request suspended inside the model's `waitForUser` tool before it was renamed `suspendForUser` (FIX-2317) resumes when the user answers. Before this, answering it failed with `GeneratorToolUnavailableError`. When the resolved tools have nothing by the old name, the resumed step runs `suspendForUser` under the old name's path, so the stop matches the answer already given. A tool of an app's own that still has the old name resumes as itself. The model never sees the old name.
- 8e67ce5: A worker's call that dies after sending its message and before it parks is continued (FIX-2269). A call (`sendMessage({ wait: true })`) now owes its park through the new optional `RequestWaits.owingPark(work)` before it sends. If the request is then marked `interrupted` while it still owes one, the durability sweeper continues it, and the replay waits on the message it already sent, so the call is answered instead of left waiting forever. A request still owing its park 10 minutes after the first owe is left `interrupted`. History and retention read an interrupted request that owes a park as one that will run again, and stopping it lets the owe go. A repeated call's send now dispatches itself, so the continued call has a request to wait on.
- dd353e2: FIX-2321: An async `onActivity` hook that rejects is now logged like one that throws, instead of escaping as an unhandled rejection that could end the process.
- 3221d05: A dispatched task's background work that errors now fails its attempt (FIX-2088), as if its request had thrown: the task runs again while it has attempts left, otherwise it fails with an error naming the step (`Background work "<step>" failed: ...`). It counts in every request working the task, including steps `onCompleted` and `onFinished` start and a step a default `.waitForSideChain()` already drained. The request itself still reports `completed`. A cancel never fails the task this way, and a step that failed before a suspension counts only if its rerun on the resume fails too. Make a step best-effort by catching inside it.

  Core adds `RequestEnding.backgroundFailures` and the `BackgroundFailure` type (`@flow-state-dev/core/types`), and `RequestSideChainPool.failures()`; the engine hands a request's background failures to its request-end hooks. In Workforce, a failed `afterAnswer` step (such as a memory capture) fails a task's attempt too, except in a task filed `resultTo: "conversation"`, where it is logged and the task keeps its answer. Conversation turns are unchanged. A step a timed-out `.waitForSideChain({ timeoutMs })` stopped waiting on is still waited for before the request ends, and its failure counts and is logged, with `failOnError` too; `drainScope` takes an `abandoned` signal for this. The MOAT bash provider's purge of stale containers now logs a failure instead of throwing it.

- 397cfa7: Boot warnings and the active-profile line now print once per server process, not on every dev hot reload (FIX-1632).
- 53b50f0: New `utility.cascadingRouter` walks a tree of `evaluator` choice questions and sends anything the model didn't answer with enough reported confidence to one required `ambiguous` block (FIX-1558).
- 646f8d2: A harness can declare `stopsOnAbort` on the block it returns (an optional field on core's `HarnessBlock`): when its abort signal fires, the block returns only after its process has exited. `claudeCodeAgent` declares it, and now kills its agent process with `SIGKILL` if it is still running 5 seconds after the abort, then waits for it to exit. A harness manager built without `stopsOnAbort` now reads the harness's declaration, so a line typed into a running Claude Code task stops the run and the same request continues its session with the line. Set `stopsOnAbort: false` on the manager to keep the old behavior, where the line waits for the run's own end (FIX-2312).
- 16a8dab: See how much of Claude Code's subscription is used. Core's `HarnessUsageWindow` gains `level` (`ok`, `warning`, `reached`, or `null`) and its `usedPercent` may be `null` when a harness sends no percent; core adds `HarnessUsageHook` and `HarnessUsageReport`, the run-time twin of `HarnessSessionHook`. `claudeCodeAgent` takes `onUsage` and hands it each window a run's `rate_limit_event` reports, with the run's account; `readClaudeUsage` reads who is signed in for the usage query, and `probeClaudeAccount` takes a `signal` that stops and closes the probe, and marks a `none` it got no answer for with `unanswered: true`. `@flow-state-dev/harness-manager` feeds `onUsage` at both of its harness slots (`HarnessFeeds.onUsage`, now required, so code that builds `HarnessFeeds` itself must add it), writing into the run owner's usage record, and keeps a stored record's account and windows together across a sign-in change. Codex windows now carry `level: null`. Shift Manager's Usage view shows Claude Code's windows, saying "limit reached" or "under Claude Code's warning line" where there is no percent (FIX-2142).
- 456fe85: The resource CRUD tools and `resolveResourceByPath` now reach parameterized collections (`react/observations` for `[topic]/observations`) and nested paths under a `**` collection registered after a `*` one, matching what the full uri already resolved (FIX-1484).
- 9d02ac6: A sequencer's `uses` capabilities now stay reachable at `ctx.cap` after `.connectInput()`; previously calling it dropped them for the whole chain (FIX-1714).
- 8dc242e: `assertEvaluatorBlock(block, { slot, helper, questions })` refuses a value in an evaluator slot that is not an evaluator block, with one message shape shared by every package that takes an evaluator option (FIX-1555).
- 89af7db: **`@flow-state-dev/cursor`** — two opt-in options on `cursorAgent`, both off by default (FIX-1917):

  - `recordPlan: true` records Cursor's to-do list in the run's plan record (`observed-plan`, with its `observed-plan-list` marker): the whole list Cursor last confirmed, one row per place, with Cursor's own status words, written through core's `replacePlanList`.
  - `env` runs Cursor's local runtime in a separate process whose environment is exactly the variables you pass, so commands Cursor runs start with only those variables. It is not a security boundary: the process runs as the same OS user, and on Linux a command can still read the server's environment through `/proc`; use a separate user or a container when that matters. With `env` set, functions in `agent` or `send` and a custom `resolveCursorClient` are refused when the block is built.

  A resume Cursor refuses because it doesn't know the agent now fails with `harnessFailure: "unknown-conversation"`, which core's `harnessFailureKind` reads.

  **`@flow-state-dev/core`** — `harnessRunNamespace(ctx)`, the per-invocation namespace a harness keys its plan rows and list marker under. `@flow-state-dev/claude-code`'s `runNamespace` is now this same function.

- 7d4158f: `FSDEV_DEFAULT_MODEL` no longer throws in `createModelResolver` when an app declares no intents, so an environment that sets it no longer crashes apps and tests that never resolve a model (FIX-1083).
- dd80e01: Evaluators work with `@ai-sdk/gateway` 4.0.108 and later: core now requires `ai` 7.0.133 or later, which sends an evaluator's state the way those versions read it, and an array state still reaches the model as the array it is. Evaluation through Vercel's AI Gateway now needs `@ai-sdk/gateway` 4.0.108 or later in your app. `mockEvaluationModel` hands its `answers` function, and records on `calls`, the state the evaluator evaluated (FIX-1925).
- 5181ddb: An approval that passes its `expiresAt` no longer leaves its request suspended: the durability sweeper carries the turn on as if the approval were rejected, so the gated tool does not run, the model gets a result saying the approval expired and is no longer valid, and `SuspensionRejectedError` carries `expired: true` (FIX-1846).
- 2969b30: Add `defineFacetedCollection`: a resource collection whose bodies are classified once on write by an evaluator block you pass, storing the answers as `facets`, with a `search` block over the stored answers (optional `minConfidence`, no model call), a `reindex` block that reports `{ reindexed, failed }`, and the `resources` to register on the flow. A misconfiguration throws when the collection is defined: client body edits, `writable: false`, a `reactTo.contentUpdated` binding, parameterized key patterns, and evaluators with computed questions, an input schema that rejects a string, a `flowConfigSchema` or a lazy single resource (FIX-1583).
- a74429a: A generator no longer calls a capability preset's function-valued `tools` when it would drop the result: behind a declared `tools:` list, or while it assembles context from a capability added through a dynamic `uses` entry (FIX-1459).
- e71ea1a: The DevTeam and `fsd` Labs now ship a default model, so a worker that names no `model:` answers instead of failing every turn, and an `intent/<name>` with no model to fall back to fails with a setup error that names where to set one (FIX-2008).
- 49d6397: A refused flow config bag now throws `FlowConfigRefusalError`, which carries each issue as `{ path, code, message }` beside the same message as before (FIX-1789).
- 9e3b823: A text generator that runs without streaming now keeps the text it wrote before a tool call, returning the same text as the streamed turn (FIX-1628).
- df3de3b: A streaming text generator whose turn writes text in more than one step (text, then a tool call, then more text) now separates each step's text with a blank line, in both the streamed assistant message and the generator's output. Before, the pieces ran together with no space at the step boundary ("…the tool.I've filed…") (FIX-1626).
- 423a405: Add `harnessEnv({ pass })`, which builds a coding harness's `env` from an allowlist of variable names so a harness's agent process sees only the variables you name instead of the server's entire `process.env` (FIX-1716).
- 08a9b05: See how much of each coding harness's subscription is used. Core adds the neutral usage window and the on-demand reader signature (`HarnessUsageWindow`, `HarnessUsageReading`, `HarnessUsageReader`). `@flow-state-dev/codex` adds `readCodexUsage`, which asks the Codex CLI's app-server for every window's percent used and reset time with no run (local only), and exports `findCodexProgram`. `@flow-state-dev/harness-manager` adds the per-person `harness-usage/**` record and `harnessUsageAction({ readers })`, the one query that returns each window with its age and whether it has rolled over, refreshing a reader at most once a minute. Shift Manager shows it on a new Usage view (FIX-2141).
- 01b29f0: A hired seat stays with the organization and user that hired it, so another organization or roster peer cannot list, open, or run that seat (FIX-1529).
- 712dc22: A hired seat now keeps what it saves for a person (shared user-scoped resources and user state) under one user-scope key per organization and person, `<userId>:~org:<orgId>`, so the same person's seat in another organization starts empty and no seat reads the person's app-wide data; data seats saved before upgrading is not read for them until you run the optional offline copy in the persistence docs under "Upgrading: moving hired seats' stored data" (FIX-1538).
- afb512f: `ItemQuery` gains `includeInFlight`: pass `false` to `ctx.session.items.history()` (or `all()`, `client()`, `selectForContext()`) to get earlier items only, without the items the current request has produced so far (FIX-1595).
- f9995b1: An `{ id }` dispatch target may carry `state`, which creates the session at that id when none exists, through the target flow's create check (FIX-1989).
- a7f1c41: `utility.intentRouter` now keeps a category handler's own `connectInput`, applying it to the router's original input instead of dropping it (FIX-1558).
- 80f6e25: Models `createModelResolver` loads from a provider or gateway package carry `generateStep` and `streamStep` from the first resolution, so a generator runs its own tool loop on them and a tool's `ctx.suspend()` pauses the request instead of reaching the model as a failed tool call (FIX-1719).
- 3cbab3a: `RequestHost` gains `sessions.read(id)`, which returns a session's flow and its read-only state when the session belongs to the same user, tenant and organization as the request, and `undefined` otherwise (FIX-2160).
- a965a50: A request that resumes after `suspendForUser` restores the state of every sequencer it was inside, nested ones included, so a step after the resume sees what the steps before it wrote (FIX-2163). Two `loopBack`s that target the same step give each pass its own child paths, so a resumed request no longer reuses an earlier pass's step outputs for a later pass.
- 41638f3: A flow that sets no `tokenCounter` now counts with core's `estimateTokenCounter`, which reads each model's characters-per-token from the model lookup, instead of a flat four characters a token. `{ tokens: N }` history windows on a GPT, Gemini or Llama model count a little higher than before, so they hold slightly fewer turns. Blocks read the flow's counter as `ctx.tokenCounter` (absent on a mock context), and `utility.consultSessionHistoryTool` cuts its `budgetTokens` with it, for the answering model (FIX-2319).
- 311a6d5: `@flow-state-dev/orchestration/tasks` no longer reaches `node:module` or `node:url`, so a browser bundle can import it. Core adds two subpaths, `@flow-state-dev/core/blocks/handler` and `@flow-state-dev/core/blocks/sequencer`, that expose the block builders without the main entry's Node-only model resolver (FIX-1608).
- 27b198a: `defineResourceCollection` accepts `ownerWrites: { param }`: every reader the collection's scope serves reads each row, and only the user the row's owner segment names writes it. Key rows with `ownerSegment(userId)` at that parameter, as for `ownerPrivate`, and the same pattern rules apply (the parameter appears once, no `**`); a browser read is allowed. A create, update or delete by anyone else, through the collection handle, a ref obtained by reading, or the browser update and delete routes, throws `A row of an owner-writes collection is written only by the user it belongs to.` and changes nothing. The startup fence covers these collections too: a wider collection in the same scope that can reach their keys, or the same pattern declared `ownerPrivate`, stops the app from starting. A collection can't declare both modes, and an owner-writes collection can't declare an `eviction` policy other than `"none"` (FIX-1793).
- db7df1c: A `per-task` hand-off keys a follow-up task's child session by the task it follows (`followUpOf` on the worker input), so the follow-up runs in that task's session (FIX-1817).
- 0d6278e: Each worker's token usage is recorded per person and day, with harness runs reporting their spend through `reportHarnessSpend`, read through the `workerUsage` query, and shown on Shift Manager's Usage view (FIX-2145).
- 968faa6: The run's plan record is now part of the harness contract in `@flow-state-dev/core`: `OBSERVED_PLAN`, `observedPlanCollection`, `observedPlanItemStateSchema` and `ObservedOutcome`, with the same key and fields as before, and entries now stream to an open page as they change. New beside it: a per-run list marker (`OBSERVED_PLAN_LIST`, `observedPlanListCollection`) that says whether a run's plan is `writing`, `complete` or `incomplete`, and `replacePlanList(plan, marker, runNamespace, items)` for harnesses whose plan arrives as the whole list. Also new: `harnessFailureKind(error)`, which returns `"unknown-conversation"` when a harness refused to continue the conversation a run asked to resume, and `null` for any other failure (FIX-1915).
- 653549d: New `planRowsPrefix(requestId)` and `planKeySegment(value)`, from the package root and `@flow-state-dev/core/types`: the key prefix one request's plan entries (or, with `OBSERVED_PLAN_LIST`, its markers) are under, for reading one turn's plan with a `topicPrefix`, and how a request id or run name is written as one key segment (FIX-1915).
- adbcf0b: `RequestWaits` gains an optional `running(requestIds)`: whether each request of the running session is running its own work now (`in_progress`), as opposed to parked (`suspended`) or ended. The engine's request host implements it. A host that supplies its own `RequestWaits` should add `running` too: without it, a task board doesn't hold a task's notice while the request that filed the task runs (FIX-2123).
- 1cfd80c: `defineResource` and `defineResourceCollection` take a `secret` list of state fields the engine never sends to a client or returns from the debug routes, and Workforce marks a stored MCP key's `value` secret so the debug routes no longer show it (FIX-1955).
- 3b0161c: With a durability provider configured, a request resumed after a stop, or continued through `/continue`, no longer runs its completed steps again when trace observability is off, as it is by default in production. Without a durability provider, `/continue` behaves as it did before: it skips a completed step only from a full trace, so a request recorded with observability off runs again from the top. The lean record is marked `lean: true`. Each completed block now records a lean `block_trace` (its identity and output) whatever the observability setting, and resume replay reads that record to skip the block. Full capture (inputs, generator prompts, resource loads, failed traces) is still gated by `FSDEV_TRACE_OBSERVABILITY`. With observability off, a request's item log now holds one `block_trace` per completed, non-transient block. An output larger than the recorded-value limit is stored as an omitted placeholder, so a resume that reaches that step fails with `RECORDED_VALUE_OMITTED`, naming the block, rather than skipping it or running it again. With a durability provider, crash recovery (`/continue`) is at-least-once for a block whose completion had not been persisted when the process died: that block runs again. A completed `block_trace` now carries `rescued: true` when a `.rescue()` handler produced the block's output, so `ctx.wasRescued()` returns the same answer after a resume (FIX-2137).
- 385d01e: A generator tool that throws after its approved `ctx.suspend()` gate now reaches the model as a failed tool call, as in the live tool loop, while a cancel during that tool still stops the request (FIX-1719).
- 7c9e932: A running request's items are now readable while it runs on the in-memory stores too, and a message sent to a coding run whose harness hasn't named its session yet is held until it does instead of being refused as a run that can't continue (FIX-1735). `readCommitted` (in `@flow-state-dev/core/helpers`) reads a resource's state as committed now rather than as the request first read it.
- 334c1e3: A message item read through `ctx.session.items.all()`, `client()` or `selectForContext()` carries its `role`, so a block building its own prompt context can tell the caller's messages from the flow's (FIX-1828).
- a021cd1: `@flow-state-dev/contracts/helpers` (and `@flow-state-dev/core/helpers`) now export the resource-state version rule every `ResourceStateStore` adapter uses: `assertSetExpectedVersion`, `assertDeleteExpectedVersion` and `resourceStateConflict`, with the `ExpectedVersion`, `VersionedRow` and `VersionConflict` types. A custom store adapter can import them instead of copying the rule. `cloneValue` is now also exported from `@flow-state-dev/contracts/helpers`; its `@flow-state-dev/core/helpers` export is unchanged. No store's behaviour changes (FIX-1277).
- 68b8957: `defineFlow`'s build-time resource collision check now keys each declaration on the cell the engine actually writes (FIX-1257). Two collections sharing a `pattern` are refused whatever `ref` each carries, a `defineResource` carrying a `pattern` is checked as the collection it is stored as, and an aliased resource is checked only under the slot it persists to. A flow that previously built only because a collection carried a `ref` now throws `Resource collision` at definition time. The shared rule is exported as `isCollectionConfig` and `resourceStorageKeys` from `@flow-state-dev/core/types`.
- e11764a: `ctx.suspend()` takes an optional `title`, a short heading for the ask, carried onto the suspension record and the `suspension` item; `message` is then the body under it. The Error Reporter's preview now sends a short title with its count and questions as a markdown body (FIX-2030).
- 9cd314d: `defineTaskCollection` accepts `partitionBy` on a `user`-scoped collection, keeping one set of rows per partition so each conversation's board reads, claims, waits on and settles only its own tasks while a board's hand-off carries the partition (core's task dispatch envelope gains an optional `partition`) to a task entry on another flow, whose gate and `taskLedgers` resolver read the row there (FIX-1794).
- 9af8ce5: A dispatched task records what its runs spent on its row (`spend`), every attempt counted, rising while a run works: the board writes it every 2 s and as the request ends, through the new `recordSpend` verb on `TaskCollectionRef`. `listTasks` from `taskToolActions` returns it folded (`taskSpendView`: harness, model, input and output tokens, `null` until reported). Harness runs report spend as they go, keyed by a `runId` with the model the run named, each report replacing the run's last; `readRequestSpend(ctx)` reads a running request's spend so far, and `requestSpendSources` moves from Workforce into core (FIX-2288).
- 407964a: Resources declared on a block that a generator lists in a static `tools` array now reach `ctx.resources` when the model calls the tool, including when a `uses` capability also contributes tools, and a conflicting declaration at the same accessor now fails at `defineFlow` time (FIX-1578).
- 5708f16: A generator tool whose `mapModelOutput` throws is now recorded as a failed `tool_output` (code `MODEL_OUTPUT_MAP_FAILED`) and fails the run on resume and recovery too, instead of being stored as completed and replayed to the model as a success (FIX-1719).
- 50edfd4: A tool's `item.updated` event, sent when it completes or fails, is now keyed by `itemId` like every other stream, instead of `id` (FIX-1681).
- 84cc226: New `isWindowsReservedName(name)` helper on `@flow-state-dev/contracts/helpers`, re-exported from `@flow-state-dev/core/helpers`: `true` for the names Windows reserves for devices (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) in any letter case. The filesystem store and the workforce tree loader now both read this one list; which names they refuse, and the messages they give, are unchanged (FIX-1428).
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [617aeab]
- Updated dependencies [211679a]
- Updated dependencies [839e915]
- Updated dependencies [65ad58a]
- Updated dependencies [3b0161c]
- Updated dependencies [fa7b22e]
- Updated dependencies [d1a4cab]
- Updated dependencies [60c8192]
- Updated dependencies [b7c523b]
- Updated dependencies [a021cd1]
- Updated dependencies [cd180d7]
- Updated dependencies [e11764a]
- Updated dependencies [d97031f]
- Updated dependencies [49d2aca]
- Updated dependencies [84cc226]
  - @flow-state-dev/contracts@0.2.0

## 0.2.0

### Minor Changes

- b597600: An agent can now ask what it can work with: `discoveryTools(createManifestRegistry([...]))` returns one `discover` tool that answers from whatever domains a scope registers a source for, and `resourcesManifestSource()` ships the resources domain. Two enumerators that ignored the `llmReadable` gate are closed with it — `resourceTools().listResources` is **removed** (it had no caller), and `globResources` now lists only resources the agent may read (FIX-817).
- 6b8bfe4: Sessions a dispatcher ran work in are listable on their flow: `GET /sessions` takes `include=dispatch-runs` (off by default), `listSessions` takes `include`, `FlowNavigator` takes `includeDispatchRuns` and draws a run one level under the session that started it, the DevTool shows runs in the rail and inside a session's block tree on demand in place of its Children tab, and `requestHost.livenessOf` now also answers for a dispatch run under the caller's own principal, tenant, organization and flow instance rather than only for one beneath the asking session (FIX-1440).

  The dispatch-run liveness arm compares the caller's organization against the active-request entry as well as the session record. Both comparisons are required: they read separately stamped rows, and a caller whose organization was not forwarded to the read matched only entries carrying no organization at all.

- b48158a: Organization identity is now required on every request (FIX-1442).

  A session, request, dispatched child and scheduled job each carry an
  organization, and the server checks it on reads and execution alongside the
  user. It comes from a configured `resolvePrincipal`, or — when an app
  configures no resolver — from the new reserved `DEFAULT_ORG_ID` exported by
  `@flow-state-dev/core`. A caller-supplied `orgId` is never authoritative.

  **What you need to change**

  - A resolver must return a verified `orgId`. Returning none, a blank one, or
    `DEFAULT_ORG_ID` is refused with 401. A machine transport may return
    `{ orgId }` alone and let `defaultUserId` name its system user.
  - Direct `runAction` calls must pass `orgId` — your verified organization, or
    `DEFAULT_ORG_ID` for single-organization development.
  - `authentication.requireOrg` and a block's `requireOrg` are removed.
    Organization is unconditional, so the declaration had nothing left to say;
    a config that still carries either is rejected at definition time rather
    than ignored.
  - Client and React session APIs no longer take an `orgId` — the server owns
    it. `SessionDetail.orgId` is now required on the way back.
  - `openChannels` no longer takes an `orgId`; the server binds the channel.
  - A queued BullMQ job that carries no organization now fails terminally
    instead of being retried: a worker runs below principal resolution, so no
    later attempt could supply one. Subscribers receive an error terminal rather
    than waiting for a job that never completes.

  **The schedule index stores the organization.** `schedule_index` gains a
  nullable `org_id` column in both the SQLite and PostgreSQL adapters, so the
  organization a schedule fires into survives a round trip through the database.
  The column is added for you on the next schema init — there is no manual DDL
  step. Existing rows read back with no organization and are quarantined rather
  than dispatched, so a schedule written before this upgrade does not fire until
  it is attributed; rewriting it stamps the organization of the execution that
  writes it.

  **Upgrading a store with existing data.** Records written before this carry no
  organization. They are preserved and refused (`409 migration-required`) rather
  than guessed at, and listings and scheduler scans skip them. Attribute them
  offline first — the procedure, including dynamic schedules, index rebuild and
  the reserved-id collision check, is in the persistence guide under "Which
  organization a record belongs to".

- f25f03c: Rename the read-through collection family from `ExternalResource*` to `ProjectedResource*` (FIX-1518). Call `defineProjectedResourceCollection` and the `projected: true` brand; the old `External*` names and `external: true` brand are gone.
- bff5e06: FIX-1393: a generator's declared `tools:` is now a runtime fence over capability-contributed tools, not just a documented one.

  A capability's tools used to be unioned onto whatever the block declared, so a block with `tools: []` could still be handed tools it never named. Declaring the slot now drops a capability's catalog-granted tools — `tools: []` reaches the model with none. Omitting `tools:` entirely is unchanged: it declares no fence, so capability tools still flow.

  Capabilities declare tools through two slots. `tools` is a grant from the app's catalog and is fenced. The new `controlTools` is a framework control the consuming block's own configuration asked for, and the fence never touches it — a control is built inside its capability and never exported, so no `tools:` list could name it back in. One capability may use both: the skills library registers the app catalog through `tools` and its own skill loader through `controlTools`, and `taskTools` contributes the delegation board entirely as controls.

  **Migration.** If you relied on a capability's tools arriving past a narrower `tools:` declaration, name them in `tools:` or drop the declaration. Pattern factories (`planAndExecute`, `supervisor`, `routedSpecialists`) forward both slots, so a call site passing `tools` and `uses` together now gets the fence inside the pattern. Capability authors whose tools are framework controls rather than catalog grants should move them to `controlTools`.

### Patch Changes

- e4c443e: A task board now reports when it saves a task's result and then cannot announce
  it, instead of finishing the run as though nothing went wrong. The failure lands
  on a persisted `task-board-recorder-failure` item and fails the run once every
  other task has drained; on a handed-off task it fails that child run. `onError`
  does not suppress it. Where the board cannot tell whether the write landed —
  permanently so on a task store you supplied, and on rows that predate write
  provenance — it says `undetermined` rather than assuming the write was lost, and
  hands the row back rather than leaving it claimed. `createRecordSuccess` and
  `createRecordError` composed outside a board raise the failure where it happens,
  since nothing downstream would read the report (FIX-963).
- Updated dependencies [b597600]
- Updated dependencies [e4c443e]
  - @flow-state-dev/contracts@0.1.2

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/contracts@0.1.1

## 0.1.1

### Patch Changes

- 7c52923: `AgentSpec` accepts an optional `description` used as the roster blurb for a skill assignee prompt (FIX-1370).
- a8e22c4: A block whose `flowConfigSchema` asks for a setting inside a nested object can be installed on a flow again, and a block that declares a requirement from inside a dynamically resolved tool is now checked the same way a statically declared one is (FIX-1336).

## 0.1.0

### Minor Changes

- 67b4157: `dispatcher()` can address another flow: `flowKind` on an `internal` or `task` dispatcher resolves `action` on that flow's matching entry map and starts the work there, fire-and-forget. `defineFlow` holds one flow's entry maps and skips the check, so the miss is a named runtime refusal — `flow-not-found` for an unregistered flow, `no-entry` for a registered one that declares no such entry — never a retry, a queue, or a fall-through to the sender's own map. A cross-flow `{ key }` child belongs to the addressed flow (its `flowKind`, its state defaults) and roots its own lineage; a reply is the same `{ from: true }` dispatcher pointed back at the sender's `flowKind`. Omit `type` — ordinary dispatchers send `internal`, and a task-board seat is a dispatcher whose `session` is `"per-task"`, `"per-worker"`, or `{ key }` (FIX-1297, FIX-1171 family). The entry-name field is `action`.
- 4e562d0: The chat transport is removed (FIX-1330): `@flow-state-dev/chat-sdk` no longer exists, `chat` is no longer an option on `defineFlow`, `ChatConfig` / `ChatEventBinding` / `validateChatConfig` are gone from core, `"chat"` is no longer a `DispatchType` or a public re-entry source in the engine, and the DevTool no longer renders a Chat provenance badge. Conversational bots are driven through a caller-addressed action in `actions`; platform events ride the webhook transport.
- afcac3d: A flow declares its `cardinality` — `"singleton"` (the default: `myFlow()` is the one instance, addressed by its kind, and `myFlow({ id: "default" })` now throws) or `"collection"` (several configured copies, each registered under its own required `id`) — every address (the action, stream, resume, retry and continue routes, `fsdev run`, dispatchers, BullMQ jobs, MCP, webhook and schedule dispatch) is the exact instance id with no first-registered fallback, every session and request records its owning `flowId` and is refused when reached through another instance (`FlowInstanceBindingMismatchError`; `409 wrong-instance-session` / `wrong-instance-request` / `migration-required` on the routes), and SQLite and Postgres add a nullable indexed `flow_id` column with no backfill (FIX-1321, FIX-1322).
- 3cbc411: A shared contract for coding-agent harnesses (LAB-152), so a harness package no
  longer has to be built against another vendor's internals.

  `@flow-state-dev/core` now exports the shape a harness block is handed and the
  handle it returns — `harnessRunInputSchema` and `harnessRunHandleSchema` (plus
  `harnessRunEnvelopeSchema` for a fire-and-forget dispatch), with
  `HarnessRunInput`, `HarnessRunHandle`, `HarnessBlock`, `HarnessResolver` and
  `HarnessSessionHook` on `@flow-state-dev/core/types`. The handle names how a run
  ended (`outcome`: finished, stopped at a limit, or failed), its final message,
  usage, and cost — including whether that cost was reported by the agent or
  estimated. The input is the prompt alone: a working directory or a session to
  resume reaches a harness through a resolver the host supplies, not through a
  schema a model calling the block as a tool can see.

  `@flow-state-dev/claude-code`'s handles are the neutral ones plus Claude's own
  `resultSubtype` and `toolsObserved`. Two visible changes: `source` now reads
  `claude-code/sdk` and `claude-code/cli-remote` (the `<package>/<door>`
  convention every harness follows) and handles saved under the old `sdk` /
  `cli-remote` spellings still load; and the SDK handle carries `outcome` and
  `cost` alongside the existing `costUsd`, which stays for now. The package's
  `RemoteAgentTaskHandle`, `RemoteAgentSource`, `RemoteAgentStatus` and
  `remoteAgentTaskHandleSchema` are deprecated aliases of the core shapes.

- b3e6e22: Initial release (FIX-1187).
- ce85e80: Two registered copies of one flow definition can be set up differently: `defineFlow({ configSchema })` declares what a copy may carry, the factory call takes `config`, and blocks read it as `ctx.flow.config` (FIX-1331).
- 1b94521: Background Claude Code runs can continue a previous conversation (LAB-154).

  `claudeCodeAgent` and `createClaudeCodeAgentCapability` take `resume` (which
  session this run continues — return `null` to start fresh) and `onSession`
  (called during the run when the agent names its session, so a cancelled run's id
  is not lost). Both are background-path only and throw at construction without
  `detached: true`.

  Three things existing code can trip over:

  - **Every resolver option is now handed the block context alone.** `cwd`,
    `sandbox` and `resume` on `claudeCodeAgent`, and `root` on
    `createWorkspaceAgentCapability`, used to receive the run's input as a first
    argument. Drop it: `cwd: (_input, ctx) => …` becomes `cwd: (ctx) => …`.
  - **`costUsd` is gone from the SDK handle.** Read `cost.usd`. Handles already
    persisted with the old field still load.
  - **`HarnessResolver` in `@flow-state-dev/core/types` matches**, and its context
    keeps its types where it previously widened them to `any` — a resolver body
    reading an undeclared scope-state field no longer compiles.

- 5fa52aa: One dispatch protocol: every arrival at a flow — a caller's action, a webhook, a schedule, a task hand-off, an internal dispatch — is a dispatch of one type delivered to one entry addressed by `(type, name)`, with no fallback between types (FIX-1302).

  - **`defineFlow` gains `internal` and `task` entries, nested under their type.** `internal: { actions: { wake: { block } } }` and `task: { actions: { implement: { block } } }` are declared like actions and are definition-only, like the transport maps; the flat `internal: { wake }` / `tasks: { implement }` spelling is refused by name. An `internal` entry is reachable only from a `dispatcher()` inside the flow; a `task` entry is reachable only from a `dispatcher({ type: "task" })` seat on a task board the flow reaches, and `defineFlow` puts each one behind that board's claim gate (the row re-read, the claim verified, the task scope marked, the ticket re-minted) before the block runs. A task entry no board addresses, a task dispatcher no board holds, and two boards addressing one entry are refused at definition. Every entry, of every type, accepts its own `concurrency` (`ActionCore.concurrency`).
  - **`dispatcher()` is the block that sends.** `dispatcher({ name, type: "internal", target, session: { key } | { id }, payload? })` (`InternalDispatcherConfig`) returns a handler carrying its static address, and `defineFlow` refuses an address the flow does not declare — through composition, rescue handlers, and a generator's static `tools`. `{ key }` derives a child session of the running one (minted, then adopted on the same key); `{ id }` delivers into an existing session of the same flow and principal, refuses an unknown id rather than creating one, and is dropped if that session was deleted and recreated between acceptance and the run. A refusal throws `DispatchRefusedError` naming the refusal (`no-entry`, `session-not-found`, `session-not-addressable`, `key-occupied`, `no-dispatch-operation`, `dispatch-rejected`, `external-dispatcher`).
  - **`.forEach()` and `.forEachSideChain()` accept `blocks`.** A per-item factory declares the blocks it can produce, so they are walked for dispatch addresses and merged for resources like a block-shaped call's element. A task board's drain uses it, which is what lets `defineFlow` refuse a flow that reaches a board with a hand-off seat but never declares the entry it addresses.
  - **A task board hands off through a dispatcher seat.** A seat under `workers` is a block; a `dispatcher({ name, type: "task", target, session: "per-task" | "per-worker" | { key: (task) => string } })` (`TaskDispatcherConfig`) in that position hands the seat's rows off to `flow.task.actions[target]` in the child session the policy names. A `task` dispatch carries `{ boardId, seat, taskId, attempt, createdAt, incarnationId?, payload }` (`taskDispatchInputSchema`, `TaskDispatchInput` from core), and the entry's gate re-reads the row and verifies the claim before the block runs. A refused hand-off throws the same `DispatchRefusedError` a `dispatcher()` block throws. An entry a `per-worker` or `key` seat hands off to defaults to `concurrency: "queue"` (an explicit policy wins); a `per-task` seat keeps the flow default. `board.handedOff` lists the seats that hand off; `createTaskGate`, `createHandOff`, `StaleTaskClaimError` and the `TaskSeatRegistry` type are exported from `@flow-state-dev/orchestration/task-board`. `TaskSessionPolicy`, `taskSessionKeyFor`, `bindTaskDispatcher` and `taskBindingOf` are exported from core for substrate code.
  - **A dispatched request is stamped.** It records `metadata.dispatch = { type, target, from, key?, ... }` under `source: "internal"` or `"task"`; the child session it runs in carries `topic` (the key) and `coordinate` (`"<type>:<target>"`) and is listed by `GET /sessions/:sessionId/children` like any other child of its parent.
  - **`task` and `internal` dispatches can never be re-entered** from a public route: retry, continue and resume refuse them, and `publicReentrySources` cannot re-open them.
  - **`createMockTransportHost` publishes `usesExternalDispatcher: false`**, matching the widened `InboundTransportHost` contract.
  - **The dispatch seam is not a named member of the block context** — reach it with `dispatcher()`, or in substrate code with `dispatchThroughSeam` and `markDispatcher`. The Workstream surface this protocol replaces is removed in the same release; see the Workstream-removal note for the renames.

- 4054c64: `dispatcher()` can reply to who dispatched it: `session: { from: true }` delivers into the seam-stamped sender, and a request with no trusted stamp refuses `no-sender` (FIX-1312, FIX-1171).
- fda9b15: Background work is declared with a task-board dispatcher seat and read back as child sessions: a session's children are listed at `GET /sessions/:sessionId/children` through `listChildSessions()` and `useSession`'s `childSessions` / `childSessionsStale`, session-scoped resources shared with them use `sharedToLineage`, and the two `createFlowState` options are `dispatchDrainTimeoutMs` and `maxChildSessionListLimit`; the Workstream surface they replace is removed, `ctx.requestHost.startDetached` and `dispatch: { mode: "detached" }` with it (FIX-1308). From `@flow-state-dev/orchestration/task-board` that removes the detached-mode helpers (`assertDetachedBoardSupported`, `detachedTaskPredicate`, `coordinateKey`, `coordinateLabel`, `workstreamRoutingSeed`, `WorkerCoordinate`, `TaskWorkerDispatch`, `TaskWorkerSlot`, `TaskWorkerSlotRegistry`, `TaskWorkerEntry`, `isTaskWorkerEntry`) and `board.detachedWorkers`; a seat is a block or a `dispatcher({ type: "task" })`, and `resolveWorkerSlots` now returns the bare blocks plus the `HandOffSeat`s (`name`, `label`, `dispatch`) in one walk from the hand-off module. A `{ worker, dispatch }` or `{ block, session }` seat is refused by name at construction. The DevTool's Children panel pairs a child with its task from the dispatch key a `per-task` or `per-worker` seat derives (a `{ key }` policy pairs nothing) and shows the entry it was dispatched for.

### Patch Changes

- 527c5ca: The DevTool now identifies flows by instance rather than by kind, so two registered copies of one flow each show their own sessions, requests and controls instead of one copy's work appearing under the other (FIX-1324).
- d7208f7: LAB-153: the model price table now knows OpenAI's Codex models, so a Codex run can be priced.

  `gpt-5.4-codex-mini` previously matched the `gpt-5.4` row and was estimated at the full model's rate. Cost estimates for that model change; the other Codex names were unpriced before and are priced now.

- 2c4b0f5: Skills now follow the Agent Skills specification (https://agentskills.io/specification)
  in full for a SKILL.md's frontmatter (FIX-1318).

  - `name`, `license`, `compatibility`, and `metadata` are parsed into typed fields
    on `SkillState` (and `Skill`) instead of being kept only as preserved unknown
    keys. `name` is validated and must match the folder it lives in;
    `compatibility` is capped at 500 characters; `metadata` is a string → string
    map. `MAX_COMPATIBILITY_LENGTH` is exported alongside the existing caps.
  - `parseSkillMd` takes an optional `{ expectedName }` so directory readers and
    seeders can enforce the name/folder match. `readSkillsDirectory`,
    `importSkillsDirectory`, `ensureSeeded`, and `createSkillsLibrary` pass it.
  - Skill names follow the spec's hyphen rules: no leading, trailing, or
    consecutive hyphens. Names like `pdf-` or `pdf--tools` were accepted before
    and are rejected now.
  - `allowed-tools` accepts the spec's space-separated string form
    (`allowed-tools: search fetch`) in addition to a YAML list, and
    `serializeSkillMd` writes it in the spec form.

- Updated dependencies [b3e6e22]
  - @flow-state-dev/contracts@0.1.0

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-17 — Turn-aware history windowing (FIX-608)

`history: { limit: N }` on generators now counts conversational turns rather than raw LLM protocol messages, and `{ limit: { tokens: T } }` packs whole turns from the end without splitting across the budget. New explicit `{ limit: { turns: N } }` form is preferred for new code.

### 2026-05-16 — Sequencer DSL: `.throwIf()`

New `.throwIf((value, ctx) => boolean, Error | factory)` guard primitive on the sequencer DSL. Throws when the predicate is true, otherwise passes through. Pairs with `.rescue([...])` for typed early-stop patterns.

### 2026-05-16 — Idempotency primitives on handler context (FIX-402)

`BlockContext` now exposes `idempotencyKey` (stable `${requestId}:${blockPath}` string suitable for provider idempotency headers) and `runOnce(key, fn)` (memoizes a side effect per request-id and shares inflight promises across concurrent callers).

### 2026-05-14 — `useResourceCollection` invalidates on mid-stream changes

`SessionView` gains a dedicated `resourceChanges: ReadonlyArray<ResourceChangeNotice>` channel populated from `resource_change` SSE items, independent of the consumer's transient-item filter. New `ResourceChangeNotice` type exported.

### 2026-05-14 — Delta store verbs (FIX-405)

Single-field `patchState` calls now route to optional `patchField`, `incState({ field: delta })` to `incField`, and `pushState` to `pushToArray` when an adapter advertises them. Adapters that don't fall back to `set`. `createScopePersist` feature-detects per call. Hot-path cleanup: `MemoryStateContainer.read()` no longer deep-clones, and the `onStateSizeWarning` callback is removed from `ScopeStateOpsOptions`.

### 2026-05-14 — Observable model identity on emissions (FIX-518)

New `ModelIdentity` type (`{ actual, requested?, gateway? }`) exported. Every generator-emitted item (`message`, `reasoning`, `source`, `tool_output`, transient `tool_call_progress`) now carries `model: ModelIdentity`. `BlockTraceItem` for generator blocks gains a top-level `model` field, populated even on tool-only or structured-only turns. Additive — items persisted before this release surface as `model: undefined`.

### 2026-05-14 — `block.asTool()` (FIX-593)

New method on every `BlockDefinition`. Wrapping a block with `.asTool(opts?)` emits a `tool_output` envelope identical to the AI SDK tool-loop path while the block runs normally and returns its typed output unchanged. `agentType` / `agentName` opts control grouping. Failures flip the emitted `tool_output` to `failed` and rethrow.

### 2026-05-12 — Block trace honors `transient` (FIX-586)

Auto-emitted `block_trace` items now inherit `transient` from the originating block. Restores the FIX-478 contract that FIX-573's `block_output → block_trace` unification regressed by hardcoding `transient: false`.

### 2026-05-12 — DevTool: surface context on block failures (FIX-582)

`block_trace.error` and `tool_output.error` gain an optional `details: Record<string, unknown>` field. Generator output-validation failures now throw `OutputValidationError` carrying `{ rawOutput, issues, phase }`. `FlowError` relocated to `@flow-state-dev/core` so handler authors in third-party packages can throw it without a server dependency.

### 2026-05-11 — `makeSchemaStrict` public; BP-016 (FIX-561)

`makeSchemaStrict(schema)` is now re-exported from the package root. It unwraps `optional` / `default` / `nullable` but does NOT transform `z.record()` or non-literal `z.union()` — those still fail OpenAI strict mode and must be rewritten at source. BP-016 codifies the rules.

### 2026-05-11 — Client projection shortcuts: `expose`, `exclude` (FIX-580)

`defineResource` and `defineResourceCollection` now accept `client.expose` (whitelist) and `client.exclude` (blacklist) alongside `client.data`. Field names are type-checked against the state schema. The three projection forms are mutually exclusive; omit all three to ship the full state.

### 2026-05-07 — `useClientData` reflects mid-stream state changes (FIX-576)

`ctx.session.patchState`, `ctx.user.patchState`, `ctx.org.patchState`, and `ctx.request.patchState` (and their `setState` / `incState` / `pushState` / `setStateRecord` / `deleteStateRecord` / `atomicState` siblings) now emit `state_change` SSE items with the matching `scope` value. Previously only sequencer/target-state writes emitted on the wire.

### 2026-05-07 — Container lifecycle: in-flight signal (FIX-574)

`container` items now emit with `status: "in_progress"` when a sequencer or router scope opens, patch to `completed` (or `failed`) via `item.updated` when it closes, then emit the terminal `item.done`. New optional fields: `startedAt`, `completedAt`, `duration`, and `error: { message }` on failure.

### 2026-05-07 — Block trace unification (FIX-573) [BREAKING]

A single `block_trace` item per block run replaces the old `block_output` / `block_debug` split. `block_tool_output` renamed to `tool_output`. Hooks `onBlockDebugCapture` and `onConnectedInput` collapsed into a single `onBlockTraceCapture(payload, ctx)` keyed by phase. Migration: rename `block_output` → `block_trace` and `block_tool_output` → `tool_output` at consumer dispatch sites.

### 2026-05-07 — Lazy collection state, query interface, resource manifest (FIX-427) [BREAKING]

Collection snapshots dropped the eager `items` map; entries now carry `count` and an opt-in `prefetched` window. Per-item `clientData` in the window requires the new `client.state.read` permission. `defineResourceCollection` gains `prefetchWindow?: number` (lexicographic key sort, not recency).

### 2026-05-07 — `item.updated` SSE event (FIX-572)

New `item.updated` event carrying `{ itemId, patch }` with shallow top-level merge semantics. Identity-invariant keys (`id`, `type`, `provenance`, `agentType`, `transient`) are stripped server-side. New `emitItemUpdated(itemId, patch)` on `ResponseEmitter`.

### 2026-05-07 — Lift `.sideChain()` background tasks to a request-level pool (FIX-554) [BREAKING]

Background tasks are queued on a single per-request pool. Inner sequencers no longer auto-await; the request executor drains the pool exactly once before terminal status. `.waitForSideChain()` now drains by sequencer-instance scope. Migration: code that relied on inner-sequencer auto-await for ordering needs an explicit `.waitForSideChain()` at the inner sequencer boundary.

### 2026-05-06 — `clientData` privacy fix + rename (FIX-505) [BREAKING]

Default snapshot response no longer includes raw scope state — `response.state` is gone. New per-scope `client: { expose: string[], derived: { name: fn } }` shape on `session`, `user`, and `org`. Legacy `clientData: { name: fn }` keeps working with a one-time deprecation warning per scope per process.

### 2026-05-06 — Trace channel separation, `step_error` removed (FIX-506) [BREAKING]

Public `OutputItem` union shrinks from 15 to 10 entries — the four trace types (`block_output`, `router_decision`, `state_snapshot`, `block_debug`) leave the union and become observability-only. Public `BlockValue<T>` is now `inline | structure`; the `ref` case moves to `@flow-state-dev/core/items/internal`. `step_error` removed entirely.

### 2026-05-06 — `mapModelOutput`

New `BlockDefinition.mapModelOutput((output, ctx) => string)` method declares a separate, model-visible representation of a tool block's output. The structured `TOutput` keeps flowing through items, devtool, tests, and history replay; the mapper fires only at the AI SDK bridge boundary. Inert when the block is used as a regular sequencer step. Expected to be deterministic — replay re-runs it on the persisted structured output.

### 2026-05-06 — Generator: log unparseable candidates

When a generator's output schema rejects the model's response and repair gives up, the candidate string is now logged to stderr (truncated at 2000 chars) alongside the validation error.

### 2026-05-02 — Memory pipeline + naming reliability fixes

`sanitizeToolName` is now exported from `@flow-state-dev/core/utils/tool-name` (and the `@flow-state-dev/core/utils` barrel). `BlockToolOutputItem.toolCall` gains an optional `alias` field so tool-call replay reads the model-facing sanitized name from item metadata rather than re-sanitizing the framework name at replay time. `sideChainIf` predicate signature changed to `(value, ctx)` like `thenIf` and `tapIf`.

### 2026-05-02 — Resource content moved out of scope records (FIX-347)

`SessionRecord`, `UserRecord`, and `OrgRecord` no longer carry a `resourceContent` field. Content lives exclusively in `ContentStore`, keyed by `(scopeType, scopeId, resourceKey)`. Concurrent writes to different resources no longer contend on the scope-record CAS path.

### 2026-05-01 — Per-scope FIFO mutation queue (FIX-492)

In-memory state scopes now serialize mutations through a per-`StateContainer` FIFO queue. `ConcurrentModificationError` is no longer thrown for these scopes. New `flow.request.mutationTimeoutMs` (default 30s) bounds worst-case waits; `ScopeMutationTimeoutError` is thrown on exceedance.

### 2026-04-30 — `emit*` default-transient decouple (FIX-478)

`ctx.emitMessage()` and `ctx.emitComponent()` no longer inherit the producing block's `transient` flag — both default to `transient: false` regardless. `ctx.emitStatus()` continues to default to `transient: true`. All three emitters now accept a per-call `{ transient?: boolean }` override.

### 2026-04-30 — SSE noise reduction (FIX-477)

Framework-level no-op guard in `applyMutation`: when the proposed next state deep-equals current, the persist call is skipped, no `state_change` SSE item is emitted, and the helper returns `false`. New `transientSlot()` helper marks top-level fields on a sequencer's `stateSchema` as in-memory only. Breaking (internal): `runWithCAS` now returns `{ state, committed }`; `applyMutation` and the seven `ScopeStateOps` helpers return `Promise<boolean>`.

### 2026-04-30 — `content.delta` non-replayable (FIX-479)

`content.delta` events are no longer persisted to the events log and no longer await `flushEvents`. Running text is checkpointed via an items snapshot instead; new `ResponseEmitterItemHooks.onItemUpdate` hook fires on each delta. Resume contract change: mid-stream reconnects snap to the latest persisted snapshot rather than replaying the exact token sequence.

### 2026-04-30 — Connection resilience (FIX-476)

`RequestStatus` and `RequestStatusSnapshot` now live in `@flow-state-dev/core/types`.

### 2026-04-29 — Per-flow authentication (FIX-23)

New `authentication` config on `defineFlow`: `{ resolvePrincipal?, defaultUserId?, requireUser?, requireOrg? }`. `requireUser: false` is now a real option; flows that declare user-scoped state, clientData, or resources under `requireUser: false` are rejected at registration with the offending field named.

### 2026-04-28 — Durable sequencer checkpoint schema (FIX-401)

New `SequencerCheckpoint` type and `CheckpointStore` interface. `durable: true` is now the sequencer default. `state_snapshot` items now carry a stable `key` per sequencer instance.

### 2026-04-26 — Org scope rename + immutable session binding (FIX-428) [BREAKING]

`project` scope renamed to `org` across the framework. `ScopeType` is now `'request' | 'session' | 'user' | 'org'`. Block configs use `orgResources` / `orgStateSchema` / `orgClientData`. Session `orgId` and `userId` are now immutable; mismatches throw `OrgBindingMismatchError` / `UserBindingMismatchError`. New `requireOrg: true` block flag.

### 2026-04-24 — Cross-flow schema registry + per-flow isolation (FIX-431)

Added `isolateUserState` and `isolateProjectState` flags to `defineFlow`. Isolated flows get their user/org storage namespaced by `flowKind` and skip cross-flow schema checks. `FlowRegistry.register` throws `CrossFlowSchemaConflictError` on incompatible declarations. New storage-key helpers (`resolveUserStorageKey`, `resolveProjectStorageKey`).

### 2026-04-24 — Prompt caching audit and default-enable (FIX-423)

New `caching` field on `generator()` config, defaulting to `{ enabled: true, breakpoints: 'auto', ttl: '5m' }`. Provider-specific markers applied for Anthropic / OpenRouter / Vercel AI Gateway; OpenAI / Google / DeepSeek cache implicitly. `GeneratorModelUsage` gains `cacheReadInputTokens` and `cacheCreationInputTokens`.

### 2026-04-11 — DevTool: View Sequencer State (FIX-348)

New `SequencerStateSnapshotItem` trace item captures the full state of a sequencer at each step boundary. Sequencers now auto-emit an initial snapshot before execution begins and one after each step completes (including `loopBack` iterations).

### 2026-04-11 — `defineCapability()` (FIX-351)

New `defineCapability()` packages resources, state schemas, targets, helper functions, and presets under a single name. All four block kinds accept `uses: [capability]`. Capabilities compose transitively with cycle detection and diamond dedup. `.presets()` builder ships with boolean toggles and function-form overrides. `ctx.cap.{name}.{fn}` provides memoized helpers.

### 2026-03-20 — Resource Namespaces (FIX-98)

New `defineResourceNamespace()` for typed dynamic resource collections with glob patterns (`files/*`, `files/**`) and parameterized patterns (`[topic]/observations`). `ResourceNamespaceRef` runtime interface with `create`, `get`, `getOrCreate`, `list`, `delete`, `count`. `maxInstances` cap with `none` / `lru` / `oldest` eviction. Per-instance lifecycle hooks. Block-level `sessionResources` / `userResources` / `projectResources` slots accept namespace definitions alongside static resources.

### 2026-03-03 — `contextReducer` utility block (FIX-73)

New `utility.contextReducer(config)` generator factory with three modes: `distill`, `denoise`, `compress`. Mode-specific default output schemas exported with caller override support.

### 2026-03-01 — Sequencer container item emission (FIX-8)

Optional `container` metadata on the shared block config surface so sequencer/router container settings remain attached to built block definitions. Parent metadata extended with `parentInstanceId` and resolved container metadata.

### 2026-03-01 — Block resource declarations (FIX-92)

New `DeclaredResources` type and `declaredResources` field on `BlockDefinition`. Handler, generator, and router blocks accept `sessionResources`, `userResources`, `projectResources`. Sequencers collect declared resources from all child blocks (with build-time conflict detection on same-name/different-reference); `defineFlow` merges them into flow scope configs.

### 2026-02-15 — Monorepo init / package scaffolding

Initial scaffolding for `@flow-state-dev/core`: type contracts (blocks, flows, state/scopes, resources, items, events), shared schema helpers, the four block kinds (`handler`, `generator`, `sequencer`, `router`), `defineFlow`, sequencer DSL, and model-resolver wiring. Token-budget primitives, prompt-caching surface, and model-lookup tables for OpenAI / Gemini / Anthropic families.
