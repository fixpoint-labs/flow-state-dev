# @flow-state-dev/harness-manager

## 0.7.0

### Minor Changes

- f2d4221: A coding run's phase is now its mode (FIX-2877). The public word is mode; the old names are gone, with no alias.

  - **Breaking: the renames.** `PhaseSpec` is `ModeSpec`, `PhaseDoneVerdict` is `ModeDoneVerdict`, `PhaseRunContext` is `ModeRunContext`, and the kit's `codingPhase` is `codingMode`. `harnessManager`'s `phase` option is `mode`, and a run context's `phase` field is `mode`.
  - **Breaking: the shape.** A mode is `{ name, instructions, doneWhen }`. `name` was `phase`. `instructions` was `buildPrompt`. `doneWhen` holds what was three fields: `check` (was `isDone`), `timeoutMs` (was `doneTimeoutMs`) and `validate`. `commandCheck(mode, options)` takes and returns a mode. A session door's `runOf(row)` answers `{ issue, mode: { name, formerName? } }`.
  - **The kit's mode is `default`.** A run of the harness kit's `coder` flow is now keyed `<epic>/<issue>/default`, and its branch and checkout end in `default`. Its runs were keyed `code` before. A run stored under `code` is still found there and finishes there, on its branch, checkout and coding session; nothing is moved or copied. A run that starts after the upgrade is keyed `default`.
  - **`formerName` and `readModeRunRecord`.** A mode can name the segment its runs had before it was renamed (`formerName`), and `readModeRunRecord(ctx, epic, issue, mode)` finds a run under the mode's name first, then under that one.

  Docs: packages/harness-manager/README.md and apps/docs/docs/orchestration/harness-manager.md (every `PhaseSpec`, `phase:` option, `buildPrompt` and `isDone` example becomes the mode shape)

- fd82133: A coding task names the mode it runs in, and the server writes its run settings at filing (FIX-2878).

  - **Breaking: `mode` and `issue` replace the feature marker.** A task for the harness kit's `coder` flow names the work it is as `input.mode`, one of the modes the app registered, and the tracker issue it works on as `input.issue`: `{ mode: "implement", issue: "FIX-2165" }` where `harnessFeature: { issue }` was. A task that names no mode gets the app's `defaultMode` written in at filing. The filing is refused by name, and nothing is filed, when the mode isn't registered (`mode_unknown`, naming the modes there are; an inherited name such as `constructor` is no mode), when the mode's `requires` names a field the task lacks (`mode_needs_input`), and when `issue` isn't a tracker key (`issue_malformed`).
  - **Breaking: `harnessFeature` is refused on any write.** A filing or an update that sends it is refused with `legacy_marker`, never translated. A row stored before this change still runs: its marker reads as the registered mode whose old phase it names (`implement` stays `implement`; the kit's `code` is `default`), on its issue. A stored marker with a phase no mode keeps, with no valid issue, or beside a `mode` is refused at claim by name. On any other row stored before this change, a `mode` or `issue` was whatever a model wrote, so it is ignored: the row runs the app's default mode on no issue, as it did before.
  - **Breaking: the marker's names are gone, with no alias.** `HARNESS_FEATURE_KEY`, `harnessFeatureSchema`, `namesHarnessFeature` and `harnessFeatureOf` are no longer exported. `harnessManager` takes `trackerIssueOf(input)` for a board read from the claim: the issue a task names, which its run works on. With none given it reads the old key, for rows stored before.
  - **The run settings are the server's.** A coding task's `harness`, `model` and `plan` are written only by the server: a filer's are dropped, as are a `doneWhen` and a `workspace`, which are a mode's. A task filed from inside a coding run carries that run's harness; any other carries the kit's `defaultHarness`, on whatever worker the filer chose. Decided once per call, so a replayed call stores what its first attempt filled. Runs still start on their worker's `harness:` line until the settings are read at claim, in a later change.
  - **A worker's `lock:`.** A coding worker's file can fix the `harness` and `mode` its tasks run with: `lock: { mode: answer }`. A filing or a move that differs is refused (`mode_locked`, `harness_locked`), naming the worker, its value and the one asked for, and is never swapped to fit. A task filed before the lock was set is refused at its claim, and nothing runs.
  - **`isCheckedCodingTask(task)`**, from `@flow-state-dev/harness-manager/kit`: whether the coder flow's filing check wrote a stored task's input. A reader of stored coding tasks outside the flow asks it before it trusts the task's `mode` or `issue`.
  - **Shift Manager's EM** files feature work as `{ mode: "implement", issue }`.

  Docs: packages/harness-manager/README.md and apps/docs/docs/orchestration/harness-manager.md (replace the `harnessFeature` paragraph with the coding task's input: `mode`, `issue`, the server-written run settings and `lock:`); the harness kit's docs gain where a coding task's harness comes from, and `isCheckedCodingTask` for apps that read stored coding tasks.

- 019b156: A harness is a core value, and the harness packages no longer depend on the harness manager (FIX-2928).

  - **`@flow-state-dev/core/harness` exports `Harness`, `harnessSchema` and `HarnessFeeds`**, beside `HarnessBlock`, plus the tool-approval feed's types (`HarnessToolApprovalHook`, `HarnessToolApprovalRequest`, `HarnessToolApprovalDecision`). A harness package, or a harness of your own, imports these from core.
  - **One feed type.** A task run and a session turn both hand a harness `HarnessFeeds`. Required: `cwd`, `resume`, `onSession`, `onUsage` and `worktree` (the run's directory, for a fence that names it; a task run now hands it too). Optional: `model` (a session turn's pick), `onSteerable`, `onActivity`, `onEvent`, `onToolApproval`.
  - **Breaking:** `@flow-state-dev/harness-manager` no longer exports `Harness`, `HarnessFeeds`, `HarnessSessionFeeds` or the tool-approval feed types. Import them from `@flow-state-dev/core/harness`; `HarnessSessionFeeds` is `HarnessFeeds`. No alias.
  - **Breaking: `claudeCode()` is gone; fill `claudeCodeHarness()` instead,** the way you fill `codexHarness()` and `cursorHarness()`: `fill: { [harnesses.slots.harnesses]: [claudeCodeHarness(), claudeCodeHarness({ plan: true })] }`. `plan: true` gives the `claude-code-plan` value. A run's work collections (`observed-file-ops`, `observed-gaps`, the plan record) are served by the flow that runs it, so there is no `claude-code` flow.
  - `@flow-state-dev/codex` and `@flow-state-dev/cursor` drop their dependency on `@flow-state-dev/harness-manager`.

  Docs: packages/claude-code/README.md · packages/harness-manager/README.md · apps/docs/docs/reference/kits.md, apps/docs/docs/reference/harness-runs.md and apps/docs/docs/build/webhooks/github-reviews.md (every `claudeCode()` becomes `claudeCodeHarness()` in the `harnesses` fill; the `claude-code` flow is gone)

- e74debe: The harness kit names its default coder in the coordinator's context, and workforce can retire a worker setting (FIX-2877).

  - **The default coder in context.** When the kit has a `defaultHarness`, the readiness rows it puts in a coordinator's context are followed by a line naming the default coder, by its label. The coordinator starts coding work on the coding worker that runs on it unless the user names another. `harnessReadinessCapability(readiness, defaultHarness?)` takes the default as a second argument. With no default, there is no line.
  - **Workforce: `retiredSettings`.** A worker flow registration (`workerFlow(build, { retiredSettings })` or the `{ flow, retiredSettings }` entry) and the kit's `agent` config can retire a setting. A worker stored with that setting is read without it and keeps running. A hire or an edit that names it is refused by name, and nothing is written. An edit of such a worker drops the setting from what is stored.

  Docs: packages/harness-manager/README.md (the readiness capability's second argument) and packages/workforce/README.md (`retiredSettings`)

- 7c6f8ae: A coding run's review opens a changed file's diff in place, with no pull request needed (FIX-2796).

  - **harness-manager:** the harness kit's `coder` flow serves the `changes` session view (`harnessRunChangesView`) on each run's session. `runChangesViewRef()` from `@flow-state-dev/harness-manager/browser` addresses it: `client.view(runChangesViewRef(), { path }, { sessionId })` answers one file's patch.
  - **shift-manager:** the review card in Inbox, the Shift Coordinator summary and a task's session opens each changed file into its patch, read when the file is opened. A review raised by a flow other than `coder` lists its files without opening them, as before.

  Docs: packages/harness-manager/README.md (the coder flow's views, and `runChangesViewRef` in the browser entry)

- d9e9b78: Shift Manager's coder is the harness kit's `coder` flow (FIX-2877). It no longer runs a coding flow of its own.

  - **Breaking: `openLab`'s harness options.** `openLab` takes `harnesses` (harness values, the one list) and `defaultHarness`. `harness`, `harnessName`, the named-harness record, `harnessValues` and `stopsOnAbort` are gone, with no alias: pass the slot as a harness value (`readyHarness(slot, id)` for a scripted one), and declare stop-on-steer on the harness block (`stopsOnAbort`). `selectHarness(...)` returns the coder as `value`, a harness value, in place of `slot`; `startHarness(...)` returns every harness as `harnesses`.
  - **One list of coders.** The DevTeam and `fsd` profiles hand the kit all four harnesses: the scripted coder, Claude Code, Codex and Cursor. The readiness view now lists all four, not only Claude Code, and the scripted coder always reads ready. `DEVFORCE_LAB_HARNESS` still picks the coder a worker naming none runs on; a `coder` worker with `harness: cursor` (or `codex`, `claude-code`) still runs on that one.
  - **A task on a harness this machine can't run is refused at once**, saying why, before any run starts. Before, a Codex or Cursor run with no sign-in failed inside the run.
  - **A hire naming a harness Shift Manager doesn't run** is refused by the kit's setting check, listing exactly the harnesses the coder runs, in place of Shift Manager's own wording.
  - **One run budget.** Every run may take `DEVFORCE_LAB_RUN_MINUTES` minutes, 20 by default, whichever harness runs it; the scripted coder's one-minute budget at start is gone.
  - **Same tasks, same keys.** A task carrying the feature marker still implements it (the `implement` mode, needing a commit) and any other is answered (the `answer` mode). Runs keep the keys, branches and checkouts they were stored under, so a run in flight across the upgrade is found where it was. Block names in a run's trace now name the shared flow (`coder-<harness>-implement`, `coder-<harness>-answer`).
  - **harness-manager: a mode can work in its task's project on its own.** A mode registered on the harness kit takes `project` (`modes: { answer: { project: true } }`): its runs hold the project collections their workspace reads and run the project's checks, whatever the kit's `project` is. Whether a filing needs a project stays the kit's. Shift Manager's `answer` mode sets it, so a Lab on one fixed repository still answers in a task's project.
  - **harness-manager: the kit's `review` is a floor.** A worker's `review:` line can turn review on when the kit's is off, and can no longer turn it off when the kit's is on: a worker hired with `review: false` on an app with `review: true` still waits for a user's review before a run with commits completes.
  - **harness-manager:** the coder flow refuses at start a harness that keeps session state beneath its task entry, naming the entry; and `hostForConfig`, the workspace host a fixed repository runs through, is exported from `@flow-state-dev/harness-manager/checkout`.

  Docs: packages/shift-manager/README.md, where it describes running from a checkout and `DEVFORCE_LAB_HARNESS` (`DEVFORCE_LAB_HARNESS`: readiness lists every coder; a task on one not set up here is refused at once; one run budget); packages/harness-manager/README.md (the kit's `modes`: a mode's own `project`)

- ea5582c: The harness kit's `coder` flow takes an app's modes, tool approval, and the app's own worker settings, documents and actions (FIX-2877). An app that sets none of them runs as before: the same one mode, the same manager names, the same run keys.

  - **`modes`.** A map from a name to `{ instructions, doneWhen, workspace?, requires? }`: how a run is told what to do, when it counts as done, where it works (a workspace host, as the kit's `workspace` is; absent: the kit's), and the task-input fields a task in that mode needs (`"issue"`, `"project"`). `doneWhen` takes the full `{ check, timeoutMs?, validate? }` or a bare check function. Absent, the kit has its one mode, `default`. A `default` entry is completed from the kit's own, so `modes: { default: { instructions } }` keeps the kit's done check and workspace; any other entry needs `instructions` and `doneWhen`. The kit's `checks` wrap every mode. A mode other than `default` names its managers `coder-<harness>-<mode>`.
  - **`defaultMode`.** The mode a task that names none runs. Default `default`. Until a task names its mode itself, a task carrying the `harnessFeature` marker runs the `implement` mode when the app registers one, and the default mode otherwise.
  - **Refused at start, naming the mode:** a `defaultMode` that isn't registered (with the modes there are), a mode name that can't key a run, a mode other than `default` with no `instructions` or `doneWhen`, a mode workspace that isn't a workspace host, and a `requires` field a task doesn't carry.
  - **`approveTools`.** Forwarded to every run's manager: a run asks the user before its tool calls.
  - **`worker: { settings?, resources?, actions? }`.** The app's own part of the flow, which the flow carries and never reads: settings a worker's file may set beside `harness` and `review` (a schema shape by key), documents installed at flow level, and actions built on the installation (`(installation) => ({ … })`). A setting or action the flow already declares (`harness`, `review`, `respond`) is refused, and so is a document under an accessor the flow already declares for a different resource.
  - `codingDrainBudgetMs` takes `modes` and waits for the longest done check of any mode.

  Docs: packages/harness-manager/README.md (the kit's options)

- a8c9519: One way to hand the harness manager a workspace (FIX-2933).

  - **New: `localRepoWorkspaceHost({ root, repo, baseRef?, setup?, pullRequestRepo?, provisionTimeoutMs? })`** in `@flow-state-dev/workspace` returns a workspace host whose every run is a worktree of one repository on this machine, its branch kept in that repository. A relative `repo` is resolved. A host whose source changes per run, or that cuts from several repositories, still calls `localWorkspaceHost`.
  - **Breaking:** `harnessManager({ workspace })` takes a `WorkspaceHost` only. The `{ root, sourceRepo, baseRef }` object form is gone: pass `localRepoWorkspaceHost({ root, repo: sourceRepo, baseRef })`. `WorkspaceConfig` and `hostForConfig` are removed, with no alias. A mode's `doneWhen.validate` receives the host.
  - **Breaking:** in `@flow-state-dev/harness-manager/checkout`, `checkoutPathFor(root, location)` takes the host's root, and `provisionCheckout(host, answer, location)` takes the host and the run source's answer.

  Docs: packages/workspace/README.md (the new helper) · packages/harness-manager/README.md (its `workspace: { root, sourceRepo, baseRef }` example becomes `localRepoWorkspaceHost({ root, repo, baseRef })`)

### Patch Changes

- a739475: A follow-up of a coding task (`followUpOf`) now continues its root task's run (FIX-2274): the same checkout and branch, with the root's commits in place, and the root's coding session. A follow-up of a follow-up continues the same root. The mode stays part of the run: a follow-up run in another mode than its root's has a run of its own. One task of a chain runs at a time: on a board with no one-open-task start test, a follow-up claimed while another task of its chain is still running fails that attempt, naming the running task, and the board's retry tries it again later. A task with no `followUpOf` keeps its run where it was. A host's own session door keys a task's run the same way with the new `runIssueSegment(task, lookup)`. `readModeRunRecord` takes, in place of the reading task's id, a test of whether a recorded task id is this run's, so a follow-up finds its root's run under a former key too.

  Docs: packages/harness-manager/README.md (a host's own session door keys `runOf` with `runIssueSegment(task, lookup)`, not `taskIssueSegment(task.id)`, so a follow-up reads its root's run)

- 51b4b3e: A message sent to a coding task that waits on its pull request is always answered, even when the pull request has already merged or closed (FIX-2884).

  - **harness-manager:** with `awaitPullRequests`, a user's message (a line in the task's session, or a steer) that wakes a task whose pull requests have merged or closed now runs the harness on the same session. The brief tells the run what became of each pull request, in place of the lead for one still open, and asks it to answer rather than push. The settle after that run completes or cancels the task as before. Before, the message was taken with no run and never answered. A wake carrying only the pull request's own news (a delivery from GitHub, a deadline) still settles with no run.
  - **harness-manager:** that turn only answers: it asks for no review of the run's changes, and a judge's reading doesn't stop the settle. A message sent while the wake reads GitHub is answered the same way.
  - **harness-manager:** when a task settles on its pull request, the output's `landed` pull request records `state: "merged" | "closed"` (matched by the pull request's address). `landedOf` reads it, so the coding board's `landed` carries it too.
  - **shift-manager:** a finished task's landed pull request says "It has merged." or "It was closed without merging." in place of "Next: review and merge it."

  Docs: packages/harness-manager/README.md (`awaitPullRequests`: a user's message on a merged or closed pull request runs the harness)

- a8ba338: A coding run's review no longer offers to open a pull request when one is already open from its branch (FIX-2920).

  - **harness-manager:** with `reviewChanges` on, a review asked about a run whose branch has a pull request open that no accept on this task landed on yet (for example, one the coding session opened itself) now names it. Its data carries `openPullRequest: { number, url }`, read by `reviewDetail` (`null` when none is open, or on data from before the field), the pull request is listed in `pullRequests`, and the prompt says "Pull request #N is already open from <branch>: <url>. An accept that lands as a pull request puts the work on it; no second pull request is opened." The ways to land are unchanged. A user's `pull-request` accept goes only onto that pull request: if it closed since, nothing is pushed or opened, and the review is asked again with the error and without it.
  - **shift-manager:** the review card's accept onto that pull request reads "Accept: Push to PR #N" instead of "Accept: Open a PR".

  Docs: packages/harness-manager/README.md (the `reviewChanges` section: a review on a branch with a pull request already open names it as `openPullRequest`, and an accept lands there)

- aec3d83: A worker flow says what its tasks take on its `work` entry: `workerTaskEntry({ name, block, inputSchema: taskInputSchema(schema, { serverOwned, fill, refuse, check, stored, project }) })` (FIX-2894). Every write that files a task for one of its workers is checked against it before anything is written: `createTask`, a batch (refused whole), a routed task, a step filed `session: "new"`, `updateTask` (its input, and a move to another worker), and the raw ledger handles `filingConversationBoard()` and `conversationLedgers()` hand a task session. A misfit is refused `input_refused`, naming the delegate, its flow, the field and what was expected; nothing is filed. A field named in `serverOwned` is dropped from what a filer sends and written by the flow's `fill`; `updateTask` keeps its stored value; a `check` that changes one is refused as a bug in the flow. A value that would not survive being stored as JSON is refused by name, and a schema that can break the round trip (`.transform`, `.preprocess`, `.pipe`, `.catch`, `z.coerce.*`, `z.date`, `z.bigint`, `z.map`, `z.set`) is refused when the flow is built. Assigning an unassigned task, or moving one onto a worker on another declared flow, is a filing for that flow, its filler included. The claim parses the stored row again (through the flow's `stored` read, for a row in an old shape), fills the server-owned fields again when the row was filled under another declaration or flow (`fill` is called with `at: "claim"`), and hands the worker block the parsed input; a row that no longer fits fails its attempt, `Nothing ran.` A flow that declares nothing takes any object, as before. `listDelegates` gains `inputSchema` on each delegate: `{ jsonSchema, project }`, the fields a filer may write as JSON Schema draft-07 with every reference inlined, or `null`. A rule only `check` or `refuse` enforces belongs in the field's `.describe()` text, so a model reads it before it is refused.

  **Breaking (pre-1.0):** the `needsProject` hire option is removed from `workerFlows` entries and `workerFlow(build, options)`, with no alias; passing it throws, naming the replacement. Declare `taskInputSchema(schema, { project: "required" })` on the flow's `work` entry instead (an open flow: `taskInputSchema(z.record(z.string(), z.unknown()), { project: "required" })`). The harness kit's `project: true` now does this for the `coder` flow. Code that wrote a misfit through a raw ledger handle is now refused.

  Orchestration: `TaskSettingsPatch.ifRevision` writes an edit only while the row is still at that revision, else it is declined `revision-moved`; `TaskWriteRefusedError` is exported from `@flow-state-dev/orchestration/tasks`, for a flow's task-input hooks to throw.

  Docs: apps/docs/docs/workforce/delegating-work.md (new section "What a delegate takes": the declaration, the refusal, `listDelegates`'s `inputSchema`, and the rule that a `check`-only rule goes in the field's description), apps/docs/docs/workforce/projects.md (where it registers the coding flow with `needsProject: true`: declare `project: "required"` on the work entry), packages/workforce/README.md (the `workerTaskEntry`, `workerFlow` and `listDelegates` rows; `taskInputSchema` added), packages/orchestration/README.md (`ifRevision` on `patchSettings`).

- Updated dependencies [990ebc5]
- Updated dependencies [73aa85a]
- Updated dependencies [3a21218]
- Updated dependencies [8111572]
- Updated dependencies [ce105b1]
- Updated dependencies [019b156]
- Updated dependencies [81387f7]
- Updated dependencies [5c9acb4]
- Updated dependencies [8828dd9]
- Updated dependencies [fad96df]
- Updated dependencies [9b18dd4]
- Updated dependencies [7ac7f90]
- Updated dependencies [e74debe]
- Updated dependencies [136e348]
- Updated dependencies [16e6852]
- Updated dependencies [6968618]
- Updated dependencies [45650b1]
- Updated dependencies [aec3d83]
- Updated dependencies [c51d3e6]
- Updated dependencies [9930b5e]
- Updated dependencies [a8c9519]
  - @flow-state-dev/workspace@0.6.0
  - @flow-state-dev/client@0.6.1
  - @flow-state-dev/core@0.7.0
  - @flow-state-dev/workforce@1.1.0
  - @flow-state-dev/orchestration@0.8.0

## 0.6.0

### Minor Changes

- ffbe992: An app can follow and drive its users' worker sessions through package hooks and calls, with no stream, subscription or flow address of its own (FIX-2757).

  - **client:** a session feed's snapshot has `historyLoaded`, `true` once the history read has landed, so an empty session can be told from one still being read. `request(id).stream({ reconnect: true })` keeps following until the request ends: a failed connection opens again after the client's backoff (1 s, doubling, at most 30 s), resuming after the last event, without reporting it; five empty answers in a row (a request that already ended) or a 401, 403 or 404 still end it with `onError`, and `close()` ends it, a reconnect waiting on its backoff included. A user or org collection's handle has `listAll()`, every entry page after page, stopping with `CollectionReadStoppedError` on a repeated cursor or past 1,000 pages.
  - **react:** `useSessionFeed(sessionId, { itemTypes, client })` follows one session live (its items once the history lands, `[]` for an empty session even while its stream is still connecting; its unfinished runs and connection state, `loadEarlier`, and `followResponse` for a streamed send). `useRequestStream` takes `reconnect: true`, handed to the client's stream above, a `client` of the host's own, and asks for no flow while `enabled: false`. `useResource` takes `client` and `pollIntervalMs` at user and org scope.
  - **workforce:** the workforce client opens a new session with a worker (`startSession(worker, { fields })`, writing the app's session fields at open), sends to it (`send`, or `send(..., { stream: true })` for the streamed `Response`), each on the instance of its flow that owns the session, stops its running turns (`stopTurns`, resolving to the ids it stopped) and runs a failed turn again (`retryTurn`). `operatorGitHub({ operator, token })` and `operatorGitHubToken()` give a single-user host GitHub routines on the operator's own token, for the operator alone.
  - **harness-manager:** each coding board row names `runFlow`, the flow its run's session runs on, so a screen reads that run's own stream without looking the session up.
  - **workspace:** `sessionRepositorySource({ field, repositories, check })` is the run source for a host whose sessions each work in one repository a session field names; `listedRepository` maps a path or `file://` remote to the listed repository it is. `setupCommandFrom(value, setting)` reads a setup command from a setting, beside `checkCommandsFrom`.
  - **store-sqlite:** `sqliteScheduleIndex({ filename })` is a schedule index on a SQLite file of its own.

  Docs: packages/client/README.md (the session feed snapshot's `historyLoaded`; `request(id).stream`'s `reconnect`; a collection handle's `listAll`), packages/react/README.md (`useSessionFeed`; `useRequestStream`'s `reconnect` and `client`; `useResource`'s `client` and `pollIntervalMs`), packages/workforce/README.md (the client's `startSession`, `send`, `stopTurns`, `retryTurn`; `operatorGitHub`), packages/harness-manager/README.md (the coding board row's `runFlow`), packages/workspace/README.md (`sessionRepositorySource`, `listedRepository`, `setupCommandFrom`), packages/store-sqlite/README.md (`sqliteScheduleIndex`)

- c105282: A coding run's branch now starts with the app's own prefix instead of `conductor/` (FIX-2857). `harnessManager({ branchPrefix })` and the harness kit's `harnesses({ branchPrefix })` take it, such as `"teammates/"`: lower-case letters and digits with single `-` or `_`, ending in `/`, at most 32 characters, refused at construction otherwise. With none set, a new run's branch is `fsd/<name>`. The name and the folder are unchanged, and a run already recorded on a branch, `conductor/…` included, keeps that branch and its worktree.
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

- 2cb6326: A coding task can wait for its pull request to merge before it completes (FIX-2578).

  - **harness-manager:** new option `awaitPullRequests` (off by default). When it is on, a task whose run opened a pull request does not complete at its settle. It waits on its pull requests, and each wake reads them through `gh`: all merged completes the task with no new run; none open with some merged completes it and the output notes the closed ones; all closed without merging cancels it with the reason "its pull request was closed without merging"; any still open runs the wake's words as a steer on the same attempt and session, then waits again. A pull request that can't be read never settles the task: it runs the steer, waits again, and adds a status note. A completed run's output gains `pullRequests` (`{ url, number, title, state }[]`, `null` when no wait ran).
  - **harness-manager:** `pullRequestWait(row, records?)` and `PULL_REQUEST_EVENT`, from the package root and from `./browser`, read a task's open pull-request wait for a screen: the hold, when it opened, and each pull request's number, link and title. `CLOSED_WITHOUT_MERGING` is the cancel reason.
  - **orchestration:** a new row hold, `external`, for a running task that waits on something outside the board. It is the system's (`actor: "system"`), never a question: the filer is not told of it, the Inbox does not list it, and `waitsOnUser` is false. It holds the row as a question does (no lease, unclaimable, the waiting turn cannot settle). Open one from the turn holding the claim with `waitExternally(ctx, ledger, { prompt, events })` (`./task-board`) or `ref.awaitExternal(id, wait, { claim })`. A user's line in the task's session answers it, and so does an answer from `"service"`. New readers `holdActorOf(row)` (`"user"`, `"system"` or `undefined`), `externalHoldOf(row)` and `isExternalHold(hold)` from `./tasks`. A board whose only open rows wait on an event ends with the reason `waiting-on-an-event`.
  - **orchestration:** steers and answers gain the source `"service"`, for words from outside the app, with the sender's handle as `by`. A run reads them quoted as the sender's, never as the user's. The filer's answer through `updateTask` on an `external` hold is refused (`wait_is_not_a_question`).
  - **workspace:** `readPullRequest({ cwd, number, repository?, host? })` reads a pull request's `state` and `merged`, a fork's included. `pullRequestHead` also returns `state` and `merged`.
  - **core:** `writePullRequests` keeps a pull request's `state` current: a sighting's state replaces the stored one. Other fields still fill only when null.
  - **workforce:** a message delivered to a task's session whose task waits on an `external` hold answers that wait, as `"service"` from its sender, instead of queueing behind it.

  Docs: packages/harness-manager/README.md (settling: a section "Waiting on a pull request" for `awaitPullRequests`, the four outcomes, the unreadable case, `pullRequestWait` in the `./browser` list, the `pullRequests` output field), packages/orchestration/README.md (the `external` hold beside questions and confirms, `waitExternally` / `awaitExternal`, `holdActorOf`, the `"service"` steer source, the `waiting-on-an-event` reason), packages/workspace/README.md (`readPullRequest`), packages/workforce/README.md (a message to a task waiting on an outside event answers its wait).

- 84b912d: A board's task list and a coding run's changes are views (FIX-2623).

  - **orchestration:** `taskToolViews(collectionId, resolve)` builds a board's task list as a keyed session view, `listTasks_<suffix>`. Its answer is the board's rows as the `listTasks_<suffix>` action lists them, keyed by task id. When a session has no board to list, it is refused with the list's own reason (`422 no_delegation_board`) rather than answered as an empty board. `taskListViewRef(flow, board)` from `@flow-state-dev/orchestration/inbox` is the client's typed handle on it (`TaskListView` is its type): `useView(taskListViewRef(flow, "tasks"), {}, { sessionId })` in React, or `client.view(...)`.
  - **harness-manager, breaking:** `harnessRunChangesRead` is now `harnessRunChangesView`, and `HarnessRunChangesReadOptions` is now `HarnessRunChangesViewOptions`, with the same options. It returns a session view: declare it with `views: { changes: harnessRunChangesView({ board, uses }) }` instead of `reads: { changes: ... }`, and call it on the run's session with `client.view(viewRef(flow, "changes"), { taskId?, path? }, { sessionId })`. The answer is unchanged. `harnessSessionFlow`'s per-turn `changes` is a session view too.
  - **shift-manager:** the Tasks panel and a feed's task cards watch the conversation board's view. They name no topic and read on the view's own timer where push can miss a change.

  Docs: packages/orchestration/README.md (`taskToolViews` keyed, `taskListViewRef`, `TaskListView`), packages/harness-manager/README.md (`harnessRunChangesView`, `HarnessRunChangesViewOptions`, `changes` as a session view), apps/docs/docs/orchestration/harness-manager.md (the changes view replaces the read).

- e5a9596: The coding board view takes an optional `taskId` in its input (FIX-2773). With it, the view still returns every row, and the row it names carries `detail: { answer, answerCut }`: what the task came back with, cut at the same 20,000 characters `getTask` cuts output at. Without it, `detail` is `null` on every row, so a board read stays the size it was. A screen reads a task's answer this way while the task is open, and reads the board without one everywhere else.

  A row's `error` now also carries the reason a cancelled task was cancelled with. Code that reads `error` as a failure should check `status === "errored"` too.

- c064858: The coding board view's row gives each task its title and the state the user sees it in, so a screen reads them from the row and computes neither (FIX-2766).

  - **`title`** is now always a string: the task's title, else its goal, else its id. It was optional, absent when the task was filed with no title. A screen that wrote `task.title ?? task.goal` can read `task.title`.
  - **`state`** is new: orchestration's `TaskView` state of the row (`queued`, `held`, `running`, `waiting`, `failed`, `done` or `cancelled`), worked out with the row's `asks`, so a task with an open ask for the user reads `waiting`. A screen that called `taskView(row, row.asks).state` can read `task.state`.

  Both come from one `taskView` of the row, so they follow orchestration's rules exactly.

  Docs: no page documents the coding board view's row today; when one does, it lists `title` as always set and the new `state`.

- aa28006: The harness kit serves a conversation's coding board, and the coding worker flow serves a run's recorded work, as live views (FIX-2725).

  - `codingBoardViewRef()` with `{ sessionId }` is a user view on the `harnesses` flow. It answers the conversation's board tasks, each with:

    - what holds it for you and where each answer goes (`asks`);
    - its harness (its run's, else its worker's `harness:` setting);
    - how its review ended, where its work landed, and why it failed;
    - the numbers of the pull requests it waits on.

    It reaches a conversation on any flow, including an app's own agent flow. Another user's conversation answers nothing. No action runs in another session to build it.

  - `recordedWorkViewRef()` with `{ requestId }` is a session view on the coding worker flow, at its `recordedWork` name. It answers a run's plan and the pull requests it opened, with their links.
  - The `harnesses` flow is now built through workforce's `flows` slot. Its `readiness` view is unchanged.
  - `landedOf` and `LandedWork` are exported from `@flow-state-dev/harness-manager/browser`.
  - **core:** `observedPullRequestsCollection` declares a `requestId` index, so `findBy("requestId", id)` reads one run's pull requests. It builds from existing rows at its first lookup; stored keys are unchanged.

  Docs: packages/harness-manager/README.md (list `codingBoardViewRef`, `recordedWorkViewRef`, `landedOf`); the Views page's "reading your sessions" section names the coding board as a user view reading across kits.

- 1600ca1: A coding task that opens a GitHub pull request hears each review, comment and CI result on it once, through a signed webhook, from `service:github` (FIX-2535).

  - **workforce:** `githubServiceFlow({ provider, installation, trustedBots, agentHandles })` is GitHub's service flow, with the webhook route declared. `githubSubscriptionProvider({ token })` answers who can read a repository and who the user is on GitHub, on the user's own token. `followPullRequest({ providers })` subscribes a coding session to each pull request it records, hearing its reviews, comments and CI until it merges or closes. `normalizeGitHubEvent` maps a webhook payload, or a poll's object of the same shape, to normalized events; `defineSubscriptionServiceFlow` takes `normalize` (declares the webhook route) and `maxOwnerRuns` (the most subscriptions one event reaches, 100 by default).
  - **core:** a webhook provider entry can be a service route, `webhooks: { <provider>: { service: { entry, normalize } } }`, instead of `on`. `WebhookSubscriptionConfig` is now a union of the two, so code that reads `.on` off it must check for `undefined`. The normalized subscription event gains an optional `addressed: true` when it asks the app's agent. `writePullRequests` takes `onRecorded`, called once per newly recorded pull request; `followRecordedPullRequests(ctx, follower)` hands a request's new pull requests to a `PullRequestFollower`.
  - **engine:** the webhook transport routes a service route's events through `routeServiceEvent`, as `service:<provider>`, answering 202 once each owner run is recorded, 503 when one wasn't.
  - **harness-manager:** `harnessManager({ onPullRequestRecorded })` hands each pull request a run records to the follower, mid-turn.
  - **workspace:** the branch check hands the pull requests it records to the request's follower.

  Docs: packages/workforce/README.md (GitHub's service flow, the provider, `followPullRequest`, the webhook mount), packages/core/README.md (the `service` webhook form, `addressed`, `onRecorded`), packages/engine/README.md (the service route in the webhook transport), packages/harness-manager/README.md (`onPullRequestRecorded`), apps/docs/docs/server/webhooks.md (the service route beside bindings), apps/docs/guides/webhooks-github.md (mount the flow; a task follows its pull request; `sessionId` routing for GitHub is gone)

- dde9a4b: Harness readiness is read as a view, with no session (FIX-2624).

  - `harnessReadinessView(readiness)` is the readiness read as a user-scope view. Install it on a flow with `views: { readiness: harnessReadinessView(readiness) }`. It takes `{ refresh?: boolean }` (`refresh: true` is Re-check) and answers one row per harness, keyed by harness. The rows are this machine's, the same for every signed-in caller; the answer names no change topic.
  - `harnessReadinessViewRef(flow, view?)` from `@flow-state-dev/harness-manager/browser` is the client's handle on it, for `client.view(ref, { refresh })` or `useView(ref)`. The view name defaults to `"readiness"`.
  - `HarnessReadinessViewDefinition` is the view's type.
  - `harnessReadinessAction` is removed, with no alias. Install `harnessReadinessView(readiness)` in the flow's `views` instead of the action in its `actions`, and read it with `client.view(harnessReadinessViewRef(flow), { refresh })` instead of sending the action in a session; the answer is the rows themselves, not `{ harnesses }`.

  Docs: packages/harness-manager/README.md ("Which harnesses can run here": the view and its client handle in place of the action; swap `harnessReadinessAction` for the three names in the supported-API list), apps/docs/docs/orchestration/harness-manager.md (the "A screen" bullet and its example: install the view, read it with no session, Re-check as `{ refresh: true }`; drop `harnessReadinessAction` from the export list), packages/shift-manager/README.md (Usage: `openLab({ readiness })` puts the `readiness` view on the projects flow, not a `harnessReadiness` action)

- 23517c7: A coding run starts from one brief, whatever app hands it the task and whichever harness runs it, and the brief names the checks that decide done (FIX-2502).

  - **`codingBrief(run, parts)`** builds a coding run's task prompt: the task (its title, goal, context, and capped dependency output) first, then the app's own parts (`instructions`, a `standingBrief`, `conventions`, and `terms` for what counts as done), where and how to work, the run's answered questions, the report it owes (what changed, each command run with its result, what could not be checked), and why the last attempt stopped. With no `conventions`, it points at the repository's `AGENTS.md` or `CLAUDE.md`. `report: false` leaves the report out, for a run whose last message is the answer the user reads and which no check follows. It is the prompt, not a system prompt, so Claude Code, Codex and Cursor read the same words. A phase that wants a different brief keeps its own `buildPrompt`.
  - **`inBrief` on `CommandCheckOptions`.** `commandCheck(phase, { commands, timeoutMs, inBrief: true })` adds a section to the phase's prompt naming each command that decides done, and asks the run to run them first and name each in its report with its result. `harnessSessionFlow`'s `verify` takes the same option and adds the section to every turn. Both read the same `commands`, so the brief can't name a check that doesn't run. A resolver is then also called before the run: `commandCheck` hands it the run's context with `stopReport`, `answer` and `baseCommit` set to `null`, so a resolver must not read them to leave a check out, and `verify` hands it the session's directory, set up first on a fresh session. Off by default: a caller that sets neither sees no change.
  - **The harness kit's `coder` flow** builds its brief with `codingBrief`, and its checks (the kit's `checks`, or a project's) are named in it. The brief now leads with the task, and the worker's instructions follow it.
  - **shift-manager:** a coder's brief is `codingBrief` with the worker's instructions, standing brief and skills, and on a project it names the project's checks. The report it owes is in the brief, so a Codex or Cursor coder is asked for it too; Claude Code's appended system text is gone and its preset stays.
  - **`harnessSessionFlow`'s brief step** is one block, `turn-brief`, carrying the issue spec (with `issueSpec`) and the checks (with `verify.inBrief`). It was `issue-spec-brief`. A turn sets up its workspace once: the brief and the harness share one working directory, so a setup command runs once per turn.

  Docs: packages/harness-manager/README.md (a "Briefing a coding run" section after "What a phase supplies": `codingBrief` and its parts, with the `commandCheck` example using `inBrief: true`; one line under "Checking the work with commands" on `inBrief`; one line under "A harness as a session" on `verify.inBrief` adding the checks to every turn), apps/docs/docs/orchestration/harness-manager.md (the same three: a "Briefing a coding run" section after "What a phase is", a line under "Checking the work with commands", a line under "In a coding chat").

- de09b77: **Breaking:** 1,107 exports are removed from the roots of the published `@flow-state-dev/*` packages, with no deprecated aliases, so importing one from a package root no longer compiles; some of them are still exported from another entry of the same package (FIX-2562).
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

- 03be7e4: A coding run's report now comes under fixed Markdown headings, and a browser card can read it back as parts (FIX-2870).

  - `codingBrief` asks every run to end its last message with `## What changed`, `## Checks` (one bullet per check, each led by `passed:`, `failed:`, `pre-existing:` or `not done:`) and `## Worth knowing` (follow-ups, debts, oddities). The report is still Markdown a person reads whole, so an app that shows the answer as it is loses nothing.
  - `runReport(answer)`, from the package root and `@flow-state-dev/harness-manager/browser`, reads those sections back: `{ changed, checks: [{ status, text }], notes }`, or `null` for an answer with none of the headings. `RUN_REPORT_HEADINGS` names the three headings.

  Docs: packages/harness-manager/README.md (the coding brief's report, and `runReport` beside `reviewDetail`)

- e77c376: A harness session's turn now has a deadline (FIX-2680).

  - **harness-manager:** `harnessSessionFlow` takes `turnTimeoutMs`, how long the harness may run in one turn, in ms. **Default 60 minutes**, where before a turn had no deadline: a turn that legitimately runs longer than an hour is now stopped unless the host raises it. At the deadline the harness step is stopped through the same abort a stop uses, so a harness that stops its process on abort (Claude Code, Cursor) takes the agent's process group down with it. The turn fails with the error `the turn's harness timed out after <ms>ms and was stopped`, the harness's own error as its `cause`. With `approveTools` on, time waiting on a user's answer about a tool call doesn't count: each run the turn resumes gets the whole deadline again. A value that is not a positive whole number of ms a timer honours (at most 2147483647) is refused when the flow is built.
  - **harness-manager:** a turn's record (`harnessTurnRecordSchema`) gains `timedOut`: `true` on a turn stopped at its deadline, whose `stopped` is `false` so a page tells it apart from a person's stop; `null` otherwise, and on records stored before it.

  Docs: packages/harness-manager/README.md (the session flow's options: `turnTimeoutMs` and its 60-minute default; the turn record's `timedOut` field).

- 9f8b8d3: A coding task's branch and worktree folder are now one short name made from the task's title, so its pull request can be pushed to GitHub (FIX-2657).

  - **harness-manager:** a board run's branch is `conductor/<name>` and its folder `<root>/<name>`, where the name is a slug of the task's title (led by the tracker issue when the task names one, at most 32 characters) and 6 hex of the run's identity, for example `conductor/fix-2657-cap-failed-at-five-3f9a1c`. The full ref stays under 100 bytes. Before, the branch spelled the tenant, organization, user and board out as full digests, and a run on a conversation's board pushed a ref over GitHub's 255-byte limit, which GitHub refused (`GH005`). When another run holds the name, or another worktree or branch already has it, a new run takes `-2`, `-3` and so on. A run already under way keeps the branch and folder its record names. The worktree's `name` in the `worktrees` resource is the same name. New exports from `@flow-state-dev/harness-manager/checkout`: `runName`, `freeRunLocation`, `worktreeNameFor`, `runIdentityKey`, `locationFor`. **Behaviour change for hosts deriving a run's place themselves:** `branchFor`, `checkoutPathFor` and `provisionCheckout` now give the short shape. For a run recorded in the old long shape, find its location with `locationFor(location, recordedBranch)`, or pass `nested: true`.
  - **workspace:** `WorkspaceHost.reserve` reserves a place's and branch's names for one run, atomically, refusing a name another run holds or a worktree or branch already has. The local host keeps the holder in a `<place>.holder` file beside the place. A host without it gives a run its derived name as it is. `WorktreeRecording.name` sets a worktree's name when the caller already named the worktree.

  Docs: packages/harness-manager/README.md (where a run's checkout and branch are, and what they are named), packages/workspace/README.md (`reserve`, `WorktreeRecording.name`)

- 81c145c: A task filed with files keeps them in its brief, and every run of the task gets them (FIX-2522).

  - **orchestration:** a task has `attachments`, its brief's files as stored references, beside `context`. `createTask` fills it with copies of every file the turn that files the task carried; a model can't set it, and `updateTask` takes no files. Like `context`, the files are fixed once the task starts (`TASK_FIELD_RULES.attachments`). Every run is handed them on its input (`TaskWorkerInput.attachments`). When the turn's files can't be kept (a server with no blob store), `createTask` refuses with `task_files_not_kept` and files nothing.
  - **core:** `attachmentReferenceSchema` (`@flow-state-dev/core/attachments`) reads a stored file's reference and refuses bytes. An action's `userMessage` may return `attachments`: files the flow kept itself, written on the line after the user's own.
  - **engine:** a task's copies belong to the user's own scope, not the conversation, so deleting the conversation leaves them. Any run of that user reads them, in any session; nobody else's does. `GET /api/flows/blobs/:id` serves them to that user only, signed in as the flow that kept them signs them in; anyone else, an anonymous caller included, gets 404.
  - **workforce:** a conversation's task run opens with the brief's files on its brief line, so a generator worker's model reads them with the brief. The board's browser read carries `attachments`.
  - **harness-manager:** a task's coding run hands the harness the brief's files beside the prompt on every attempt. A harness that declares no `accepts` is never handed one: the attempt fails, naming the file.
  - **shift-manager:** every composer (a task's, a workstream's, Inbox's reply, the Shift Coordinator's) takes files by paste, the + button or a drop, and sends them with the line. A line that fails to send keeps its files for Retry. A task's brief shows its files on the task screen and on the brief line in its session.

  Docs: the Shift Manager README gains _Attaching files_ (composers, a task's brief, Retry). The orchestration README's task fields gain `attachments`. The attachments guide gains a line: a task filed from a message keeps its own copy of that message's files.

- d23352d: Subscription usage and worker usage are read as views, with no session, and Re-check is a write through the usage flow (FIX-2624).

  - `harnessUsageFlow({ readers, timeoutMs? })` is the flow a host registers once, at `HARNESS_USAGE_FLOW` (`"harness-usage"`). Its `usage` view answers `{ harnesses }`, the same rows as before, and starts nothing. Its `recheck` action asks each reader, at most once a minute per user and harness, stores the reading, and answers `{ asked }`, the harnesses asked this time.
  - `harnessUsageCollection` (`harness-usage/**`) now names that flow as its `runBy` and allows a client read of the caller's own rows, without `account`, `accountAt`, `noSubscriptionAt` and `lastAttemptAt`, which stay on the server (`secret`). A client re-checks by sending `recheck` to the collection, which runs in the caller's own write session; no session is named or made by the client.
  - From `@flow-state-dev/harness-manager/browser`: `harnessUsageViewRef()`, for `client.view(ref, {})` or `useView(ref)`, and `recheckHarnessUsage(client)`. `HarnessUsageViewDefinition` is the view's type.
  - `harnessUsageAction` is removed, with no alias, and so are `harnessSessionFlow`'s `harnessUsage` action and its `usageReaders` option. Register `harnessUsageFlow({ readers })()` beside your flows instead, and read with `client.view(harnessUsageViewRef(), {})`; replace `{ refresh: true }` with `recheckHarnessUsage(client)` before the read. A harness session flow still records the windows its runs report.
  - The roster flow serves a `workerUsage` view, each worker's tokens over `{ days? }`, answered at user scope with no session; `workerUsageView` from `@flow-state-dev/workforce/browser` is its handle and `WorkerUsageViewDefinition` its type. `hireWorkforce` installs it, so every app with a roster flow has it. `workerUsageAction` and `WORKER_USAGE_ACTION` are removed, with no alias: drop the action from your flow and read the view.
  - Shift Manager's Usage reads both views and opens no reading or usage session of its own.

  Docs: apps/docs/docs/orchestration/harness-manager.md ("Subscription usage": register `harnessUsageFlow`, read the view, Re-check with `recheckHarnessUsage`; the collection is client-readable and written through its `runBy`; drop `harnessUsageAction`), apps/docs/docs/workforce/worker-usage.md (the roster flow's `workerUsage` view in place of `workerUsageAction`), apps/docs/docs/shift-manager/overview.md (the usage and worker usage prerequisites: the usage flow and the roster flow, not actions), packages/harness-manager/README.md, packages/workforce/README.md and packages/shift-manager/README.md (the same swaps in their API lists).

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

- 95d9686: A pull request a coding run follows with `followPullRequest` now stops being followed when the run's task fails or is cancelled, also when the run's session works more than one task. A `PullRequestFollower` is handed a third argument, the run (`FollowingRun`, with its `taskId`), and harness-manager passes it; `subscribe`'s server-side write takes a `taskId` for the same purpose. A session that saves its own routine on a pull request it follows keeps hearing that pull request's merge or close (FIX-2786, FIX-2787).

  Docs: packages/workforce/README.md (`followPullRequest`: a failed or cancelled task ends the follow), packages/core/README.md (`PullRequestFollower`'s `run` argument).

- f5caf94: The harness kit can follow the pull requests its coding runs open. `harnesses({ onPullRequestRecorded })` takes a builder that the kit calls with the installation its coding flow is built on, for example `(installation) => followPullRequest({ providers: [github], installation, screens })` from `@flow-state-dev/workforce`, or `githubTrustedReviewers(...).follow(github)`, which hears only the trusted reviewers. The kit hands the follower it returns to every harness manager it builds, so a run's session hears its pull request's reviews, comments and CI from the moment it opens. Without the option, nothing is followed, as before (FIX-2869).

  - **The `allow` screen takes `bots`.** With it, a bot sender must be one of `bots` and any other sender one of `ids`. GitHub sends a bot's id as its app slug without `[bot]`, the same form as a user's login, so a user who registers a listed bot's name doesn't pass as that bot. Without `bots`, the sender's id alone is checked, as saved subscriptions are. `ids` may now be empty, which allows no user.
  - **`followPullRequest` takes `outsiders: true`**, for use with a screen that names who is heard.

  Docs: packages/harness-manager/README.md (the harness kit's options: `onPullRequestRecorded`), packages/workforce/README.md (following a pull request: `followPullRequest({ outsiders })`, the `allow` screen's `bots`)

- 1d23553: With `awaitPullRequests` on, a goal judge's confident `not-done` no longer fails a run that opened a pull request (FIX-2579). The task waits on its pull request as any other run that opened one does, and the judge's reason is said in a status note. A run that opened no pull request still fails on a confident `not-done`, and with the option off nothing changes.

  Docs: packages/harness-manager/README.md (the `awaitPullRequests` entry: a judge's `not-done` doesn't fail a run that opened a pull request).

- 2e63b30: A coding run that merged its moved-on base branch into its own branch is now judged and reviewed on its own work: the judge's commit count, subjects and diff, and the review card's files, match the pull request's diff (where the branch meets the base branch's tip now), not everything since the commit the branch was cut at (FIX-2859).

  - **workspace:** `WorkspaceHost` has a new optional method, `baseTip({ cwd, baseRef })`: the commit the run's base branch is at now, fetched from the remote the host pinned, into the checkout's object store. It answers only a commit that fetch brought, never a local branch or tracking ref a run could move, and `undefined` for a checkout outside a listed repository, a base named only as `HEAD` (whichever branch the repository is on when asked), a base with no pinned upstream, or a failed fetch. `localWorkspaceHost` implements it; a custom host may leave it out.
  - **harness-manager:** at settle the manager asks the host for the tip once and reads the run's commits, its diff and a round's commits against it, when it has the recorded cut in its history (`effectiveCut`). Any other tip, or none, leaves the cut as the base, as before: the reads can over-report the base's commits, never hide the run's. The commit the settle read against is kept on the run record (`effectiveCut`, `null` on older records) on every settle, so a file's patch opened from the `changes` view later matches the review's files and the judge's read; `baseCommit` stays the commit the branch was cut at. Every commit and diff read now ignores replace refs, grafts and the commit-graph in the run's checkout, so a run can't rewrite the base's history to hide its own commits.

  Docs: packages/workspace/README.md (the `WorkspaceHost` method list: `baseTip`)

- cc91d7a: Landing an accepted run is safer, and is offered only where it can work (FIX-2543).

  - **workspace:** a local merge never runs a program set in the checkout's own git config, which a run shares: fsmonitor, filters, merge drivers and signing programs fall back to your global or system config, or are off. `gh` runs outside every checkout, with `--repo` taken from the pinned remote URL and an explicit `--head`, so it never pushes or reads a run's config; a remote that names no GitHub repository is refused as `no-pull-request-repo` before anything is pushed. Set `pullRequestRepo` on `localWorkspaceHost` when the pinned URL doesn't name the repository itself. A merge that fails is undone under its own time limit and checked; if the checkout couldn't be put back, `merge-failed` says so. New: `WorkspaceHost.landWays(target)`, the landings that will work for a run (none for a run cloned from a remote).
  - **harness-manager:** the review offers only the landings the host's `landWays` answers, so a run that can't be landed keeps the plain Accept. The workspace config gains `pullRequestRepo`.

  Docs: apps/docs/docs/orchestration/harness-manager.md

- 3f23173: Open a PR and Merge locally on a coding run's review now find their way past a failure instead of giving up after one (FIX-2658).

  - **workspace:** `land` lands the branch the run's checkout is on when the run's own branch is gone (the run renamed it, or moved its work to a branch it named), provided it holds commits over the new `LandTarget.baseCommit`; `Landed.branch` names the branch landed. A pull request already open from the branch is the landing, and no second one is opened. A push refused then is let go only when the remote branch already holds the checkout's tip; otherwise it is `push-failed`. A gone branch with nothing to land is refused as `branch-gone`.
  - **harness-manager:** a landing that fails is handed to the run's coding session as one more step, with the exact error and the person's note, and tried again when that step stops, without asking the person. New option `landAttempts` (default 3) caps the tries; `1` asks the person after every failure, as before. Failures no run can fix (no remote, no GitHub repository, a repointed remote, an unknown base, a host that can't land) go straight back to the person. An accept takes optional `words`. The review's data carries `landAttempts`, every try with its error, which `reviewDetail` reads.

  Docs: packages/harness-manager/README.md (`landAttempts`, the hand-off to the coding session, `words` on an accept), packages/workspace/README.md (`land` and a moved branch, an open pull request, `baseCommit`, `branch-gone`)

- c049036: `harnessManager` no longer refuses the removed `announce` option; it is an unknown option that nothing reads. Read held tasks from the board (`openRowHolds`) (FIX-2454).

  Docs: packages/harness-manager/README.md (drop "`harnessManager({ announce })` is refused at construction"). The old name is removed outright, with no refusal message.

- 74a7b9d: What you read from FSD no longer names our internal issue tracker (FIX-2453). Editor hovers in every package, error messages and UI copy say what the code does instead of pointing at a ticket you can't open.

  - **engine:** the store conformance suites (`createSessionStreamConformanceTests`, the request-store suite) drop the ticket suffix from their test titles, so an adapter's test report reads the behaviour under test. The error for two collections that share a storage prefix with conflicting isolation flags no longer ends in an issue id. No behaviour changes.
  - **harness-manager:** the refusal for a malformed issue (`TRACKER_ISSUE_REFUSED`) uses `ENG-142` as its sample key.
  - **shift-manager:** placeholder copy for surfaces that are not built yet says it arrives in a later release instead of naming an issue.

  Docs: not yet rewritten; /release-docs rewrites these, since this PR may not edit them. packages/core/README.md (the `keyedRouter` entry cites BP-013 and the `assertStrictCompatible` note cites BP-016: state each rule instead), packages/patterns/README.md (the workers section cites BP-011 and BP-013: say no handler wraps the worker and adapters connect inside the router), packages/harness-manager/README.md (two places) and apps/docs/docs/orchestration/harness-manager.md (the sample issue key `FIX-2165` becomes `ENG-142`, the neutral key the refusal text and JSDoc now use).

- 8d4dd64: Open a PR works when the branch a run was started from is gone from the remote, the normal state of a checkout after its own pull request merged and GitHub deleted the branch (FIX-2858).

  - **workspace:** a pull-request landing asks the pinned remote whether the base branch is still there. When it is gone, the pull request goes into the remote's default branch, and the `Landed` result carries `baseGone` with the branch that was gone. `existingPullRequest` looks into the same base. The default branch is taken only when it holds the commit the run was cut at: a base merged by squash or rebase would bring its changes into the pull request again. That case, and a remote that names no default branch, are refused with a new reason, `base-gone`, before anything is pushed.
  - **harness-manager:** a landing GitHub refuses (`pull-request-failed`, `pull-request-gone`, `base-gone`) is no longer handed to the coding session to fix. The person sees the failure on the review asked again, and only the landing opens the pull request. A refused push is still handed to the coding session, as before. The landed line says when the pull request went into the default branch instead.

  Docs: none. No docs page or README documents a landing's base or its refusal reasons.

- 33c4312: `readSessionPullRequests(client, runSessionId)`, from the package root and from `./browser`, reads the pull requests a run session records, every request's, with each one's `number`, `url`, `title` and `state`, plus the `host` and `repository` that `pullRequestWait(row, records)` matches by. With it, a screen can draw a waiting task's line, _PR open · #7_, linked, without its own read of the record (FIX-2578). A session that records none reads as none. A read that fails throws the client's error.

  Docs: packages/harness-manager/README.md (the `./browser` list: `readSessionPullRequests` beside `pullRequestWait`).

- f9daf5a: A flow and its sessions can say what they are, so a flow list reads by who and what instead of by hashed ids (FIX-2875).

  - **core / engine / client:** `defineFlow({ description })` goes out on the flow list as `FlowListEntry.description`. `session.label: ({ id, state }) => string | undefined` names a session on every read of it, as `SessionSummary.label`. It sees only the state the session shows (readonly and exposed fields). A label that throws leaves that session unlabelled, and the server warns once for that flow kind.
  - **react:** `FlowNavigator` reads a session's title, then its `label`, then a shortened id (derived ids such as `dsx_…` shorten too). In every app that uses `FlowNavigator`, a collection flow with one copy whose id is the flow's kind draws one level; a single copy with a different id keeps its own line. Sessions run with no session id of their own (`ephemeral_…`) fold into one closed "One-off runs (N)" line, together with every run they started. An empty session list shows the flow's description, which is also the flow line's tooltip.
  - **devtool:** each session line has a copy button for its id.
  - **workforce:** every worker flow labels a session by its worker's name (a standard worker's `name:`, else the worker id), plus the task id for a task's session. The `agent` worker flow and service flows have descriptions; so do harness manager's `coder` and `harnesses` flows and the Claude Code kit's flow.

  Docs: apps/docs (flow definition: `description`, `session.label`; the DevTool's flow tree)

- 3c22491: `readRecordedWork` file rows now carry `applied`: how many of the run's operations on that path landed. `0` means every attempt failed, so a page can count edits without counting failed tries. `null` on rows recorded before the count was kept (FIX-2396).

  Docs: packages/harness-manager/README.md ("Reading what a run recorded, in a browser": say each file row carries `applied`, and show `applied: 1` in the example row)

- 4fdcaed: A coding run's review now carries what the user decides on: what was asked, the run's own summary, this round's commits and where the pull request is (FIX-2782).

  - **harness-manager:** the `kind: "review"` stop's data gains `goal` (the task's goal), `answer` (the run's final message), `pullRequests` (the task's recorded pull requests and the one open from its branch, each `{ number, url }`) and `round` (`{ commits, subjects }` for this round's commits when the branch already had commits before it; `null` when the round is the whole branch). The stop's prompt names the same four things. `reviewDetail` reads the new fields, plus the `files`, `fileCount`, `added` and `removed` the stop already carried, and reads each as `null` (or `[]`) on a stop recorded before them. New exported types: `ReviewPullRequest`, `ReviewFile`.
  - **shift-manager:** the Inbox review card shows the ask and the run's summary as Markdown, this round's commits apart from the branch's earlier ones, a link to each pull request, the changed files folded under their totals, and the judge's whole reason instead of three clamped lines.

  Docs: packages/harness-manager/README.md (the `reviewChanges` section: the review's data and prompt name the ask, the run's summary, this round's commits and the pull requests)

- 714e98f: A harness run that is still working is no longer stopped at a short limit on how long it has run. Coding runs and harness session turns are stopped once the harness has sent nothing for 20 minutes, and they fail with a message that names the harness, such as "No output from Claude Code for 20 mins; stopped." A cap on total run time, 4 hours by default, stops a run that loops while still sending events. (FIX-2794)

  - **Coding runs.** `harnessManager` and the harness kit take `idleTimeoutMs` (default 20 minutes). `runTimeoutMs` is now an optional cap on a run's total time, 4 hours by default; pass `0` to turn it off. Before, it was required, and the kit capped every run at 20 minutes. A run stopped at its cap fails saying so, such as "Claude Code ran for 1 hr, its cap on run time; stopped.", not with the harness's aborted error. `harnessManager` also takes `harnessLabel`, the harness's name in the stop message, which the kit fills from each harness's `label`. `codingDrainBudgetMs` takes `idleTimeoutMs` too. A shutdown waits out a cap you set; with the default cap, or with it off, `codingDrainBudgetMs` gives a run's harness 20 minutes before the run is cancelled.
  - **Session turns.** `harnessSessionFlow` takes `idleTimeoutMs` (default 20 minutes) and `harnessLabel`. `turnTimeoutMs` is now an optional cap, 4 hours by default; pass `0` to turn it off. Before, every turn was capped at 60 minutes. A turn stopped at its cap ends with the same words as a coding run's cap. A turn stopped for silence is recorded as `timedOut`, like one stopped at the cap.
  - **The harness contract.** A new optional feed, `onEvent` (type `HarnessEventHook`, helper `reportHarnessEvent` in `@flow-state-dev/core/harness`), is called on every event a run sends. `claudeCodeAgent`, `codexAgent` and `cursorAgent` call it, and `codexHarness()` and `cursorHarness()` pass it on. **If you write your own harness slot and pick feeds by name, pass `onEvent` on too.** A harness that never calls it is stopped after the idle window, however busy it is.
  - **Checkout locks.** A coding run's checkout lock is marked live on its events, so a long run keeps its lock. The stale window is sized from the idle window rather than from a run's length.

  Docs: apps/docs/docs/orchestration/harness-manager.md (`runTimeoutMs` is an optional cap, 4 hours by default, `0` for none; `idleTimeoutMs` and `harnessLabel`; the drain budget's run term), the harness kit page (the `idleTimeoutMs` key; `runTimeoutMs` 4 hours by default, `0` for none), the session flow's `turnTimeoutMs` (4 hours by default, `0` for none), apps/docs/docs/tools/codex.md and cursor.md (`onEvent` on the block's options), the harness contract reference (`onEvent`, `HarnessEventHook`, `reportHarnessEvent`).

- 89b40bc: A coding run whose branch already has a pull request open from it puts its work there, with no review asking how to land it (FIX-2781).

  - **workspace:** `WorkspaceHost.existingPullRequest(target)` answers the pull request already open from the branch `land` would land, into the base it would land on (`{ url, number, branch }`), or `null` when there is none. It rejects when git or GitHub can't be read. `existingPullRequest(host, target)` is the same check for a `LandHost`. A `pull-request` landing onto a pull request that was already open now says so with `existing: true` on its `Landed`. A pull request open from a fork's branch of the same name, or into another base, is no longer taken as the run's. A `pull-request` landing with `onlyExisting: true` pushes only to that open pull request: when none is open it is refused `pull-request-gone`, pushing nothing and opening nothing.
  - **harness-manager:** with `reviewChanges` on, a run whose branch has an open pull request that a person's accept on this task already landed on is not held for "Review the run's changes". Its branch is pushed to that pull request, the stream says "Pushed <branch> to pull request #N", and with `awaitPullRequests` the task waits on it as before. The output's `review` stays `null`, since nobody reviewed it here. If the push fails, the person is asked with the error (the coding session isn't handed it) and offered only that pull request, never a second one or a local merge. If that pull request closed before the push, nothing is pushed or opened and the person is asked with every way to land. If GitHub can't say whether one is open, the stream says so and the review is asked as usual. Any other pull request open from the branch, including one the coding session opened itself, is never pushed to unasked: the stream says so and the review is asked as usual, and accepting "Open a PR" puts the work on that pull request rather than opening a second. The run record keeps the accepted pull requests in a new `landedPullRequests` field (`null` on older records, read as none).

  Docs: packages/workspace/README.md (`existingPullRequest` beside `land` and `landWays`), packages/harness-manager/README.md (the `reviewChanges` section: a branch with an open pull request lands there unasked)

- Updated dependencies [091a1dd]
- Updated dependencies [04812f3]
- Updated dependencies [801aa5e]
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
- Updated dependencies [9dde49f]
- Updated dependencies [77a6c9b]
- Updated dependencies [8b5801a]
- Updated dependencies [abed271]
- Updated dependencies [3d8d4cb]
- Updated dependencies [aa28006]
- Updated dependencies [e3ca793]
- Updated dependencies [bf4dd7b]
- Updated dependencies [7a2bb7e]
- Updated dependencies [ad80d4e]
- Updated dependencies [9d8f2be]
- Updated dependencies [0b56b1c]
- Updated dependencies [e505adf]
- Updated dependencies [98b888d]
- Updated dependencies [5b2bd16]
- Updated dependencies [9662c34]
- Updated dependencies [50b2f19]
- Updated dependencies [fe85f56]
- Updated dependencies [8dfcb2e]
- Updated dependencies [091078d]
- Updated dependencies [a06ad2d]
- Updated dependencies [ec679dd]
- Updated dependencies [9e77cd9]
- Updated dependencies [e804004]
- Updated dependencies [99e1c9d]
- Updated dependencies [4394069]
- Updated dependencies [21d31bc]
- Updated dependencies [5f1c26a]
- Updated dependencies [7ddae5c]
- Updated dependencies [5c7de6e]
- Updated dependencies [5c7de6e]
- Updated dependencies [c7ce9ff]
- Updated dependencies [8e70af6]
- Updated dependencies [95d9686]
- Updated dependencies [3930a0f]
- Updated dependencies [cd1a560]
- Updated dependencies [1600ca1]
- Updated dependencies [7e4bca5]
- Updated dependencies [f5caf94]
- Updated dependencies [6b360fa]
- Updated dependencies [3973e1f]
- Updated dependencies [a62f6d0]
- Updated dependencies [e5a9596]
- Updated dependencies [556aabe]
- Updated dependencies [556aabe]
- Updated dependencies [41dcd7e]
- Updated dependencies [2e63b30]
- Updated dependencies [e238e18]
- Updated dependencies [cc91d7a]
- Updated dependencies [3f23173]
- Updated dependencies [e9722ee]
- Updated dependencies [c049036]
- Updated dependencies [c049036]
- Updated dependencies [c049036]
- Updated dependencies [b43424c]
- Updated dependencies [182fb96]
- Updated dependencies [1a2eaf3]
- Updated dependencies [3ef3979]
- Updated dependencies [3ef3979]
- Updated dependencies [0e0df19]
- Updated dependencies [8d4dd64]
- Updated dependencies [80175df]
- Updated dependencies [b9bb900]
- Updated dependencies [fabd6a7]
- Updated dependencies [d3a6855]
- Updated dependencies [ae106d2]
- Updated dependencies [2b3b34d]
- Updated dependencies [030eb14]
- Updated dependencies [f9daf5a]
- Updated dependencies [de09b77]
- Updated dependencies [6407fbf]
- Updated dependencies [995e1a8]
- Updated dependencies [c82adfa]
- Updated dependencies [aa45e92]
- Updated dependencies [269ab76]
- Updated dependencies [8ccec52]
- Updated dependencies [92f6901]
- Updated dependencies [6b68a97]
- Updated dependencies [546603f]
- Updated dependencies [4a6643c]
- Updated dependencies [8127ab6]
- Updated dependencies [18adad9]
- Updated dependencies [246f0ba]
- Updated dependencies [4698256]
- Updated dependencies [9f8b8d3]
- Updated dependencies [0454257]
- Updated dependencies [85ca2a3]
- Updated dependencies [246f0ba]
- Updated dependencies [714e98f]
- Updated dependencies [91184e2]
- Updated dependencies [1e58902]
- Updated dependencies [81c145c]
- Updated dependencies [bb280f4]
- Updated dependencies [3e7d5f3]
- Updated dependencies [13e3970]
- Updated dependencies [c9d33ff]
- Updated dependencies [bb95ce1]
- Updated dependencies [d23352d]
- Updated dependencies [ec1fdf9]
- Updated dependencies [1970b12]
- Updated dependencies [c36ffa0]
- Updated dependencies [23bac7e]
- Updated dependencies [1f46aaf]
- Updated dependencies [89b40bc]
- Updated dependencies [b5b52b9]
- Updated dependencies [abfac77]
- Updated dependencies [1015669]
- Updated dependencies [f63ef40]
- Updated dependencies [e9722ee]
- Updated dependencies [d0e892d]
  - @flow-state-dev/core@0.6.0
  - @flow-state-dev/workforce@1.0.0
  - @flow-state-dev/client@0.6.0
  - @flow-state-dev/workspace@0.5.0
  - @flow-state-dev/orchestration@0.7.0

## 0.5.0

### Minor Changes

- 73f8352: Accepting a coding run's review can now land its work: **Open a PR** pushes the run's branch and opens a pull request, and **Merge locally** merges it into the base branch where your checkout has it (FIX-2543).

  - **harness-manager:** with `reviewChanges`, an accept can name `land: "pull-request" | "merge"` (`harnessReviewAnswerSchema`). The review's data lists the ways this host offers (`lands`). If the landing fails, the task doesn't complete: the review is asked again with the error (`landFailed: { land, message }`), so the user can retry or pick the other way, and the run's branch and commits are kept. The output gains `landed`: `{ kind: "pull-request", url, number, branch, base, remote }` or `{ kind: "merge", branch, commit, checkout, from }`, `null` unless the work landed. A pull request is written to the run session's `observed-pull-requests` record. `ReviewDetail` gains optional `lands` and `landFailed`, and `ReviewLand` is exported from the `browser` entry. A plain `{ verdict: "accepted" }` completes the task without landing anything.
  - **workspace:** `WorkspaceHost.land(target, request)`, implemented by `localWorkspaceHost` for a repository in `localRepositories`. A pull request pushes to the remote pinned at start (the base's upstream, else `origin`), never force-pushes, and returns the pull request already open for the branch instead of opening a second. A merge lands the run's commits on the base by fast-forward or a merge commit, whatever the repository's squash or no-commit settings say, never overwrites an ignored file, and never resolves a conflict. A base that names a pinned remote's branch (`origin/main`, `refs/remotes/origin/main`) targets that branch on the remote for a pull request and the local branch tracking it for a merge; a local branch named `origin/main` stays that branch. A refusal is a `WorkspaceRefusedError` whose `reason` is `land-unsupported`, `base-unknown`, `no-push-remote`, `remote-repointed`, `push-failed`, `pull-request-failed`, `base-not-checked-out`, `checkout-dirty`, `checkout-busy` (the checkout is mid-merge, rebase, cherry-pick or revert, and is left alone), `merge-conflict` (aborted, naming the files) or `merge-failed`; after a merge refusal the checkout is as it was. New exports: `LAND_TIMEOUT_MS`, `Landed`, `LandRequest`, `LandTarget`.
  - **ui registry (`review-hold`):** with `lands`, Accept is two buttons, **Open a PR** and **Merge locally**, and a review asked again with `landFailed` shows the error and **Retry**. Pass the stop's suspension id, or the hold's id, as `holdId`, so a retry that fails with the same error still shows Retry. `LandedOutcome` draws where accepted work went and what to do next.

  Docs: apps/docs/docs/orchestration/harness-manager.md, packages/harness-manager/README.md, packages/workspace/README.md, packages/ui/README.md

- bf6c622: A coding run's review card shows the project's checks the run passed or failed (FIX-2387).

  - **harness-manager:** `reviewDetail` (browser entry) also reads the review stop's `checks` into `ReviewDetail.checks`, `null` when the phase ran none; `ReviewCheck` is exported beside it. **Breaking for code that builds a `ReviewDetail` by hand:** add `checks: null`.
  - **shift-manager:** the review card in a task's thread shows "Checks n/m passed", open on a red check's output.

### Patch Changes

- a124a8e: A project's repository can be checked before any run. `localWorkspaceHost` answers `checkRepository(repository, { ignored })` without making anything: whether a run's checkout could be made there, and if not, a sentence naming the fix. The ignore rule is read from the last commit, as a run's checkout gets it, so a rule that is only in uncommitted changes is refused with "commit it". `defineProjectBlocks({ checkRepository })` uses it to refuse `createProject` and `setRepository` with `repository-unusable`, and serves a read-only `checkRepository` action a page can ask before Create. `harness-manager` exports `ASK_MARKER_IGNORED`, the rule coding runs need (FIX-2403).
- 0d895fc: A run's judge now sees what its commits changed. The judge's input gains `diff`: each file the commits changed against the run's base, with its added and removed lines (up to 200 files listed, totals over all of them), or `null` when the run has no branch or its commits couldn't be read. `goalJudge` hands it to the evaluation model, so a task that asked for a change is judged on the branch rather than on a commit subject (FIX-2577). A custom judge can read `input.diff`; one that ignores it is unaffected.
- Updated dependencies [73f8352]
- Updated dependencies [531bf32]
- Updated dependencies [a124a8e]
- Updated dependencies [05a7022]
- Updated dependencies [c67aa49]
- Updated dependencies [8d3921e]
- Updated dependencies [3646a14]
- Updated dependencies [a1386ea]
- Updated dependencies [f1e6315]
- Updated dependencies [da4a4bb]
- Updated dependencies [5f569fd]
- Updated dependencies [8788d02]
- Updated dependencies [844a4f9]
  - @flow-state-dev/workspace@0.4.0
  - @flow-state-dev/orchestration@0.6.0
  - @flow-state-dev/core@0.5.0
  - @flow-state-dev/client@0.5.0

## 0.4.0

### Minor Changes

- 151309c: Harness readiness: which coding harnesses can run on this machine, and what to do about one that can't. Core adds the neutral `HarnessReadiness` and `HarnessReadinessCheck`. Each integration ships a check: `checkClaudeCodeReadiness`, `checkCodexReadiness` and `checkCursorReadiness`, each with its sign-in remedy. `@flow-state-dev/harness-manager` adds `harnessReadiness(slots)`, which checks once and re-checks on request. It also adds `harnessReadinessAction` for a read with Re-check, `harnessReadinessCapability` for the coordinator's context, `formatHarnessReadiness` for the start log, and `refusal(harness)` for a coding flow's pre-start gate (FIX-2391).
- A coding run can be told which tracker issue it is for. A harness session takes `state.issue` at create, fixed like the model, and hands it to the workspace as `place.issue`. On a board read from the claim, a task names its issue with `harnessFeature: { issue }`, and the phase is now optional. The run's branch leads with the issue, and a run already under way keeps its recorded branch. The new `issueSpec` option on `harnessSessionFlow` and `harnessManager` opens the brief with the issue's spec from the run's checkout. It is off by default. Phases see the issue as `trackerIssue` (FIX-2388).
- 9622803: `@flow-state-dev/harness-manager` reads what a coding run changed (FIX-2384). A `reviewChanges` stop's data carries each changed file and its added and removed lines (`files`, `fileCount`, `added`, `removed`), and its prompt names them. `harnessRunChangesRead({ board, uses })` is a flow read, stored nowhere, that answers a board run's files or one file's patch from the run's own session. `harnessSessionFlow` records each turn's `base` and `head` commits and declares a `changes` read for one turn's files or patch. New exports: `harnessRunChangesRead`, `HarnessRunChangesRefused`, `harnessRunChangesInputSchema`, `harnessRunChangesOutputSchema`, `harnessTurnChangesInputSchema`, `runChangesSchema`, `runDiffSchema`, `runFilePatchSchema`, `MAX_DIFF_FILES`, `MAX_PATCH_CHARS`, and the `RunChanges`, `RunDiff`, `RunDiffFile` and `RunFilePatch` types.
- cc0ab62: Choose where a coding session starts, and remove what it left on disk (FIX-2419).

  - `@flow-state-dev/workspace`: a `baseRef` naming a pinned remote's branch (`origin/main`) in a listed repository is fetched before the cut, and refused as `remote-unreadable` when the fetch fails. `PlaceRequest.existing` checks a branch out instead of cutting one, making it from the remote's when absent (`no-such-branch` when there is none). `localWorkspaceHost` gains `list()` and `remove(target, { deleteBranch?, force? })`, the one removal path, which refuses uncommitted work (`uncommitted-work`), a place mid-provision (`place-busy`) and, unless forced, deleting a branch that holds the only copy of a commit, or removing a detached HEAD that does (`unique-commits`). `pullRequestHead` resolves a same-repository pull request to its head branch. `occupyWorktree` holds a worktree in use (`<dir>.lock`), and `remove` refuses one a run holds (`in-use`); `checkedOutBranch` reads the branch a worktree is on.
  - `@flow-state-dev/harness-manager`: harness session state gains `start` (`{ base } | { branch } | { pullRequest } | { worktreeOf }`, fixed at create like `model`) and a server-owned `workspace` record. `HarnessSessionWorkspace.provision(place, { start })` may return `{ path, branch }`; the turn-end pull-request check reads the recorded branch. A `removeWorktree` action, refused while a turn runs, calls the workspace's optional `remove`. `resolveHarnessSessionStart` maps a start to a workspace host's request. `{ worktreeOf: sessionId }` attaches a session to another session's worktree and branch: refused at create (404) when that worktree isn't there in the caller's tenant and at its turn when it isn't in the user's own list of worktrees, each turn holds the same in-use lock as the owner's, only the owner may `removeWorktree`, and an attached turn that leaves the worktree on another branch is recorded as failed. The workspace record carries `owner`.
  - `@flow-state-dev/fsdev`: `fsdev worktrees <root>` lists a workspace host's worktrees and removes one with `--remove`.

- ddf60c8: `taskSpendView` gains `costUsd`: the sum of the charges vendors reported for the task, or `null` when none did (a subscription run reports none). `requestSpendView` reads one request's spend the same way. `harnessSessionFlow` records what each turn spent on its turn record (`spend`, in `taskSpendView`'s shape, and `endedAt`), hands harnesses an `onUsage` feed that records subscription windows in the user's usage record, and carries a `harnessUsage` action that reads it, with optional `usageReaders` (FIX-2398).
- cc0ab62: A coding run now says where its work went (FIX-2386). A harness session's `state.workspace` is `{ worktree }`, the key of its worktree's row in the user's `worktrees` list, which owns the path, branch, base, commit count and state; the copies of the path, branch and owner it held before are gone, and a stored record with them reads as `{ worktree: null }` until its next turn. `HarnessSessionProvisioned` no longer takes `branch`. A task's output gains `baseCommit`, `path` and `commitsVerified`. `workPlace` reads a task's output or a worktree row and returns the branch, the count, the worktree's name and state, whose it is for an attached session, and shell-quoted `git switch`, `cd` and `git log baseCommit..branch` commands. The UI registry gains a `work-place` component that draws them.
- cb395b2: `localWorkspaceHost({ setup: { command, env? } })` runs a setup command, such as `pnpm install`, in each new repository checkout before handing it over. It runs again on later provisions until it succeeds, and it counts against `provisionTimeoutMs`. `PlaceRequest.onSetup` is called when it starts, and `WorkspacePlace.setup` reports `done`, or `failed` with the tail of the output. A failure doesn't refuse the provision. In harness-manager, `WorkspaceConfig.setup` is passed through to the host, and task-board runs show the setup on their stream. The session flow's `provision(place, request)` may return `{ path, setup }` and pass `request.onSetup` to the host, and the turn record gains `setup` (FIX-2420).
- cc0ab62: Add a shared list of worktrees (FIX-2439).

  - `@flow-state-dev/workspace`: `worktreesCollection` is a user-scoped, `llmReadable` collection with one row per worktree a host made. A row holds `name`, `path`, `branch`, `repo`, `baseCommit`, `owner`, `attached`, `state`, `commits`, `lastTurnAt` and `pullRequests`. To have the host write rows, give it the collection: `PlaceRequest.worktrees` writes `provisioning`, then `ready`; the new `host.attach` adds a session or run to `attached` (`{ kind, id, lastTurnAt }`); the new `host.recordCheckout` writes the branch and commit count together at a turn's end and returns what it read; and `RemoveOptions.worktrees` marks the row `removed`. `recordBranchPullRequests` takes `worktree: { collection, key }`. `WorkspacePlace.worktree` is the row's key.
  - `@flow-state-dev/harness-manager`: the session flow declares the collection and passes it to `HarnessSessionWorkspace`: on `provision` and `remove`, and on the new optional `attach` and `recordCheckout`. It stores the row's key as `state.workspace.worktree`, and marks `worktrees` read-only to the model's resource tools. The board manager writes a row for each run's checkout.

### Patch Changes

- 4578042: A phase's `isDone` now gets `baseCommit`: the commit the run's branch was cut at, from the run's record (`null` with no recorded base or a files-only run). A phase can compare the checkout against it to tell whether the run changed anything (FIX-2387).
- 7a200b3: `reviewDetail` reads a review stop's data (branch, commit count, commit subjects, the judge's verdict) from the browser entry `@flow-state-dev/harness-manager/browser`, as the props the ui registry's `review-hold` card takes (FIX-2380).
- 9632f7d: `harnessSessionFlow({ approveTools: true })` makes a session turn's tool call that isn't pre-allowed wait for the user as an approval stop, then resumes the same conversation on Allow, Allow for this run (for the rest of the turn), or Deny, composing the manager's approval pieces (FIX-2432).
- 1fb64c9: `harnessManager({ approveTools: true })` makes a run's tool call that isn't pre-allowed wait for a person's approval as the task's hold, then resumes the same coding session on Allow, Allow for this run, or Deny; claude-code's `onToolApproval` gains a `held` decision, and react's `useApproval` gains `approveWith`, `rejectWith` and `approveOptionsOf` (FIX-2389).
- Updated dependencies [e0daf6e]
- Updated dependencies [b9e6dd0]
- Updated dependencies [151309c]
- Updated dependencies [488b203]
- Updated dependencies [824ce87]
- Updated dependencies [8be6d45]
- Updated dependencies [29579d4]
- Updated dependencies [147d923]
- Updated dependencies [cc0ab62]
- Updated dependencies [0554e0b]
- Updated dependencies [7d92efe]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
- Updated dependencies [3aced5b]
- Updated dependencies [ddf60c8]
- Updated dependencies [cb395b2]
- Updated dependencies [cc0ab62]
  - @flow-state-dev/core@0.4.0
  - @flow-state-dev/client@0.4.0
  - @flow-state-dev/workspace@0.3.0
  - @flow-state-dev/orchestration@0.5.0

## 0.3.0

### Minor Changes

- 78312a3: A coding run's question now holds its task on the board, where the Inbox lists it, and the answer continues the same coding session on the same attempt: an answer spends no retry (FIX-2132). The run's own question, the judge's _ask_ and held work that doesn't match its record all ask this way. Answer through the board's `updateTask({ id, answers, message })`, or with a line typed in the run's session; a cancel closes the question and starts nothing.

  **Migration.** The manager's question inbox is removed: `askQuestion`, `answerQuestion`, `listQuestions`, `readQuestion`, `withdrawQuestion`, `inboxCollection`, `INBOX`, `questionTopic`, `questionFingerprint`, `parseQuestionTopic`, and the `QuestionAnnouncement` type. `harnessManager({ announce })` is refused at construction; read held tasks from the board (`openRowHolds` on its rows). `PromptRunContext.answers` is the task's answered questions, oldest first, read from its row. `run.askMarkerPath` is now `.fsdev/ask/<attempt>-<run>.md`, a new path for every run; `askMarkerPath` and `readAskMarker` take the run as a third argument. A phase that hard-codes the old `<attempt>.md` path must use the path it is handed.

- e2c190e: A running coding turn can take a message mid-turn (FIX-2254). Core declares the optional harness hook `onSteerable(steer | null, ctx)` (`HarnessSteer`, `HarnessSteerHook`): a harness whose run can take a line calls it with a `steer` that answers `"delivered"` or `"refused"`, and with `null` when the turn is over. `cursorAgent({ onSteerable })` offers Cursor's own run steering on local runs, through the `env` process too. The harness manager hands down `onSteerable` as an optional fifth feed; passed through, a message sent to the task while a step runs goes straight into that step, with no stop, extra step or new attempt. A line the run refuses is taken by the next step, as before.

  `autoResume: false` on an action (core's `ActionCore`, honoured by the engine) keeps a request on it from becoming its session's auto-resume target (`latestRequestId`), so a control sent beside a running request, such as that line, doesn't stop a reloading client from reattaching to the running one.

  Any app can steer a harness turn run in a session: `harnessSteering()` in core keeps each session's offer and builds the `steer` action (`{ taken, live }`), and the client's `sendHarnessLine` and `steerRunningTurn` send a typed line into the running turn, falling back to the next turn when it isn't taken.

- 0d55d46: A session keeps a record of the pull requests it opened (FIX-2268). Core adds the `observed-pull-requests` collection (`observedPullRequestsCollection`), one writer (`writePullRequests`), a replaceable GitHub rule (`githubPullRequestRule`, `DEFAULT_PULL_REQUEST_RULES`) and the recorder: `recordPullRequests(ctx)` for a block, and `pullRequestRecorder()` for a flow with no harness to add as a `.tap` step. A `gh pr create` command or a `create_pull_request` tool whose output holds the link is one row, written as the call settles. Each row carries the `requestId` that opened it.

  The Codex, Claude Code and Cursor blocks record by default; `recordPullRequests: false` turns it off. Workspace adds `recordBranchPullRequests`, a host-side check that asks GitHub through `gh` which pull requests a checkout's branch has. The harness manager declares the record and runs that check before its verdict and when a run fails.

  **Migration.** A Codex, Claude Code or Cursor block now declares the `observed-pull-requests` session collection by default. A test that asserts the block declares no resources must pass `recordPullRequests: false`.

- 2ffc03c: "Dispatcher" now names only the `dispatcher()` block (FIX-2245). Two other things that shared the word are renamed, with no alias.

  - A task board's rule for which ready task it claims next is a claim order. `TaskDispatcher` is `ClaimOrder`; `fifoDispatcher`, `topologicalDispatcher` and `priorityDispatcher` are `fifoClaimOrder`, `topologicalClaimOrder` and `priorityClaimOrder`; harness-manager's `runOwnerDispatcher()` is `runOwnerClaimOrder()`. The task board's option is `claimOrder` (it was `dispatcher`, which it now refuses by name), and takes the same `"fifo"`, `"topological"` and `"priority"` names.
  - What decides where a flow action runs is a runner. `FlowDispatcher` is `FlowRunner`, `InProcessDispatcher` and `InProcessDispatcherDeps` are `InProcessRunner` and `InProcessRunnerDeps`, `createInProcessDispatcher` and `isInProcessDispatcher` are `createInProcessRunner` and `isInProcessRunner`, and BullMQ's `createWorkerDispatcher` and `CreateWorkerDispatcherOptions` are `createWorkerRunner` and `CreateWorkerRunnerOptions`. The option on `createFlowState`, `createFlowApiRouter` and `createInboundTransportHost` is `runner` (it was `dispatcher`, which they now refuse by name), `WorkerAdapter.createDispatcher` is `createRunner`, and `InboundTransportHost.usesExternalDispatcher` is `usesExternalRunner`.

  The `external-dispatcher` refusal keeps its value.

- 16a8dab: See how much of Claude Code's subscription is used. Core's `HarnessUsageWindow` gains `level` (`ok`, `warning`, `reached`, or `null`) and its `usedPercent` may be `null` when a harness sends no percent; core adds `HarnessUsageHook` and `HarnessUsageReport`, the run-time twin of `HarnessSessionHook`. `claudeCodeAgent` takes `onUsage` and hands it each window a run's `rate_limit_event` reports, with the run's account; `readClaudeUsage` reads who is signed in for the usage query, and `probeClaudeAccount` takes a `signal` that stops and closes the probe, and marks a `none` it got no answer for with `unanswered: true`. `@flow-state-dev/harness-manager` feeds `onUsage` at both of its harness slots (`HarnessFeeds.onUsage`, now required, so code that builds `HarnessFeeds` itself must add it), writing into the run owner's usage record, and keeps a stored record's account and windows together across a sign-in change. Codex windows now carry `level: null`. Shift Manager's Usage view shows Claude Code's windows, saying "limit reached" or "under Claude Code's warning line" where there is no percent (FIX-2142).
- 3ec9bca: On a board read from the claim, feature work is now named only under `HARNESS_FEATURE_KEY` (`"harnessFeature"`): `input: { harnessFeature: { issue, phase } }`. The rest of a task's `input` is the filer's own, so a task whose fields include a plain `issue` (a model's word for "the problem") runs as an ordinary task instead of being refused as half a feature payload (FIX-2282). `namesHarnessFeature(input)` and `harnessFeatureOf(input)` read the key the way the manager does.

  **Migration.** A flow that files feature work on a conversation's board must move `{ issue, phase }` under `harnessFeature`; a task carrying them at the top of `input` now runs as the manager's phase with its task id standing in for the issue. Fixed boards are unchanged: their rows carry `{ issue, phase }` at the top of `input`, as before.

- 4a3b026: FIX-2157: add `goalJudge`, a ready-made judge for the manager's `judge` option. An evaluation model reads a run's answer and commits against its task's goal and answers done, not done (with why), or a question for the person.
- ac632a0: On a workspace host with a held-work store, the manager now holds a run's repository work at the end of each turn, when it stops for a person, and when the harness fails, and brings it back on another machine (FIX-1766). The run record gains `place` (`{ host, state }`) and `held` (the last hold, or why it failed); both stay `null` with holding off. A run whose held work does not match its record, or lands on a host with holding off, holds its task for its owner with a question naming what disagreed, instead of starting over. A run is not completed on work it could not hold.
- 3b3171a: A phase's `buildPrompt` now receives `run.task`: the claimed row's goal, plus its title, context, input, dependency outputs and selected prior work when present. `PromptRunContext.task` is a required field, so code that builds a `PromptRunContext` by hand (a test fixture, say) must now supply it. Prompt builders that only read `run.issue` keep working unchanged (FIX-1717).
- a965a50: `harnessManager({ reviewChanges: true })` has a user review a run's commits before its task completes. A run that would complete with commits on its branch holds the task on a review (`ask.kind: "review"`) that lists the commits and the judge's verdict. The user accepts, or asks for changes in words, which one more run on the same attempt takes as a steer in the same coding session. The answer is checked against the exported `harnessReviewAnswerSchema` (type `HarnessReviewAnswer`). The manager's output gains `review: "accepted" | "deadline" | null`; `"deadline"` means the host's `userDeadlineMs` passed with no answer, not an approval. Needs a host with durable execution: without it, a manager with `reviewChanges` on cancels the task before any harness step. Off by default (FIX-2163).
- ba74f01: `harnessManager({ workspace })` accepts a workspace host from `@flow-state-dev/workspace` as well as a fixed `{ root, sourceRepo, baseRef }`, and provisions every run through the host either way. A run keeps the repository and base it started on (recorded on its run record) when its source later changes, and a run that started with no repository stays on its kept files. Its kept files are saved at the end of each turn, when it asks a question, and when the harness fails, and a run is not completed while its last save failed. A run its workspace refuses (the source answers `refused`, or the host won't provision the remote) is cancelled on its first attempt instead of being retried, and `HarnessRunRefused` is exported. `localWorkspaceHost` gains `localRepositories`, for a repository on the machine that runs are cut from directly, with no clone and no fetch, and a place request can name a directory the checkout's repository must keep out of git, which a run with no repository also leaves out of its saved files. A provision's `provisionTimeoutMs` now covers its waits for other provisions of the same place or clone, and `save` refuses a place handle that a later provision of the same place has replaced. `run`, `GIT_TIMEOUT_MS` and `CHECKOUT_CLEANUP_TIMEOUT_MS` from `@flow-state-dev/harness-manager/checkout` are now re-exported from `@flow-state-dev/workspace` (FIX-1762).
- 350e0e3: New: `harnessSessionFlow`, a coding harness as one long-lived session a person talks to. Each turn continues the conversation the harness last confirmed, a session is created with the model it runs, a `steer` action hands a line to the running turn, and each turn is recorded in `harnessSessionStateSchema`. The host says where sessions work (`workspace`) and builds the harness block from the feeds (`agent`). Also new: `harnessStub`, a scripted harness for the slot, for checks that run no model (FIX-2320).
- 90ed00b: A coding run's checkout folder and branch now include the organization the request was admitted under, so one person's runs in two organizations on one host no longer share a checkout or a branch; `RunPrincipal` requires `orgId`, and a run already under way keeps the branch its record names (FIX-1926).
- c4150e7: A person's message on a finished task reopens it: task collections gain `reopen(id)`, the harness manager's door reopens a finished run when its board names `reopenIn`, a worker's reply in a finished task's session on a Workforce conversation board reopens that task, and Shift Manager's task composer takes a message on a finished task (FIX-1764).
- 2f342f6: Words sent into an open task now take one path, `updateTask({ id, message })`, and a finished task's output never changes (FIX-2086).

  - **Steer an open task.** `updateTask`'s `message` (tool and `updateTask_<board>` action), sent alone (`message_takes_no_edits` otherwise), keeps the message on the task (`Task.steers`, at most 20; `getTask` lists them as `steers`). A task that hasn't started gets every message in its first brief; a running request takes it before its next model call (`createSteerContext`); a task waiting on work it filed gets a turn now; one that lands after the last model call, even while the task settles, gets one more turn first (`taskLedgers({ endRules: { steerTurn } })`, with `complete`'s new `refuseUntakenSteers` guard, reason `untaken-steers`; on Workforce, `steerTurnEntry` declared under `STEER_TURN_ENTRY`). No attempt is used. A message taken mid-run shows in the task's session as a line from its sender (`showTakenSteers`). The collection write is `TaskCollectionRef.steer`, with `takeSteers` for the request holding the claim; the change kind is `"steered"`.
  - **Correct a finished task with a follow-up.** `updateTask({ message })` on a finished task is refused (`task_finished: a finished task takes no message; file a follow-up`). `getTask` shows the latest completed follow-up as `current: { id, output }`, and `listTasks` rows carry `current: { id }`.
  - **A line in a task's session.** On the built-in `agent` flow, a line in an open task's session is a steer from the user (`{ steered: <taskId> }`), with no reply beside it; in a finished one it is an ordinary turn and the task doesn't change.
  - **Coding runs.** `harnessSessionDoor({ board, harness, onSteered?, talkTimeoutMs? })` is a coding flow's one door: a steer while the task or a follow-up is open, talk (one run resuming the confirmed coding session, outside any attempt, holding the checkout) once all have finished. Its refusals are `not-started`, `cannot-continue`, `steer-limit`, `finished` and `not-supported`, the last three worded as Workforce's door words them (`LINE_STEER_REFUSALS`, `steerFromLine`). A steer reaches the run's next step in the same request and attempt; with `harnessManager({ stopsOnAbort: true })` it stops the running step once the harness has confirmed a session.

  **Migration.**

  - `TaskCollectionRef.reopen`, `Task.reopened`, the worker input's `reopened` and the `"reopened"` change kind are removed: file a follow-up, `createTask({ goal, followUpOf: id })`. A stored row with `reopened: true` reads unmarked; still open, it carries one steer pointing at the latest line in its session.
  - Send `updateTask({ id, message })` to steer a running task. A stored row that was waiting for a turn reads as `pending`, its next attempt uncharged.
  - Declare `harnessSessionDoor` as the coding flow's `message` action. `harnessManager` now returns a `TaskWorker`.
  - The harness manager's `turns` collection is no longer written or read. Run `upgradeKeptTurns(stores, { userCell, ledgers })` once at host start to write each kept line no attempt took onto its task as a steer. Shift Manager's DevTeam host runs it at every start; a second run adds nothing.

- 9edbfa2: A worker can now end its task on the current attempt without writing the ending itself: throw `TaskEndsForGoodError` (from `@flow-state-dev/orchestration/task-board`) naming the task it holds (`taskId`), and the board's error recorder ends that row under the worker's claim, `errored` with no retry by default or `cancelled` with `{ ending: "cancelled" }`. A marker naming any other row, such as one rethrown by a board nested inside the worker, is an ordinary failure.

  Harness Manager's refused run uses it: the manager no longer fails or cancels its own row, and the board records the ending. The outcome is unchanged (`errored` on a board read from the claim, `cancelled` on the fixed board). `HarnessRunRefused` now extends `TaskEndsForGoodError`, and its constructor takes a second argument, `{ taskId, ending }` (FIX-2090).

### Patch Changes

- 859f621: A coding run stops when its task is cancelled. The manager reads the task's row every `STEER_POLL_MS` while a step runs, and aborts the harness within that second once the task is cancelled, finished, or claimed again. Before, a cancelled run kept working until the lease's next renewal or the run's deadline (FIX-2349).
- 24afa6e: A question is one kind of task hold (FIX-2317, FIX-2131, FIX-2133). The two ways to stop for the user are named for what stops, and a task's open stops live in one list.

  - **`suspendForUser`** (new) suspends the request and resumes it with the answer: `ctx.suspendForUser({ kind, prompt, deadline? })` in `core`, `suspendForUserOn`, `createSuspendForUserTool`, `SuspendForUser`, `SuspendForUserOptions`, `SuspendForUserContext`, `SuspendForUserCancelled`, and `SuspendForUserKind` / `suspendForUserKindOf` (`contracts`, re-exported by `core`). `kind` is `"approval"`, `"review"` or `"input"`.
  - **`holdTaskForUser({ question })`** holds the task until the user answers, built with `createHoldTaskForUser`. The turn ends; the next turn on the same attempt spends no retry.
  - **`Task.holds`** lists what stops the task being claimed until the user answers. There is no `kind` field on a hold: an entry is told apart by `source.kind` (`"row"` or `"suspension"`) and `ask.kind` (`question`, `confirm`, `approval`, `review`, `input`). `getTask`, `listTasks` and Inbox items list `holds`.

  `createTask({ questions })` files a task that stays `pending` until each question is answered: a plain string is a question, `{ kind: "confirm", prompt, onNo? }` asks for a yes or a no. Answer with `updateTask({ id, answers, message })`. The Inbox client's `answerOne` takes `questionId`. A deadline applies only when the host sets `userDeadlineMs`.

  **Breaking, from the last publish.** The `parked` status is gone, with `counts.parked`, `TaskCollectionRef.awaitReview` / `unpark`, `board.unparkAndDrain`, a board's `onReview`, and `@flow-state-dev/react`'s `BOARD_STATUS_COLUMNS` `parked` column. Ask for a review with `ctx.suspendForUser({ kind: "review", prompt })`. The filer's hold is unchanged: status `held`, `hold()`, `release()`. `keptOpenBy: "suspended"` means the task's own request is suspended. Stores are reset: a stored `parked` row is not read. Also removed with `parked`: `TaskTransitionOptions.refuseWhenParked`, `CheckBoardOptions.excuseParked`, the `"parked-for-review"` termination reason, the `"review_requested"` change kind, the `"parked"` write-decline reason, `unparkAndDrainInputSchema` / `UnparkAndDrainInput`, and the task-board exports `TaskBoardOnReview` and `assertParkExitSupported`. React no longer maps a legacy `awaiting_review` card status. `TaskClaimTicket.turn` is required: every claim advances the row's `turn`, and a ticket from an earlier turn of the same attempt is declined `lost-claim`.

  A row stored with `questions` still reads as `holds` (`withRetiredShapes` from `@flow-state-dev/orchestration/tasks`). Shift Manager and the DevTool read them as holds.

- 1cd9821: A harness manager runs a task whose board-minted id isn't a usable identity segment, such as a coordinator's routed task (`routed:<request>:<round>:<delegate>`): a task that names no issue runs under `taskIssueSegment(taskId)`, the id itself when it fits and an `h-` hash otherwise. A session door's `runOf` keys a row's run with the same export. A conversation-result task whose output carries an `answer` string, as a coding run's does, now lands that answer in the conversation, routed or not (FIX-2270).
- 82eea02: A running coding task now says how it's doing. The harness contract gains an optional `onActivity` hook (`HarnessActivityHook`), called with each completed assistant message and each tool call a run starts; `claudeCodeAgent`, `codexAgent` and `cursorAgent` (tool calls only) take it, and `reportHarnessActivity` / `harnessActivityOf` in `@flow-state-dev/core` map a harness's events to it. `harnessManager` hands the feed and keeps the task's `statusNote` set to the run's latest activity: the first at once, then at most one write per `PROGRESS_NOTE_MS` (30 s), fenced by the run's claim. A slot that builds its harness from named feeds must pass `onActivity` through to get notes (FIX-2290).
- 06ea781: A checkout handed back off its run's branch is no longer refused. The host moves it back onto the run's branch and keeps what the run made elsewhere: a fast-forward when the checkout's commit contains the branch, and otherwise a checkout of the branch. It reports this as `place.repo.movedBack`. A checkout with uncommitted changes on a branch that lacks the run's commits is handed back as it is and reported as `place.repo.offBranch`, because those changes are the run's to commit, stash or discard; harness-manager refuses that attempt with the message. A half-done git operation, or the branch checked out in another worktree, is refused as the typed `WorkspaceRefusedError` `checkout-moved`, naming the git command that clears it. A run that switches its own branch no longer strands its session (FIX-2211).
- 646f8d2: A harness can declare `stopsOnAbort` on the block it returns (an optional field on core's `HarnessBlock`): when its abort signal fires, the block returns only after its process has exited. `claudeCodeAgent` declares it, and now kills its agent process with `SIGKILL` if it is still running 5 seconds after the abort, then waits for it to exit. A harness manager built without `stopsOnAbort` now reads the harness's declaration, so a line typed into a running Claude Code task stops the run and the same request continues its session with the line. Set `stopsOnAbort: false` on the manager to keep the old behavior, where the line waits for the run's own end (FIX-2312).
- 809cebd: `harnessManager` can read each run's board from its claim (FIX-1866). Give it `ledgers`, a resolver typed like `taskLedgers`'s, and the task's entry hands it the claim on its input as `claim: { collectionId, partition, incarnationId }`; every read and write is still fenced against the row at that ledger and partition. Runs are kept apart by board and partition (`runBoardSegment`). On such a board a refused run ends the task `errored` instead of `cancelled`, and a question parks the task on the board itself, with the answer reaching the next attempt's prompt. A completed run's output now carries `answer`, `branch`, `commits` and `judged`, and `isDone` reads the run's `answer`. An optional `judge` (a host block and a confidence floor) reads a run on such a board after `isDone` passes; `harnessDrainBudgetMs` takes `judge: true` to reserve its time. A fixed board runs as before.

  Orchestration's `fail` takes `noRetry: true` to end a task `errored` on this failure even when it has attempts left.

- e6bd135: A feature task (one naming an `issue` and a `phase`) on a board read from the claim now runs under the id its board minted, keyed by that task id, instead of being refused for not carrying the id its payload derives (FIX-1792). A fixed board still refuses such a row.
- d10b1ba: A board id may carry a single dot between its parts (`eng.feature.work`), and the manager uses it as is for each run's checkout folder and branch, so it never shares either with `eng-feature-work` (FIX-1667). Board ids that worked before derive exactly the same folders and branches. An id a git branch can't carry, such as one ending in `.lock`, is now refused when the manager is built rather than when a row is claimed.
- 08a9b05: See how much of each coding harness's subscription is used. Core adds the neutral usage window and the on-demand reader signature (`HarnessUsageWindow`, `HarnessUsageReading`, `HarnessUsageReader`). `@flow-state-dev/codex` adds `readCodexUsage`, which asks the Codex CLI's app-server for every window's percent used and reset time with no run (local only), and exports `findCodexProgram`. `@flow-state-dev/harness-manager` adds the per-person `harness-usage/**` record and `harnessUsageAction({ readers })`, the one query that returns each window with its age and whether it has rolled over, refreshing a reader at most once a minute. Shift Manager shows it on a new Usage view (FIX-2141).
- 2348dbd: A repository listed in `localRepositories` now fetches the base's upstream and cuts a new run's branch from whichever of local and upstream is newer, refusing a base whose two copies have each moved as `base-diverged` and recording the commit cut at as `place.repo.baseCommit`, which the run record keeps and `readRunCommits` now counts a run's commits from (FIX-1927).
- 3cbab3a: `harnessTalkTurn` is the session door's talk half as its own block: it resumes a finished task's coding session with a message and returns `{ reply, taskId }`, refusing a task that is still running (FIX-2160).
- 7c9e932: A running request's items are now readable while it runs on the in-memory stores too, and a message sent to a coding run whose harness hasn't named its session yet is held until it does instead of being refused as a run that can't continue (FIX-1735). `readCommitted` (in `@flow-state-dev/core/helpers`) reads a resource's state as committed now rather than as the request first read it.
- cd180d7: Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, a turn paused on an ask cancels the asked task instead of waiting for it, and a durable host now runs the durability sweeper even without `durabilityRetention`, so a paused request past its `expiresAt` expires and an ask past its deadline times out, while pruning still waits for a retention policy (FIX-1816).
- 78178a9: A run's owner is now the bare user id, not the user record's storage key (FIX-1790).
- Updated dependencies [dc17a39]
- Updated dependencies [92b2b70]
- Updated dependencies [20aa58f]
- Updated dependencies [a5c1ce8]
- Updated dependencies [9f237f5]
- Updated dependencies [5d31955]
- Updated dependencies [bea14a0]
- Updated dependencies [71ab534]
- Updated dependencies [15f7c6b]
- Updated dependencies [5c8a130]
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [82eea02]
- Updated dependencies [e2c190e]
- Updated dependencies [0d55d46]
- Updated dependencies [1abab86]
- Updated dependencies [cb364e8]
- Updated dependencies [8e67ce5]
- Updated dependencies [af6c7cd]
- Updated dependencies [dd353e2]
- Updated dependencies [c245f7c]
- Updated dependencies [0836ffa]
- Updated dependencies [ad0babd]
- Updated dependencies [10ded49]
- Updated dependencies [e00a3b0]
- Updated dependencies [3221d05]
- Updated dependencies [58ffc93]
- Updated dependencies [4cdc088]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [70cfac9]
- Updated dependencies [53b50f0]
- Updated dependencies [06ea781]
- Updated dependencies [2ffc03c]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
- Updated dependencies [9d02ac6]
- Updated dependencies [d5ce1e0]
- Updated dependencies [8dc242e]
- Updated dependencies [89af7db]
- Updated dependencies [7d4158f]
- Updated dependencies [5d94e61]
- Updated dependencies [5492a77]
- Updated dependencies [6819520]
- Updated dependencies [b234f0d]
- Updated dependencies [ad5df6f]
- Updated dependencies [211679a]
- Updated dependencies [dd80e01]
- Updated dependencies [2ce15c7]
- Updated dependencies [5181ddb]
- Updated dependencies [8628a54]
- Updated dependencies [3c10d9d]
- Updated dependencies [2969b30]
- Updated dependencies [3ee61e5]
- Updated dependencies [a74429a]
- Updated dependencies [04ff39d]
- Updated dependencies [e71ea1a]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [f12089e]
- Updated dependencies [35bec56]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [3b40ca1]
- Updated dependencies [fe5df7d]
- Updated dependencies [17444fe]
- Updated dependencies [423a405]
- Updated dependencies [809cebd]
- Updated dependencies [ba74f01]
- Updated dependencies [08a9b05]
- Updated dependencies [c4d9743]
- Updated dependencies [90a5e64]
- Updated dependencies [7da156e]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [f9995b1]
- Updated dependencies [a7f1c41]
- Updated dependencies [3a6c910]
- Updated dependencies [80f6e25]
- Updated dependencies [d356f52]
- Updated dependencies [2348dbd]
- Updated dependencies [3cbab3a]
- Updated dependencies [3cbab3a]
- Updated dependencies [849f6ec]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [eb831f8]
- Updated dependencies [859f621]
- Updated dependencies [16455f2]
- Updated dependencies [41638f3]
- Updated dependencies [24744af]
- Updated dependencies [4a3b026]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [12bf045]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [f2f8527]
- Updated dependencies [726de78]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [d348ae7]
- Updated dependencies [315f7f3]
- Updated dependencies [f292079]
- Updated dependencies [dd2563b]
- Updated dependencies [839e915]
- Updated dependencies [f5b5457]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [16bb676]
- Updated dependencies [c4150e7]
- Updated dependencies [9510a03]
- Updated dependencies [adbcf0b]
- Updated dependencies [1027b98]
- Updated dependencies [1cfd80c]
- Updated dependencies [3b0161c]
- Updated dependencies [385d01e]
- Updated dependencies [d1a4cab]
- Updated dependencies [d1a4cab]
- Updated dependencies [3311cc2]
- Updated dependencies [2ab7ea2]
- Updated dependencies [7c9e932]
- Updated dependencies [60c8192]
- Updated dependencies [d2dd7f7]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [edc3197]
- Updated dependencies [295e96a]
- Updated dependencies [97894aa]
- Updated dependencies [334c1e3]
- Updated dependencies [9ed6b29]
- Updated dependencies [b552b50]
- Updated dependencies [a021cd1]
- Updated dependencies [d994f51]
- Updated dependencies [afb512f]
- Updated dependencies [09e3705]
- Updated dependencies [eb66ddd]
- Updated dependencies [2f342f6]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [e11764a]
- Updated dependencies [edb3d46]
- Updated dependencies [872a088]
- Updated dependencies [9edbfa2]
- Updated dependencies [437727e]
- Updated dependencies [9cd314d]
- Updated dependencies [2e8f640]
- Updated dependencies [9af8ce5]
- Updated dependencies [7035b4c]
- Updated dependencies [30aa133]
- Updated dependencies [912ae98]
- Updated dependencies [7052203]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [78178a9]
- Updated dependencies [d97031f]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [da86f88]
- Updated dependencies [96ff077]
- Updated dependencies [84cc226]
- Updated dependencies [721a811]
- Updated dependencies [98b90a6]
- Updated dependencies [57a859d]
- Updated dependencies [707b340]
- Updated dependencies [c4d14f6]
  - @flow-state-dev/orchestration@0.4.0
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/workspace@0.2.0

## 0.2.0

### Minor Changes

- 0ab8c2e: A phase's `isDone` is handed how the run said it stopped, as `CompletionRunContext.stopReport`, so a completion check can refuse to settle a row whose run ran out of budget partway (FIX-1438).

### Patch Changes

- Updated dependencies [0f812c9]
- Updated dependencies [b597600]
- Updated dependencies [8faf08e]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [218de72]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/orchestration@0.3.0
  - @flow-state-dev/core@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2
  - @flow-state-dev/orchestration@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
- Updated dependencies [23bc757]
- Updated dependencies [64b323e]
- Updated dependencies [119936d]
- Updated dependencies [c25ad3e]
- Updated dependencies [8a1173a]
- Updated dependencies [23ac6de]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/orchestration@0.2.0

## 0.1.0

### Minor Changes

- 7cf0ca3: New package: a task-board worker that turns a row into a supervised coding run —
  its own git checkout, a verdict read before the row settles, a question it can
  ask a person and be answered on, and the coding agent supplied as a slot rather
  than built in (LAB-154).

### Patch Changes

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [bea3a24]
- Updated dependencies [b484d86]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [0443742]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [229da65]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/orchestration@0.1.0
