---
title: Harness runs
type: reference
description: "The harnesses kit and workspace options, a run's states, what marks its task complete, the question channel, review, what a run records, and the options of Claude Code, Codex and Cursor."
---

import Figure from "@site/src/components/Figure";
import States from "./figures/harness-run-states.svg";

# Harness runs

A harness run is one coding agent (Claude Code, Codex or Cursor) working on one task in a checkout of its own. A task is a unit of work filed on a board, such as "fix the refund rounding bug". The `harnesses` kit turns each such task into a supervised run: its own checkout, checks and a verdict before the task completes.

[Coding harnesses](../concepts/coding-harnesses.md) explains the idea. This page is the exact surface.

The tables use the `support` app. Its config installs the kit with a local repository, checks, review and a custom branch prefix:

```ts title="fsdev.config.ts"
import { claudeCode } from "@flow-state-dev/claude-code";
import { codexHarness } from "@flow-state-dev/codex";
import { createFlowState } from "@flow-state-dev/engine";
import { codingDrainBudgetMs, harnesses } from "@flow-state-dev/harness-manager/kit";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";

const repository = "/srv/support";

const workspace = localWorkspaceHost({
  root: ".fsdev/runs",
  remotes: { allow: [] },
  localRepositories: [repository],
  source: () => ({ kind: "repo", repo: repository }),
  setup: { command: ["pnpm", "install", "--frozen-lockfile"] },
});

const checks = { commands: ["pnpm typecheck", "pnpm test"], timeoutMs: 600_000 };

export const app = createFlowState({
  kits: [
    claudeCode(),
    harnesses({ workspace, defaultHarness: "claude-code", review: true, checks, branchPrefix: "support/" }),
    workforce({ agent: { model: "openai/gpt-6-luna" } }),
  ],
  fill: { [harnesses.slots.harnesses]: [codexHarness()] },
  durable: true,
  dispatchDrainTimeoutMs: codingDrainBudgetMs({ checks }),
});
```

A coding worker is a `WORKER.md` that names the `coder` flow. Its `harness:` and `review:` lines are on [WORKER.md](./worker-md.md):

```md title="workforce/teams/engineering/workers/coder/WORKER.md"
---
description: Changes the code in the session's project.
flow: coder
harness: codex
review: true
---
```

## What the kit adds

`harnesses(config)` requires the `workforce` kit and has one slot, `harnesses`, a keyed slot of harness values. An app fills it with `fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()] }`. `claudeCode()` fills it itself. Each run is driven by a harness manager (`harnessManager`), which the kit builds for you.

| Where | What the kit puts there |
| --- | --- |
| Workforce's `workerFlows` slot | `coder`, the one coding worker flow. Its settings are on [WORKER.md](./worker-md.md). |
| Workforce's `uses` slot | The harness-readiness capability, which puts the [readiness](#readiness) rows in a coordinator's context. |
| `flows` | `harnesses`, with two views: `readiness` and `codingBoard`. |

- `codingBoard` answers the conversation's coding tasks. Each row has a state (`queued`, `held`, `running`, `waiting`, `failed`, `done` or `cancelled`), the harness, the review result, where the work landed, the error, and the numbers of the pull requests the task waits on.
- The `coder` flow serves one view, `recordedWork`, in a run's own session.
- `harnesses(...).without(workforce.slots.workerFlows, "coder")` switches the flow off. What the app then refuses at start is on [Kits and slots](./kits.md#at-createflowstate-the-entries).
- A line typed in a task's session and a message from another worker are covered in [Talking to a run](#talking-to-a-run).
- Each run is named by two values that appear in its task output and its branch name: `phase`, always `code`, and `issue`. `issue` is the task id when the id is letters and digits joined by single `-` or `_` and at most 64 characters, and `h-` followed by a hash of the id for any other id, such as one a coordinator routed.

## Kit options

`harnesses(config)` checks its config when called. A bad option throws, and the message names the key. The refusals are on [Kits and slots](./kits.md#at-createflowstate-the-entries).

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `workspace` | `WorkspaceHost` | required | The host a run works in, built with `localWorkspaceHost(...)`. |
| `defaultHarness` | string | none | The harness id a worker whose file names none runs on. With none set, that worker's task fails with a message saying so. A value that is not a filled id throws at start. |
| `review` | boolean | `false` | A run that committed waits for a user's [review](#review) before its task completes. A worker's own `review:` line overrides it either way. |
| `pullRequests` | boolean | `true` | A task whose run opened a pull request is done when it merges and cancelled when it closes unmerged. Off: the task settles on the verdict. |
| `judge` | boolean | `true` | A judge reads each run against its task's goal. |
| `checks` | `{ commands: readonly string[]; timeoutMs?: number }` | none | Commands a run that changed files must pass in its checkout. `timeoutMs` is one wall clock for all of them, default `600000` (10 minutes). An empty list runs nothing. |
| `project` | boolean | `false` | A task works in its session's project: it needs one, the run works in its checkout, and its checks are the project's own, empty when the project names none. The `coder` flow is installed needing a project. |
| `idleTimeoutMs` | positive integer, ms | `1_200_000` | How long a run's harness may send nothing before the run stops and fails with `No output from <Harness> for 20 mins; stopped.` |
| `runTimeoutMs` | integer >= 0, ms | `14_400_000` | A cap on one run's wall-clock time, however busy its harness is. At the cap the run fails with `<Harness> ran for 4 hrs, its cap on run time; stopped.` `0` turns the cap off. |
| `branchPrefix` | string | `fsd/` | What each run's branch starts with. Lower-case letters and digits, single `-` or `_`, `/` between segments and at the end, at most 32 characters. |
| `onPullRequestRecorded` | `(installation) => PullRequestFollower` | none | Builds the follower each recorded pull request is handed to, so the run's session hears its reviews, comments and CI. With none, nothing follows a pull request a run opens. |
| `logReadiness` | boolean | `false` | Checks every harness at start and logs the rows as a table. It is never awaited, so a missing sign-in never stops the app. |

The shutdown wait is not a kit option. `codingDrainBudgetMs(...)` returns the number to pass to `createFlowState` as `dispatchDrainTimeoutMs`, which is on [Runtime configuration](./runtime.md). Its inputs and worked numbers are on the [harness-manager API reference](./api/harness-manager.md).

## Workspace options

`localWorkspaceHost(options)` from `@flow-state-dev/workspace` builds the host the kit's `workspace` option takes. Its options and the answers its `source` may give (a repository, kept files or a refusal) are on the [workspace API reference](./api/workspace.md). A *listed repository* is one named in the host's `localRepositories`; `remotes.allow` names the hosts a clone may reach. The behavior a run depends on follows.

- **A cloned repository.** One clone per remote under `<root>/.clones/<clone key>.git` (the key is a slug of the remote's host and path, such as `github.com-owner-name`, followed by a 12-character hash), shared by every run, and each run's own branch in `checkout/` under the run's folder (its *place*, `<root>/<name>`, named in [The branch and the folder](#the-branch-and-the-folder)). `https://host/x`, `https://host/x.git` and `git@host:x` are one repository and share one clone. A repository left out of `localRepositories` is cloned only when it is a remote that `remotes.allow` admits. A bare local path left out is refused `invalid-remote`, before git runs.
- **A listed repository.** The run's branch is cut from the source's `baseRef` (or `HEAD`) and stays in that repository, with no clone. When the source names no kept files, the run's folder is the checkout itself. With kept files, the worktree is `checkout/` and the files are in `project/`.
- **What a run in a listed repository may do to it.** Its working tree, index and branches are not touched. Git shares branches, tags and remote-tracking refs between worktrees, so the run can create or move refs there. To keep a run apart from a repository's refs, leave it out of `localRepositories` so the host clones it.
- **The run's branch** cannot be one already checked out in another worktree, including your own checkout of a listed repository (`checkout-moved`).
- **A new branch** whose base tracks an upstream is cut after fetching that one upstream branch, from the newer of the two. Local and upstream both moved is refused `base-diverged`. A failed fetch starts from the local base with a warning.
- **`setup`** runs once per fresh checkout and again on the next provision until it exits 0. It draws on the provision budget. A failure does not fail the provision: the checkout is handed over with `place.setup` saying what went wrong. A new checkout has no installed dependencies unless `setup` ran.
- **The question-marker directory.** Every repository must ignore `**/.fsdev/`. A checkout whose repository tracks files there, or does not ignore it, is refused before the agent runs, with `Add **/.fsdev/ to that repository's .gitignore`.
- **Git hooks.** The host runs none of the repository's hooks while it makes or hands back a checkout.
- **A refused run** (a `refused` answer or a host refusal) ends its task and is not retried. Under the kit the task ends `errored`. A `harnessManager` you build yourself on one board, named with `boardCollectionId`, cancels the task instead.
- **A refused project workspace.** A run whose source is `projectWorkspace()` is refused before any file or clone exists, with one reason: `no-project`, `no-such-workstream`, `no-such-project`, `not-the-owner`, `not-a-member` or `other-project`. Under the kit the task ends `errored` on its first attempt and is never retried. On a board you name with `boardCollectionId` it is `cancelled`. A task depending on the refused row is cancelled.

### The branch and the folder

A run's name is a slug of the task's title (at most 32 characters) plus six hex digits derived from the user (or organization), board, issue and phase. The branch is `<branchPrefix><name>` and the folder is `<root>/<name>`. A new run takes the first spelling that no other run holds and no worktree or branch already has (`-2`, `-3`, and so on). A retry of a run that already has a branch reuses that branch and folder. Two users, or two organizations, never share a folder or branch for the same issue and phase.

## What happens to the checkout after a run

Nothing removes it. When a run ends, the manager lets go of the checkout and leaves it on disk with its branch and commits, so a retry, an answered question, a typed line or a change request picks up in the same place. The one checkout the host removes by itself is one it made in a provision it then refused, such as a repository that does not ignore `**/.fsdev/`.

- **Removing one by hand.** `fsdev worktrees <root>` lists and removes them. Its flags and output are on [the CLI reference](./cli.md#fsdev-worktrees).
- **A removal is refused** with `uncommitted-work` (uncommitted or untracked changes), `place-busy` (a provision of the folder is running), `in-use` (a run is working in it) or `unique-commits` (with `deleteBranch`, the branch holds commits nothing else holds, or a detached HEAD does; `force: true` removes it anyway). A refusal removes nothing. The CLI prints `Refused (<reason>): <message>` and exits 1.
- **The user's worktree list.** Collection `worktrees/**`, user scope, written only by the workspace host, readable by the user's sessions, by a model and by clients. One row per worktree: name, path, branch, repository, base commit, owner (`session` or `run`), attached sessions, `state` (`provisioning`, `ready`, `removed` or `lost`) and pull requests. A removed worktree's row stays, marked `removed`.
- **Held work.** On a host with a `heldWork` store, a run's commits and uncommitted changes are saved at the end of each turn. A retry on another machine gets them back in a fresh conversation, with a note that the checkout was rebuilt. Without a store the checkout lives only on the machine that made it, and a retry elsewhere starts from the base branch.
- **An interrupted checkout** is rebuilt only when the tree shows files missing and nothing else changed. Any other change is refused and kept.
- **The checkout is not a fence.** The framework prepares the checkout and hands its path to the agent as `cwd`. It does not confine what the agent runs: each harness's sandbox option does that. The run deadline bounds the harness step, not what the run started, and a command the agent's process started can outlive the kill. The Claude Code kit harness sets no sandbox.

## A run's states

<Figure svg={States} caption="A run's states" description={"Three boxes across the top: queued, running and done. Running is joined to queued by claim and retry arrows and to done by a done arrow. Below running, a waiting box is highlighted as the state that waits on a user, with hold and answer arrows to and from running. A failed box sits under done and receives a fails arrow from running. A wide cancelled box along the bottom receives cancel arrows from queued, from running and from waiting. Four notes say that a failure with attempts left returns a run to queued, that an answer spends no attempt, that a run with a pull request stays running until the pull request settles, and that a harness that is not set up fails the start with no move to another harness."} />

The figure draws what a user sees. The stored task status behind each name is on [Task board](./task-board.md#task-statuses), which also lists the allowed moves:

| Shown as | Stored status | Meaning |
| --- | --- | --- |
| `queued` | `pending` | Waits to be claimed. |
| `held` | `held` | Filed and not released. Moves to `pending` when released, or to `cancelled`. |
| `running` | `in_progress` | A harness is working, or the task waits on something that is not a user's to answer. |
| `waiting` | `in_progress` with an open hold for a user | Overrides `running` for a task that is not finished. |
| `done` | `completed` | Final. |
| `failed` | `errored` | Final. |
| `cancelled` | `cancelled` | Final. |

### Waits

A wait is a hold on an `in_progress` task. What an open hold does to the task's attempt and claim is on [Task board](./task-board.md#task-statuses). While one is open, nothing settles the task or starts another run.

| Wait | `ask.kind` | Shown as | Ends when |
| --- | --- | --- | --- |
| A question (the judge's *ask*, saved work that does not match the record, or a question the run wrote) | `question` | `waiting`, in the Inbox and in the task's open `questions` | Answered, or the task is cancelled |
| A review of the run's commits (`review` on) | `review`, titled "Review the run's changes" ("The accepted changes didn't land" on a re-ask) | `waiting` | Accepted, changes asked for, host deadline, or cancel |
| A tool approval, titled `Allow <tool>?` (only when you build `harnessManager` yourself with `approveTools`; the kit does not) | `approval` | `waiting` | Allowed, denied, or cancel |
| Waiting on the run's pull requests | external, one per pull request | `running`: an external wait is never a user's to answer | A pull request merges, all close, or a message wakes the task to check |

### Attempts

What `maxAttempts` changes, and what spends an attempt, is on [Task board](./task-board.md#what-does-maxattempts-change). A task in the kit has one attempt unless it sets `maxAttempts`. An answered question, a steer and a review's change request each take another turn on the same attempt.

- A harness that is not ready fails the start as a failed attempt (see [Readiness](#readiness)). A workspace that refuses is not an attempt: it ends the task for good, as under [Workspace options](#workspace-options).
- The run record, one row per run in `runs/**`, has its own `outcome`: `running`, `succeeded` or `failed`. It stays `running` while the task waits on a question. A refused attempt, or one that stopped because another attempt holds its task, writes nothing. A run's place has a state of its own, only where the host holds a run's work: `provisioning`, `ready`, `refused`, `lost` or `restoring`.

## What marks a run's task complete

A step that fails fails the attempt, and the reason becomes the next attempt's brief. The steps run in this order.

| Step | The run passes when | Otherwise |
| --- | --- | --- |
| 1. The harness step | The harness ended with `status: "completed"` within its stops. | A run the harness stops by itself (limit or error) comes back `errored` and a thrown error is an exception. Either way the attempt fails with `the run stopped without finishing: <outcome or "no result reported"> and the final message`. A silence stop (`idleTimeoutMs`) or the cap (`runTimeoutMs`) aborts the step. |
| 2. A question | The run wrote no question. | If the step succeeded and the run's marker file exists and is not blank, the task is held on that question and the steps below do not run. A failed step with a marker is a failed attempt, never a held task. |
| 3. The phase says done | The [handle's](#the-result-handle) `outcome` is `finished`. | Any other value fails the attempt with `<ended> and the code phase is still not done`, where `<ended>` is `the run stopped at its limit` (`stopped-at-limit`), `the run finished cleanly` (`finished`, when the phase says it is not done), or `the run terminated normally reporting <outcome>` (`failed`; a `null` outcome reads `no terminal result`). A reason is appended after a colon when the phase gives one. A `null` outcome is never read as finished. |
| 4. Checks | Every `checks` command passes, run in the checkout. | A command with a non-zero exit, a timeout, a skip (time ran out) or one that could not run makes the attempt not done. The next brief names each red command, why, and the end of its output. Results are kept on the run record whatever the verdict. |
| 5. Files and held work are saved | They were saved. | The attempt fails, and the next attempt saves them again. |
| 6. The judge | The judge answers *done*, finds nothing, or reads under its floor. | *Not done* fails the attempt. An *ask* verdict holds the task on a question. |
| 7. Review, when on | The user accepts. | See [Review](#review). |
| 8. Pull requests, when on | Every pull request the run opened has merged. | See below. |

Where the table is not enough:

- **Steps 3 and 4 are one completion check.** It is bounded to a minute, or to the checks' time plus a minute when `checks` is set.
- **Checks** run only when the run changed files: uncommitted files, or a checkout tree that differs from the commit its branch was cut at. Trees are compared, so a run that committed and moved its branch back counts as unchanged only when the trees match. A missing recorded base, or a git error, counts as changed. The brief names the same commands before the run. Checks are commands the checkout's own scripts run, so a green check does not prove the agent left those scripts alone.
- **The judge** runs when `judge` is on and the task has a goal that is not blank. It reads the goal, the run's answer (cut at 8 000 characters), the commit count and subjects, and the files the commits changed, and answers *done*, *not done* or *ask* with a confidence. The floor is 0.7. *Done* closes the task whatever the confidence. *Not done* or *ask* at or over the floor acts, and under the floor the run counts as done. *Not done* fails the attempt with `The judge read the answer against the goal: <reason>` as the next brief. An *ask* verdict holds the task on a question that names the goal and quotes the first 500 characters of the answer. A judge that throws, times out or answers off-shape gives no verdict: the task settles on the checks alone and its output says `judged: false`. The judge needs a model through the flow's model resolver. Its default model id is `typesafe-ai/jev`, the evaluation model the package ships.
- **Review** is asked of a run that passed steps 1 to 6 with commits over its base. A verified zero commits skips it. If git could not count the commits, review is asked anyway and says so. A confident *not done* or *ask* from the judge skips it.
- **Pull requests.** A run that opened a pull request settles on it: each is read from GitHub. With any open, the task holds on an external wait. With none open and at least one merged, it completes. With all closed unmerged, it is cancelled with `its pull request was closed without merging`. If a pull request cannot be read, the task holds with a status note. A confident *not done* from the judge on a run that opened a pull request does not fail the attempt: the task waits on the pull request and shows the judge's reading as a status note. A message sent to the task wakes the wait to check.
- **A task with no pull request** completes after the last step, and the run record's `outcome` becomes `succeeded`.
- A run that spends its turns or budget is not done. Under Claude Code the SDK's turn and budget limits come back as `status: "errored"`, so the attempt fails at step 1 with `the run stopped without finishing: stopped-at-limit`. Codex and Cursor never produce `stopped-at-limit`.

A completed task's output carries: `issue`, `phase`, `sessionId`, `answer` (the run's last message, cut at 8 000 characters, `null` when none), `branch` (`null` for a run with only kept files), `commits` (over the base the branch was cut at) with `commitsVerified`, `baseCommit`, `path`, `judged`, `review` (`accepted`, `deadline` or `null`), `landed` and `pullRequests`.

### What the brief tells the run

Every run's prompt carries the task title, goal and context; what the task's dependencies produced and what earlier tasks on the board found (each cut at 4 000 characters of JSON); the worker's instructions; conventions (by default, read the repository's `AGENTS.md` or `CLAUDE.md`); the task id, phase and attempt number; the directory and branch; answers to earlier questions; a request for a report; and why the last attempt stopped.

The kit adds: "Work in this directory only. If the task asks a question, read what you need, answer it in full, and change nothing. If it asks for a change, commit what you change with git." The report asks for three headings: `What changed`, `Checks` (each line led by `passed:`, `failed:`, `pre-existing:` or `not done:`) and `Worth knowing`.

## The question channel

| | Behavior |
| --- | --- |
| Who can raise a question | The judge (*ask*). Held work that does not match the run's record: the place goes `lost`, the task holds on a question saying what could not be brought back, and answering starts the run again from its base. The run itself, by writing a non-blank file at `<checkout>/.fsdev/ask/<attempt>-<run>.md`, but the kit's brief does not tell the agent that path, so under the kit an agent does not ask by default. A manager you build yourself passes the path as `run.askMarkerPath`. |
| Marker rules | A blank marker is not a question. An unreadable one fails the attempt. |
| State while it waits | `in_progress` on the same attempt, with a hold of `ask.kind: "question"` and no deadline unless the host sets one. The checkout is let go and the run's work is saved first. |
| Where it shows | The user's Inbox, the task's open `questions` from `getTask`, and `codingBoard` rows as `waiting` with the questions. |
| How to answer | The Inbox. `updateTask` with `answers: <hold id>` and `message`. A line typed in the run's own session, which answers the oldest open question or external wait and never a confirm. Only the run's own user can send one. |
| What an answer does | The task takes one more turn on the same attempt. The turn resumes the same coding session in the same checkout, with the question and its answer in the brief under `Answers to your questions`. An answer spends no retry. A second question holds the task again the same way. |
| A session the agent cannot find | The run record keeps only a session the harness confirmed. If the agent cannot find the session a run asked to continue, the next run starts a fresh one with the brief, the question and the answer. |
| Cancel | Closes the question and starts no run. The commits and kept files stay. |
| A deadline | Exists only if the host sets `userDeadlineMs`. At it the question closes with a "no answer came" message and the next run goes on in the same session. An approval reads as a no, and a review ends with `review: "deadline"`. |

**Tool approval.** When you build `harnessManager` or `harnessSessionFlow` yourself with `approveTools: true`, a call the harness has not been told it may make stops the run before it runs. The Inbox shows an approval titled `Allow <tool>?` with `{ tool, touches, cwd, approveOptions }`. The answers are allow once, allow for this run (`{ label: "Allow for this run", data: { scope: "run" } }`, which covers the same tool on the same command or file for the attempt) and deny with an optional note. More than 25 approvals in one attempt fails the attempt. It needs durable execution. Only Claude Code asks per call, through its `onToolApproval` hook, which returns `{ decision: "allow", updatedInput? }`, `{ decision: "deny", message? }` or `{ decision: "held", message? }`; a call in `allowedTools` never reaches it. Codex and Cursor take their sandbox and approval settings for the whole run and ignore the feed. The kit sets no `approveTools`.

## Talking to a run

- **Who can send a line.** Only the run's own user. A line from anyone else, a colleague included, is refused before it is written, with a 404 `Unknown session`, as if the session did not exist. A colleague who files the same issue as a task of their own gets a separate run, with its own checkout and branch: two users never share a folder or branch for the same issue and phase (see [The branch and the folder](#the-branch-and-the-folder)).
- **A line in a task's session.** While the task is open, it is a steer: kept on the task as the user's message, taken at the run's next step, in the same coding session, using no attempt. A task takes at most 20 steers. Once the task and its follow-ups have finished, a line is talk: one harness run resumes the task's coding session and the reply stays in the session, and the task, its output and its attempts do not change.
- **Refusals** of a line: `not-started`, `cannot-continue` (finished, and its harness confirmed no session), `task-running` (a message, not a line, about an open task), `steer-limit`, `finished` and `not-supported`.
- **A message from another worker.** A coding worker is refused with `task_sessions_only` when messaged by name. See [Worker messaging](./worker-messaging.md#when-a-message-is-refused).
- **Stopping a running step for a steer** happens only when the harness's block declares `stopsOnAbort`. Claude Code's does. Codex's and Cursor's do not, so the step finishes first and the next step takes the message.
- **A harness that takes a line mid-turn** offers `steer` through `onSteerable` once the prompt is sent and withdraws it (`null`) when the turn ends. Cursor does. Claude Code and Codex do not. `steer(text)` answers `"delivered"` or `"refused"`, and a refused line is sent as the next prompt.
- **`harnessSteering()`**, from `@flow-state-dev/core/harness`, gives a flow that runs a harness turn without a board the same live steering. It is on the [core API reference](./api/core.md).
- **Progress.** A running task's `statusNote` comes from the harness's activity feed: the first note at once, then at most one every 30 seconds, cut at 280 characters. Claude Code and Codex report messages and tool calls, Cursor tool calls only.

## Review

Review is on when the kit's `review` is `true` or the worker's `review:` line says so. It needs durable execution: on a host without it, a reviewed manager is refused before any harness step and the task ends `errored` with a message naming durable execution.

- **The hold** is `ask.kind: "review"`, titled "Review the run's changes" ("The accepted changes didn't land" when it is asked again after a failed landing). Its prompt gives the commit count and up to 20 subjects, the files changed and lines added and removed, "Checks n/m passed." when checks ran, the judge's verdict, confidence and reason (or "No judge read this run."), and "The judge's verdict is information, not approval."
- **Hold data:** `{ branch, commits, subjects, files, fileCount, added, removed, judge, checks, lands, landFailed, landAttempts, goal, answer, pullRequests, round }`. `files` lists up to 200 changed files as `{ path, added, removed }` (`null` counts for a binary file). `fileCount`, `added` and `removed` count every file, and all four are `null` when git could not read the diff. Only committed changes count, and a rename is the old path removed and the new path added.
- **Answers** are one of:

| Answer | What it does |
| --- | --- |
| `{ verdict: "accepted", land?: "pull-request" \| "merge", words?: string }` | Completes the task with no further run. The output says `review: "accepted"`. With `land`, the work is landed first. |
| `{ verdict: "revise", words: string }` | Writes `words` as the user's steer and starts one more run on the same attempt, resuming the same coding session. A blank `words` is refused with a 400 and the review stays open. If the run commits again, it is reviewed again over all the branch's commits. |

- **Landing.** `pull-request` pushes the run's branch and opens a pull request, recorded in `observed-pull-requests`. `merge` merges the run's branch into the base branch of your checkout. `lands` lists the ways the host offers: for a run cut from a repository in `localRepositories`, `merge` always, and `pull-request` as well only when the run's base has a pinned remote that names a GitHub repository; none for a run cloned from a remote (the review keeps a plain Accept). A landing that fails (a refused push, a merge conflict never resolved) asks the review again with the error in `landFailed` and the tries in `landAttempts`. The branch and checkout are kept.
- **A branch with a pull request open from it,** opened by this task's own accepted landing, lands there unasked: no review is asked and its commits are pushed to that pull request. A pull request on the branch that this task did not land is never pushed to unasked.
- **Change requests count toward the 20-steer limit.** Past it the attempt fails. A harness that confirmed no session cannot take a revision: the attempt fails and the next brief carries the words.
- **A deadline** exists only if the host sets `userDeadlineMs`. At it the task completes and the output says `review: "deadline"`, which is never read as accepted. A cancel while the review waits closes it and starts nothing.
- **Per-file patches and where the work went.** The kit declares no per-file patch view. `harnessRunChangesView` and `workPlace` are on the [harness-manager API reference](./api/harness-manager.md).

## What a run records

A run's harness or the manager writes each of these. A user reads them and a client writes none. The kit's `recordedWork` view, with input `{ requestId }`, answers `plan` (at most 200 steps, with `truncated`; `null` while none) and `pullRequests` (that run's, oldest first, at most 200, with `truncated`). `readRecordedWork` from `@flow-state-dev/harness-manager/browser` reads the same rows for a page, plus the files.

### Plan

`observed-plan/**` has one row per to-do item, keyed `conversation/<id>/<item>`, and `observed-plan-list/**` has one marker per conversation with `status` (`writing`, `complete` or `incomplete`), `count` and `reason`. A row has `title`, `status` (the harness's own word), `previousStatus`, `lastOutcome`, `lastTouchedAt` and `requestId`, and every field may be `null`. A plan belongs to the conversation, not one run, and a new conversation starts with none. It is session-scoped, client-readable and live.

| Harness | Records a plan |
| --- | --- |
| Claude Code | Yes, with `recordWork: true`, which the kit sets |
| Cursor | Only with `recordPlan: true` (default `false`; the kit does not set it) |
| Codex | No |

A harness that records no plan does not declare the collection, so check the session's resource manifest before showing an empty plan.

### Files touched

Claude Code only, with `recordWork`. `observed-file-ops/**`, keyed `<run id>/<path>`, has `lastKind` (`created` or `edited`), `outcome`, `lastTouchedAt` and `appliedCount` (operations the harness confirmed applied; `0` means the run touched the path and nothing applied; `null` when the count is unknown). It never holds contents. Only the file tools' calls are recorded: an edit made through the shell (`sed -i`, a redirect, `mv`) is not. `observed-gaps/**` gets a row when a file or plan tool call could not be recorded, such as an edit that names no path or a to-do item that was being created when the run ended, so a missing file row is not mistaken for an edit that never happened. A row has `kind` (`file`, `plan` or `run`), `reason`, `rawPath` and `at`, keyed by run and ordinal. Both are session-scoped.

### Pull requests

`observed-pull-requests/**` is session-scoped and client-readable, with no client write. Every field is nullable:

| Field | Value |
| --- | --- |
| `host` | Lower-cased |
| `repository` | `owner/name` |
| `number`, `url`, `title`, `branch`, `requestId` | As GitHub names them |
| `state` | `open`, `closed`, `merged` or `draft` |
| `source` | `tool` (seen in a tool call) or `branch` (found by a branch check) |
| `firstSeenAt` | Epoch ms |

The key comes from host, owner, repository and number, so a pull request seen twice is one row. A row comes from a tool call that creates one and whose output names a `https://<host>/<owner>/<repo>/pull/<n>` link: a shell call running `gh pr create` or `gh pr new`, or a tool named `create_pull_request` under any MCP prefix. `gh pr view`, `gh pr list`, a search, a link only in arguments, and git's `/pull/new/<branch>` hint do not count. The three agent blocks record by default; `recordPullRequests: false` records nothing and does not declare the collection.

- **Merge rules.** A new key is written whole with `firstSeenAt`. An existing row keeps `requestId` and `firstSeenAt` once set. A later sighting fills only a `null` `url`, `title`, `branch` or `requestId`. `state` is replaced by any later sighting that names a different one. A `tool` sighting upgrades a `branch` row's `source`.
- **The pull-request wait** reads each task pull request from GitHub and writes the state it read back to the record with `source: "branch"`.
- **`recordBranchPullRequests(ctx, options)`** from `@flow-state-dev/workspace` writes the pull requests whose head is the run's branch, with `source: "branch"`. The manager runs it before its verdict and when a run fails. It never throws: when it cannot reach GitHub it records nothing. Its options and answers are on the [workspace API reference](./api/workspace.md). Only GitHub is supported.

### Usage and cost

- The handle's `usage` is `{ inputTokens, outputTokens }` or `null`, and `cost` is `{ usd, basis: "reported" | "estimated" }` or `null`. Values are never invented. Claude Code reports a cost. Codex and Cursor estimate one from the model price table, `null` when no model was named or the table has no row.
- The run record keeps the last attempt's `usage` and `costUsd` and clears them when the next attempt opens. They are for display; they do not affect whether a run passes or retries.
- **Subscription windows** (how much of a plan is used) are in `harness-usage/**`: one record per user and harness, user scope, no history. `status` is `windows`, `api-key`, `signed-out` or `unavailable`, with `plan` and `windows` (each with `origin` `read` or `run`). Clients read the rows through the usage view. Clients never see the account or the timestamps of the server's own checks.
- Under the kit, a run adds a window only for Claude Code, which reports one from the SDK's rate-limit event. The Codex and Cursor harness values pass no usage feed. The kit serves no usage view. `harnessUsageFlow` is on the [harness-manager API reference](./api/harness-manager.md).

## Readiness

A harness is ready when its agent can run on this machine: its SDK is installed at a supported version and a credential source exists.

- One row per filled harness, kept in the process's memory and never stored. The first read runs every check, later reads return the kept rows, `refresh: true` checks every harness again and `refresh: "<id>"` one. Nothing polls.
- A row has `harness`, `label`, `ready`, `reason` (`null` when ready), `remedy` (`null` when ready or when the check named nothing), `unanswered` (the check got no answer) and `checkedAt` (epoch ms).
- A check never throws. One that throws, rejects or passes its 30 s timeout is a not-ready row with a plain reason and `unanswered: true`.
- **The `readiness` view** on the kit's `harnesses` flow is user-scoped and needs no session. Its input is `{ refresh?: boolean }`, and it makes no model call. Every user of the machine gets the same rows.
- **Before each coding task** the `coder` flow asks about the worker's harness. A ready row answers with no check. A not-ready or missing row gets one fresh check, so a sign-in made since the last read counts. A harness that cannot run fails the task at once: `<Label> isn't set up on this machine: <reason>. <remedy>. Then start the task again.` A check that got no answer says `Couldn't tell whether <Label> is set up on this machine: <reason> Try starting the task again in a moment.` The task is never moved to another harness. The start is a failed attempt, so with no `maxAttempts` the task ends `errored`.
- **With `logReadiness`,** the start logs `Coding harnesses on this machine:` then one line per harness: `✓ <Label>`, `✗ <Label>: <reason>. <remedy>.`, or `? <Label>: <reason>.` for no answer.
- The readiness capability puts the same rows in a coordinator's context, with guidance to file coding work only on a ready harness, to say what to run for one that is not, and to start the task when the user says they have signed in.

## The result handle

Every harness block returns a handle of the same shape, and a manager reads success from its `status` alone. Its input is `{ prompt, attachments? }` only. `cwd`, `resume` and `model` are configuration, never input, so a model cannot choose where a run works or which conversation it resumes.

| Field | Values |
| --- | --- |
| `source` | `claude-code/sdk`, `codex/sdk` or `cursor/sdk` |
| `status` | `running`, `completed` or `errored` |
| `sessionId` | The harness's conversation id, or `null` when unknown. A resumed run's id starts as the one asked for, so `onSession` firing is what confirms it. For Cursor it is the agent, each prompt being one run in it. |
| `url` | A link to the run, or `null` |
| `dispatchedAt` | Epoch ms |
| `outcome` | `finished`, `stopped-at-limit`, `failed`, or `null` for no terminal result |
| `finalMessage` | The last assistant message, or `null` |
| `usage`, `cost` | As in [usage and cost](#usage-and-cost) |

Beside the shared fields, Claude Code returns `resultSubtype` (`success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution`, `error_max_structured_output_retries` or `null`) and `toolsObserved` (distinct tool names, first seen first). Codex returns `codexUsage` and `failureMessage`. Cursor returns `cursorUsage` and `failureMessage`.

- **How `outcome` is set.** Claude Code's `success` is `finished` unless `is_error` is set, then `failed`. `error_max_turns` and `error_max_budget_usd` are `stopped-at-limit`. Anything else is `failed`, and `null` means no terminal result arrived. Codex and Cursor give `finished` or `failed`. A Cursor run reported cancelled reads `failed` with the reason on `failureMessage`.
- **A run the agent itself fails** comes back as a handle with `status: "errored"` and no throw. For Claude Code `outcome` is `stopped-at-limit` or `failed` with a `resultSubtype`, and a turn ending on an API error is `success` with `is_error`, so `failed` with `resultSubtype: "success"`. For Codex and Cursor `outcome` is `failed` with `failureMessage`. Nothing retries.
- **A thrown run returns no handle.** A stopped run (a deadline or a cancel) is a throw. Its session id has already reached `onSession`, so the run can be continued.

| Agent | Errors thrown |
| --- | --- |
| Claude Code | `ClaudeCodeAgentRunError` (the SDK threw mid-stream), `ClaudeCodeSdkNotInstalledError`, `ClaudeCodeAgentAbortedError` (carries `sessionId`) |
| Codex | `CodexAgentRunError`, `CodexAgentConfigError`, `CodexSdkNotInstalledError`, `CodexAgentAbortedError` |
| Cursor | `CursorAgentRunError`, `CursorAgentConfigError`, `CursorSdkNotInstalledError`, `CursorAgentAbortedError` (carries the agent id on `sessionId`) |

- **`harnessFailureKind(error)`**, from `@flow-state-dev/core/harness`, reads through wrapped errors. It returns `"unknown-conversation"` when the agent does not know the conversation `resume` named, else `null`. The run throws and the stored id is untouched.
- **SDK versions.** The three blocks refuse to build against an installed SDK outside the tested range, with one error, `HarnessSdkVersionMismatchError` (code `HARNESS_SDK_VERSION_MISMATCH`). Its message names the SDK, the harness, the installed version (or that it cannot be read) and the range, and gives the install command. An absent SDK is not refused at build: the first run throws the agent's `...SdkNotInstalledError`.
- **A harness value** is the entry a kit puts in the keyed `harnesses` slot. Its fields and what the slot refuses are on [Kits and slots](./kits.md#the-harness-value).
- **Feeds** the manager hands `agent`: `cwd`, `resume`, `onSession`, `onUsage`, and optionally `onSteerable`, `onActivity`, `onEvent` and `onToolApproval`. `onEvent` marks each event so a working run is not stopped for silence. A harness not handed it is stopped at the idle window however busy it is, and the manager warns once.

## Per-agent options

| | Claude Code | Codex | Cursor |
| --- | --- | --- | --- |
| Fill the slot with | `claudeCode()`, which fills it itself | `codexHarness()` | `cursorHarness()` |
| Harness ids | `claude-code`, and `claude-code-plan` with `plan: true` | `codex` | `cursor` |
| Package | `@flow-state-dev/claude-code` | `@flow-state-dev/codex` | `@flow-state-dev/cursor` |
| SDK | `@anthropic-ai/claude-agent-sdk` `>=0.3.316 <0.4.0` | `@openai/codex-sdk` exactly `0.164.0` | `@cursor/sdk` exactly `1.0.40` |
| Run mode under the kit | permission mode `acceptEdits` (`plan` for the plan harness) | sandbox `workspace-write` | agent mode `agent`, sandbox off |
| Credential | `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, or a stored sign-in | `CODEX_API_KEY`, or `codex login` | `CURSOR_API_KEY`, or a stored Cursor login |
| Records a plan | yes | no | with `recordPlan: true` |
| Cost | reported | estimated | usually `null` |

The kit fills a harness's `agent` with the feeds the manager hands it and the options below. An app that builds a harness block itself passes the block's own options.

### The environment every run starts with

- **The names a run is handed** are the base names (`PATH`, `HOME`, the proxy names and a few more) plus the ones each harness adds. Both lists are on [Environment](./environment.md#coding-harness-variables).
- `harnessEnv({ pass, env? })` builds an object holding exactly the named variables that are set, read when it is called, so a variable set later is not seen. The list is not a security boundary: a command the run starts as the server's OS user can read the server's own environment.
- `HOME`, and `CODEX_HOME` for Codex, hold the agent's sign-in and resumable state. A Codex conversation or a Cursor agent is found only under the same home.
- The readiness check runs over the same filtered environment. Cursor's stored-login check reads the checking process's own `HOME`, not `env.HOME`, so keep the two the same.
- Used directly, outside the kit, `claudeCodeAgent` with no `env` hands the run the server's whole `process.env`, `codexAgent` does the same with no `client.env`, and `cursorAgent` with no `env` runs Cursor's runtime in the server's own process. The kit's harness values always set `env` from the lists above.

### Claude Code

Import `claudeCode`, `claudeCodeAgent` and the errors from `@flow-state-dev/claude-code`. The SDK is an optional peer dependency.

`claudeCode(config)` takes `{ plan?: boolean }` and no other key (an unknown key throws). It requires the harness kit and fills `claude-code` (label "Claude Code"). With `plan: true` it also fills `claude-code-plan` (label "Claude Code (plan)", permission mode `plan`). It serves one flow, `claude-code`, holding the collections a run records into: `observed-file-ops`, `observed-plan`, `observed-plan-list`, `observed-gaps` and `workspace-outcomes`.

| Option | Under the kit | Meaning |
| --- | --- | --- |
| `allowedTools` | `["Read", "Write", "Edit", "Bash"]` | The SDK adds Claude Code's to-do tools (`TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`). |
| `permissionMode` | `acceptEdits` (`plan` for the plan harness) | |
| `settingSources` | `["project"]` | Loads the working folder's `CLAUDE.md`, skills and `.claude/settings.json`. Unset loads `user`, `project` and `local`. |
| `settings` | `{ disableAllHooks: true }` | Every hook off, since a turn could write a hook into `.claude/settings.json` that would run by itself on the next one. |
| `env` | from the Claude Code names above | Unset: the server's whole environment. |
| `detached` | `true` | See below. |
| `recordWork` | `true` | Records the plan and the files touched. Default `false` outside the kit. |
| `sandbox` | none | Unset hands the SDK no sandbox. |
| `onToolApproval` | none | Nothing under the kit asks per call. |
| `mcpTools` | none | Under the kit a run has no relayed MCP servers. |

Options of `claudeCodeAgent` when you build the block yourself are on the [claude-code API reference](./api/claude-code.md).

- **Sessions.** With `detached: false`, the default, the block keeps the SDK session id in session state under `sdkSessionId` and a run log under `sdkAgentRuns`, and resumes the last session on the next request. `detached: true` turns all of that off, which a task-board worker needs because a dispatched run refuses a block that declares session state. The handle carries the `sessionId` either way. `resume` and `onSession` are the background-path pair, and passing either without `detached: true` throws when the block is built. `onSession` fires during the run, the moment the agent names its session. The aborted error carries the session id.
- **Credential check.** `probeClaudeCodeAccount` asks the SDK for the account without a model call, and is on the [claude-code API reference](./api/claude-code.md). It reports where a credential would come from, not that it works: a key that is set but rejected reads as an account.
- **Not ready** reads `The Claude Code SDK is not installed: <reason>` with remedy `Install @anthropic-ai/claude-agent-sdk`, or `Claude Code has no credential: <reason>` with remedy ``Sign in with `claude`, or set ANTHROPIC_API_KEY``, or, for no answer, `<reason>, so Claude Code's sign-in is unknown` with `unanswered: true` and no remedy. An unanswered probe is asked once more first.
- **Items a run emits:**

| Activity | Item |
| --- | --- |
| Assistant text | `message` |
| Extended thinking | `reasoning` (nothing when its text is withheld) |
| Tool call and result | `tool_output` with the call's id, name and arguments, and a transient status (the Bash `description`, or `Using <tool>…`) |
| A sub-agent | A `container` with a transient status cut at 120 characters |
| Run start, API retry, compaction | Transient statuses, cleared on the first output after them |
| Run end | A kept status `Claude Code agent run completed in <duration>.` or `Claude Code agent run errored (<reason>).` |
| Failure | An `error` item |

### Codex

`codexHarness(options?)` fills the slot with id `codex` and label "Codex". `CodexHarnessOptions` is `CodexAgentOptions` less `cwd`, `resume`, `onSession`, `onActivity` and `onEvent`.

- **Prerequisites.** A run needs `CODEX_API_KEY` or a logged-in Codex account, and expects a git repository: pass `thread: { skipGitRepoCheck: true }` to run elsewhere. A different SDK version, or one that cannot be read, throws `HarnessSdkVersionMismatchError` at build. There is no override.
- **What the harness value sets:** `name: "codex"`, `thread: { sandboxMode: "workspace-write" }` (Codex's own default is read-only, which cannot commit; options you pass in `thread: { ... }` override it), `client.env` from the Codex names above (always, over any `client.env` given), and the manager's `cwd`, `resume`, `onSession`, `onActivity` and `onEvent`. It passes no usage feed and no `onSteerable`.

Options of `codexAgent` are on the [codex API reference](./api/codex.md).

- **Readiness.** The SDK version first, then a credential source: a non-empty `CODEX_API_KEY`, else `codex login status` succeeding. It tests that a source exists, not that it is valid. Not ready reads `Codex has no credential: <reason>` with remedy ``Run `codex login`, or set CODEX_API_KEY``, or `The Codex SDK could not be loaded: <reason>` with remedy `Install @openai/codex-sdk`, or, for no answer, `<reason>, so Codex's sign-in is unknown` with `unanswered: true` and no remedy. The harness gives the check 30 s.
- **Errors.** An empty prompt throws before anything is spawned. A missing SDK throws on the first run. A different SDK version, or a `workingDirectory` or `signal` in `thread: { ... }`, or a `signal` in `client`, throws at build. The CLI exiting non-zero throws, carrying its stderr. The deadline throws with no handle. Resuming a conversation Codex does not have throws `CodexAgentRunError` with `harnessFailure` `"unknown-conversation"`, and the id you hold is left as it was.
- **Permissions.** A headless Codex run is set not to ask. The sandbox and approval policy in `thread: { ... }` are the whole permission story. Codex keeps no session state, so it has no `detached` option. It accepts image attachments.

### Cursor

`cursorHarness(options?)` fills the slot with id `cursor` and label "Cursor". `CursorHarnessOptions` is `CursorAgentOptions` less `cwd`, `resume`, `onSession`, `onSteerable`, `onActivity` and `onEvent`. Only Cursor's local runtime is supported: a `cloud` bag in `agent` or `send` is refused when the block is built, and so is an `agentId` or `local.cwd` in `agent`. A different SDK version throws `HarnessSdkVersionMismatchError` at build, naming both versions.

| Option | Under the kit | Meaning |
| --- | --- | --- |
| `model` | `"default"` | Cursor's own model id (`"default"` lets Cursor pick), or `{ id, params }`, or a resolver. Cursor's SDK refuses a local agent with no model, so the harness always sends one. Setting it beside `agent.model` or `send.model` is refused. |
| `agent.mode` | `"agent"` | |
| `agent.local.sandboxOptions.enabled` | `false` | Off under the kit, so nothing confines the agent's commands (see [The checkout is not a fence](#what-happens-to-the-checkout-after-a-run)). Turn it on with `agent: { local: { sandboxOptions: { enabled: true } } }`. |
| `env` | from the Cursor names above | Unset: Cursor's runtime in the server's process, every command inheriting the whole `process.env`. Set: the runtime runs in a separate Node process whose environment is exactly this. A function anywhere in `agent` or `send`, or a custom `resolveCursorClient`, is then refused at build. A process that cannot start fails the run and never falls back to the server's process. |
| `recordPlan` | `false` | Records the to-do list only when `true`. |
| `recordPullRequests` | `true` | |
| `name` | `"cursor"` | Default `cursor-agent` outside the kit. |

Other options of `cursorAgent` are on the [cursor API reference](./api/cursor.md).

- **Steering.** `onSteerable` is offered once the prompt is sent, on a run that can steer, then `null` on every exit. `steer(text)` answers `"delivered"` only for Cursor's delivered signal, else `"refused"`. A turn that ends with an answer owed waits for it, with no timer.
- **Sign-in.** A key counts only when `CURSOR_API_KEY` in the run's environment is non-empty. The stored login is read under the checking process's own `HOME`. With neither, the reason is `no CURSOR_API_KEY in the run's environment and no stored login`. `cursorSignIn` is on the [cursor API reference](./api/cursor.md).
- **Readiness** checks the SDK version and that the SDK loads (a key counts only when the SDK also loads), then sign-in. Not ready reads `Cursor has no sign-in: <reason>` with remedy `Set CURSOR_API_KEY, or sign in to Cursor`, or `The Cursor SDK didn't load or answer: <message>` with remedy `Install @cursor/sdk`. It never throws.
- **Conversations.** The handle's `sessionId` is the Cursor agent id, and each prompt is one run inside it. The package stores nothing. Resuming an unknown agent throws `CursorAgentRunError` with `harnessFailure` `"unknown-conversation"`. A run Cursor fails returns `status: "errored"` with `failureMessage`, no throw and no retry. A cancelled step throws `CursorAgentAbortedError`. `cost` is usually `null` because Cursor's model ids are not in the price table, so read `cursorUsage` for the counters. The block accepts image attachments.

## Where each part is stored

| Part | Owner | Who can see it | Stored | How many |
| --- | --- | --- | --- | --- |
| The checkout (directory, branch, commits) | The user the run belongs to; on a shared board, the user who started the run | Anyone with access to the host's disk. The user's worktree list names it. | On the machine that ran it, under the host's `root` | One per task and phase. Retries reuse it, and never two attempts in one tree at once. |
| The run record `runs/**` | The user | The run's user from a later session, through server code. Not client-readable. | The app's store, as a resource collection | One row per run. Nothing prunes it. |
| The task (its output, holds, steers, `statusNote` and `attempts`) | The board's owner | The Inbox, `getTask`, `listTasks` and `codingBoard` | The board's store | One per task |
| The user's worktree list `worktrees/**` | The user, written only by the host | The user's sessions, a model and clients (read, live) | The app's store | One row per worktree, never deleted |
| Held work | The run's owner | Server code | The host's `heldWork` store | One current pack per run, and off unless the host has a store |
| Plan, file operations, pull requests | The run's session | Clients (read, live) | The app's store, session scope | See [What a run records](#what-a-run-records) |
| Subscription usage `harness-usage/**` | The user | The user's own rows, through the usage view | The app's store, user scope | One current record per user and harness |
| Readiness rows | The process | Every user the flow signs in, through `readiness` | Process memory only | One per harness filled |
| The question marker | The run | Anyone with the disk, kept out of git by the required ignore rule | In the checkout | One per run that asks |
| A question, review, approval or pull-request wait | The task | The user (Inbox, `getTask`) | On the task as an open hold | One open hold at a time per wait, oldest first |

## Next

- [Coding harnesses](../concepts/coding-harnesses.md): what a harness is and what the `coder` flow does with one.
- [Kits and slots](./kits.md): how `harnesses` and `claudeCode` meet in the `harnesses` slot.
- [Task board](./task-board.md): the statuses, holds and attempts a run's task moves through.
- [WORKER.md](./worker-md.md): the file a coding worker is written in, and its `flow`, `harness` and `review` lines.
- [Environment](./environment.md): the variables each agent's sign-in reads.
