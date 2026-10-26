# shift-manager › it shows Codex usage left

**Issue:** FIX-2141

**Outcome:** A person running Shift Manager on their own subscription opens Usage and sees, for Codex, the percent used and reset time of every window Codex reports, with where it came from and how old it is. Anything else that wants those numbers reads them through the one `harnessUsage` query, and gets what the view shows.

**Input:** DevTeam's tree and `openLab`, served by Shift Manager's command (`lab/fsdev.config.mts`), with a Codex usage reader whose setup the check rewrites before each leg: the real Codex CLI from the pinned `@openai/codex` (0.152.1) over an empty `CODEX_HOME` and one where `codex login --with-api-key` stored a fake key, or `lab/scripted-app-server.mjs`, which answers in the shape the pinned CLI's `generate-ts` publishes. Three people boot with a stored reading: one stamped ten minutes ahead, one three hours old, one two minutes old. Each leg reads as its own person, so no leg reads another's row.

**Signal:** each failure tagged `<leg>:<assertion>`.

- **a** (signed in, scripted): the view opens Usage, which refreshes; the query then returns two windows, 300 and 10 080 minutes, with the scripted percents and resets, and a `checkedAt` within the run. The view shows both percents and says the numbers are from Codex. **a:leaves-the-stored-one**: a refresh over the reading stamped ahead of it leaves that reading.
- **b** (signed out, real CLI) and **c** (API key, real CLI): the query says `signed-out` / `api-key` with no window; the view's card says why and shows no `%` anywhere.
- **d** (scripted, the 5-hour window's reset already past): the query says `rolledOver: true`, and the view shows "reset at …, not checked since" with no percent.
- **e** (stored three hours ago, read without refresh): the query's `ageMs` is at least three hours (**e:age**), and no Codex process starts (**e:no-vendor-call**).
- **g** (scripted reader that never answers, stored row two minutes old): two looks at once and a third after them start one Codex process (**g:one-child**); all three return the stored percent with `refreshError` "Codex did not answer within 10 s".
- **h** (scripted): a signed-in read, then a minute later the same person on an API key; the query returns one Codex row, `api-key`, with no window from the earlier account.
- **f** (owed by a person): Jake's own ChatGPT sign-in shows the same percents as `codex` `/status` in the same minute. No CI has a sign-in, so until it is run the verdict is *goal met except leg f*, and the signed-in parse is proven against the CLI's published type only.

**Anti-game:**
- No assertion reads Shift Manager's modules or stubs the query. Rows are read through `harnessUsage` over the Lab's HTTP door, and the view in a browser.
- Legs b and c run the real Codex CLI; leg a's answers come from the published protocol shape, not from the reader's expectations.
- The child count is the scripted app-server's own log of starts, so a reader that skipped the throttle would show there.

**Model:** n/a.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-shows-codex-usage-left/run.mts` (about 90 s: leg h waits out the minute between refreshes, and leg g the 10 s timeout).

**Controls:** each patches `packages/harness-manager/src/harness-usage.ts` as the Lab loads it (`controls.mts`).
- `GOAL_CONTROL=ignore-age`: every reading is fresh and nothing rolls over. Must fail **d:rolled-over** and **e:age**.
- `GOAL_CONTROL=unavailable-as-zero`: a harness with no number is stored as one window at 0%. Must fail **b:no-percent** and **c:no-percent**.
- `GOAL_CONTROL=last-write-wins`: the writer takes any reading, however old. Must fail **a:leaves-the-stored-one**.
- `GOAL_CONTROL=throttle-ignores-failures`: the minute is counted from the last good reading. Must fail **g:one-child**.
- `GOAL_CONTROL=key-by-account`: each account gets its own row. Must fail **h:no-earlier-percent**.

The spec names *no vendor call* as where `ignore-age` fails leg e. Ignoring age makes no call, so it fails on the age itself (**e:age**); **e:no-vendor-call** stays as its own assertion.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-23 | claude/project-thread-8qgqol (pre-PR) | n/a | PASS (goal met except leg f) | 81 s. a: two windows (300 min at 42%, 10 080 min at 7%) on the query and the view, "from Codex, checked a few seconds ago"; the reading stamped ahead stays at 77%. b: real CLI, `signed-out`, "Codex is not signed in: not available automatically", no `%`. c: real CLI, `api-key`, "Codex uses an API key: no subscription limit", no `%`. d: "5-hour reset at 20:12, not checked since". e: ageMs 10 826 291, no Codex process. g: 1 child for three looks, stored 33% kept, "Codex did not answer within 10 s". h: one `codex` row, `api-key`, no window. f owed. |
| 2026-10-23 | same, `GOAL_CONTROL=ignore-age` | n/a | FAIL (expected) | **d:rolled-over** (query `rolledOver: false`, the view shows "91% used") and **e:age** (ageMs 0). |
| 2026-10-23 | same, `GOAL_CONTROL=unavailable-as-zero` | n/a | FAIL (expected) | **b:no-percent** and **c:no-percent**: one 0% window each; h fails the same way. |
| 2026-10-23 | same, `GOAL_CONTROL=last-write-wins` | n/a | FAIL (expected) | **a:leaves-the-stored-one**: the 5% refresh replaced the 77% reading stamped ahead of it. |
| 2026-10-23 | same, `GOAL_CONTROL=throttle-ignores-failures` | n/a | FAIL (expected) | **g:one-child**: three looks started 2 Codex processes. |
| 2026-10-23 | same, `GOAL_CONTROL=key-by-account` | n/a | FAIL (expected) | **h:no-earlier-percent**: two rows, `codex` (`api-key`) and `codex-<hash>` still holding the signed-in windows; a and d fail too, since the view's `codex` row is never written. |
| 2026-10-23 | claude/project-thread-3x3z3h (FIX-2142, pre-PR) | n/a | PASS (goal met except leg f) | 90 s, rerun over the reworked writer (run windows, `accountAt`); controls re-pointed at its new lines. All five controls fail on their assertions as before. |
