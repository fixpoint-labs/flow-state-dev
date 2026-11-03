# teammates-lab › survives a crash mid-turn

**Issue:** FIX-2407

**Outcome:** Someone runs the Teammates lab under `fsdev dev`, and every save restarts the host. When the host dies while a coding task is running and is served again on the same store, the conversation with Chief of Staff is still there, the cut turn is listed as interrupted, and the coding task carries on by itself on a new attempt or ends with its reason. That is the lab's own claim (`host.mts`: "a restart keeps every conversation").

**Input:** `fsdev dev --app @flow-state-dev/teammates` on a scratch store (`TEAMMATES_STORE`) over a git checkout holding one commit. The person says one line to Chief of Staff, then files one coding task for `teammates.claude-code` through the conversation's `createTask_tasks`. **Held out:** the code word in the line is fresh per run, and nothing in the lab names the task.

**Signal:** the coding workers run on the lab's goal-only scripted harness (`GOAL_HARNESS=stub`, harness-manager's `harnessStub`), its five steps 30 s apart (`GOAL_HARNESS_STEP_MS`), so its run is still going when the host is killed. The goal kills only after it reads the task `in_progress` and its run session holding an `in_progress` request, never on a timer. The crash is `crashAndRestart`: SIGKILL to the whole process group, checked gone, then the lab served again on the same store. Then, through the public client only:

- `conversation`: the conversation lists the person's message holding the code word, and both earlier requests (the turn and the filing).
- `cut-turn`: within 150 s, `requests.interrupted()` lists the coding run's request, and its status does not read as running.
- `task`: within 240 s (the board's two-minute lease, plus a sweep), the task's row reads a later attempt than before the kill, or an ending with a reason. The row is read with the board's `listTasks_tasks` read, which stores nothing and touches no board.

**Anti-game:** every read goes through `@flow-state-dev/client`. A fresh store fails `conversation`. A group member left alive fails the crash itself (`crashAndRestart` throws; proven once in Shift Manager's `every-stop-is-one-inbox-item`, `wrapper-kill`). A row still on its first attempt, or ended with no reason, fails `task`. The lease and the sweep are the board's and the engine's own.

**Model:** real, for the person's turn: the lab's default, `openai/gpt-6-luna`. The coding run is scripted.

**Shared:** the lab's boot is `goals/teammates-lab/lab.mts`; the reads are `goals/lib/crash-reads.mts`.

**Run:** `pnpm tsx goals/teammates-lab/survives-a-crash-mid-turn/run.mts`. It needs `AI_GATEWAY_API_KEY` and the lab's pages built (`pnpm --filter @flow-state-dev/teammates build`).

**Controls:** on the same command:

- `GOAL_CONTROL=fresh-store`: the second serve gets a new store file. `conversation` must FAIL.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
