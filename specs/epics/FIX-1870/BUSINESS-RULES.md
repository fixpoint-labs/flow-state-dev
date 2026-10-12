# FIX-1870 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

At epic altitude the rules aren't behaviours of one feature; they're the constraints every child
spec and implementation must satisfy, and the place a cross-spec review checks. Each says who owns
it and where it's checked.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | A worker starts work on another worker now with one tool, `dispatchTask`: a new row or a reference, a worker, and an optional `wait` (FIX-1872 adds a workstream's `target`, ER-5). With `wait`, its turn parks until the row ends and resumes with the row's output, or an error naming how it ended. Without it, the ending arrives through `onTaskSettled` | FIX-1875 ([D1](DECISIONS.md#d1)) | The closure's reruns |
| ER-2 | `addTask`, `assignTask` and the other task tools record work and an owner; the board decides when it runs. Only `dispatchTask` starts work now | FIX-1875 | FIX-1875's goal check |
| ER-3 | Every rule ask carries today holds under `wait`, unchanged: a waited-on row can't park on a question · the waiting turn owns the row's lifetime, and only its filer hears a cancel · a timeout cancels the row · bounds 30 seconds to an hour, default 5 minutes · one row per call, one wait per step · `wait` only where the host can resume a parked turn and a sweeper bounds every wait · a turn working a task can't wait (depth one) · the description says to wait only when the next step needs the result | FIX-1875 | The FIX-1816 and FIX-1820 reruns |
| ER-4 | A referenced row must sit on the caller's own board lineage ([FIX-1794](https://linear.app/fixpoint-labs/issue/FIX-1794)) | FIX-1875 | FIX-1875's goal check |
| ER-5 | **The fence.** The board claim ticket is the only answer-once fence. Every coordinator post that expects an answer is a task, one per delegate, sent through `dispatchTask`. **Workstreams.** A post to a workstream keeps its route: the row carries the delegate record's `target` and is worked in the session that target resolves to, as `handOff` delivers it today. FIX-1872 adds that coordinate to `dispatchTask` and lifts the task check's "a workstream takes posts, not tasks" refusal for it; what the task does is unchanged (ER-8). **Tells.** A tell that expects no reply is a `dispatcher()` message, into the target's session for a workstream: no row, no deadline, no once-only check, and no model-facing tell tool. It is not the conversation board's `-tell` notice flush, which delivers task endings. **The change.** The coordinator's `handOff` tool, the delivery ledger and its `delegateAnswer` / `delegateMissed` entries go in one change. A notice marker, which records a notice owed, is not a fence | FIX-1872 ([D2](DECISIONS.md#d2)) | FIX-1872's goal check · the closure sweep |
| ER-6 | One answer per delegate per post per round, each delegate's own line, the round deadline, the missed answer, and the routing record keep working, carried by rows ([D2](DECISIONS.md#d2)) | FIX-1872 | `goals/coordinators/hands-each-post-to-its-delegates/`, `goals/coordinators/files-tasks-down-the-owners-chain/`, `goals/workforce-mailboxes/a-routed-post-gets-one-answer/` · the closure |
| ER-7 | Ask is a question to a person; hand-off is mid-work only; new work is dispatched; a caller waits. Every new public name in the set follows it | FIX-1876 defines in docs and code · FIX-1875, FIX-1872 consume | Each child's spec review · the closure's docs walk |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-8 | Change what a waited-on or dispatched task does | Not doing. The proof is that nothing changed but names |
| ER-9 | Add waiting on several tasks at once, a row-less question tool for workers, a question kind of task, or channels | Not doing. A question kind of task waits until something needs it |
| ER-10 | Add a second answer-once fence, or a path for a post that expects an answer that isn't a row, including between two children's merges | D2. A row-less path needs its own fence |
| ER-11 | Edit the FIX-1816, FIX-1817 or FIX-1820 goal checks beyond names (and the two named shape entries the [anti-game](SPEC.md) map admits) | The kill line. A check that had to change is the finding, not a fix |
| ER-12 | Retire `dispatcher()` or FIX-1312's `session: { from: true }` | They are flow-code transport, not a model tool |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-13 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear |
| ER-14 | A cross-cutting question (above all, a coordinator post whose own lines, rounds or routing can't run as a row) is raised to the epic, not decided locally; after merge, any resulting amendment gets a follow-up PR | It is D2's one flip condition |
| ER-15 | The epic finishes only when the closure issue closes: a clean run on one `main` commit, with every bug an earlier run found fixed as a child of this epic and retested | Surface without proof doesn't move Goal 4 |

## The closure

| # | The epic is done when | Proved by |
|---|---|---|
| ER-16 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met: the three reruns match with a rename-map diff, the three coordinator checks keep every outcome line, the sweep passes, and both controls fail | FIX-1887's goal check |
| ER-17 | The published docs and the package READMEs teach one path for giving another worker work | FIX-1876's docs PR · the closure follows the docs as written |
