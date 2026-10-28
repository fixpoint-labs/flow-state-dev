# standing-rules › it follows what the Rules page edits

**Issue:** FIX-1945; the page moved into each worker's settings in FIX-2007

**Outcome:** A person opens a worker from Shift Manager's Roster, goes to its **Settings**, and adds, edits or deletes a standing rule in its Rules section. The worker's next conversation follows the list as the page left it, and the page shows that same list after a reload. A worker on a custom flow has a settings page too, whose Rules section says it keeps no rules rather than offering an empty list. The old `/roster/<id>/rules` address opens the same page. The Shift Coordinator screen no longer draws the rules in its panel; a gear in its header opens the coordinator's settings, with its Rules.

**Input:** DevTeam's Shift Manager install, served by its own command over a store the run owns, opened in Chromium as its owner. The researcher (built-in `agent` flow) is the worker edited, and `eng.coder` (DevTeam's own `coder` flow) is the one that keeps none. The coordinator is the worker Shift Manager's `shiftCoordinatorOf` finds on the roster. The rule added is "Start every reply with `Page —`.", edited to "Start every reply with `Edited —`.". Held out: the markers and asks are constants the checks read.

**Signal:** each failure is tagged with its leg.

- **way-in**: every Roster row, `eng.coder`'s included, has a **Settings** button. The researcher's opens `/roster/researcher/settings` with its Rules, and `/roster/researcher/rules` opens that same page. `eng.coder`'s settings page says its flow doesn't keep standing rules.
- **empty** and **limits**: the view says the worker keeps none for you, offers to add one, and shows 20 rules and 300 characters.
- **add** and **edit**: after each, the page draws exactly that rule, marked *added here*.
- **reload**: after a reload the page draws the edited rule.
- **edit-is-followed**: 3 of 3 fresh conversations with the researcher open with `Edited —` and never mention `Page —`.
- **delete**: after the page's delete it draws the empty state, and 0 of 3 fresh conversations open with `Edited —`.
- **shiftCoordinator**: `/shift-coordinator` draws no RULES in its panel; the gear in its header opens `/roster/<coordinator's id>/settings` with that worker's Rules.
- **reach**: the page throws nothing.

**Anti-game:** the replies are read back from the sessions that stored them, by request id. The check never reads the rules record. A page that draws its edits without saving them passes add and edit, so the claim rests on reload and edit-is-followed, which only the Lab's list can satisfy.

**Model:** real: the researcher on `openai/gpt-5.4-mini`, through the environment's gateway. With no model credential the check says it is blocked.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/standing-rules/the-rules-page-edits-what-the-worker-follows/run.mts`

**Controls:** `GOAL_CONTROL=page-does-not-save` builds Shift Manager from a scratch copy whose `src/lib/rules.ts` edits its own copy of the list and never calls the rules action, so the page renders every change and saves none. The build fails if the patch matches nothing. It must fail **reload** and **edit-is-followed**, and stops before the old address, delete and shiftCoordinator.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-14 | PR A (#3316) + FIX-1945 PR B (uncommitted) | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `page-does-not-save`, expected) | Only `reload` (after a reload the page draws [], not the edited rule) and `edit-is-followed` (0 of 3 opened with `Edited —`: "Teams pin dependency versions to keep builds reproducible…"). |
| 2026-10-14 | same | openai/gpt-5.4-mini (vercel gateway) | PASS | `eng.coder` says its flow keeps no rules. The researcher's Rules opened empty with the limits, drew the add (*added here*) and the edit, and the edit again after a reload. 3/3 fresh conversations opened `Edited —` only; after the delete, 0/3. The Shift Coordinator's panel draws RULES for `chief-of-staff`. |
| 2026-10-14 | PR A (#3316) at 9d5157a3 + PR B | openai/gpt-5.4-mini (vercel gateway) | PASS | After `keepsRules` moved onto Workforce's `STANDING_RULES_FLOWS`: every leg as above. |
| 2026-10-14 | PR A (#3316) at 0b961183 + PR B | openai/gpt-5.4-mini (vercel gateway) | PASS | After Rules moved onto the inventory row's `rules` flag (published at boot from each worker flow's actions): every leg as above. |
| 2026-10-14 | FIX-2007 (uncommitted, on 9c201d9f) | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `page-does-not-save`, expected) | Only `reload` (the page draws [] after a reload) and `edit-is-followed` (0 of 3 opened with `Edited —`). |
| 2026-10-14 | same, Shift Manager source at 9c201d9f (main) | openai/gpt-5.4-mini (vercel gateway) | FAIL (expected: the check is ahead of the code) | `way-in`: 0 of 9 Roster rows have a Settings button, and `eng.coder` has none. |
| 2026-10-14 | FIX-2007 (uncommitted, on 9c201d9f) | openai/gpt-5.4-mini (vercel gateway) | PASS | Every Roster row has Settings, `eng.coder` included. The researcher's settings opened its Rules empty with the limits, drew the add and the edit, and the edit again after a reload; 3/3 fresh conversations opened `Edited —` only, and 0/3 after the delete. `/roster/researcher/rules` opens the same page; `eng.coder`'s says its flow keeps no rules. `/cos` draws no RULES in its panel, and its gear opens `/roster/chief-of-staff/settings` with its Rules. |
