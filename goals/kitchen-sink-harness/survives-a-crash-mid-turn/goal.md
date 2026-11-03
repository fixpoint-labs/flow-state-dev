# kitchen-sink-harness › survives a crash mid-turn

**Issue:** FIX-2407

**Outcome:** Someone runs Kitchen Sink locally, on its SQLite store with durable execution on, and the server dies while a Claude Code session's coding turn is running. When it is served again on the same store, the session still shows its earlier turn, and the cut turn is listed as interrupted, not left reading as running. Nobody touches anything for that to happen.

**Input:** the built app in test mode (`next start`), on SQLite at a scratch file (`KITCHEN_SINK_STORE_FILE`, honoured in test mode only), its harness worktrees cut from a scratch checkout (`KITCHEN_SINK_HARNESS_WORKSPACE`) under a scratch `XDG_STATE_HOME`. One Claude Code mode session, born on the scripted model. **Held out:** the code word in the first turn's prompt is fresh per run.

**Signal:** Claude Code mode runs on the scripted Claude Code that test mode installs. The first turn completes. The second carries the script's `[slow]` directive, which holds it open; the goal kills only after it reads that turn `in_progress`, never on a timer. The crash is `crashAndRestart`: SIGKILL to the server's whole process group, checked gone, then the same build served again on the same store. Then, through the public client only:

- `conversation`: the session lists the person's first prompt holding the code word, and the first turn's request.
- `cut-turn`: within 150 s, `requests.interrupted()` lists the held turn, and its status does not read as running.

**No `task` signal here.** A harness session keeps no task row: its coding work is the turn itself, with a record per turn. So the coding work's next state is the cut turn's, which `cut-turn` reads. Continue and Discard on it are FIX-2377's.

**Anti-game:** every read goes through `@flow-state-dev/client`. A fresh store fails `conversation`. A group member left alive fails the crash itself (`crashAndRestart` throws; proven once in Shift Manager's `every-stop-is-one-inbox-item`, `wrapper-kill`). A turn still reading `in_progress` after the restart fails `cut-turn`, even when listed.

**Model:** none: the scripted Claude Code (test mode) runs no model.

**Run:** `pnpm tsx goals/kitchen-sink-harness/survives-a-crash-mid-turn/run.mts`. It builds the packages and the app in test mode first; `GOAL_SKIP_BUILD=1` serves the build already in `apps/kitchen-sink/.next`.

**Controls:** on the same command:

- `GOAL_CONTROL=fresh-store`: the second serve gets a new store file. `conversation` must FAIL.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
