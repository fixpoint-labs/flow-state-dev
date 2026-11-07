# teammates-lab › coding work goes only to a harness that can run here

**Issue:** FIX-2391

**Outcome:** The Teammates lab knows which coding harnesses this machine can run. It says so at start, with what to run for one that can't. It reads again when asked, so a sign-in made after start counts. Lead files coding work only on a ready harness. Asked for one that isn't ready, it files nothing there and tells the user what to run.

**Input:** `fixtures/input.json`: two wordings of "have Codex add a line to the README", one drawn per run. **Held out**: no worker file or prompt names a harness's sign-in state. Lead's own `WORKER.md` says to assign a task to the agent the user names, so only the readiness rows in its context can stop it.

**Signal:** `fsdev dev --app @flow-state-dev/teammates` on a fresh store over an empty git checkout, driven over HTTP. Cursor is ready, from a `CURSOR_API_KEY` in the lab's environment. Codex is not: there's no `CODEX_API_KEY`, and `CODEX_HOME` is an empty folder, so the SDK's own `codex login status` finds no login. `PATH` doesn't pick the program; the SDK does.

- *start log*: the server log has the Codex row, and it names `codex login`.
- *re-check*: the `harness-readiness` flow's `read` returns Codex as not ready, with a remedy. The goal then runs the SDK's own program with `login --with-api-key` and a dummy key into that `CODEX_HOME`. After that, `{ refresh: true }` returns Codex as ready.
- *routes*: asked to have Codex change the README, Lead calls `createTask` on `teammates.codex` zero times, and its reply names `codex login`. It may offer Cursor, or use it.

Each run passes all three. 3 runs of 3 (`GOAL_RUNS`, default 3).

**Anti-game:** Graded on the server log, the read action's output and Lead's tool outputs, through the public client. The Codex sign-in really changes between the two reads, through Codex's own program, so a read that never checks again can't pass *re-check*.

**Model:** real: `openai/gpt-6-luna` (the lab's default) for *routes*. *start log* and *re-check* call no model.

**Shared:** the lab's boot is `goals/teammates-lab/lab.mts`.

**Run:** `pnpm tsx goals/teammates-lab/routes-only-to-ready-harnesses/run.mts`. It needs `AI_GATEWAY_API_KEY` and the lab's pages built (`pnpm --filter @flow-state-dev/teammates build`).

**Controls:** on the same command:

- `GOAL_CONTROL=no-readiness-context`: the readiness capability is patched off the workers' `uses` as the server loads `labs/teammates/host.mts`. *routes* must FAIL, by filing the Codex task, in at least 2 runs of 3. That failure is the incident.
- `GOAL_CONTROL=kept-answer`: harness-manager's `read` is patched to answer `refresh` from the kept rows. *re-check* must FAIL.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-02 | 1be70346 + this change, pre-commit | none (no `AI_GATEWAY_API_KEY` in this container) | *start log* and *re-check* PASS; *routes* not run | Ran the two model-free signals once from a scratch script on the same lab boot. The start log printed `✗ Codex: Codex has no credential: Not logged in. Run \`codex login\`, or set CODEX_API_KEY.` `read` returned Codex `ready: false`; after `login --with-api-key` into the empty `CODEX_HOME`, a plain read still returned the kept row, and `{ refresh: true }` returned `ready: true`. *routes* and the full 3-of-3 run are still owed on a machine with the gateway key |
| 2026-11-02 | same | none | control `kept-answer`: *re-check* FAIL as required | After the login, `{ refresh: true }` still returned Codex `ready: false` with the start's `checkedAt` |
