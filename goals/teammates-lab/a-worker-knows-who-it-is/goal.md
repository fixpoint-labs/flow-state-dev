# teammates-lab › a worker knows who it is

**Issue:** FIX-2334

**Outcome:** Asked who it is, each worker in the Teammates lab gives its own name and role, never "ChatGPT". Asked who its teammates are, Chief of Staff names them from what it already knows: no tool call. None of it is written in the lab's worker files. It comes from the built-in worker flow's default prompt layer, read from the roster.

**Input:** `fixtures/input.json`: the three workers and the names they go by, and two wordings of each question. A wording is drawn per ask. **Held out**: another wording of either question passes a correct lab.

**Signal:** `fsdev dev --app @flow-state-dev/teammates` on the lab's own workers and a fresh store, driven over HTTP.

- **Leg 1:** each of `teammates.chief-of-staff`, `teammates.researcher` and `teammates.writer` is asked who it is, in its own conversation.
  - *named*: the reply holds the worker's name (`Chief of Staff`, `researcher`, `writer`).
  - *not ChatGPT*: the reply doesn't say ChatGPT.
- **Leg 2:** Chief of Staff is asked who its teammates are.
  - *names researcher*, *names writer*: the reply holds both.
  - *no tool call*: the turn holds no tool output.

Each leg passes in 3 runs of 3 (`GOAL_RUNS`, default 3).

**Anti-game:** Graded on the replies and the turn's items. The lab's worker files carry no "You are …" or teammates line, so a worker's own name in a reply comes from the prompt layer. Leg 2 is weaker: the team's `TEAM.md` and Chief of Staff's body still mention researcher and writer, so the names alone could come from there. What leg 2 adds is *no tool call*: without the layer the model looks its teammates up (`listDelegates`).

**Model:** real: `openai/gpt-5.4-mini` (the lab's workers).

**Run:** `pnpm tsx goals/teammates-lab/a-worker-knows-who-it-is/run.mts` (needs `AI_GATEWAY_API_KEY`).

**Controls:** on the same command:

- `GOAL_CONTROL=no-identity`: the built-in worker flow's default layer is patched out as the server loads it (a scratch patch to `agent-worker-flow.ts`). Leg 1 must FAIL on *named* for at least one worker, and leg 2 on a name or on *no tool call*.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-30 | (this PR) | openai/gpt-5.4-mini | PASS 3/3 | Every worker named itself in all runs; leg 2 named both teammates with no tool call. An earlier wording failed 1 of 3 on leg 2 (`listDelegates`); the teammates list now says to answer from it. |
| 2026-10-30 | (this PR) | openai/gpt-5.4-mini | control `no-identity`: FAIL as required | All three workers answered as "your team assistant" / "your AI assistant"; leg 2 called `listDelegates`. |
| 2026-10-30 | 863a0e13 | openai/gpt-6-luna | FAIL | Closure re-run (FIX-2156) on the lab's new default model: leg 1 passed 3/3; leg 2 called `listDelegates` 3/3. On `TEAMMATES_MODEL=openai/gpt-5.4-mini`, leg 2 failed 1/3 |
| 2026-10-30 | 863a0e13 | openai/gpt-6-luna | control `no-identity`: FAIL as required | Leg 1 unnamed / "ChatGPT" answers |
| 2026-10-30 | 863a0e13 + layer fix | openai/gpt-6-luna | PASS 5/5 | The teammates list says it is current, so no tool call is needed; every worker named itself; leg 2 named both with no tool call |
| 2026-10-30 | 863a0e13 + layer fix | openai/gpt-6-luna | control `no-identity`: FAIL as required | Leg 1 unnamed in every run, "ChatGPT" in run 2; leg 2 called `listDelegates` |
| 2026-10-30 | 07753056 | openai/gpt-6-luna | PASS 3/3 | Closure re-run after #4262 |
| 2026-10-30 | 07753056 | openai/gpt-6-luna | control `no-identity`: FAIL as required | Leg 1 unnamed or "ChatGPT"; leg 2 called `listDelegates` |
| 2026-10-31 | 43f36196 + FIX-2364 | openai/gpt-6-luna | PASS 3/3 | Regression re-run on FIX-2364's default-layer rule, with the lab's boot now shared (`../lab.mts`) |
| 2026-10-31 | 43f36196 + FIX-2364 | openai/gpt-6-luna | control `no-identity`: FAIL as required | Leg 1 unnamed or "ChatGPT" |
