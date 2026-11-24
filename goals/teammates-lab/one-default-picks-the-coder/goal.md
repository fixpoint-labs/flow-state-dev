# teammates-lab › one default picks the coder

**Issue:** FIX-2877 (leg a of its goal check)

**Outcome:** In the Teammates lab, `TEAMMATES_HARNESS` is the one value that picks the coder. A coding task Lead starts from your message lands on the coding worker whose `harness:` is that value, and runs on it, whatever worker Lead named and whatever text names another coder. A task you file on a coder through the board stays on that coder. A teammate can't carry a coding harness of its own.

**Input:** `fixtures/input.json`: two wordings of "add a line to the README", one drawn per run, and a planted ask whose message says `Coding harness: Cursor`, over a working folder whose README says the same. **Held out**: no worker file or prompt names the default; Lead's `WORKER.md` says only to assign a coding worker.

**Signal:** `fsdev dev --app @flow-state-dev/teammates` on a fresh store over a git checkout holding one commit, driven over HTTP, the coders on the scripted harness (`GOAL_HARNESS=stub`), once with `TEAMMATES_HARNESS=codex` and once with `claude-code`.

- *default*: Lead starts at least one coding task (a task on a coding worker) from the ask, every one is on the worker whose `harness:` is the default (`teammates.codex`, `teammates.claude-code`), and the first one's run session's coder (`coder` flow, `harness` action) answers that harness. Lead may start more than one: the scripted run changes no README, and Lead's prompt tells it to course-correct. Each is graded. A task Lead hands researcher is not a coding task and isn't graded.
- *planted*: with the default on `codex`, the planted ask, asked first in a fresh conversation, starts coding tasks only on `teammates.codex` too.
- *board*: a task filed on `teammates.cursor` through the board's `createTask_tasks` action stays there and runs on `cursor`.
- *no-own-harness*: hiring a teammate with `settings: { harness: "cursor" }` is refused, saying the setting is no longer taken, and nothing joins the roster.

Each run passes all four (*planted* on `codex` only; *board* and *no-own-harness* on each default's first run). 3 runs of 3 per default (`GOAL_RUNS`, default 3).

**Anti-game:** Graded on the stored rows (the board's task view), the run session's own answer and the roster, through the public client; never Lead's reply. The server's no-pick assignee is the mechanism under test: it reads the default from the kit's config and the roster, never from anything the model wrote.

**Not covered here:** that the composer sends a line as typed, with no `Coding harness:` line: `labs/teammates/test/composer-harness.test.tsx`. A filing made inside a coding run keeping the model's assignee: `packages/workforce/test/no-pick-assignee.test.ts`.

**Model:** real: `openai/gpt-6-luna` (the lab's default) for Lead. The coders are scripted.

**Shared:** the lab's boot is `goals/teammates-lab/lab.mts`.

**Run:** `pnpm tsx goals/teammates-lab/one-default-picks-the-coder/run.mts`. It needs `AI_GATEWAY_API_KEY` and the lab's pages built (`pnpm --filter @flow-state-dev/teammates build`).

**Controls:** on the same command:

- `GOAL_CONTROL=model-assignee`: the harness kit's `coder` flow is registered without its no-pick assignee, so Lead's own assignee stands. *default* or *planted* must FAIL, on at least one default.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-24 | e74debec + the grader's two fixes, pre-commit | openai/gpt-6-luna (Lead), scripted coders | PASS (3 of 3 per default) | codex: planted 6/6, 9/9, 15/15 and default 5/5, 6/6, 5/5 coding tasks on `teammates.codex`, each first run on `codex`. claude-code: 12/12, 8/8, 4/4 on `teammates.claude-code`. *board*: on `teammates.cursor`, ran `cursor`. *no-own-harness*: refused, "no longer takes" |
| 2026-11-24 | e74debec, the grader before its fixes | same | control `model-assignee`: FAIL as required on 5 of 6 runs by the current grader | Lead's own assignee spread over all three coders: codex runs 1–3 FAIL *default* and *planted* (planted on `teammates.cursor`, first run `cursor`); claude-code runs 1–2 FAIL (tasks on `teammates.codex` and `teammates.cursor`). claude-code run 3 put every coding task on `teammates.claude-code` by chance: it failed only on a researcher task, which the current grader no longer counts |
