# @flow-state-dev/harness-manager

A task-board worker that turns a row into a **supervised coding run**: its own checkout, a verdict read before the row settles, a question it can ask a user, and the coding agent itself as a slot you fill.

A *harness* is a coding agent driven as a block: you hand it a prompt, it works in its own agentic loop, and it hands back a handle describing the run. This package imports none of them.

## Installation

```bash
pnpm add @flow-state-dev/harness-manager
```

Peer of `@flow-state-dev/core` and `@flow-state-dev/orchestration`. You install a harness separately: `@flow-state-dev/claude-code`, `@flow-state-dev/codex`, `@flow-state-dev/cursor`, or your own.

## Quick start

```ts
import { harnessManager } from "@flow-state-dev/harness-manager";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";

const manager = harnessManager({
  boardCollectionId,          // the board's ledger collection id
  boardCollection: tasks,     // the same declaration the board registers
  tenant,                     // the tenant this manager serves; every request must match
  phase: implementPhase(),    // prompt builder + done-condition
  workspace: { root, sourceRepo, baseRef },
  runTimeoutMs: 30 * 60_000,
  // reviewChanges: true,   // optional: a user reviews a run's commits before its task completes

  // The slot. Called once; the manager hands down its feeds.
  harness: ({ cwd, resume, onSession, onUsage, onActivity }) =>
    claudeCodeAgent({ cwd, resume, onSession, onUsage, onActivity, detached: true, recordWork: true }),
});
```

Mount it as the block behind a board worker that dispatches, and rows filed on that board become supervised runs.

With `workspace: { root, sourceRepo, baseRef }`, every run gets a new branch of `sourceRepo`, cut from `baseRef`. The branch lives in `sourceRepo` itself and the run's checkout sits under `root`.

## Running a project's work

Hand the manager a workspace host instead of a fixed repository, and each run gets its files from whatever the host's source says. A *workspace host* turns a run's source into a directory the agent works in, and saves the files kept with it; a *run source* says where those files come from. Both come from `@flow-state-dev/workspace`:

```ts
import { localWorkspaceHost } from "@flow-state-dev/workspace";

harnessManager({
  boardCollectionId: "eng.feature.work",
  boardCollection: work,
  workspace: localWorkspaceHost({
    root: "/var/fsd/runs",
    remotes: { allow: ["github.com"] },
    source: (ctx) => ({ kind: "repo", repo: "https://github.com/acme/storefront.git" }),
  }),
  // ...
});
```

For a run on a Workforce project, `@flow-state-dev/workforce` provides the source: `projectWorkspace()` answers with the repository of the project the run works for (its workstream's, its conversation's, or the one its task names), with the project's files beside the checkout, or the project's files alone when it has none. It reads its collections through `projectWorkspaceCapability`, which goes on the manager's `uses`:

```ts
import { projectWorkspace, projectWorkspaceCapability } from "@flow-state-dev/workforce";

harnessManager({
  // ...
  workspace: localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace() }),
  uses: [projectWorkspaceCapability],
});
```

The source answers per run, from the block context, and it is asked when a run is first set up. The repository and base branch it named are recorded on the run record (`remote`, `baseRef`). A retry uses the recorded ones, so changing where a source points applies to new rows and never moves a run already under way. A run that started with no repository is recorded as one (`filesOnly`), so it stays on its kept files even if its project gains a repository later.

When the run has files kept beside its checkout, the manager saves them at the end of each turn, when the run asks a question, and when the harness fails. The run record's `lastSave` shows the result: the time, any files left alone because someone else changed them too, and an error if the save failed. In a run with no repository, the manager's question file stays out of the saved files.

The manager can also save a run's repository work, its commits and its uncommitted changes, so another machine can pick the run up. Give `localWorkspaceHost` a held-work store as `heldWork`, and have your source return a `heldPrefix` with the repository, such as `{ kind: "repo", repo, heldPrefix: "runs/storefront" }`. The prefix is the key prefix the run's work is stored under, and a run without one is never saved. The manager saves it at the same points as the kept files: the end of each turn, a turn that ends in a question included, and when the harness fails. An attempt that lands on another machine gets its checkout rebuilt from the last save, with the same commits and the changes unstaged. The coding agent starts a fresh conversation there and is told what was restored. Submodules and files over 10 MB are left out. Setting up the store is covered in the workspace README's [Holding a run's work across machines](../workspace/README.md#holding-a-runs-work-across-machines).

The run record shows where that stands. `place` names the machine the run is on and its `state`: `provisioning`, `ready`, `lost`, `restoring` or `refused`. `held` describes the last save: the attempt, the time, the base, head and snapshot commits, the key it's stored under, the paths left out and why (`skipped`), and `error` when the last save failed. Each save of repository work is tried a few times before it counts as failed.

A failed save of either kind, kept files or repository work, doesn't fail the run, and the next save point tries again. The exception is an attempt that would complete: completing is its last save point, so it fails instead and the retry saves the work.

If the saved work doesn't match the run's record, the harness doesn't run. The task waits on a question for the run's owner, naming what disagreed, and `place.state` is `lost`. Nothing saved is changed or deleted. Once the owner answers, the next run, on the same attempt, starts from its base, with the saved files in `held/` beside the checkout when they can be read.

Without a held-work store, nothing is saved and the record gets no `place` or `held`. A run whose record says its work was saved, with no live checkout on this machine, asks its owner the same way rather than starting over.

A run its workspace refuses is not retried. That covers a source answering `refused` and a host that won't provision what the source named, such as a remote it doesn't allow. The row is cancelled on its first attempt, before the harness starts, with the refusal as its reason.

## Running a board kept per organization

To run an org-scoped board's rows as supervised coding runs, hand the manager that board and its id:

```ts
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { harnessManager, runOwnerClaimOrder } from "@flow-state-dev/harness-manager";

const work = defineTaskCollection({ id: "eng.feature.work", scope: "org" });

const manager = harnessManager({
  boardCollectionId: "eng.feature.work",
  boardCollection: work,
  // ...the rest as above
});

// On the board that drains the rows:
taskBoard({ collection: work, claimOrder: runOwnerClaimOrder(), /* ... */ });
```

The manager builds each run's checkout folder and git branch from the board's id, used as is. An
id with dots in it is accepted. The manager refuses, when you build it, an id git can't use as a
branch name, such as one ending in `.lock`. Two boards whose ids differ other than in letter case
never share a checkout.

The board is kept per organization, so everyone in the organization sees its rows. A row's
coding run belongs to the user who started it: a drain by anyone else in the organization is
refused, naming whose run it is. Their own retry picks up the same checkout, branch and agent
session. With `runOwnerClaimOrder()` on the draining board, the refusal happens before the row
is claimed and costs it no attempt. Without it the manager still refuses to run someone else's
row, but only after the claim, so the row is charged an attempt.

**Wire `runOwnerClaimOrder()` on every board kept per organization that drains rows into a
manager.** The manager's own refusal keeps the run from being split between two people, but only
the claim order keeps a teammate's drain from spending the row's retries. The claim order claims in
the board's own readiness and order, so it takes the place of any other claim order on that board.

## Running a conversation's tasks

A worker can also take tasks a coordinator files in a conversation. Each conversation keeps its
own board, so there is no single board to name. Give the manager `ledgers` instead: a function
that finds a board by the ledger id and partition the task's claim names, and returns
`undefined` for any board the worker shouldn't read. It has the same shape as orchestration's
`taskLedgers` resolver, so one function can serve both.

```ts
import { harnessManager, type HarnessLedgers } from "@flow-state-dev/harness-manager";

const ledgers: HarnessLedgers = async (ledgerId, ctx, partition) =>
  ledgerId === "tasks" && partition !== undefined ? conversationBoard(ctx, partition) : undefined;

const manager = harnessManager({
  ledgers,
  judge: { block: answerJudge, floor: 0.6 }, // optional, see below
  // ...the rest as above
});
```

The task's entry hands the manager the claim on its input, as `claim: { collectionId,
partition, incarnationId }`. The manager never trusts it by itself: the row at that ledger and
partition must be this task, on this attempt, still running, before anything runs, and every
later write is checked against it again. Each run's checkout, branch and run record are kept
apart by board and partition (`runBoardSegment`), so two conversations that file the same task
id never share a tree. Pass `boardCollectionId` and `boardCollection` too and the manager also
runs that board's rows.

The manager calls `ledgers` on every checked write, not once per run, so keep it cheap. For a
user's line into such a run, declare [`harnessSessionDoor`](#talking-to-a-run) on the flow.

On such a board, feature work is named under one key, `HARNESS_FEATURE_KEY` (`"harnessFeature"`):
`input: { harnessFeature: { issue, phase } }`. The rest of `input` is the filer's own, so a plain
`issue` or `phase` there means nothing to the manager. A task that names no feature work runs as
the manager's phase, with its task id in place of the issue, and one whose key names only one of
the two is refused. `namesHarnessFeature(input)` and `harnessFeatureOf(input)` read the key as
the manager does, for a flow that routes tasks between managers. A task naming both is
feature work in that phase, and its run is keyed by its task id, not by the issue: the board
mints its own task ids, so its id needn't be the one `{ issue, phase }` derives, and two tasks
naming one issue still get a tree each. A fixed board runs feature rows only, and refuses a
row whose id isn't the one its payload derives.

A completed run's output carries `answer`, the agent's last message (up to 8,000 characters),
the run's `branch` (`null` for a run with only kept files), how many `commits` it made,
`judged`, and `review`: `"accepted"` or `"deadline"` when the run's changes were
[reviewed](#reviewing-a-runs-changes), `null` otherwise. A feature row's output gains the same fields.

On a board read from the claim:

- **A refused run fails the task for good** (`errored`, never retried), so the conversation
  hears why. On a fixed board it is cancelled.
- **A judge, when you give one, reads the run** after the phase's own check passes, for a task
  with a goal. It is your block, typically an evaluator, handed `{ goal, answer, commits: {
  count, subjects } }` and answering `{ verdict: "done" | "not-done" | "ask", confidence,
  reason }`. *Not done* fails the attempt and the next prompt carries the reason; *ask* holds
  the task on the reason as a question, as a run's own question does
  ([Continuing a run](#continuing-a-run)). A verdict under `floor` counts as done. `confidence`
  and `floor` run from 0 to 1; a confidence outside that is not a verdict. A judge
  that fails never fails the task: it settles on the phase's check, with `judged: false`. Size
  your shutdown with `harnessDrainBudgetMs({ ..., judge: true })`.
- **`goalJudge({ name, model?, floor? })` is a ready-made judge.** An evaluation model (default
  `typesafe-ai/jev`, floor 0.7) is asked whether the answer and commits do what the goal asks,
  and why not. *Not done* carries the why it picked as the reason, and *ask* becomes a question
  that names the goal and quotes the start of the answer. Pass it as `judge: goalJudge({ name:
  "my-coder-judge" })`; the model resolves through your flow's model resolver.

See [Harness manager](https://flow-state.dev/docs/orchestration/harness-manager) for the whole
picture.

## The slot

The manager calls your factory once, with six feeds (`HarnessFeeds`), and a seventh with [`approveTools`](#approving-a-runs-tool-calls):

| Feed | What it does |
|---|---|
| `cwd` | Where this run works: the checkout the manager derived and provisioned. |
| `resume` | Which session this attempt continues, or `null` for a fresh one. |
| `onSession` | Called by the harness when it names its session, so the manager records it. |
| `onSteerable` | Called by a harness whose run can take a line mid-turn, with the run's `steer` while it can and `null` after, so a steer reaches the step [as it runs](#a-run-that-takes-a-steer-live). Optional; a harness that can't steer ignores it. |
| `onUsage` | Called by the harness with each subscription usage window its run reports, so the manager stores it in the run owner's [usage record](#subscription-usage). A harness that reports no usage ignores it. |
| `onActivity` | Called by the harness with each assistant message and tool call of its run, so the manager keeps the task's [progress note](#how-a-running-task-is-doing) current. Optional; a harness that reports no activity ignores it. |
| `onToolApproval` | Called by a harness that asks before each tool call (Claude Code), so a call the user hasn't allowed [waits for them](#approving-a-runs-tool-calls). Handed only with `approveTools: true`; Codex and Cursor ignore it. |

The first six are the harness contract's own signatures, declared in `@flow-state-dev/core`. `onToolApproval` is declared here (`HarnessToolApprovalHook`), shaped as `@flow-state-dev/claude-code`'s `onToolApproval` option, so `...feeds` passes it on. Each is handed the block's context, not the run's prompt.

Everything else about the agent (model, tools, permissions, sandbox) you write inside the factory. Pointing the same manager at another harness is one line, and the manager is unchanged:

```ts
import { codexAgent } from "@flow-state-dev/codex";

harness: ({ cwd, resume, onSession, onActivity }) =>
  codexAgent({ cwd, resume, onSession, onActivity, thread: { sandboxMode: "workspace-write" } }),
```

```ts
import { cursorAgent } from "@flow-state-dev/cursor";

harness: ({ cwd, resume, onSession, onSteerable, onActivity }) =>
  cursorAgent({ cwd, resume, onSession, onSteerable, onActivity, agent: { model: { id: "composer-2.5" } } }),
```

Any block that takes the feeds and returns a run handle conforming to `@flow-state-dev/core`'s harness contract is one this manager can drive.

Claude Code needs `detached: true`. Leave it out and your flow fails to build, naming the entry. Codex and Cursor need no equivalent.

### A scripted harness for checks

`harnessStub` is a harness you can put in the slot when a check should run no model. It records the prompt and the working directory each run was handed (`runs`), can do some real work there (`duringRun`), and returns a handle that parses against the harness contract. Use it to prove your wiring drives whatever harness sits in the slot.

```ts
import { harnessManager, harnessStub } from "@flow-state-dev/harness-manager";

const stub = harnessStub({ finalMessage: "done" });
const manager = harnessManager({ /* ... */ harness: stub.slot });
// later: stub.runs[0].cwd is the checkout the first run was given
```

Give it `toolCalls` and each run makes those calls in order, asking through `onToolApproval` when the manager hands it: an allowed call runs its `run`, a denied one is skipped, and a held one stops the run unrun until the manager resumes it, when it makes the call again. `stub.toolCalls` records what became of each. Without the feed every call runs unasked.

The stub connects to no MCP servers. If your host hands it an `mcpTools` feed, each run writes a status line into its session naming the servers it skipped, so a user watching that session sees which ones the run went without. That feed reads the run's project, so the block needs the capability that holds it. If the feed comes from a capability such as workforce's `projectWorkspaceCapability`, pass that capability in `mcpUses`. If neither the stub nor the manager (`harnessManager({ uses })`) holds it, the run fails with an error that names the capability.

## A harness as a session

The manager runs a harness for a task on a board. `harnessSessionFlow` runs one for a user instead: one session, many turns, one continuing conversation. It is the flow behind a coding chat, where each turn is a prompt and the harness picks up where it left off.

```ts
import { harnessSessionFlow } from "@flow-state-dev/harness-manager";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";

export const claudeCodeSession = harnessSessionFlow({
  kind: "claude-code-session",
  workspace, // where each session works; see below
  agent: (feeds) => claudeCodeAgent({ ...feeds, detached: true, permissionMode: "bypassPermissions" }),
});
```

`agent` builds the harness block from the feeds the flow hands it: `cwd`, `resume`, `onSession`, `model`, `worktree` and `onSteerable`. These are the session flow's own feeds. It has no `onUsage` or `onActivity`, which feed the manager's task records. `workspace` says where each session works: `provision` makes a session's directory on its first turn, `locate` finds it without making it, and `branch` names the branch whose pull requests the flow checks when a turn ends (`null` skips the check). A session is keyed by its flow kind, tenant and id, never by anything the caller sent.

The flow handles the rest:

- **Continuity.** `resume` hands the harness the conversation it last confirmed, and `onSession` is the only thing that records a new one. If the harness refuses to continue that conversation, the session stays bound to it, and each later turn fails the same way. To recover, start a new session.
- **The model.** A session is created with the model it runs (`state.model`), which never changes after that. Creating one without a model is refused with `HARNESS_SESSION_MODEL_REQUIRED`. `defaultModel` is the model used for a stored session that has none recorded.
- **Actions.** `turn` takes a prompt and waits for any running turn to finish first (`concurrency: "defer"`). `steer` hands a line to the running turn if its harness offered to take one, and answers `{ taken, live }`.
- **A record per turn.** `state.turns` keeps the latest 20 turns, by request id. Each record holds the conversation the turn tried to resume, the one the harness confirmed, and how the turn failed: core's failure class, the harness's error text, and whether it was stopped. Read it to show a user why a turn failed. The schema is `harnessSessionStateSchema`.
- **A title.** The session takes its title from its first prompt (`harnessSessionTitle`).

## What a phase supplies

```ts
{
  phase: "implement",
  buildPrompt: (run) =>
    `${run.task.goal}\n\nWork in ${run.workspacePath}, on branch ${run.branch}.`,
  isDone:      (run) =>
    run.stopReport === "stopped-at-limit" ? false : pullRequestExists(run.branch),
  validate:    (workspace) => checkWhateverThisPhaseNeeds(workspace),  // optional
}
```

`buildPrompt` is rebuilt on every attempt from current state. `isDone` is consulted only after a successful verdict, which the manager reads from the handle's `status`. Completion is a conjunction, never an alternative route. `validate` runs once at construction and whatever it returns reaches the phase's own hooks, which is how a phase carries something it learned at startup into a run.

`run.task` is the claimed row's brief: `goal`, plus `title`, `context`, `input`, `deps` and `priorWork` when present. Build the prompt from it rather than from `run.issue`, which is only the row's identity.

`isDone` gets one fact `buildPrompt` does not: `run.stopReport`, how the run said it stopped, in the framework's own vocabulary (`"finished"`, `"stopped-at-limit"`, `"failed"`) and exactly as the harness reported it. A value this version of the framework doesn't define reaches `isDone` unchanged, and never as `"finished"`. `null` means no terminal result was reported at all. What "done" means is entirely the phase's call.

Ending cleanly is not the same answer as finishing the job. A run that exhausts its turn or spend budget commits the part it got through and reports `stopped-at-limit`. A check that only asks whether the branch has a pull request settles that row as done with half the work in it.

Collections a phase reads ride the standard `uses` option:

```ts
harnessManager({ …, uses: [myPhaseCapability] });
```

A capability claiming one of the manager's own accessors (`runs`, `harness-usage`, the board's ledger) is refused when you build the manager, naming the key.

## Continuing a run

A run that needs a decision writes its question to the file its prompt names (`run.askMarkerPath`) and stops. Its task then waits on the question: it stays on its attempt, its lease is dropped, and nothing settles it or starts another run while the question is open. Its work is saved first, and the checkout is free. The Inbox lists the held task as a question, and the board's own `getTask` shows it among the task's open `questions`.

The answer goes through the board's `updateTask` action, naming the question, as the Inbox sends it:

```ts
await updateTask_tasks({ id: task.id, answers: hold.id, message: "Use the v2 endpoint" });
```

A line the user types in the run's session answers the task's oldest open question the same way (see [Talking to a run](#talking-to-a-run)). Once its last question is answered, the task takes one more turn **on the same attempt**: no retry is spent. That turn's run **continues the same coding session**. Its prompt is the phase's `buildPrompt` again, with `run.answers` holding the task's answered questions, oldest first, each with its answer. A run may ask again, and the next answer works the same way. Each run writes its question to a path of its own (`.fsdev/ask/<attempt>-<run>.md`), so a run never reads a question an earlier one already asked.

A cancel while the task waits closes the question and starts nothing: what the run committed stays on its branch, and its kept files stay saved. A question has no deadline unless the host sets one on the board; at a deadline it closes with a "no answer came" message, and the next run goes on in the same session with it.

The judge's *ask*, and held work that doesn't match its record, ask the same way.

The recorded session is the one the harness *confirmed* it was in. If the agent can't find that session, the next run starts a fresh one, with the brief, the question and the answer in its prompt.

### Upgrading from the question inbox

- The manager keeps no questions of its own. Removed: `askQuestion`, `answerQuestion`, `listQuestions`, `readQuestion`, `withdrawQuestion`, `inboxCollection`, `INBOX`, `questionTopic`, `questionFingerprint`, `parseQuestionTopic`, `HarnessRunParked` and the `QuestionAnnouncement` type. <!-- retired-name-refusal: migration note -->
- `harnessManager({ announce })` is refused at construction. Read held tasks from the board (its rows' open questions, `openRowHolds`) and answer with its `updateTask` action.
- `run.answers` reads the task's answered questions from its row.
- `run.askMarkerPath` is `.fsdev/ask/<attempt>-<run>.md`. A phase that names a path of its own must use the one it is handed.
- `askMarkerPath(path, attempt, run)` and `readAskMarker(path, attempt, run)` take the run.

## Reviewing a run's changes

`harnessManager({ ..., reviewChanges: true })` makes a user review a run's commits before its task completes. Off by default.

A run's changes are the commits it made over the base its branch was cut from. A run that would complete (the judge said done, there is no judge, or the judge's verdict was under its `floor`) and has commits on its branch waits for a review. So does a run whose commit count git couldn't read; its review says the commits couldn't be read. A run with no commits completes unreviewed. A failed run fails its attempt unreviewed. A judge's confident verdicts skip the review: *not done* fails the attempt, and *ask* holds the task on a question.

While it waits, the task stays `in_progress` on the same attempt and keeps its claim, and the checkout is free. The row lists the wait among its open `holds`, with `source.kind: "suspension"` and `ask.kind: "review"`, titled "Review the run's changes". Its prompt gives the commit count and up to 20 commit subjects, then the judge's verdict, confidence and reason ("No judge read this run." without one), and the line "The judge's verdict is information, not approval." The hold's data is `{ branch, commits, subjects, judge }`. The Inbox lists it as a review.

The answer is a `HarnessReviewAnswer`, checked against `harnessReviewAnswerSchema`: `{ verdict: "accepted" }`, or `{ verdict: "revise", words }` with non-blank `words`. With the Inbox client:

```ts
import { createInboxClient } from "@flow-state-dev/orchestration/inbox";

const inbox = createInboxClient(client);
await inbox.answer(item, { value: { verdict: "accepted" } });
await inbox.answer(item, { value: { verdict: "revise", words: "Keep the old endpoint as a fallback." } });
```

That posts to the engine's answer route, `POST /api/flows/:flow/requests/:requestId/answer` with `{ suspensionId, action: "submit", data }`. Blank `words` are refused with a 400, and the review stays open.

- **Accepted**: the task completes with no further run, output `review: "accepted"`.
- **Revise**: the words are written on the task as the user's steer, and one more run starts on the same attempt, continuing the same coding session with the words in its prompt, as any steer is taken. If it commits again it is reviewed again, over all the branch's commits. Each revision counts toward the task's steer limit; past it the attempt fails. If the harness confirmed no coding session, the revision fails the attempt instead, and the next attempt's brief carries the words.
- **Deadline**: none unless the host sets `userDeadlineMs`. At the deadline the task completes with no further run, output `review: "deadline"`. Show that as not reviewed, never as approved.
- **Cancel** (the board's `updateTask` cancel): the review closes, no run starts, and the branch's commits and kept files stay.

Reviews need a host with durable execution. A host can restart while a review waits; the answer continues the run.

## Approving a run's tool calls

`harnessManager({ ..., approveTools: true })` makes the user approve each tool call the harness hasn't been told it may make. Off by default, and with it off no feed is handed.

```ts
harnessManager({
  ledgers: conversationLedgers,
  approveTools: true,
  harness: (feeds) =>
    claudeCodeAgent({ ...feeds, detached: true, allowedTools: ["Read"], permissionMode: "default" }),
  // ...
});
```

A call `allowedTools` or `permissionMode` already allows runs unasked. Any other call stops the run before it runs: the harness process exits, the run's work is held and its kept files saved, and the checkout is released. The task stays `in_progress` on the same attempt, with an open hold of `source.kind: "suspension"` and `ask.kind: "approval"`, titled "Allow <tool>?". Its prompt names the tool, the command or file the call touches, and the run's folder; its data is `{ tool, touches, cwd, approveOptions }`. The Inbox lists it as an approval.

The answer is the Inbox's approval answer:

```ts
import { ALLOW_FOR_RUN } from "@flow-state-dev/harness-manager";

await inbox.answer(item, { approved: true });                              // Allow: once
await inbox.answer(item, { approved: true, data: ALLOW_FOR_RUN.data });    // Allow for this run
await inbox.answer(item, { approved: false, data: { note: "Not here." } }); // Deny, with a note
```

Each resumes the coding session that asked, with the checkout taken again. On a yes the model is told to make the call again, and the grant lets it through: once, or for the rest of the attempt with `{ scope: "run" }`. A grant covers the same tool on the same command or file (`grantMatches`), and any other call only with the same arguments, never the tool as a whole; the approval's prompt states that reach. A grant lives on the attempt, not the task row, so a retry asks again. On a no the session is told it may not, with the note, and the run goes on. At the host's `userDeadlineMs` it reads as a no; a cancel resumes nothing. Past 25 approvals in one attempt, the attempt fails and says why.

The pieces are exported for a flow other than the manager to compose the same wait: the feed's types (`HarnessToolApprovalHook`, `HarnessToolApprovalRequest`, `HarnessToolApprovalDecision`), the held call (`heldToolCallOf`, `heldToolCallSchema`) and its decision (`heldToolDecision`), the grant rule (`grantMatches`, `toolGrantSchema`), the stop (`toolApprovalStop`, `toolApprovalYesSchema`, `ALLOW_FOR_RUN`) and what an answer means (`toolApprovalOutcome`).

## The pull requests a run opened

The manager declares the session's pull-request record, `observed-pull-requests` from
`@flow-state-dev/core`, beside its own collections. The coding harness records each pull request
its run opens as the call settles. Before the verdict, and when a run fails, the manager also asks
GitHub which pull requests the run's branch has (`recordBranchPullRequests` from
`@flow-state-dev/workspace`, through the host's signed-in `gh`) and writes any the run's calls
didn't show. A check that can't reach GitHub is a status note; it never changes the verdict. Each
row names the request that opened it, so a reader narrows a shared session to one run.

## Talking to a run

A user talks to a coding run by typing in the run's own session. `harnessSessionDoor` builds the public action a coding flow declares for that line. One door serves every manager on the flow, and the board the calling session's run is on is resolved per request, from server state:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { harnessManager, harnessSessionDoor, taskIssueSegment } from "@flow-state-dev/harness-manager";
import {
  conversationLedgers,
  filingConversationBoard,
  startOwedSteerTurn,
  STEER_TURN_ENTRY,
  steerTurnEntry,
  workerTaskEntry,
} from "@flow-state-dev/workforce";

// `harness` is the slot both the manager and the door are given.
const manager = harnessManager({ ledgers: conversationLedgers, harness /* , phase, workspace, … */ });
const runOf = (row) => ({ issue: taskIssueSegment(row.id), phase: "answer" });

defineFlow({
  kind: "coder",
  actions: {
    message: harnessSessionDoor({
      name: "coder",
      harness,
      board: async (ctx) => {
        const filed = await filingConversationBoard(ctx);
        return filed === undefined ? undefined : { tasks: filed.tasks, runOf };
      },
      // A steer to a task running nothing (waiting on work it filed) starts the turn it is owed.
      onSteered: (ctx, row) => startOwedSteerTurn(ctx, row),
    }),
  },
  internal: {
    // The turn a steer that missed the run's last step is owed: the task again, on its attempt.
    actions: { [STEER_TURN_ENTRY]: steerTurnEntry({ name: "coder-steer-turn", block: manager }) },
  },
  task: { actions: { work: workerTaskEntry({ name: "coder-work", block: manager }) } },
});
```

The session's task is found in the chain of the task that ran there (the task and its follow-ups, which run in the session one at a time), the way Workforce's door finds it: the open one running here, else the latest open one, a follow-up waiting to start, else the latest that ran here. Sent `{ message }`, the door writes the line into the session as the user's message, then:

- **open task** → a steer. The line is kept on the task as a message from the user (`Task.steers`, the same write as `updateTask({ message })`). The run takes it at its next step: the same request runs another step that resumes the coding session the last one confirmed, with the steer in its prompt, on the same attempt. A steer that lands after the run's last step gets one more turn before the task settles, through `STEER_TURN_ENTRY`. While the task waits on a question, the line answers its oldest open question instead, and the turn the answer owes resumes the coding session ([Continuing a run](#continuing-a-run)). Answers `{ steered: <taskId> }`.
- **every task in the chain finished** → talk. One harness run resumes the task's confirmed coding session with the line, outside any attempt, and its answer is the reply. It holds the checkout while it runs, as a run does, so a follow-up claimed meanwhile waits for it; `talkTimeoutMs` (default 10 minutes) bounds it. The task, its output and its attempts don't change. Answers `{ reply, taskId }`.

A refusal fails the request, with the reason in words as the error's message and `SessionDoorRefused` as its cause, so only a delivered line ever completes:

- `not-started`: no task started in this session.
- `cannot-continue`: the task finished and its harness never confirmed a coding session.
- `steer-limit`: the task has taken as many messages as it can (20).
- `finished`: the task finished before the line reached it.
- `not-supported`: the board keeps no messages.

The last three read as they do on Workforce's door (`LINE_STEER_REFUSALS`).

The door reads nothing from the request but `message`. `board` must resolve from the session's own fields, never from the request. `runOf` names the `issue` and `phase` a row's run is keyed by, as the manager keyed its run record, or `undefined` for a row no manager behind the door runs. A task that names no issue is keyed by `taskIssueSegment(row.id)`: its id when the id fits a checkout path and a branch name, and a short hash of it otherwise.

### Answering a worker's message

`harnessTalkTurn({ name?, board, harness, uses?, talkTimeoutMs? })` is the door's talk half as a
block of its own, with the same `board`, `harness`, `uses` and `talkTimeoutMs` as the door. It takes
`{ message }` and answers `{ reply: string | null, taskId }` (`reply` is the harness's final text):
one harness run resumes the coding session of the session's finished task with the message, outside
any attempt, and the task, its output and its attempts don't change. It refuses, failing the request
with `SessionDoorRefused`, with `not-started` (no task ran in this session), `task-running` (the
task or a follow-up is still open) or `cannot-continue` (the harness confirmed no coding session).

A Workforce coding flow passes it as the `turn` of its `messageReceivedEntry`, so a worker's
`sendMessage` to one of its finished tasks (`to: { task: id }`) is answered from the coding session.
The turn's input is a `MessageReceived`, so map it to `{ message }` first:

```ts
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { harnessTalkTurn } from "@flow-state-dev/harness-manager";
import {
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  messageReceivedSchema,
  type MessageReceived,
} from "@flow-state-dev/workforce";

const messageTurn = sequencer({ name: "coder-message-turn", inputSchema: messageReceivedSchema }).step(
  (received: MessageReceived) => ({ message: `Message from ${received.from}, another worker: ${received.text}` }),
  harnessTalkTurn({ name: "coder-message", harness, board }),
);

defineFlow({
  kind: "coder",
  // … actions, task entry and resources as above
  internal: {
    actions: {
      [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({
        installation,
        flowKind: "coder",
        hears: "task-sessions",
        turn: messageTurn,
      }),
    },
  },
});
```

The reply is an item in the task's session. Nothing is sent back to the worker that wrote, unless
the coding flow gives its turn a `sendMessage` of its own.

### Stopping a step for a steer

By default a running step finishes first, and the next step takes the steer. The manager stops it instead when the harness declares `stopsOnAbort: true` on the block its factory returns (a field of core's `HarnessBlock`). The declaration says that when its abort signal fires, the block returns only after its process has exited. A command that process started may still be running, and can keep writing to the checkout while the next step works there ([Claude Code's note](../claude-code/README.md#stopping-a-run-for-a-message)). Claude Code's block declares it. For a harness that doesn't, build the manager with `stopsOnAbort: true`; the option, set either way, overrides what the harness declares. The manager then reads its row every `STEER_POLL_MS` (one second) while a step runs, and once the harness has confirmed a coding session to resume, a new message stops the running step, and the next step starts at once with it. The stop ends the step, not the request, and the checkout keeps what the stopped step wrote. A message that arrives before the session is confirmed waits for the step's own end. Leave the option off for a harness whose abort can return while its process still runs.

A step never runs for a task its attempt no longer holds. The manager reads the task's row every `STEER_POLL_MS` while a step runs, and if the task is cancelled, finishes, or is claimed again, it aborts the running step's harness within that second and the request takes no further step. A cancelled task's harness doesn't keep working on a run that can record nothing.

A message taken mid-run shows in the run's session as a line from its sender.

### A run that takes a steer live

A harness whose run can take a line mid-turn (Cursor, passed the `onSteerable` feed) offers the manager a way in while a step runs. The manager then reads the task's row every `STEER_POLL_MS` while the step runs, and hands each new message to the running turn as it arrives. The step carries on, with no stop, no new step and no new attempt. A message taken this way shows in the run's session as a line from its sender.

A line the run refuses is not lost. The next step the request runs takes it, as if it had arrived after the step: by default when the step ends, or at once under `stopsOnAbort: true`, which stops the step for it. A line still waiting on the run's answer when the step ends is taken by the next step too, with a note to the agent that it may already have acted on it. Lines owed this way are held in the server's memory for the request, so a server that dies mid-step loses them.

### How a running task is doing

While a step runs, the manager keeps the task's `statusNote` (the one-line note `getTask`, `listTasks` and task views show) set to the run's latest activity, from the slot's `onActivity` feed. A message reads as its first non-empty line. A tool call reads as `<name>: <detail>`, where the detail is the first of `file_path`, `path`, `command`, `pattern`, `query` or `url` in its arguments, or as the name alone when none is there. Whitespace is collapsed and the note is cut to 280 characters; `progressNoteOf(activity)` returns the note an activity reads as, or `null` for one that says nothing.

The first activity of a step is written at once. After that the manager writes at most once per `PROGRESS_NOTE_MS` (30 seconds), always the latest, and never the same text twice in a row. A write needs the claim the run holds, so an attempt that lost its task writes nothing more. Nothing is written after the step ends, and nothing clears the note: a finished task keeps its last one beside its status. A board without `reportProgress` gets no note, and the run is unaffected.

The feed reaches the harness only if your slot passes it on, as in the examples above (spreading the feeds into the harness's options does it too). Claude Code and Codex report messages and tool calls; Cursor reports tool calls only.

A worker's message to a coding task that is still running is refused (`task-running`, see [Answering a worker's message](#answering-a-workers-message)), so a coordinator that wants to know how the task is doing reads its `statusNote` with `getTask`.

### Upgrading from `messageDoor`

Before `harnessSessionDoor`, a manager's `messageDoor` (and `harnessMessageDoor`) kept a user's line in the `turns/**` collection for the attempt that would act on it. Nothing reads that collection now. If your host ran a version with `messageDoor`, run `upgradeKeptTurns` once at host start, before the first request (Shift Manager's DevTeam host does):

```ts
import { upgradeKeptTurns } from "@flow-state-dev/harness-manager";

const written = await upgradeKeptTurns(runtime.stores, {
  userCell: (userId, orgId) => resolveUserStorageKey(userId, orgId, { id: "coder", isolateUserState: false }),
  ledgers: ["tasks"],
});
```

It writes each kept line no attempt took onto its task as an untaken steer from the user, keyed so a second run adds nothing. A line whose task has finished is left.

## The deadline

`runTimeoutMs` bounds **the harness step**: the manager composes it into the step's abort signal and fires that signal when the deadline passes. That is the manager's half and all it promises. How promptly a harness returns after its signal fires is the harness's own business.

Neither bounds what the run *spawned*. A command the agent's process started can outlive the kill; the sandbox you configure on the harness is the fence for that, not this deadline.

## Subscription usage

`harnessUsageAction({ readers, timeoutMs? })` is one flow-level action, the `harnessUsage` query: how much of each coding harness's subscription a user has used, window by window, with how old each reading is. `readers` holds one core `HarnessUsageReader` per harness, keyed by its name. Put it on one flow, the one your screens and workers call:

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { readCodexUsage } from "@flow-state-dev/codex";
import { harnessUsageAction } from "@flow-state-dev/harness-manager";

const env = harnessEnv({ pass: ["PATH", "HOME", "CODEX_HOME"] });
const actions = {
  harnessUsage: harnessUsageAction({ readers: { codex: (options) => readCodexUsage({ env, ...options }) } }),
};
```

- **Input** `{ refresh?: boolean }`. **Output** `{ harnesses: HarnessUsageRow[] }`, sorted by harness: `status` (`windows`, `api-key`, `signed-out`, `unavailable`), `reason`, `plan`, `windows` (each with `checkedAt`, `origin`, `ageMs` and `rolledOver`; `origin` is `"read"` for a reader's refresh and `"run"` for a window a run reported), `checkedAt`, `ageMs` and `refreshError`. No model call.
- **Without `refresh`, nothing is read.** A harness with a reader and no reading yet is listed as `unavailable`, `"Not checked yet"`.
- **`refresh: true` runs the readers**, at most once a minute per user and harness (`USAGE_REFRESH_EVERY_MS`), counted from the last attempt whether or not it worked. Refreshes that arrive together share one call. A reader that throws or outlasts `timeoutMs` (default `USAGE_READ_TIMEOUT_MS`, 10 s) leaves the stored reading and sets `refreshError`.
- **`ageMs` and `rolledOver` are worked out by the server's clock** when the query runs. `rolledOver` is true once a window's `resetsAt` has passed.
- **Run windows land on their own.** Pass the slot's `onUsage` to the harness (`claudeCodeAgent` takes it) and each window a run reports is stored with `origin: "run"`; the session door stores a talk's windows for the user talking. For Claude Code, register `readClaudeUsage` from `@flow-state-dev/claude-code/sdk` as the `claude-code` reader: it names the account and plan, and the windows come from runs.
- **One current record per user and harness.** A reading replaces the last reading's windows and keeps run windows it doesn't name; on a shared window the newer wins. A newer report for a window replaces an older one, and an older one arriving late is ignored, as is a reading older than the stored one. A reading or run window from a different account clears the earlier account's windows and plan. A no-number reading (`api-key`, `signed-out`) clears every window, and a run that started before it doesn't bring them back. The account is kept as a hash; no email is stored. No history.

The record is `harnessUsageCollection` (`HARNESS_USAGE`, `harness-usage/**`, user scope, not client-readable, not writable by a model). On the server, `readHarnessUsage(ctx, now, expected?)` returns the query's rows without refreshing, and `recordHarnessUsage` is the one writer, in two forms: `recordHarnessUsage(ctx, report)` for one window a run reported (the manager's and session door's `onUsage` call it), and `recordHarnessUsage(ctx, harness, reading, checkedAt)` for a whole reading. It answers `"recorded"`, `"kept-stored"` or `"refused-older"`. Both throw when the calling block doesn't have the collection under `HARNESS_USAGE`.

## Which harnesses can run here

`harnessReadiness(slots, { timeoutMs? })` keeps which coding harnesses can run on this machine, and what to do about one that can't. `slots` holds one core `HarnessReadinessCheck` per harness, keyed by its name, with the `label` the user sees. Each integration ships one:

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { checkClaudeCodeReadiness, CLAUDE_CODE_PASS } from "@flow-state-dev/claude-code/sdk";
import { checkCodexReadiness, CODEX_PASS } from "@flow-state-dev/codex";
import { checkCursorReadiness } from "@flow-state-dev/cursor";
import {
  formatHarnessReadiness,
  harnessReadiness,
  harnessReadinessAction,
  harnessReadinessCapability,
} from "@flow-state-dev/harness-manager";

const readiness = harnessReadiness({
  "claude-code": { label: "Claude Code", check: () => checkClaudeCodeReadiness({ env: harnessEnv({ pass: CLAUDE_CODE_PASS }) }) },
  codex: { label: "Codex", check: () => checkCodexReadiness({ env: harnessEnv({ pass: CODEX_PASS }), timeoutMs: 30_000 }) },
  cursor: { label: "Cursor", check: () => checkCursorReadiness(harnessEnv({ pass: ["PATH", "HOME", "CURSOR_API_KEY"] })) },
});

// At start: never throws, so it never stops the server.
void readiness.read().then((rows) => console.log(formatHarnessReadiness(rows)));
// Coding harnesses on this machine:
// ✓ Cursor
// ✗ Codex: Codex has no credential: Not logged in. Run `codex login`, or set CODEX_API_KEY.
```

- **`read({ refresh? })`** returns one `HarnessReadinessRow` per harness, in the order given: `harness`, `label`, `ready`, `reason`, `remedy`, `unanswered` and `checkedAt`. The first read runs every check; later reads return the kept rows. `refresh: true` checks every harness again, and `refresh: "codex"` checks one. Concurrent checks of one harness share one call. Nothing polls.
- **It never throws.** A check that throws, rejects or outlasts `timeoutMs` (default `READINESS_CHECK_TIMEOUT_MS`, 30 s) is a row with `ready: false`, `unanswered: true` and a plain `reason`.
- **`refusal(harness)`** is for a coding flow's gate before a task starts. It returns `undefined` when the harness can run, checking a not-ready harness once more first so a sign-in made since the last read counts. Otherwise it returns a sentence that names the harness, says why, and says what to run.
- **`harnessReadinessAction(readiness)`** is a flow-level action: input `{ refresh?: boolean }`, output `{ harnesses: HarnessReadinessRow[] }`. A screen draws chips from it, and Re-check is `{ refresh: true }`. No model call.
- **`harnessReadinessCapability(readiness)`** puts the rows in a generator's context, followed by `READINESS_GUIDANCE` (file coding work only on a ready harness, and say what to run for one that isn't). Add it to your coordinator's `uses`.
- **`formatHarnessReadiness(rows)`** is the text the start log and the context print.

Readiness is this machine's state, so it is kept in the process, not stored. Nothing here changes `harnessManager`: a host that installs none of it gets the run path it had.

## The export surface, in two halves

**`@flow-state-dev/harness-manager`** is the supported host API, and what this package versions: `harnessManager` and its options, `harnessSessionDoor` and `SessionDoorRefused`, `harnessTalkTurn` with `harnessTalkInputSchema` and `harnessTalkOutputSchema`, `harnessReviewAnswerSchema` and `HarnessReviewAnswer` for [answering a review](#reviewing-a-runs-changes), `harnessSessionFlow` with `harnessSessionFeeds`, `harnessSessionStateSchema` and their types for [a harness as a session](#a-harness-as-a-session), `harnessStub` for [checks that run no model](#a-scripted-harness-for-checks), `upgradeKeptTurns`, `STEER_POLL_MS`, `PROGRESS_NOTE_MS` and `progressNoteOf` for [progress notes](#how-a-running-task-is-doing), `PhaseSpec` and the run-context types, `WorkspaceConfig`, the construction-time guards (`assertDistinctRepository`, `assertBaseRefExists`, `assertCheckoutRootUsable`, `assertPositiveInt`), `harnessDrainBudgetMs` and `resolveOwnership` for sizing your own shutdown, `runOwnerClaimOrder` and `runOwnerOf` for a board kept per organization, the run-record collection for building a status surface (a run's questions are on its task's row), the [usage query](#subscription-usage) with `harnessUsageCollection`, `readHarnessUsage`, `recordHarnessUsage` and their constants and types, and [readiness](#which-harnesses-can-run-here): `harnessReadiness`, `harnessReadinessAction`, `harnessReadinessCapability`, `formatHarnessReadiness`, `harnessReadinessRowSchema`, their constants and types.

**`@flow-state-dev/harness-manager/checkout`** is how a run gets a directory: `provisionCheckout`, `acquireCheckout`, `branchFor`, `checkoutPathFor` and the path grammar. `run` and the git timeouts it re-exports come from `@flow-state-dev/workspace`. It is outside the versioned contract, so a host should not import from it. Everything in it is specific to git worktrees. Adopt `harnessManager({ harness })` and let it own the checkout.

The run record's writes (`openRunRow`, `writeRunRow`) aren't exported. Read with `readRunRow` and the collection.

## Telling the guard where you live

`assertDistinctRepository` stops a run being pointed at the repository your own
application lives in, so a coding agent never edits the thing that dispatched
it. It needs to know where that is, and it will not guess:

```ts
assertDistinctRepository("workspace.sourceRepo", sourceRepo, process.cwd());
```

Pass the directory your code lives in. Pass a list if it spans more than one
place. **Pass `[]` if this host has no repository of its own**, such as a built
artifact or compiled output in an image with no `.git` anywhere. That case is
supported; it just has to be said.

There is no default. The guard refuses only on a *match*, so a host it can't
identify would pass unchecked. That is easy to hit with a container whose
`WORKDIR` sits outside the source tree, a service unit, or a process launched
from `/`. Given a location it cannot resolve, it refuses and names the option.

## Limits

- **Saving work across machines is opt-in.** Without a held-work store, a run's checkout exists only on the machine that made it, and a retry that lands elsewhere starts from the base branch. A run whose record says its work was saved, with no store and no live checkout on this machine, asks its owner rather than starting over.
- **A turn in progress can be lost.** Work is saved when a turn ends, so a machine that dies mid-turn loses that turn.
- **A repository on the host's own disk is never saved.** A run cut from a repository listed in `localRepositories` on `localWorkspaceHost` works in that repository directly, and its work stays on that machine.
- **The lease is not a mutex.** Checking the lock and removing it are two steps. A dead holder's lock is reclaimed after a stale window rather than instantly, and the manager refuses a configuration that shortens that window below the longest a live attempt could legitimately hold it. Each acquisition carries its own token, so a displaced process never removes its replacement's lock. The token gives no stronger cross-process exclusion than that.
- **Usage rows are keyed by the bare user id.** Where one user id is reachable from two tenants, both see that user's plan and percents.
- **No retention policy.** Run records grow without bound.
- **A harness that can't resume can't be talked to once finished.** Talk resumes the confirmed coding session, so the door refuses a finished run whose harness never confirmed one (`cannot-continue`).
- **A steer waits for the step to end** unless the run takes it live (Cursor today) or the step is stopped for it (a harness that declares `stopsOnAbort`, as Claude Code does, or a manager built with `stopsOnAbort: true`). A stopped step's harness process has exited, but a command it started may still run in the checkout. Claude Code and Codex runs don't take a line mid-turn yet.
- **A steer step needs a confirmed session.** The step a steer adds resumes the coding session the run confirmed. On a run whose harness confirmed none, a steer that arrives after its last step is left on the task untaken: only the `STEER_TURN_ENTRY` turn acts on it, and a host without that entry completes the task over it.
- **Reviewing changes needs durable execution.** On a host without it, a manager built with `reviewChanges: true` refuses the run before any harness step, and the task is cancelled with a message naming durable execution.
- **Approving tool calls needs durable execution, and covers Claude Code only.** `approveTools: true` is refused the same way on a host without durable execution. Codex and Cursor offer no per-call question and ignore the feed. A harness that calls the feed but whose stop doesn't wait for its process (`stopsOnAbort`) has its unallowed calls denied rather than held. Each answer restarts the harness and resumes its session, a few seconds.
- **Git worktrees specifically**, as above.

## Running tests

```bash
pnpm --filter @flow-state-dev/harness-manager test
```

The suite drives the manager with a fake harness the tests own, with no coding agent and no network. A source check asserts that nothing in `src/` imports one, which is the property the slot exists for.

## Documentation

[Harness manager](https://flow-state.dev/docs/orchestration/harness-manager) · [Coding agents](https://flow-state.dev/docs/tools/coding-agents) · [Task board](https://flow-state.dev/docs/orchestration/task-board)
