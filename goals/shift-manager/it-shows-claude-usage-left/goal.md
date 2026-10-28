# shift-manager › it shows Claude usage left

**Issue:** FIX-2142

**Outcome:** A person running Shift Manager on their own Claude subscription opens Usage and sees, for Claude Code, each window their runs reported: which limit, when it resets, and how close it is, as a percent when Claude Code sent one and in words when it didn't. A run only ever writes its own person's row, and a look at who is signed in never throws a run's window away or brings back an old account's.

**Input:** DevTeam's tree and `openLab`, served by Shift Manager's command (`lab/fsdev.config.mts`), with the coder on `claudeCodeHarness`. A scripted Shift Coordinator files one task per tag, and the coder's runs go to `lab/scripted-sdk.mjs` in place of the Agent SDK (`sdkSeam` in `controls.mts`): each run sends the `rate_limit_event`s its tag scripts, in the shape the pinned CLI (0.3.234) builds for each status, and answers `accountInfo()` with the scripted account. The `claude-code` usage reader asks the same seam who is signed in, or the real Agent SDK over an empty home (with and without an API key). Each leg runs as its own person.

**Signal:** each failure tagged `<leg>:<assertion>`.

- **a** (event `allowed`, no percent): the query returns one `five_hour` window from a run, `level: "ok"`, `usedPercent: null` (**a:no-number**), its reset in ms. The view says "under Claude Code's warning line", a reset time, "from a run", and no `%`.
- **b** (`allowed_warning`, utilization 0.91): the query and the view say 91% (**b:91**).
- **c** (`rejected`): `level: "reached"`, no percent; the view says "limit reached".
- **d** (Alice's run, then Bob talks to his own finished coder): Alice's run leaves Bob's row empty (**d:no-claude-window**); Bob's talk writes his row at 50% and leaves Alice's.
- **e**: a look on the same sign-in keeps the run's window and adds the plan (**e:keeps-the-runs-window**); account B's run clears account A's window (**e:switch-clears**); the real probe on an empty home says `signed-out`; a minute later on an API key, `api-key` with no window.
- **f**: an older event from account A, written after account B's newer one, leaves B's (**f:newer-kept**); a run that started before a look found an API key brings no window back (**f:old-run**); a write that throws leaves the run completed and the row unchanged (**f:write-throws**).
- **g** (owed by a person): Jake's own Claude sign-in, a real run, then Usage beside Claude Code's `/status`. No CI has a sign-in, so until it is run the verdict is *goal met except leg g*.

**Anti-game:**
- No assertion reads Shift Manager's modules or stubs the query. Rows are read through `harnessUsage` over the Lab's HTTP door, and the view in a browser.
- Runs go through the real chain: Shift Coordinator, task board, harness manager, `claudeCodeAgent`, `onUsage`, the writer. Only the SDK module is replaced.
- The empty-home and API-key looks run the real Agent SDK probe.

**Model:** n/a (scripted Shift Coordinator and SDK).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-shows-claude-usage-left/run.mts` (about 100 s: leg e waits out the minute between looks).

**Controls:** each patches a module as the Lab loads it (`controls.mts`).
- `GOAL_CONTROL=no-scale`: the fraction is stored as sent. Must fail **b:91**.
- `GOAL_CONTROL=absent-as-zero`: an event with no percent is stored as 0%. Must fail **a:no-number**.
- `GOAL_CONTROL=fan-out`: the usage record is one org-wide row. Must fail **d:no-claude-window**.
- `GOAL_CONTROL=read-replaces-run`: a look replaces every window, the run's too. Must fail **e:keeps-the-runs-window**.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-23 | claude/project-thread-3x3z3h (pre-PR) | n/a | PASS (goal met except leg g) | 97 s. a: `five_hour`, 300 min, `ok`, no percent; view "under Claude Code's warning line", "from a run, a few seconds ago". b: 91 `warning`, "91% used". c: `reached`, "limit reached". d: Alice's run left Bob 0 windows; his talk wrote 50%. e: kept the run's window, plan max; account B cleared A; empty home `signed-out`; API key `api-key`, no window. f: B's window kept over A's late event; old run after the API-key look, 0 windows; the throwing write's run completed. g owed. |
| 2026-10-23 | same, `GOAL_CONTROL=no-scale` | n/a | FAIL (expected) | **b:91**: the query and the view say 0.91%; d's talk reads 0.5. |
| 2026-10-23 | same, `GOAL_CONTROL=absent-as-zero` | n/a | FAIL (expected) | **a:no-number**: "0% used"; c, e and f show 0% too. |
| 2026-10-23 | same, `GOAL_CONTROL=fan-out` | n/a | FAIL (expected) | **d:no-claude-window**: Alice's run wrote Bob's row; a and b read c's window from the shared row. |
| 2026-10-23 | same, `GOAL_CONTROL=read-replaces-run` | n/a | FAIL (expected) | **e:keeps-the-runs-window**: the look left 0 windows; the view's looks in a, b and c emptied their rows too. |
