# devforce-lab › it answers what a finished task found

**Issue:** FIX-1972

**Outcome:** In the DevTeam lab, a person asks the Shift Coordinator (Shift Coordinator) "what did we
decide about the tech debt?" after the coder's scan has finished. The coordinator reads the task
off its own board and answers with the item the scan picked, the plan it proposed, and that the
plan still waits on their approval, naming the task. It never asks the person to tell it what its
own board holds.

Before this, the coordinator saw only a task's status and the start of its result in the line
that landed when it finished, so it said the board didn't show the output and asked the person.

**Input:** `fixtures/input.json`: the scan's goal, the coder's report, the word only the pick
names, the words only the plan names, and the ask. It is **held-out**: the pick and the plan are
read from the fixture, and they sit past the start of the result a task's line carries, so a
correct implementation passes another report whose pick comes late.

**Signal:** one leg on the DevTeam lab opened as its profile opens it, driven over its HTTP door as
the lab's owner. A conversation with the Shift Coordinator is opened; the scan is dispatched to
`eng.coder` on its board through the `createTask_tasks` action, as an app's screen would; the
coder's run (the lab's stub) answers with the report, and the task completes. Once the lab is
quiet, the ask is sent as one turn.

- the turn read that task with `getTask` (`reads-the-task`, `readTask` before FIX-2081), graded on the tool's own output
- the reply names the picked item (`names-the-item`) and two of the plan's words (`names-the-plan`)
- the reply says the plan waits on approval (`says-it-waits-on-approval`)
- the reply names the task's id or `eng.coder` (`cites-the-task`)
- the reply doesn't ask the person to tell it what was agreed (`never-asks-the-person`)

**Anti-game:** a hollow pass is a reply built from the line that landed when the task finished.
That line carries the result's first 500 characters, and the report's pick and plan come after
them, so only a read of the task can name them. No prompt, brief or context names the item.

**Controls:**

| Control | Perturbs | Goes red on |
|---|---|---|
| `baseline` | this file run on a checkout of main before `readTask` (copy the goal folder there, install, build, run) | `reads-the-task`, `names-the-item`, `names-the-plan` |

**Model:** `openai/gpt-5.4-mini` for every turn, through the AI Gateway. The ask is one turn, graded
once: nothing is retried. Reports `blocked` when no key serves it. The coder's harness is the lab's
stub, with no judge.

**Run:** `pnpm tsx goals/devforce-lab/it-answers-what-a-finished-task-found/run.mts`. Needs `git`, a
writable temp directory and `AI_GATEWAY_API_KEY`.

## What this establishes, and what it does not

It establishes that the Shift Coordinator answers "what did we decide" from a finished task's whole
result, says whether the proposal was approved, and doesn't push the question back. It does not
grade a proposal parked on a question showing under "Needs you"; that is a unit test of the shift
summary (`packages/shift-manager/test/shift-coordinator.test.ts`).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-14 | branch `claude/project-thread-2zc7uk` | `openai/gpt-5.4-mini` | PASS; `baseline` FAIL (expected) | Control first, on main `127e7a92`: FAIL 3 of 3. The turn called `listTasks`, `memory/recall` or `listDelegates`, never read the result, and said the answer "isn't fully available"; once it made up a pick (the cart tests' clock stubs). On the branch: PASS 9 of 9 single-shot runs. Before the prompt asked it to open with the delegate and the task id, 1 of 4 runs named the task; the rest passed every other assertion. |
