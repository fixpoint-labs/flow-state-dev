# kitchen-sink-harness › Codex continues its thread

**Issue:** FIX-1916 (VG of the spec's PLAN; epic FIX-1907)

**Outcome:** A person picks Codex in Kitchen Sink and works a session as they would use Codex directly. Each turn continues the same Codex thread. A stop leaves it continuable. A thread Codex no longer has shows as refused, and nothing starts a new thread in its place. The run's steps show while it works, and the plan panel says Codex reports no plan.

**Input:** a fresh random token per run, which no other run uses, and a job long enough to stop (a shell `sleep`). Any other token or job must pass. A durable store (`STORE_TYPE=filesystem`). `KITCHEN_SINK_HARNESS_WORKSPACE` unset on a development server, so the default (the checkout the server runs in) is what's checked.

**Signal:** one real browser against `next dev`, with real Codex (`KITCHEN_SINK_REAL_HARNESS=1`) on a host signed in to Codex (`codex login`, or `CODEX_API_KEY` in the server's environment) where Codex's sandbox can run.

- **c**: turn 2 asks for the token without naming it; the reply names it, and the thread id the page shows is the one turn 1 recorded.
- **l**: at least one of Codex's steps shows before turn 1 completes.
- **s**: a long turn is stopped; the page says it stopped, and the next turn names the token under the same id.
- **r**: after a reload, the page is back in the same session without a click, the session shows the same id, and its next turn names the token.
- **x**: in a second session, after one turn, the thread's record is removed from the Codex home the server's runs use (`$CODEX_HOME`, else `~/.codex`), the way a person's cleared history loses it. The next turn shows Codex refused that thread, naming it, and the session still shows it; the turn after asks for it again and is refused again. Never a new thread.
- **p**: the plan panel says "Codex reports no plan." Never "No plan recorded for this turn."

**Anti-game:** the token count is read off the page, and the id off the page's own display of session state; never off the scripted SDK, and never off a prompt Kitchen Sink built from earlier turns (it builds none: each prompt is the person's alone). Turns 2 onward never name the token, so it can only come back from the thread. Leg **x** removes only the record of a thread this run created.

**Model:** Codex's default model, which Codex mode runs. The check needs a model that follows "answer with the token only".

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/codex-continues-its-thread/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=no-resume`: the session hands Codex no thread to continue. **c**, **s**, **r** and **x** FAIL: the token is lost and the id moves. (The spec names **c** and **s**; **r** and **x** fail for the same reason, since their next turn starts a new thread too.)
- FIX-1914's `GOAL_CONTROL=gate-open`, on `goals/kitchen-sink-harness-mode/opens-on-the-picker/`: its **session** and **served** legs loop over every built mode, Codex included, so they FAIL for Codex under the control (BR-19).

**Host:** this check can't run where Codex mode is unavailable (no Codex SDK at the pinned version, not signed in, or a sandbox that can't run). It then fails at **host** with the picker's reason, and grades nothing else.

**Also recorded:** how many to-do lists Codex reported in session 1's items. Codex mode records none either way; a non-zero count reopens the plan question (FIX-1916 BR-14).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-13 | FIX-1916 branch on `3cc37915b` + uncommitted | n/a | NOT GRADED (host) | No Codex sign-in in the implementing container: the run stopped at **host** with "Codex is not signed in on this host (`codex login status` fails and there is no CODEX_API_KEY in the run's environment)…". The check ran for real inside `next dev`: the pinned SDK found, Codex's program found the way the SDK finds it, its sign-in asked |
| 2026-10-13 | FIX-1916 branch on `3cc37915b` + uncommitted | scripted model behind the real Codex 0.152.1 program | PASS (not the goal's verdict) | Real `codex` program, real sandbox, real browser; only the model was a local Responses endpoint (via `openai_base_url` in a temporary `CODEX_HOME`) that answers with the token it finds in the history Codex replays. Every leg green: one id across c, s and r; panel `undeclared`; x removed 1 record and two turns read refused naming it; 0 to-do lists. Proves the wiring, not a real model's obedience |
| 2026-10-13 | same | same | FAIL (control `no-resume`) | Reddened **c**, **s**, **r** and **x** only: the token was lost and each turn started a new thread |
