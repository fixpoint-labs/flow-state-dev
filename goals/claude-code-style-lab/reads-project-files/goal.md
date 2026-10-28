# claude-code-style-lab › it reads project files

**Issue:** FIX-2285 (epic FIX-2152)

**Outcome:** In the Claude Code-style lab, a member asks the main session a question about the
project's code, and gets the answer from the project's files in the same turn. No task is filed
and no coding run starts. A session that may not see the project gets the refusal a coding run
there would get, and no value.

**Input:** `fixtures/input.json`: a project name, the path of the one file that holds the value,
that file's line with a `{value}` slot, some decoy files, the question, and a follow-up. The value
is new each run (`LC-<6 digits>-<3 digits>`) and is in no file name, project name or brief. The
file sits below what a 2-level tree shows. The question names no path. It is **held out**: another
repository, path and value pass a correct lab.

**Signal:** `fsdev dev --config labs/claude-code-style/fsdev.config.mts`, driven over the lab's
HTTP API with a fresh data folder and a fresh `file://` repository, created as a shared project
with a second user in its members.

- **Leg 1**, as the project's member, in a `desk.main` session set to the project with
  `setWorkProject`, asking the question and then the follow-up:
  - *value named*: the first reply contains the value.
  - *0 tasks*: `listTasks` shows no task on the session's board, nor on any other `agent` session
    of the user.
  - *no harness*: no `harness-thread` session exists.
  - *one clone, no place*: `<data>/runs/.clones/` holds one clone, and `<data>/runs/` holds no
    place directory.
- **Leg 2**, a `desk.main` session with no project, asking the question:
  - *no value*: the reply doesn't contain the value.
  - *read refused*: the turn holds a read tool call whose result is refused `no-project`.
- **Leg 3**, the second user, who set the project as a member and was then taken off its members
  (the stored row's `members` edited in the lab's SQLite file, with the server stopped, then
  restarted), asking the question in that session:
  - *no value*: the reply doesn't contain the value.
  - *read refused*: the turn holds a read tool call whose result is refused `not-a-member`.

Each leg passes in every one of `GOAL_RUNS` (3) fresh runs.

**Anti-game:** Leg 1 asserts nothing on the tool calls or their results: only the reply, the boards
through `listTasks`, the sessions and the server's disk. The value is new each run and lives only in
one file's body, so only a read can produce it. Legs 2 and 3 read the tool result too, because a
refusal the model never asked for proves nothing: a leg 2 or 3 with no read call FAILs. It doesn't
pass on the model declining. Leg 3 is a smoke check. The package test that drives `runProjectOf` with
a row the user has left is the proof (`packages/workforce/test/project-source.test.ts`), and
`no-gate` shows the read goes through the gate.

**Model:** real: `openai/gpt-5.4` (the lab's default), through the AI Gateway. No coding harness
runs, so no `ANTHROPIC_API_KEY` is needed.

**Run:** `pnpm tsx goals/claude-code-style-lab/reads-project-files/run.mts`

**Controls:**
- `GOAL_CONTROL=no-read`: `desk.main`'s `WORKER.md` names no `projectSource` preset (rewritten for
  the run and restored after). Leg 1 must FAIL on *value named* or *0 tasks*.
- `GOAL_CONTROL=no-gate`: the run source's membership check on the project path
  (`mayWorkOn` in `packages/workforce/src/projects/run-project.ts`) is patched out as the server
  loads it, and the run fails if the patch never reached the code. Leg 3 must FAIL on *no value*.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-28 | 1059ee0c | openai/gpt-5.4 | PASS | 3 of 3 runs; leg 1 took 2-3 read calls, 0 tasks, 1 clone, 0 places; legs 2-3 each refused on a read call |
| 2026-10-28 | 1059ee0c | openai/gpt-5.4 | FAIL (control `no-read`) | leg 1 *value named* (the model said it had no tool to read files) and *one clone* (0 clones); legs 2-3 made no read call |
| 2026-10-28 | 1059ee0c | openai/gpt-5.4 | FAIL (control `no-gate`) | leg 3 *no value* (the value was named) and *read refused* (the grep returned matches) |
