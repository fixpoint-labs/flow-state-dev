# claude-code-style-lab › it hands off a review a thread can start on

**Issue:** FIX-2363, with FIX-2362's result line and no-repeat

**Outcome:** In the Claude Code-style lab's Projects view, a person asks the main session to
review a pull request. Each thread it starts carries what the ask named (the PR, its branch, what
the change does, what done means) and gets on with it, with no question about a region. When a
thread finishes, the main thread shows it as one collapsed line that opens to the reply, the
task's view says what happened in plain words, and the lead doesn't write the reply out again.

**Input:** `fixtures/input.json`: a project name, the review ask, the ids it names, one detail of
what the change does, the word that says what done means, and the answer to any question a thread
asks. It is **held-out**: no worker file, prompt or flow names any of it, so another review ask
with its own ids passes a correct lab.

**Signal:** one browser on `fsdev dev --config labs/claude-code-style/fsdev.config.mts --app
@flow-state-dev/claude-code-style`, with a fresh data folder and project.

- **1** every `desk.thread` task the board lists for the ask (`listTasks_tasks`) has a goal holding
  each of the ask's ids; together the goals hold the detail and the done word.
- **2** no thread holds a question whose prompt mentions a region. A question about anything else
  is answered in its thread's view and noted.
- **3** each thread waits on your review, and *Resolve* on its card completes it.
- **4** each finished thread has a `data-entry="result"` line in the main thread whose button is
  `aria-expanded="false"`, doesn't show the reply, and opens to it; the task views' tool lines
  hold no camelCase tool name, task id or `null`.
- **5** for a thread whose result reached the lead as a notice it answers in a turn, the lead's text
  after the first result line writes at most 30% of any opened reply again (runs of 8 words or
  more), holds no list, and stays under 300 characters a result. A thread that answered into the
  conversation as written (`resultTo: "conversation"`) takes no lead turn; a run where every thread
  did is retried, since 5 has nothing to grade.

**Anti-game:** goals and holds are read from the board's own records, never from the lead's text.
The result line and tool lines are read from the rendered page, and the reply comes from opening
the line, as a person does. *Resolve* and answers are clicked and typed. Signal 5 has no floor of
its own: a lead that adds nothing after a result passes it, which is the claim.

**Retries:** up to `GOAL_ATTEMPTS` (3) fresh runs, when the lead filed no thread (never under a
control), or when every thread answered into the conversation, so no result reached the lead.

**Model:** real — `openai/gpt-5.4` (the lab's default), through the AI Gateway.

**Run:** `pnpm tsx goals/claude-code-style-lab/hands-off-a-review/run.mts`

**Controls** (`GOAL_CONTROL=<name>`; each swaps one line of a worker file for its opposite for the
run, and puts it back):
- `region-line`: the thread worker's "and start on it at once." swapped for the old "Ask which
  region matters before you start". Must FAIL 2.
- `thin-handoff`: the lead's handoff line swapped for "Give each thread a goal of five words or
  fewer". Must FAIL 1.
- `restate`: the lead's no-repeat line swapped for "Restate the whole result for the user, word for
  word". Must FAIL 5.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-31 | e3ed4e7 (worker files as on main) | openai/gpt-5.4 | FAIL (expected) | Reproduces FIX-2363. Signal 2: "Review theme-toggle PR" asked "Which region matters for this review?". Signals 1, 4 and 5 passed |
| 2026-10-31 | this change | openai/gpt-5.4 | FAIL (expected) | Control `region-line`. Signal 2: "Which region should I use for this review?" |
| 2026-10-31 | this change | openai/gpt-5.4 | FAIL (expected) | Control `thin-handoff`. Signal 1: the goal was "Review PR #4272", with no branch, detail or done |
| 2026-10-31 | this change | openai/gpt-5.4 | FAIL (expected) | Control `restate`. Signal 5: the lead wrote 99% of the reply again, in 7 list items |
| 2026-10-31 | this change | openai/gpt-5.4 | PASS 1 of 4 | Signals 1 to 4 passed in every run. Signal 5 failed 3 of 4: the lead listed the findings again (690, 619, 830 characters), paraphrased rather than copied (0 to 49% word for word), despite its instructions. The lead takes every notice in a turn under `routing: judgment`; a prompt doesn't stop it relaying |
| 2026-10-31 | this change (with FIX-2366) | openai/gpt-5.4 | PASS | Thread worker reworded to look before it asks; lead text as in the threads-mode PASS. Attempt 1 of 3, signal 5 included (0% of the reply again) |
| 2026-10-31 | this change (with FIX-2366) | openai/gpt-5.4 | FAIL (expected) | Control `region-line`, on the new anchor. Signal 2: two threads asked "Which region…" |
