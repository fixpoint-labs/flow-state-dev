# kitchen-sink-harness › Claude Code continues its conversation

**Issue:** FIX-1915 (VG of the spec's PLAN; epic FIX-1907)

**Outcome:** A person picks Claude Code in Kitchen Sink and works a session as they would use Claude Code directly, on this repository. Each turn continues the same conversation. Its edits land in the session's own worktree and nowhere else. A stop leaves the conversation continuable. The run's steps show while it works, and the panel beside it shows exactly what Claude Code recorded of its plan.

**Input:** a fresh random token per run, which no other run uses, and a job long enough to stop (a shell `sleep`). Any other token or job must pass. A durable store (`STORE_TYPE=filesystem`). `KITCHEN_SINK_HARNESS_WORKSPACE` unset on a development server, so the default (the checkout the server runs in) is what's checked.

**Signal:** one real browser against `next dev`, with real Claude Code (`KITCHEN_SINK_REAL_HARNESS=1`) on a signed-in host that can start Claude Code's sandbox and doesn't run as root.

- **c**: turn 2 asks for the token without naming it; the reply names it, and the conversation id the page shows is the one turn 1 recorded.
- **l**: at least one of Claude Code's items shows before turn 1 completes.
- **s**: a long turn is stopped; the page says it stopped, and the next turn names the token under the same id.
- **r**: after a reload, the same session shows the same id, and its next turn names the token.
- **w**: the file turn 1 was asked to write exists in the session's worktree, on branch `kitchen-sink/claude-code-session/<session>`, and the main checkout's `git status` is unchanged.
- **p**: the panel shows what the record holds for turn 1: its rows, or "No plan recorded for this turn.", never "Claude Code reports no plan."

**Anti-game:** the token count is read off the page, and the id off the page's own display of session state; never off the scripted SDK, and never off a prompt Kitchen Sink built from earlier turns (it builds none: each prompt is the person's alone). Turns 2 onward never name the token, so it can only come back from the conversation.

**Model:** whatever Claude Code is signed in with. The check needs a model that follows "answer with the token only".

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/claude-code-continues-its-conversation/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=no-resume`: the session hands Claude Code no conversation to continue. **c**, **s** and **r** FAIL: the token is lost and the id moves.
- `GOAL_CONTROL=no-record`: the block declares no plan record. **p** FAILS: the panel says "Claude Code reports no plan."
- `GOAL_CONTROL=main-checkout`: the run is handed the repository itself. **w** FAILS: the file lands in the main checkout and `git status` changes. Clean up the stray file by hand afterwards.

**Host:** this check can't run where Claude Code mode is unavailable (root, no `bwrap` and `socat` on Linux, no sign-in). It then fails at **host** with the picker's reason, and grades nothing else.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-13 | 653549d24 | n/a | NOT GRADED (host) | Container runs as root with no bwrap/socat and no Claude sign-in: the run stopped at **host** with "The server runs as root…". Needs a signed-in, non-root host (fsd-qa) for c, l, s, r, w, p and the three controls |
