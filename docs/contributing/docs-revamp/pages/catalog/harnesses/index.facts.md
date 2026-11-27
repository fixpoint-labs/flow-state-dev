# Facts for Harnesses (K-14, catalog, kit template)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited and none was read. Paths are from the repo root.

Legend: **[page]** the page states it. **[ref]** belongs on `reference/harness-runs` (or another Reference page); the page links, does not state it. **[gap]** nothing citable exists; the page must not assert it. **[verify]** not confirmed end to end; keep off the page or soften. **[cut]** history or mechanism; never on the page. **[reconcile]** a name or path that depends on something unsettled; mark for cutover.

Abbreviations:

- `hk` = `packages/harness-manager/src/kit/harnesses-kit.ts` · `cf` = `packages/harness-manager/src/kit/coder-flow.ts` · `ki` = `packages/harness-manager/src/kit/index.ts`
- `hn` = `packages/harness-manager/src/harness.ts` · `rd` = `packages/harness-manager/src/readiness.ts` · `rr` = `packages/harness-manager/src/run-record.ts` · `rc` = `packages/harness-manager/src/run-changes.ts` · `cm` = `packages/harness-manager/src/commits.ts` · `ws` = `packages/harness-manager/src/workspace.ts` · `gj` = `packages/harness-manager/src/goal-judge.ts` · `cb` = `packages/harness-manager/src/coding-brief.ts` · `br` = `packages/harness-manager/src/browser.ts` · `rw` = `packages/harness-manager/src/recorded-work.ts` · `rv` = `packages/harness-manager/src/review-detail.ts` · `mg` = `packages/harness-manager/src/manager.ts` · `ix` = `packages/harness-manager/src/index.ts`
- `kt` = `packages/harness-manager/test/harnesses-kit.spec.ts` · `cp` = `packages/harness-manager/test/coding-phase.spec.ts` · `rn` = `packages/harness-manager/test/root-imports-no-workforce.spec.ts` · `rt` = `packages/harness-manager/test/review-changes.spec.ts` · `at` = `packages/harness-manager/test/await-pull-requests.spec.ts`
- `hm` = `apps/docs/docs/orchestration/harness-manager.md` · `pj` = `apps/docs/docs/workforce/projects.md` · `rm` = `packages/harness-manager/README.md`
- `cck` = `packages/claude-code/src/sdk/kit.ts` · `cx` = `packages/codex/src/harness.ts` · `cu` = `packages/cursor/src/harness.ts`
- `dk` = `packages/core/src/kit/define-kit.ts` · `wk` = `packages/workforce/src/kit/workforce-kit.ts` · `wsp` = `packages/workspace/src/local-host.ts`
- `lc` = `labs/claude-code-style/host.mts` · `lt` = `labs/teammates/host.mts` · `g3` = `goals/kits/workforce-and-harnesses-install-as-kits/goal.md` · `g4` = `goals/harness-manager/a-runs-changes-wait-for-review/goal.md`
- `cc` = `docs/contributing/docs-revamp/pages/concepts/coding-harnesses.md` (C-23, the model the page links to and does not explain)

## Revision 1 (pass 8)

- Moved to Reference (`reference/harness-runs`), so the page no longer states them: drain-budget default, worker-file refusals, checkout layout and reuse, `localRepositories` and `remotes.allow`, `setup` and removal, per-agent sandboxes and timeout, the five-condition verdict, run states and output shape, Claude Code's permission mode and tools, question channel, review answers and durable-execution detail, review data shape and `workPlace`, project refusals, harness selection and readiness check, readiness row fields, the options table with defaults, option precedence, run-record retention, `.without` on `workerFlows`. Sections 3 to 9 of this sheet keep their [page] marks as source material for those rows.
- The page now states: `codingDrainBudgetMs` takes the kit's `checks`, `project`, `judge`, `runTimeoutMs` (`cf:147-162`); the key list including `judge` (default on, `cf:82`, `cf:205`) and `runTimeoutMs` (`cf:88`); durable execution glossed as a host that can resume a waiting task after a restart (`hm:166`; wording is a reading of the review-survives-restart fact); a waiting task's checkout stays on disk (`pj:971`, never removed by the kit).
- Flag 9 of pass 7 answered: `judge` and `runTimeoutMs` are kit keys, listed by name on the page; defaults live on Reference.

## Revision 2 (pass 8)

- The page now defines the judge where the verdict first names it: `goalJudge`, an evaluation model, on by default, answering done, not done or ask (`gj:1-30`, `cf:205`); the pull-request hold is tied to `pullRequests`, default true (`cf:80-81`, `cf:206`). The waiting-task checkout clause rests on `pj:971`. The "refusals" link names one refusal, a task whose session has no project (`pj:652-662`, `cf:304`). "Keyed" is dropped from the slot sentence (`hk:100` still holds it).

## Revision 3 (pass 8)

- Install line now adds `@flow-state-dev/workforce` and `@flow-state-dev/workspace`, which the config block imports (`packages/workforce/package.json`, `packages/workspace/package.json` names); `@flow-state-dev/engine` is the app's own. The Codex example names `pnpm add @flow-state-dev/codex` (`packages/codex/package.json`). The verdict paragraph no longer announces a count.

## Flags against the page plan (read first)

1. **Reading a run's changes: the published docs and the README name an export the code does not have.** `hm:168`, `hm:171-173` and `rm:509-530` say to declare `harnessRunChangesRead` under `reads:` on the coding flow. The package exports `harnessRunChangesView`, declared under `views:` (`ix:196-203`; `rc:4-8`, `rc:66-79`, `rc:100`). `harnessRunChangesRead` is exported nowhere (grep of `packages/*/src`: none). **The code wins.** The call on the client is the view call (`packages/client/src/client.ts:787-826`, which posts to `/api/flows/<flow>/<sessionId>/views/<name>`), not `client.flow(...).read(...)`. **[reconcile]** the page must not use `harnessRunChangesRead`; `hm` and `rm` are stale here.
2. **The kit's `coder` flow declares no `changes` view.** Its actions are `respond` and `harness`, its internal entries `onMessageReceived` and `onTaskSteered`, its task action `work` (`cf:262-300`); it has no `views`/`reads` key. So an app that wants one file's patch on a page under the kit must add the view to a flow of its own, with a `board` resolver for the run's session (`rc:51-58`), which the kit does not expose. **[gap]** for any claim that the kit serves per-file patches. What a page can read with no extra wiring under the kit is below: the review hold's data (flag 3), `readRecordedWork` (section 6), and `workPlace` on the task's output (section 6).
3. **The review hold lists changed files with no extra wiring.** With `review` on, the hold's `data` carries `{ branch, commits, subjects, files, fileCount, added, removed, judge, checks }` (`hm:140`; `rm:476`). The `RunChanges` component takes `files`, `fileCount`, `added`, `removed` (`packages/ui/registry/components/run-changes.tsx:30-50`) and `loadPatch` is optional (`:42`), so a page can show the file list from the hold alone. But `reviewDetail` (the browser reader of the hold) returns `branch`, `commits`, `subjects`, `judge`, `lands`, `landFailed`, `landAttempts`, `checks` and **not `files`** (`rv:25-60`). A page reads `files` straight off the hold's `data`. **[verify]** keep the example to the data fields the docs name; do not show a typed reader for `files`.
4. **`harnessManager` imports no harness, and the kit does not either.** The kit requires `workforce` only (`hk:98`). Claude Code's kit requires `harnesses` and fills the slot (`cck:72-80`). Codex and Cursor are plain values filled with `fill` (`cx:28`, `cu:25`; `lt:376-381`). **[page]**
5. **The plan's third example ("reading a run's changes on a page") has two citable shapes** and the page should pick one: (a) the review hold's `files` into `RunChanges` (flag 3), which exists with the kit and `review: true`; (b) `readRecordedWork(client, { sessionId, requestId })` for the files the harness's own file tools touched (section 6). They answer different questions: (a) is what the commits changed, (b) is what the run's tools touched. **[page]** states which.
6. **`project: true` needs a workspace whose source is `projectWorkspace()`, and the kit does not set it.** The kit adds `projectWorkspaceCapability` to each manager's `uses` and swaps the checks for `projectChecks()` (`cf:138-141`, `cf:207`), and registers the flow with `needsProject: true` (`cf:304`). The workspace host the app passes carries the source (`cf:75`; `pj:628-641`; `lc:142-145`). No citable test or doc runs `project: true` over a source that is not `projectWorkspace()`. **[verify]** the page says to pair them, and does not say what happens otherwise.
7. **Install line.** The package's `package.json` names `@flow-state-dev/harness-manager`, version `0.5.0`, public (`packages/harness-manager/package.json`: `name`, `version`, `publishConfig.access`). The kit is the `./kit` subpath (`packages/harness-manager/package.json` `exports["./kit"]`). `hm:11-13` and `rm:7-11` print `pnpm add @flow-state-dev/harness-manager`. **[page]** with the same cutover caveat the other catalog sheets carry for install lines.
8. **Stored data.** The kit stores one run record per task and, where the app has them, one usage row per user and harness. Section 8 answers the four questions. Readiness is stored nowhere. **[page]** a short table.

## 1. What the kit is, and what it installs (opening, "what you get")

- The harness kit is named `harnesses`: `defineKit({ name: "harnesses", requires: [workforce], config, slots: { harnesses: slot.keyed(harnessSchema) }, contributes, install })`. `hk:96-118`. **[page]**
- It is exported from `@flow-state-dev/harness-manager/kit` as `harnesses`, with `HARNESSES_FLOW`, `HarnessesConfig`, `CODER_FLOW`, `codingDrainBudgetMs`, `CoderFlowOptions`. `ki:1-6`; `packages/harness-manager/package.json` `exports["./kit"]`. **[page]**
- Only the `./kit` entry reaches Workforce. The package root never imports it, so an app with no Workforce can still use `harnessManager` from the root. `hk:20`; `rn:1-30` (root walk finds none; kit entry finds some). **[page]** one clause; it is why the kit is a subpath.
- What it does: a worker whose file names `flow: coder` has each task it is handed turned into a supervised coding run in the harness the worker's file names. `cf:1-12`; `kt:38-42` (a worker file with `flow: coder` and `harness: codex`). **[page]**
- It installs exactly one flow of its own, `harnesses`, serving a `readiness` view. `hk:112-116`; `kt:84` (the running app serves `agent`, `coder`, `harnesses`, `workforce-roster` with the harness kit and workforce listed and one worker file naming `flow: coder`). **[page]**
- It contributes two things to Workforce's slots: the `coder` worker flow into `workforce.slots.workerFlows`, and the readiness capability into `workforce.slots.uses`. `hk:105-106`. **[page]**
- The `coder` flow is one flow for every coding worker; another coding worker is another `WORKER.md`, never another flow. `cf:6-12`. **[page]**
- Use needs three things in `createFlowState`: Workforce, the harness kit, and at least one harness value in the slot. `hk:90-95` (the example); `cf:177-178` (no harness filled throws: ``coder: no harness is filled; fill the harness kit's `harnesses` slot.``). **[page]**
- Kit order in `kits` is free; kits install in `requires` order (see K-05 fact sheet `docs/contributing/docs-revamp/pages/catalog/workforce/index.facts.md` §1). **[page]** or omit.

## 2. Which slot it opens, and what fills it (question 1)

- The kit opens one slot, `harnesses`, keyed. `hk:100`. The key a filler uses is `harnesses.slots.harnesses`. `hk:93`; `dk:196-197`. **[page]**
- Each entry is a `Harness` value: `{ id, label?, agent, readiness, pass, usage?, models? }`. `hn:20-35`. **[page]** the four it needs (`id`, `agent`, `readiness`, `pass`); the optional two named in a clause; **[ref]** the field table.
  - `id`: what a worker's `harness:` line names, and what readiness rows are keyed by. `hn:21-22`.
  - `label`: the name a person sees; defaults to `id`. `hn:23-24`.
  - `agent`: builds the block one run runs, from the feeds its manager hands it. `hn:25-26`.
  - `readiness`: whether this machine can run it. `hn:27-28`.
  - `pass`: the environment variable names a run is given, beside the base ones. `hn:29-30`.
  - `usage`, `models`: when the harness reports its subscription usage or lists models. `hn:31-34`.
- The slot refuses an entry that is not a function where one is required, naming what is wrong (`a harness's \`agent\` builds the block a run runs`). `hn:37-50`. **[ref]**
- Two ways to fill it:
  - **A kit fills it.** `claudeCode()` is a kit that requires `harnesses` and fills `harnesses.slots.harnesses` with a harness `claude-code` (and `claude-code-plan` when its config `plan: true`). `cck:72-80`. It also serves a `claude-code` flow holding the collections a run records its work into. `cck:81-90`. **[page]**
  - **The app fills it with `fill`.** `createFlowState({ kits, fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()] } })`. `hk:92-94`; `lt:376-381`; `lc:200-208`. **[page]**
- Why Claude Code is a kit and the others are values: Claude Code installs collections of its own; Codex and Cursor install nothing. `cck:3-8`. **[page]** one clause, as a fact about what each is.
- `codexHarness(options?)` and `cursorHarness(options?)` return a `Harness` value. `cx:28`; `cu:25`. Their ids are `codex` and `cursor`. `cx:35`; `cu:32`. **[page]**
- Defaults the harness values set, which the page may state as what a reader gets:
  - Claude Code: runs with only Claude Code's own environment; records its work; allowed tools `Read`, `Write`, `Edit`, `Bash`; permission mode `acceptEdits` (`plan` for the second harness); project settings read, every hook off. `cck:3-21`, `cck:43-64`. **[page]** one sentence; **[ref]** the rest.
  - Codex: sandbox mode `workspace-write` unless the options say otherwise. `cx:1-7`, `cx:38`. **[page]**
  - Cursor: sandbox off, because the run is in its own worktree; model `"default"` unless the options name one. `cu:1-8`, `cu:37-41`. **[page]** (state the sandbox fact flat; it is a limit a reader needs)
- An app switches a filled harness off with `.without(harnesses.slots.harnesses, "<id>")`: `claudeCode().without(harnesses.slots.harnesses, "claude-code")`. `cck:18-20`; `lt:376`; `dk:168-170`. **[page]** one sentence, or **[ref]** `reference/kits`.
- Another kit's contribution can be switched off the same way: `harnesses(...).without(workforce.slots.workerFlows, "coder")` removes the kit's `coder` flow, for an app with a coding flow of its own; a worker file that names `flow: coder` then refuses at start. `hk:9-12`; `kt:93-104`. **[page]** one sentence.
- A `harness:` line that names a harness nobody filled refuses the app at start, naming the harness (not a missing flow). `kt:106-119`. **[page]**
- A `defaultHarness` that names one not filled throws when the kit is built: ``the default harness "<id>" is not one of <ids>``. `cf:179-181`. **[ref]**
- A stub is a harness value too: same `id`, a scripted `agent`. `hn:11-14`; `lc:180-188`. **[cut]** for the page (a testing concern; `reference/harness-runs` or the testing page).

## 3. Install it and configure it (the "install" section)

Config is the kit's own object. It is strict: an unknown key is refused. `hk:46-62`. **[page]**

| Key | Meaning | Default | Source |
|---|---|---|---|
| `workspace` | The workspace host a run works in, from `@flow-state-dev/workspace` (`localWorkspaceHost(...)`). Required. | none | `hk:48-50`; `cf:74-75` |
| `defaultHarness` | The harness a worker whose file names none runs on. Absent: such a worker's task is refused. | absent | `cf:76-77`; `cf:228-230` |
| `review` | A run that committed waits for a user's review before its task completes, whatever the worker's own `review:` says; a worker's `review: true` turns it on alone. | `false` | `cf:78-79`; `cf:231` |
| `pullRequests` | A task whose run opened a pull request waits for it to merge or close. | `true` | `cf:80-81`; `cf:206` |
| `judge` | `goalJudge` reads each run against its task's goal. | `true` | `cf:82-83`; `cf:205` |
| `checks` | `{ commands, timeoutMs? }`: the commands a run that changed files must pass in its worktree, and how long they may take together. | none; 10 minutes when `timeoutMs` is left out | `cf:84-85`; `cf:70`, `cf:144` |
| `project` | A task works in its session's project: it needs one, runs in its checkout, and runs the project's checks. | `false` | `cf:86-87`; `cf:138-141`, `cf:207`, `cf:304` |
| `runTimeoutMs` | One run's wall-clock budget. | 20 minutes | `cf:88-89`; `cf:67`, `cf:183` |
| `logReadiness` | Check every harness at start and log a table; never awaited, so a missing sign-in never stops the app. | `false` | `hk:41-43`; `hk:111` |

- **[page]** `workspace`, `defaultHarness`, `review`, `checks`, `project` and `logReadiness`; **[ref]** `reference/harness-runs` carries the full table with the rest. The page names the keys it uses in its examples.
- **The smallest call**: `harnesses({ workspace })`. Beside `workforce(...)`, with a harness filled. `hk:90-95`; `kt:80` (`harnesses({ workspace })`, `workforce({ directory })`). **[page]** (the plan's example)
- **`workspace`'s shape** is the workspace package's, not the kit's. A host over a local directory: `localWorkspaceHost({ root, remotes: { allow: [...] }, source, localRepositories? })`. `wsp:194-232`; `kt:53` (`localWorkspaceHost({ root, remotes: { allow: [] }, source: () => ({ kind: "repo", repo }) })`); `lt:304-310`. **[page]** one example; **[ref]** the host's options live on the workspace package's page.
  - `root`: the directory every checkout is made under. `wsp:195-196`. **[page]**
  - `remotes.allow`: the remote hosts it may reach, over `https` or `ssh`; `"file"` permits `file://`. `wsp:197-201`. **[page]**
  - `source`: where each run's files come from. `wsp:202-203`. **[page]**
  - `localRepositories`: absolute paths of repositories on this machine that runs are cut from directly. A source that answers one of those paths gets a worktree of that repository; any other bare path is refused. `wsp:204-231`. **[page]** one sentence, with the trust note below.
  - `setup`: a command run in each fresh checkout before the harness starts (`pnpm install --frozen-lockfile --prefer-offline`); once per checkout, again on the next provision until it exits 0. `wsp:248-254`; `hm:448`. **[page]** one sentence, because a new checkout has no installed dependencies. **[ref]** details.
- **A run in a listed local repository acts with the operator's trust:** it can create and move that repository's branches and refs. Keep a run that must not do that in a clone the host makes, by leaving the path out of `localRepositories`. `wsp:225-228`; `pj:967-969`. **[page]** one flat sentence.
- **A shutdown must wait for a run.** `codingDrainBudgetMs({ checks, project, judge, runTimeoutMs })` is what an app hands `createFlowState` as `dispatchDrainTimeoutMs`, in place of the engine's 30 second default, which would cancel a run. `cf:147-162`; `lt:394`; `lc:213`. **[page]** one sentence and the call; it is the line a reader forgets.
- **Durable execution.** A `review: true` kit needs a host with durable execution (`durable: true` in the examples). On a host without it a manager built with `reviewChanges: true` refuses each run before any harness step and cancels the task, naming durable execution. `hm:166`, `hm:726`; `rm:832`; `lt:395` (`durable: true`). **[page]** one sentence on `review`; **[ref]** the rest.
- A sign-in or key per harness is the harness's own: a harness is usable only where its SDK is installed and a user is signed in or a key set. `hm:458-459`. **[page]** (what `readiness` is for)

### The coding worker's file

- A coding worker's `WORKER.md` names the flow and the harness:

  ```md
  ---
  name: Codex
  description: Runs coding tasks on Codex in the background, in the team's working folder.
  flow: coder
  harness: codex
  ---
  ```

  `labs/teammates/workforce/teams/teammates/workers/codex/WORKER.md:1-6`. **[page]**
- The file's body becomes the worker's instructions in the run's brief. `cf:116-128` (`instructions: workerConfigOf(run.ctx).instructions`); `cp:1-6`. **[page]**
- `harness:` is validated against the filled harness ids: an id nobody filled is rejected. `cf:256-258` (`z.enum(ids)`). **[page]**
- `review:` on the worker overrides the kit's `review`: `review: true` waits for a review, `review: false` does not, absent follows the kit. `cf:231`; `cf:256-259`; `lc:17-19` (only one of two coders waits for review). **[page]**
- `harness` rides on the worker's roster row so a task line can name it (`showSettings: ["harness"]`). `cf:303-304`. **[ref]**

## 4. Where a run works, and what it is made from (question 3)

- Each task gets its own checkout: a git worktree of the repository the workspace host's source names, on its own branch. `cf:1-12`; `hm:9`, `hm:436-448`; `cc` "Its own checkout". **[page]**
- The checkout's place is derived from who the run belongs to plus the board, the issue and the phase, so a later session works out the same path without looking it up. `hm:438`; `ws:1-32` header. **[page]** one sentence, the guarantee: a retry lands in the same directory.
- For a kit task, the "issue" is the task's own id (`taskIssueSegment(task.id)`: its id when it fits a path and a branch name, a short hash otherwise) and the phase is `"code"`. `cf:187-192`, `cf:117-119`; `hm:418`. **[ref]**
- The branch is `conductor/<name>` and the folder `<root>/<name>`, where `<name>` is a slug of the task's title (at most 32 characters), then 6 hex that keep two runs apart, then `-<n>` only when two names collide. `ws:41-47`, `ws:518-584`, `ws:759-780`. **[page]** the shape in one line (`conductor/fix-cart-test-3fa9c1`); **[ref]** the slug and bump rules.
  - **[verify]** `hm:272` says a task that names an issue under `harnessFeature` gets `conductor/<scope>/<issue>--<task-id>--<phase>`. The code's `branchFor` keeps that long shape only for a run recorded on it (`ws:759-780`), and `runName` leads with the tracker issue for a new run (`ws:571-583`). The kit's tasks name no `harnessFeature`. Leave the issue-led form off this page.
- A run's branch is checked out in the run's worktree for as long as the run can be continued. `pj:971` (a branch stays checked out in the run's worktree; `fsdev worktrees <root> --remove <path>` frees it). **[page]** one sentence if the page says how to review by hand; else **[ref]**.
- A lease keeps two attempts out of one tree: a lock file beside the checkout, taken before provisioning, released on every exit. `hm:442-444`. **[cut]** to a clause or **[ref]**; it is mechanism. The guarantee is "two attempts never work in one tree at once".
- Setting a run up never touches the user's working tree or index; runs share the repository's refs when it is listed in `localRepositories`. `cc` "Its own checkout"; `wsp:225-228`. **[page]**
- A failed attempt's changes stay on its branch; a retry continues the work already in the checkout. `hm:9`; `cc` "Its own checkout"; `cc` "What it gets you". **[page]**
- **What the checkout is made from**, by source:
  - A repository on this machine listed in `localRepositories`: a worktree of it, branch kept in it. `wsp:204-211`.
  - Any other source the host allows (`remotes.allow`): a clone under `root`. `wsp:197-201`; `hm:728`.
  - **Where the source answers a project:** see section 9.
  - A new branch cut from a base that tracks an upstream is cut from the newer of the two, after one fetch of that upstream; a base and upstream that have each moved are refused as `base-diverged`; a failed fetch starts from the local base with a warning. `wsp:212-218`; `pj:945-955`. **[ref]**
- A checkout lives on the machine that made it unless the host has a held-work store and the source returns a `heldPrefix`. Then the manager saves commits and uncommitted changes at each turn's end and when the harness fails, and a retry on another machine gets the checkout back from the last save with the changes unstaged. `hm:446`; `rm:70-86`. **[ref]**; the page says in one sentence that it is opt-in. Limit: a turn in progress is lost when a machine dies. `hm:721`. **[ref]**
- A fresh checkout has no installed dependencies, so a run's first build or test would fail unless the host has a `setup` command (above). `hm:448`. **[page]** one sentence.
- **The checkout is where the agent is pointed, not a jail.** The sandbox on the harness sets what it may run. The kit's Claude Code harness has none; it can run shell commands as the server's user. `cc` "Its own checkout"; `cck:48-58` (`allowedTools` includes `Bash`; no sandbox option). Codex: `workspace-write`. Cursor: sandbox off. **[page]** flat limit.
- The deadline: `runTimeoutMs` bounds the harness step; the manager fires the step's abort signal when it passes; how promptly the harness returns is the harness's own; a command the agent's process started can outlive it. `hm:450-454`. **[page]** one sentence (the default is 20 minutes); **[ref]** the rest.

## 5. The verdict: what must hold before a run's task is marked complete (question 2)

The order the kit applies, from the harness's end to a settled task. Each step is a condition for the next.

1. **The harness terminated normally.** The verdict is read from the handle's `status`, not from what the agent said. A run that did not terminate normally is a failed attempt and is re-queued with the reason until the retry budget runs out. `hm:31`, `hm:33`. **[page]**
2. **The run's own report says it finished.** The kit's phase is done only when `stopReport === "finished"`. A run that spent its turns or budget commits what it got through and reports `stopped-at-limit`; that is not done. `cf:117-128`; `cp:1-6`; `hm:31`, `hm:96-98`. **[page]** (the neutral words `finished`, `stopped-at-limit`, `failed`, `null`; **[ref]** the handle's fields)
3. **Checks pass, if the run changed files.** With the kit's `checks` (or, with `project: true`, the project's checks via `projectChecks()`), a run that changed files is done only when the commands pass in its worktree; a run that changed nothing (a question) skips them. `cf:21-24`, `cf:138-145`; `cp:44-62`. **[page]**
   - "Changed files" means uncommitted files, or a tree that differs from the commit its branch was cut at; trees are compared, so a run that moved its branch back still counts; no base or anything git cannot answer counts as changed, so the checks run. `cf:96-114`. **[ref]**
   - A red command: exited non-zero, timed out, skipped, or could not run. The attempt fails, goes back to the board, and the next brief names the command, why, and the end of its output. `hm:308`; `cp:44-52` (reason names the command and its output). **[page]**
   - Commands run one after another, no shell; a failing command does not stop the ones after it; `timeoutMs` is one wall clock for all of them. `hm:306`, `hm:333`. **[ref]**
   - The brief names the checks too, from the same list. `cf:130-132`; `cb:10-14`. **[page]** one clause ("the run is told what it will be held to").
   - A green check is evidence for the reviewer, not proof: the checkout's scripts are ones the agent could edit. `hm:337`; `cc` "A verdict before it counts". **[page]** one sentence.
   - With `checks` absent or `commands: []`, the checks step passes. `cp:55-58`. **[page]** implied.
4. **The judge reads the run against the goal, when the task has a goal and `judge` is on.** The judge is `goalJudge`, an evaluation model reading the goal, the agent's answer, the run's commits and the files they changed, answering done, not done or ask, with a confidence. `cf:205`; `gj:1-30`. **[page]**
   - A confident *not done* (at or over the floor, default 0.7) fails the attempt, and the next brief carries the judge's reason. A verdict under the floor counts as done. `gj:35` (`GOAL_JUDGE_FLOOR = 0.7`); `hm:278`. **[page]**
   - *Ask* puts a question to the user, the same way a question from the run does. `hm:278`; `gj:20-24`. **[page]**
   - A judge that fails never fails the task: it settles on the phase's check and the output says `judged: false`. `hm:278`. **[ref]**
   - The judge reads only a task that has a goal, on a board read from the claim. `hm:278`. **[ref]**
   - The model is `typesafe-ai/jev` unless a host names another; the kit passes none. `gj:32`; `cf:205`. **[verify]** it is a resolver-routed evaluation model; the page says "an evaluation model" and leaves the id off.
5. **A user's review, when `review` is on and the run committed.** With the kit's `review: true` or the worker's `review: true`, a run that would otherwise complete and has commits waits for a user to accept before the task completes. `cf:16-18`, `cf:231`; `hm:132-140`. **[page]**
   - A run is reviewed when it would otherwise complete: the judge said done, there is no judge, or the verdict was under its floor; and its branch has commits. If git cannot read the commit count, it is reviewed anyway. A run with no commits completes unreviewed; a failed run fails its attempt unreviewed. `hm:138`; `rm:474`. **[page]** the first and third; **[ref]** the unreadable case.
   - While it waits the task stays `in_progress` on the same attempt, keeps its claim, and the checkout is released. The user's Inbox lists it as a review titled "Review the run's changes". `hm:140`; `rm:476`. **[page]**
   - The prompt gives the commit count and up to 20 subjects, "N files changed (+a −d).", "Checks n/m passed." when the phase ran commands, and what the judge said, or "No judge read this run."; the judge's verdict is information, not approval. `hm:140`. **[page]** in one sentence; **[ref]** the exact lines.
   - **Answers.** `{ verdict: "accepted" }` or `{ verdict: "revise", words }` (non-blank `words`, else a 400 and the review stays open). `hm:142-156`; `rm:487-493`. **[page]** with the Inbox client call (section 7).
   - Accepting completes the task with no further run, output `review: "accepted"`. `hm:158`. **[page]**
   - Asking for changes writes the words on the task as the user's message; one more run starts on the same attempt, continuing the same coding session; if it commits again it is reviewed again over all the branch's commits; each request counts toward the task's message limit, and past it the attempt fails. If the harness never confirmed a coding session, asking for changes fails the attempt instead and the next brief carries the words. `hm:160`. **[page]** the first clauses; **[ref]** the limit and the no-session case.
   - No deadline unless the host sets `userDeadlineMs`; at the deadline the task completes with `review: "deadline"`, which a screen shows as not reviewed, never approved. `hm:162`; `g4` leg f. **[page]** one sentence.
   - A cancel while it waits closes the review and starts nothing; the branch's commits and kept files stay. `hm:164`. **[page]** one clause.
   - A review survives a host restart; the answer continues the run. `hm:166`; `g4` leg c. **[page]**
6. **Pull requests, when the run opened one and `pullRequests` is on (the default).** A task whose run opened a pull request is done when it merges, cancelled when it closes unmerged; a judge's confident *not done* does not fail such a run, and the judge's reason shows as a note. `cf:19-20`, `cf:206`; `mg:615-628` (the option's doc); `at:131-153`, `at:220-262`. **[page]** one short paragraph.
   - Only a host with a way to wake a waiting task should turn it on; until one does the task stays open. `mg:629-630`. **[verify]** the kit turns it on by default; the page states the behaviour and links to Reference for the host requirement. Do not say what host wakes it.
   - Needs the host's signed-in `gh` to read GitHub; a check that cannot reach it is a status note, never a verdict. `rm:565-573`; `at:323-340`. **[ref]**
   - The run records each pull request it opens; before the verdict the manager also asks GitHub which pull requests the branch has. `rm:565-573`. **[ref]**
7. **Anything short of done fails the attempt, and the next attempt is told why.** `hm:33`; `cp:60-62`; `cc` "A verdict before it counts". **[page]**
- **The settled task's output**, when completed: the agent's last message as `answer` (up to 8,000 characters), the run's `branch` (`null` when it worked on files alone), `commits`, and `review` (`"accepted"`, `"deadline"`, or `null`). `hm:266`; `g4` (`review: "accepted"`). **[page]** the fields the page's example reads; **[ref]** the rest.
- **What a run's attempt budget is** (how many retries) is the board's; the kit sets none of its own. **[gap]** do not state a number; link to `reference/harness-runs` and the board.

## 6. Questions to a person, and a run you can watch

### What holds a task on a user (the "Questions to a person" section)

- A task can stop and wait on a user. While it waits it holds no lease and no checkout and starts no other run; nothing is spent while the user thinks. `hm:112`, `hm:124`; `cc` "Asking you a question". **[page]**
- Three things in the kit hold a task on a user:
  - **The judge's *ask*.** `hm:278`; `hm:126`. **[page]**
  - **A review** (`review: true`). `hm:140`. **[page]**
  - **Saved work that does not match the run's record** (only with a held-work store). The harness does not run; the task waits on a question for the run's owner, naming what disagreed. `hm:446`; `rm:84`. **[ref]**
- **The agent does not ask questions through the kit.** The kit's brief tells the run to answer a question in full and change nothing, and to commit a change; it names no question path. `cf:117-128`; `cb:18-23` (`terms`). **[page]** state flat: the questions a reader sees from the kit are the judge's, the review's, and the saved-work one. The package's own file-marker ask (`ask.ts`) is a phase author's seam, **[ref]**. **[verify]** `cc` says "By default the agent does not ask you questions itself"; consistent.
- **Tool-call approval is not on through the kit.** `approveTools` is a `harnessManager` option; the kit's managers do not set it (`cf:196-208`). Claude Code in the kit runs with `permissionMode: "acceptEdits"` and `allowedTools: ["Read", "Write", "Edit", "Bash"]` (`cck:54-55`), with nobody to approve a call. **[page]** one flat sentence; **[ref]** `approveTools` on `reference/harness-runs`.
- **Where the question shows.** In the user's Inbox, and on the task's open `holds` / `questions` when read with `getTask`. `hm:112`; `hm:140`; `hm:198`. **[page]**
- **Answering.** From the Inbox, or by typing a line in the run's session. A line answers the task's oldest open question; the turn that answer owes resumes the same coding session. `hm:114`, `hm:432`. **[page]**
- **The answer continues the same conversation, on the same attempt, and spends no retry.** `hm:120`, `hm:122`; `cc` "Asking you a question". **[page]**
- **A question waits until it is answered or the task is cancelled**, unless the host sets `userDeadlineMs`; at the deadline a question closes with a "no answer came" message and the next run goes on in the same session. A review's deadline completes the task as not reviewed (section 5). `hm:124`, `hm:162`. **[page]** one sentence; **[ref]**.
- **Answering from your own screen** with the Inbox client:

  ```ts
  import { createInboxClient } from "@flow-state-dev/orchestration/inbox";
  const inbox = createInboxClient(client);
  await inbox.answer(item, { value: { verdict: "accepted" } });
  await inbox.answer(item, { value: { verdict: "revise", words: "Keep the old endpoint as a fallback." } });
  ```

  `hm:142-154`; `rm:487-493`. **[page]** (example 3's neighbour)
- To draw a review, `fsdev ui add review-hold` adds the `review-hold` component; `reviewDetail(item.data)` from `@flow-state-dev/harness-manager/browser` gives it its `review` prop. `rm:495-510`; `rv:1-60`; `br:27`. **[page]** one sentence; **[ref]**.
- **Typing a line in a run's session.** While the task is open the line steers it (kept on the task as the user's message; the run takes it at its next step in the same coding session; no attempt is used). Once the task and its follow-ups have finished, a line is talk: one harness run resumes the task's coding session and its answer is the reply; the task and its output do not change. `hm:353-357`; `cf:28-29`, `cf:263`, `cf:277-285`. **[page]** one short paragraph; **[ref]** `reference/harness-runs` for the door's refusals (`not-started`, `cannot-continue`, `steer-limit`, `finished`, `not-supported`). `hm:424-430`.
  - Only the run's own user can send one. `hm:434`. **[ref]**
- **How a running task is doing.** While a step runs the manager keeps the task's `statusNote` to the last thing the run did (a message's first non-empty line, or `<tool>: <detail>`), at most one write every 30 seconds, cut at 280 characters; read with `getTask` / `listTasks`. `hm:371-377`. **[page]** one sentence ("a coordinator asked 'how is it going' reads it"); **[ref]**.

### Reading a run's changes on a page (example 3)

Three reads exist under the kit; flag 5 says which the page chooses.

- **(a) The review's files.** With `review: true`, the hold's data has `files` (up to 200 of `{ path, added, removed }`, `added`/`removed` `null` for a binary file), `fileCount`, `added`, `removed`, all `null` when git could not read the diff. Only committed changes count; a rename is the old path removed and the new path added. `hm:140`; `rm:476`; `cm:100-103`, `cm:105-136` (`MAX_DIFF_FILES = 200`, `RunDiffFile`, `RunDiff`). **[page]**
- **(b) The `RunChanges` component** (`fsdev ui add run-changes`): takes `files`, `fileCount`, `added`, `removed`, an optional `loadPatch(path)`, `defaultOpen`; shows "N files changed (+a −d)" and opens into the list; `files={null}` draws nothing (the page says in its own words that the changes could not be read). `hm:175`; `packages/ui/registry/components/run-changes.tsx:1-50`. **[page]**
  - `loadPatch` is the app's call to a `changes` **view** (`harnessRunChangesView`), which the kit's `coder` flow does not declare (flag 2). **[gap]** the page shows the component without `loadPatch`, or says per-file patches need a view the app adds, with a link to Reference.
- **(c) `harnessRunChangesView`** (for an app that adds the view): `defineView({ scope: "session", block, ... })` built by `harnessRunChangesView({ board, uses? })` and declared `views: { changes: ... }`; input `{ taskId?, path? }`; without `path` answers `{ taskId, diff, patch: null }` with `diff` `{ files, fileCount, added, removed, verified }`; with `path` answers `{ taskId, diff: null, patch: { path, patch, truncated, verified } }`, the patch cut at `MAX_PATCH_CHARS` = 64,000 characters; `verified: false` means git could not read it; a run of kept files alone answers a verified empty diff; a session that ran no task, or a `taskId` from another session, fails with `HarnessRunChangesRefused` (reasons `not-started`, `not-this-session`). `rc:36-45`, `rc:51-58`, `rc:64-79`, `rc:100-137`; `cm:96-136`. **[ref]**; the page names it in a sentence.
  - Answered in the response and stored nowhere. `rc:5-7`. **[ref]**
  - It reads git on the run's committed history and takes no checkout lease. `rc:8-10`. **[cut]**
- **(d) `readRecordedWork(client, { sessionId, requestId })`** from `@flow-state-dev/harness-manager/browser`: returns `{ plan, files, pullRequests }`, each `{ rows, truncated }` or `null` when the harness records none; file rows `{ path, kind: "created" | "edited" | null, applied }`; only rows of that request, even when the session holds earlier runs; a read that fails throws the client's own error. `rw:1-12`, `rw:37-82`; `rm:348-358`. **[page]** the call and `work.files?.rows`. It reads the run session's recorded collections, which exist only when the harness records its work (Claude Code in the kit does: `recordWork: true`, `cck:50-53`). **[verify]** Codex and Cursor in the kit: nothing in `cx`/`cu` records work, so `files` is `null` for them; do not claim otherwise.
  - The task's run link names `{ sessionId, requestId }`: `packages/shift-manager/src/surfaces/TaskInspector.tsx:151-160`; `packages/shift-manager/src/lib/run.ts:20-27` (`OpenRun`). **[page]** where the two ids come from, in a clause.
- **(e) `workPlace(task.output)`**, from `@flow-state-dev/harness-manager/work-place` (or `/browser`): returns the run's branch, commit count and the commands that reach the work (`git switch`, `cd` into the checkout, `git log <baseCommit>..<branch>`), each quoted for a shell; `null` for a run with no branch; the count is `null` when unknown, never a guessed zero. `rm:336-346`; `packages/harness-manager/src/work-place.ts:64-73`; `br:28`. **[page]** (the plain way to say where the work is); the UI registry's `work-place` component draws it. `rm:346`.
- The run's own session and the item stream carry what the run did; the task record's `run` link names `{ sessionId, requestId, attempt }`. `packages/shift-manager/src/lib/run.ts:20-27`. **[ref]**

## 7. Filling the slot from the app (example 2)

- Claude Code is the kit-filled harness; add it with `claudeCode()` in `kits`. `cck:66-80`; `lt:376`; `lc:198-203`. **[page]**
- Codex and Cursor are filled with `fill`:

  ```ts
  createFlowState({
    kits: [workforce({ agent: { model } }), harnesses({ workspace, defaultHarness: "cursor" })],
    fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()] },
  });
  ```

  `hk:90-95`; `lt:372-381`. **[page]** (pass `codexHarness()` and `cursorHarness()` imports from `@flow-state-dev/codex` and `@flow-state-dev/cursor`: `lt:57`, `lt:60`)
- `codexHarness` and `cursorHarness` take the block's options less what each run feeds it (`cwd`, `resume`, `onSession`, `onActivity`; Cursor also `onSteerable`): `CodexHarnessOptions`, `CursorHarnessOptions`. `cx:19`, `cx:23-26`; `cu:20`, `cu:22-25`. **[page]** a clause; **[ref]**.
- What the manager hands each harness's `agent`: `cwd` (the checkout), `resume` (the conversation to continue, or `null` for a fresh one), `onSession` (the harness names its session), `onUsage` (usage windows a run reports), `onActivity` (each message and tool call), `onSteerable` (a harness whose run can take a message mid-turn), `onToolApproval` (only when `approveTools` is on). `hm:70`; `hm:196`. **[ref]**
- **Which harness a task runs on:** the harness the session's worker names in `harness:`, else the kit's `defaultHarness`, else the task is refused with ``worker "<id>" names no `harness:` in its WORKER.md, and the harness kit sets no `defaultHarness`.`` `cf:224-233`. **[page]**
- **Before each task starts** the flow asks whether that harness can run on this machine. If not, the task fails at once with the reason and what to run (`codex login`), and never falls back to another harness. `cf:12-13`, `cf:241-246`; `hm:544-547`; `cc` "Choosing a harness". **[page]** (the guarantee a reader relies on)
- **Readiness is not stored.** `harnessReadiness(...)` keeps rows in the process and polls nothing; the first read runs every check; `refresh: true` checks every harness again, `refresh: "<id>"` one; reads that arrive together share one check per harness; a check that throws, rejects or passes `timeoutMs` (30 seconds) is `ready: false`, `unanswered: true`; a check answers whether a credential is there, not whether it works. `rd:20-32`; `hm:497-527`, `hm:495-499`. **[page]** the first and last facts in a sentence; **[ref]** the rest.
- **The `harnesses` flow's `readiness` view** has one row per harness filled, read with no session; `{ refresh: true }` checks again. `hk:16-18`; `kt:62-75`, `kt:84-91`; `rd:14-16`, `rd:258`. A row: `{ harness, label, ready, reason, remedy, unanswered, checkedAt }` (`reason` and `remedy` `null` when ready or none named). `rd:50-64`. **[page]** the row's shape in a short block, since "which can run here" is what a screen draws; **[ref]** field details.
  - The client reads it with `client.view(harnessReadinessViewRef, input?)` (`br:26`; `packages/client/src/client.ts:582`, `:787-826`). **[reconcile]** the exact call a page makes was not read end to end; keep the page's example to the view's name and row shape unless the caller confirms.
- **Which harnesses are ready is also put in the worker's context** (the `harnessReadinessCapability` added to `workforce.slots.uses`), so a worker files coding work only on a ready harness and says what to run for one that is not. `hk:13-15`, `hk:106`; `hm:532`. **[page]** (one sentence)
- **`logReadiness: true`** logs the table at start. `kt:121-136` (the log holds each harness's label and the remedy for one that cannot run). **[page]**
- **Usage.** A `Harness` may carry a `usage` reader. The kit does not install `harnessUsageAction`/the usage flow. `hk:96-118`: no usage flow in `install`; `ix:36-60` header lists `harnessUsageFlow` separately. **[ref]**; not on this page. The subscription-usage surface lives on `reference/harness-runs`.

## 8. Stored data (the four questions)

For each stored part: who owns it, who can see it, where it is stored, how many exist.

| Stored part | Owns it | Who can see it | Where | How many |
|---|---|---|---|---|
| **The run record**, the manager's own account of a run: which checkout it was given (`workspacePath`, `branch`), which harness session it confirmed, how the last attempt ended and why, the checks' results, the place and held-work state | The user the run belongs to. The collection is `scope: "user"`, "the same principal as the board", and the framework keeps a user-scoped collection per user and organization. `rr:48-60`, `rr:348-358`; `ws:640-660` (another organization never reads this one's record) | **Not client-readable.** The collection is declared with no client read; the read surface is the flow's server-side `status` for a manager built from the root, and the task record carries the run link. `rr:342-347` (doc comment). **[verify]** `status` is a surface of the board flow a host builds from the root; the kit's `coder` flow declares no `status` action (`cf:262-274`). Say only "not read by a browser directly". | `runs/**` in the user's own scope, keyed `<board>/<issue>/<phase>` (the bare topic; the stored key is prefixed `runs/`). `rr:86-87`, `rr:348-358`; `ws:41-47` | One per task, per phase. For a kit task, the issue is the task id and the phase is `code`, so one record per task. `cf:187-192`. **No retention**: records are never pruned and grow with the number of tasks. `rr:62-72` (named limit); `hm:724` |
| **The checkout**: a git worktree on its own branch, a lock file beside it | The run (the user it belongs to). Its place is derived from the user, the board, the issue and the phase | The machine's disk under the host's `root`; a repository listed in `localRepositories` also carries the branch in itself | A directory `<root>/<name>` and branch `conductor/<name>` | One per task. A retry continues in the same one. Not removed when the run ends: `fsdev worktrees <root> --remove <path>` frees it, and refuses while it has uncommitted changes or a run is still working in it. `pj:971`; `ws:567-584` |
| **Held work** (opt-in): the run's commits and uncommitted changes, saved so another machine can pick the run up | The run's user | The workspace host's held-work store | Under the `heldPrefix` the source returns for the run | One per run that has a prefix. Without a held-work store nothing is saved. `hm:446`; `rm:70-86` |
| **A run's recorded work** (plan, files its tools touched, pull requests), when the harness records it | The run's session (so the user the session belongs to) | Read through the client's resource routes by `readRecordedWork`; the session's resource manifest names the collections | The run session's recorded collections: `observed-file-ops/**`, the plan collections, `observed-pull-requests/**` | One row per file operation target, per plan step, per pull request, per session; filtered to one request by `readRecordedWork`. `rw:21-35`, `rw:98-120`. **[verify]** whether Codex and Cursor in the kit record any; see §6(d) |
| **Readiness** | Nobody: it is the process's memory of this machine | `harnesses` flow's `readiness` view, any user, with no session | **Nowhere stored.** Held in memory; another process checks its own machine | One kept row per harness filled, per process. `rd:28-29`; `hm:526-527` |
| **Harness usage rows** (when an app adds the usage flow) | The user; keyed by the bare user id, so a user id reachable from two tenants shares one row | The user's own rows, through a view, never the collection | `harness-usage/**`, user scope | One record per user per harness. `packages/harness-manager/src/harness-usage.ts:141-153`; `hm:658-659`, `hm:723`. **[ref]**; the kit installs none of it |
| **The board row and its holds** (review, judge's ask) | The board's: the task belongs to the user the board belongs to | The user, in the Inbox and through `getTask` | The board's own collection | One row per task; a hold per open question. `hm:112`, `hm:140` |

- **[page]** the first three rows as a short table or three sentences; the run record's "nothing prunes it" as a limit; **[ref]** held work and usage.
- The run record also keeps `lastSave` for kept files, `place` and `held`; the page names `place` and `held` only if it covers held work. `rm:80-86`. **[ref]**

## 9. A project's code and files (the plan's fourth Use-it section)

What the kit does with a Workforce project. The projects page is `workforce/projects` (K-?); this page states only the coding half.

- `harnesses({ workspace, project: true })`: a task works in its session's project. It needs one, the run works in its checkout, and its checks are the project's. `cf:25-27`, `cf:86-87`; `lc:196-197`. **[page]**
- With `project: true` the kit (a) adds `projectWorkspaceCapability` to each manager's `uses`, (b) uses the project's checks instead of the kit's `checks` (`projectChecks()`), and (c) registers the `coder` flow with `needsProject: true`. `cf:138-141`, `cf:207`, `cf:304`; `packages/workforce/src/projects/project-checks.ts:34`; `packages/workforce/src/projects/project-workspace.ts:111`. **[page]**
- **`needsProject: true` moves the check to filing.** A task for one of the flow's workers is refused when it is filed with nowhere to work: no workstream, no project on the conversation, none named in `input.project`. Nothing is filed and nothing runs. `createTask` answers `{ ok: false, error: "no_project: …" }`, and the message tells the filer to set the conversation's project (`listProjects`, then `setWorkProject`) and file again. `pj:664-676`. **[page]**
- **The workspace host's source is the app's to set**, and for a project it is `projectWorkspace()` from `@flow-state-dev/workforce`: the repository of the project the run works for, with the project's files beside the checkout, or the project's files alone when it has none. `pj:626-641`; `rm:63-69`; `lc:142-145`. **[page]** one example (`localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace() })`, then `harnesses({ workspace, project: true })`).
- **How a run finds its project, in order:** the workstream the task came from; the project the task came from (a project's conversation, or a conversation set to work in a project); the project the task names in `input.project`, by visibility and id, when it came from a conversation with no project. `pj:643-649`. **[page]** a short list; **[ref]** the refusal table (`other-project`, `no-project`, `not-a-member`, `not-the-owner`, `no-such-workstream`, `no-such-project`, `invalid-remote`). `pj:652-662`.
- **A refused run is not retried.** The row is cancelled on its first attempt before the harness starts, with the refusal as its reason; on a conversation's task the task fails and the conversation hears why. `pj:663`; `rm:90`; `hm:268`. **[page]**
- Membership is read from the user the run belongs to; nothing the task says counts toward it. `pj:663`. **[page]**
- **A project with a repository** runs in a fresh branch of that repository (a remote the host allows; the project names a remote, never a folder). Changing the repository applies to new work; work already started stays where it began. `pj:611-614`, `pj:579-583`. **[page]**
- **A project with no repository** still runs coding work: the first run starts from an empty set of files, everything it writes is saved to the project's files, the next run starts from what the last left; two runs changing one file are merged, a real conflict is reported on the run instead of overwriting; a run is not marked done until what it wrote is saved (a failed last save fails the attempt; the retry saves it). `pj:613`. **[page]**
- **The project's files** live under `project-files/<projectId>/<path>`; in a project with a repository a run finds them in `project/` next to its checkout, never inside it, so they do not show in `git status`; whatever the run leaves there is saved back. `pj:977-1000`. **[page]** one sentence.
- **The project's checks:** a member names them (`checks: ["pnpm typecheck"]` at create, or `setChecks`); with `project: true` a run is done only when they pass in its checkout. A list changed between two attempts applies to the second. A run with no project gets no checks. `cf:138-141`; `pj:873-908` (the `projectChecks()` wiring is at `pj:889-908`). **[page]** one short paragraph and a link to Projects.
  - Each command is one program and its arguments, no shell; a line with `&&`, `||`, `|`, `;`, `&`, `<`, `>`, `$(` or a backtick is refused with `invalid-check`. `pj:884`. **[ref]** (belongs on the projects page)
  - A project's checks are a member's words, run on the machine that runs the coding workers; the kit's `project: true` is the host opting in. `pj:889`. **[page]** one flat sentence.
- **Working in a checkout you already have:** `projectWorkspace({ checkouts: [{ remote, checkout, projects: [{ orgId, id }], baseRef? }] })` with the checkout also listed in the host's `localRepositories`; only shared projects can be listed, a run uses the checkout only when its project is listed, the session belongs to that organization, and the project's `repository` equals the `remote`. `pj:910-955`; goal `goals/projects/a-mapped-project-works-in-your-checkout/goal.md`. **[ref]** (the Projects page covers it; this page links).
- Reading the project's files from a conversation, the coordinator's project tools, workstreams: all Projects. **[cut]** here.

## 10. What the kit needs from Workforce (question 4)

- **It requires the `workforce` kit**: `requires: [workforce]`. Without it the app does not start. `hk:98`; `dk:121-122`. **[page]**
- **It fills two of Workforce's slots**: `workforce.slots.workerFlows` with the `coder` flow, and `workforce.slots.uses` with the readiness capability. `hk:105-106`. **[page]** Names of Workforce's three slots (`workerFlows`, `uses`, `flows`) are on the Workforce page (`wk:177-181`).
- **It builds the `coder` flow with Workforce's own pieces:** `workerFlow(...)`, `workerConfigSchema()`, `workerConfigOf`, `conversationLedgers`, `filingConversationBoard`, `messageReceivedEntry`, `startOwedSteerTurn`, `steerTurnEntry`, `workerTaskEntry`, `workerMessagesResources`, `projectChecks`, `projectWorkspaceCapability`. `cf:35-51`. **[ref]** (a reader needs "the flow is built from Workforce's worker pieces", not the list)
- **A coding worker is a Workforce worker.** It is a `WORKER.md` that names `flow: coder`; hiring, forking, roster and its row work as for any worker. The `coder` flow is a collection flow (`cardinality: "collection"`); one registered copy serves every coding worker, and each turn runs as the worker its session names. `cf:252-254`, `cf:224-226`; K-05 sheet §3.1 (the same for `agent`). **[page]**
- **Tasks reach it through Workforce's board.** The manager reads the board of the conversation a task was filed in (`conversationLedgers`, "the board of the conversation the task came from, for the user the run belongs to, and nothing else"), not one fixed board; the manager reads board and partition from the claim, never from the task. `cf:187-192`, `cf:201`; `hm:246-264`. **[page]** one sentence (a worker takes tasks a coordinator files in a conversation).
- **A lead delegates to it** by filing a task for the coding worker; the run is the work of that task. `cc` "How it fits with the others". **[page]** (link to C-23 and Delegating work)
- **Messages between workers:** a message delivered to a coding run's session wakes it the same way a typed line does (`onMessageReceived`, `hears: "task-sessions"`). `cf:277-285`; `cf:28-29`. **[ref]**; mention in one clause or cut.
- **Roles:** the `coder` flow's workers are registered with `roles: ["contributor"]`. `cf:304`. **[ref]**
- **What it does not need:** the model for the worker (the `workforce({ agent: { model } })` model is for workers on `agent`; a coding run's model is the harness's own, set inside its value: `cx:38`, `cu:37-41`). The page may say a coding worker's "model" is whatever its harness uses. **[page]**
- **The kit and the manager are separate.** `harnessManager({ harness, ... })` is the lower-level worker for an app with its own board and no Workforce; the kit is built on it, one manager per harness, and one more per harness that waits for a review (named `coder-<id>` and `coder-<id>-reviewed`). `cf:193-209`; `rn:1-30`. **[page]** one sentence linking to `reference/harness-runs` and the harness manager's guide; do not teach the manager's options.
- **Another kit in the same app that wants the same flow name** conflicts: a worker flow key may be filled once. **[verify]** nothing citable on the error; leave off.

## 11. What the page does not state (links, cuts)

- **The model**: a harness is a block; a supervised run; the figure of checkout → agent → verdict. C-23 (`cc`). The page links; it does not re-explain. **[cut]** from this page.
- **Run states, the verdict contract, the handle's `status` / `outcome` fields, workspace options, per-agent sandbox settings, retry and attempt rules, the door's refusals, `approveTools`, usage, held work setup, `commandCheck`'s options, the readiness API, `stopsOnAbort`, live steering with `onSteerable`**: `reference/harness-runs`. **[ref]**
- **Mechanism, not stated:** the lease and its stale window; the ownership wait; how the checkout path is hashed; the `ATTEMPT_SCOPED_CLEAR`; the atomic write behind a record; how the judge model is asked its two questions. **[cut]**
- **Limits to state flat, on the page:** reviews need durable execution; a Claude Code run through the kit can run shell commands as the server's user; a repository listed in `localRepositories` is shared with the run; run records are never pruned; a harness that never confirmed a session cannot be talked to once finished; saving work across machines is opt-in. `hm:719-728`. **[page]** the first four; **[ref]** the rest. (Per the standard, limits go to Reference rows on a concept page; on a catalog page, state the ones a reader acts on.)
- **Not citable, so not stated:** how many attempts a task gets; whether `pullRequests: true` works on a host with no wake path; what happens when `project: true` is set over a source that is not `projectWorkspace()`; whether Codex or Cursor record plan and files; what the kit's `coder` flow serves for per-file patches (nothing); the host requirements of the review's landing options (`lands`: `pull-request` and `merge`), which `reviewDetail` returns and the docs do not describe. **[gap]**
