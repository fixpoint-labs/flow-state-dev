# task-board › it asks a person one way

**Issue:** FIX-2131 (epic FIX-2058). Its spec's goal: `specs/issues/FIX-2131/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a worker that needs a person midway asks one way and its task holds; a flow that needs a review suspends; the person sees each as one Inbox item; and the first answer, from the Inbox, the task's session or the filer's steer, carries the work on on the same attempt. A board whose only open rows wait on a person stops, reporting `waiting-on-a-user`, instead of spinning.

**Input:** a real `createFlowState` host on a durable SQLite store, the Workforce session board on two flows (`desk`, the conversation that files, and `doer`, whose task sessions work), the org's worker inventory opened as a Lab's boot opens it, and one scripted model that calls the real tools: the worker's `holdTaskForUser` and `suspendForUser` (its `questions` capability) and the filer's `updateTask` (its task tools). Code turns call `ctx.suspendForUser({ kind: "review" })`, a block's own `ctx.suspendForUser` input, and `askMidway`. Leg h adds a plan board (`taskBoard`, `complete-or-blocked`) whose one inline worker asks midway. Marks in a task's goal pick the turn: `[askq]`, `[review]`, `[ask2]`, `[both]`, `[input-on-task]`, `[block-input]`; a desk line marked `[input]` or `[filer]{…}[/filer]` is the desk's model's. The prompts ("Which region?", "Does this draft read right?") are arbitrary: any pass the same way.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- `a`: the asking task (`[askq]`) reads, through `getTask`, `in_progress` with no lease and one open row hold, a question; the reviewed task (`[review]`) `in_progress` on its claim with one open suspension hold, a review. Shift Manager's snapshot lists one item for each, the first a `question`, the second a `review`. No row reads `parked`. The Inbox reconciles.
- `b`: the filer's model's `updateTask` naming no question leaves the question open and listed. Its `updateTask` naming the question answers it, kept from the filer: the task takes exactly one more turn, on attempt 1, whose message holds the answer with its question, and completes; the item leaves the list. An Inbox answer to the same hold after it is refused as already answered.
- `c`: the review is listed as one suspension hold named a review, and the Inbox reconciles with it present. The Inbox's verdict resumes the block once, on attempt 1, with the verdict as its answer; the task completes; the item leaves the list and the hold is closed.
- `d`: a task held on two questions (`[ask2]`). A line sent through Shift Manager's composer (`sendTurn`) into the task's session is written from the user as the answer to the oldest open question, leaving the other; a second line answers the second (`d:answers-a-second-question`), and the task takes its owed turn on attempt 1 with both answers and completes.
- `e`: a steer into a task waiting on a review is kept and answers nothing; the review stays listed. Once the Inbox answers, the task takes one more turn, on attempt 1, whose message holds the steer, and completes.
- `g`: on the desk's own turn, which works no task row, the model's `suspendForUser` input is listed in the Inbox with no task, and its request is still suspended past several sweeps (no deadline set); the Inbox's answer comes back as the tool's result. On a task turn the tool refuses `input`, naming `holdTaskForUser`, and nothing is listed; a block's own `ctx.suspendForUser` input on a task turn still suspends and lists. A step calling `holdTaskForUser` and `suspendForUser` review together opens one wait: the row's open holds are one row hold, the request is not suspended, and the model reads the sibling's refusal (`one_wait_per_turn`). On a second host with the host's person-stop deadline at 1,500 ms, the model's input comes back `answered: false, deadline: true` and its request completes: a result, not a throw.
- `h`: a `complete-or-blocked` plan board whose only open row is held on a question its worker asked stops on its first idle pass (`terminationReason: "waiting-on-a-user"`, in well under 10 s against a 200-iteration limit), and the row stays running on attempt 1, with no lease, held on its question.

**Not in this goal, and why:**

- *A routed task's question, answered by its filer.* The filer is the conversation there, and FIX-2133's own goal and `updateTask`'s unit tests own the refusal.
- *`sendMessage` to a task waiting on a review answers nothing (rule 10).* Pinned by `goals/task-board/holds-a-task-waiting-on-a-person` leg a.
- *A revision request's words reach the next model call as a steer.* The spec's decisions name it (amended 2026-10-24), but no answer shape for a revision request exists on `main`, so there is nothing to grade; it is raised on the PR.
- *Leg h's review row.* A review asked by an inline worker on a plan board suspends the drain's own request, and an inline drain mirrors no suspension hold, so no plan board can hold a row waiting on a review today. Leg h holds the question row alone; the review half of the excusal is proved by `quiescence.test.ts` and, on a dispatching board, by legs a and c.
- *No leg f.* Stores are reset, so no stored parked row is read (the spec's owner decision).

**Anti-game:** the Inbox is Shift Manager's snapshot, every Inbox answer goes through orchestration's Inbox client, a typed line goes through Shift Manager's composer, the filer's answer is its model's own `updateTask` call, and a task is read through `getTask`. Nothing asserts on the suspension store or on rows written by hand. The turn counter is a proof each turn appends from inside its own run, and a model's tool result is the model's own reading of it.

**Model:** n/a (model-free: a scripted model calls the real tools).

**Run:** `pnpm tsx goals/task-board/asks-a-person-one-way/run.mts`. `GOAL_LEGS=a,b,c,d,e,g,h` runs some legs (b and c work on a's tasks). On demand only, never a CI gate.

**Controls:** scratch patches to the code under test, applied as it loads (`goals/lib/module-patch.mts`), printed by the run, and refused when they never reached the code. The run checks each fails its named assertion and no other leg.

- `GOAL_CONTROL=composer-sends-turn`: a line typed in the task's session goes to the worker as an ordinary turn (`steerOrTalk` always picks the turn). Must fail **`d:answers-a-second-question`** (and `d:first-line-answers` with it).
- `GOAL_CONTROL=count-person-waits`: the active-worker count excuses nothing. Must fail **`h:reports-waiting`**: the drain keeps waiting on a row nobody is working.

Not run here: today's `main`, which fails leg a (the task parks; no review item) and the sweep.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-26 | `fix/fix-2131` on `f32747683`, uncommitted | n/a | **PASS** | Every leg green. a: the model's question held its task, the block's review suspended its run, one Inbox item each (a question, a review). b: the filer's steer naming none left it open; naming it answered it, one more turn on attempt 1 with the answer in its brief; a later Inbox answer refused `question_answered`. c: reconciled with the review present; the verdict resumed the block on attempt 1. d: two composer lines answered the two questions, oldest first. e: the steer kept, answering nothing; one more turn holding it after the verdict. g: input off a task row was the tool's result and waited past four sweeps; refused on a task turn naming `askQuestion`; a block's input suspended; both tools in one step opened one wait; at a 1,500 ms host deadline `answered: false, deadline: true`. h: the plan board stopped `blocked-by-failures` 35 ms after it started. |
| 2026-10-26 | same (control `composer-sends-turn`) | n/a | FAIL (expected) | `d:first-line-answers` and `d:answers-a-second-question`: both lines ran as turns, the questions stayed open, no steer written. Nothing else red. |
| 2026-10-26 | same (control `count-person-waits`) | n/a | FAIL (expected) | `h:reports-blocked`: the drain was still running after 15 s, its meta `active`; `h:row-stays` with it (the drain's own read never ran). Nothing else red. |
| 2026-10-26 | `fix/fix-2131` review round 1 (the `held` renewal fix, the shared turn-asked predicate), uncommitted | n/a | **PASS** | Every leg green; `composer-sends-turn` failed `d:answers-a-second-question` and `count-person-waits` failed `h:reports-blocked`, as they must. |
| 2026-10-27 | `main` 31bed8b, leg h's reason moved to `waiting-on-a-user` (FIX-2214's reason), uncommitted | n/a | **PASS** | Every leg green; h: the plan board stopped `waiting-on-a-user` on its first idle pass. Before this, the same commit failed `h:reports-blocked` plain, since the goal still asked for `blocked-by-failures` (found by the FIX-2134 closure) |
| 2026-10-27 | same (control `count-person-waits`) | n/a | FAIL (expected) | `h:reports-waiting`: still running after 15 s, its meta `active`; `h:row-stays` with it. Nothing else red. |
