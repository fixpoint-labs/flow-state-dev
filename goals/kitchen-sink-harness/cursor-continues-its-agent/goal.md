# kitchen-sink-harness › Cursor continues its agent

**Issue:** FIX-1917 (VG of the spec's PLAN; epic FIX-1907)

**Outcome:** A person picks Cursor in Kitchen Sink and works a session as they would use Cursor directly. Each turn continues the same Cursor agent. A stop leaves it continuable. The run's steps show while it works, and the panel beside it shows exactly the to-do list Cursor last confirmed, or says no plan was recorded for the turn.

**Input:** a fresh random token per run, which no other run uses, and a job long enough to stop (a shell `sleep`). Any other token or job must pass. A durable store (`STORE_TYPE=filesystem`). `KITCHEN_SINK_HARNESS_WORKSPACE` unset on a development server, so the default (the checkout the server runs in) is what's checked.

**Signal:** one real browser against `next dev`, with real Cursor (`KITCHEN_SINK_REAL_HARNESS=1`) on a host with a Cursor key (`CURSOR_API_KEY`) or a stored Cursor SDK login, where Cursor's sandbox can start.

- **c**: turn 2 asks for the token without naming it; the reply names it, and the agent id the page shows is the one turn 1 recorded.
- **l**: at least one of Cursor's items shows before turn 1 completes.
- **s**: a long turn is stopped; the page says it stopped, and the next turn names the token under the same id.
- **r**: after a reload, the page is back in the same session without a click, the session shows the same id, and its next turn names the token.
- **p**: the panel's rows equal, in order, the list on the last successful `updateTodos` step of turn 1, read from the turn's own items (what Cursor's emitter wrote, not the record the panel reads). When that list is empty the panel says the turn's plan is empty; when the turn has no such step, it says no plan was recorded. Never a panel text containing "reports no plan".
- **p2** (FIX-2259): in a second session, turn 1 plans four steps with names picked per run and completes the first; turn 2 completes the second and nothing else. `p2:kept`: after turn 2 the panel holds all four rows, in order, with turn 1's names, the first two done, labelled "Last changed in turn 2". `p2:quiet-turn`: a turn 3 that leaves the plan alone leaves the rows and the label as they were. `p2:matches`: the rows equal the list on the last successful `updateTodos` step in any turn of the session, read from the turns' own items.

**Anti-game:** the token count is read off the page, and the id off the page's own display of session state; never off the scripted SDK, and never off a prompt Kitchen Sink built from earlier turns (it builds none: each prompt is the person's alone). Turns 2 onward never name the token, so it can only come back from the agent. The panel is compared with the turn's items, never with the plan record it is drawn from.

**Model:** `composer-2.5`, the model Cursor mode runs. The check needs a model that follows "answer with the token only".

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/cursor-continues-its-agent/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=no-resume`: the session hands Cursor no agent to continue. **c**, **s** and **r** FAIL: the token is lost and the id moves. (The spec names **c** and **s**; **r** fails for the same reason, since its next turn starts a new agent too.)
- `GOAL_CONTROL=plan-per-turn`: the panel shows only the rows the latest turn wrote, as a plan kept per turn would (the page is opened with `?goalControl=plan-per-turn`). **p2** FAILS: turn 3 shows no plan.
- `GOAL_CONTROL=no-record`: the block declares no plan record. **p** FAILS: the panel says "Cursor reports no plan."

**Host:** this check can't run where Cursor mode is unavailable (no Cursor SDK at the pinned version, no key and no stored login). It then fails at **host** with the picker's reason, and grades nothing else.

**Also recorded:** whether Cursor called `updateTodos` at all on turn 1's job, in the evidence. If it never does, the panel mostly says "no plan recorded for this turn", which is true but bare (FIX-1917 D1's flip condition).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-13 | PR-B head | n/a | NOT GRADED (host) | No `CURSOR_API_KEY` and no stored Cursor login in the implementing container: the run stopped at **host** with "Cursor is not signed in on this host…". Needs a host with a Cursor key (fsd-qa) for c, l, s, r, p and both controls |
