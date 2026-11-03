# shift-manager › survives a crash mid-turn

**Issue:** FIX-2407

**Outcome:** Someone runs Shift Manager on their own machine and the host dies while a coding task is running: a crash, an OOM, a closed laptop. When it is served again on the same store, the person's conversation is still there, the turn that was cut is listed as interrupted, and the coding task carries on by itself on a new attempt or ends with its reason. Nobody touches anything for that to happen.

**Input:** DevTeam's own profile (`packages/shift-manager/teams/devteam/fsdev.config.mts`), served by Shift Manager's own command on a scratch store (`DEVTEAM_STORE`). Alice, the Lab's owner, says one line to the Shift Coordinator, then files one coding task for `eng.coder` on Storefront through her conversation's `createTask_tasks`, as a screen files one. **Held out:** the code word in her line is fresh per run, and nothing in the profile names the task.

**Signal:** the coder runs on DevTeam's scripted coder (`DEVFORCE_LAB_HARNESS=stub`), its five steps 30 s apart, so its run is still going when the host is killed. The goal kills only after it reads the task `in_progress` and its run session holding an `in_progress` request, never on a timer. The crash is `crashAndRestart`: SIGKILL to the whole process group, checked gone, then the same command on the same store. Then, through the public client only:

- `conversation`: the conversation lists Alice's message holding the code word, and both of her earlier requests (the turn and the filing).
- `cut-turn`: within 150 s, `requests.interrupted()` lists the coding run's request, and its status does not read as running.
- `task`: within 240 s (the board's two-minute lease, plus a sweep), the task's row reads a later attempt than before the kill, or an ending with a reason. The row is read with the board's `listTasks_tasks` read, which stores nothing and touches no board, so the goal never nudges it.

**Anti-game:** every read is Alice's, through `@flow-state-dev/client` on her verified bearer. A host served on a fresh store fails `conversation`. A group member left alive fails the crash itself (`crashAndRestart` throws; proven once in `every-stop-is-one-inbox-item`'s `wrapper-kill`). A row still on its first attempt, or ended with no reason, fails `task`. The task's lease and the sweep are the board's and the engine's own: no setting shortens them here, so the wait is the production one.

**Model:** real, for the person's turn: the Shift Coordinator's own (`devteamShiftCoordinatorModel()`). The coding run is scripted.

**Run:** `pnpm tsx goals/shift-manager/survives-a-crash-mid-turn/run.mts`. It needs `AI_GATEWAY_API_KEY`. It builds Shift Manager's pages itself.

**Controls:** on the same command:

- `GOAL_CONTROL=fresh-store`: the second serve gets a new store file. `conversation` must FAIL.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-03 | 9f53530 on 1b5ce5a | anthropic/claude-haiku-5-5 (the turn), scripted coder | control `fresh-store`: FAIL as required | `conversation`: the conversation is 404 on the fresh store (and so `cut-turn` lists nothing, `task` is 404) |
| 2026-11-03 | same | same | PASS | Killed with the coder on attempt 1, its run request `in_progress`. After the restart: conversation kept with both earlier requests; the run request listed by `requests.interrupted()` and not running; the task re-claimed by itself onto attempt 2 about 2 min later (the board's lease) |
