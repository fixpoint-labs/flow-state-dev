# kitchen-sink-harness › A session lists its pull requests

**Issue:** FIX-2268

**Outcome:** A person works a session in Kitchen Sink, and the agent opens pull requests. Each one shows on the session's pull-request panel while the turn is still running, once, with its repository and number. A pull request the turn only viewed is not listed again. A pull request the agent opened by a call the recorder does not read shows after the turn ends, marked as found on the branch.

**Input:** a scratch GitHub repository the person names (`GOAL_PR_REPO=owner/name`, with a `main` branch), and a local clone of it (`GOAL_PR_CHECKOUT`), which the harness modes work in (`KITCHEN_SINK_HARNESS_WORKSPACE`). Branch names carry a fresh random token per run. Any repository the signed-in `gh` can push to must pass.

**Signal:** one real browser against `next dev`, with the real harnesses (`KITCHEN_SINK_REAL_HARNESS=1`) on a host where each mode is available and `gh` is signed in. Legs run per mode: Codex, Claude Code, Cursor and Flow State (`GOAL_MODES` narrows the list).

- **r1:live**: each pull request the turn opens is on the panel while the turn's Stop button still shows.
- **r2:matches**: after the turn, the panel's set equals `gh pr list --author @me --head <branch> --state all` over the run's branches, by repository and number, with no repeats. The pull request the turn opened and then viewed (`gh pr view`) shows once, as `source: tool`.
- **b:caught** (harness modes only; Flow State has no session branch): a turn opens a pull request with a raw `gh api` call, which the recorder does not read. After the turn ends, it is on the panel, marked `source: branch`.

**Anti-game:** the panel is read off the page (`pull-request-row`), and GitHub's list off `gh` on the host, never off the session's own record. Branch names are new each run. The run closes every pull request it opened and deletes its branches after.

**Model:** each harness mode's default model, and Flow State mode's default model. The check needs a model that follows a short list of shell commands.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers GOAL_PR_REPO=<owner/name> GOAL_PR_CHECKOUT=<clone> pnpm tsx goals/kitchen-sink-harness/session-lists-its-pull-requests/run.mts`

PASS is every leg green in each mode, on 2 of 2 runs.

**Controls:** on the same command.

- `GOAL_CONTROL=no-pr-record`: the harness blocks record nothing. **r1** FAILS in each harness mode (and **r2**, since the in-turn rows are missing until the branch check adds them as `branch`).
- `GOAL_CONTROL=no-backstop`: no turn-end branch check. **b** FAILS in each harness mode.

**Host:** this check can't run where a mode is unavailable or `gh` can't reach the repository. It then fails at **host** with the reason, and grades nothing else for that mode.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-28 | FIX-2268 branch | n/a | NOT GRADED (host) | The implementing container has no signed-in harness and its `gh` is refused GraphQL (`gh pr create` and `gh pr list` can't run), so no scratch repository can take a pull request. Owed on a signed-in host. The model-free halves are green in CI: core's matcher over each harness's recorded tool shapes, the recorder's live rows, workspace's branch check over a stubbed `gh`, each harness package, Kitchen Sink's panel wiring and both controls (`apps/kitchen-sink/test/harness-pull-requests.test.ts`) |
