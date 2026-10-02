# shift-manager › it briefs and talks with the chief of staff

**Issue:** FIX-1722

**Outcome:** A person opening any Lab in Shift Manager lands on Chief of Staff. They see a summary of what waits on them and what is running that agrees with the store, can answer those asks there, and can talk to the Lab's chief-of-staff seat, with every line and reply being what that seat's session holds. A Lab with no chief of staff still lands there, on the summary and a line saying how to add one.

**Input:** two Labs, each served by Shift Manager's start script.

- The fixture desk (`lab/`): one team, `desk`, with a seat that asks a person (the turn goal's `asker` kind) and a seat named `chief-of-staff` on the built-in `agent` kind with a real model, in one channel with one board. The check raises two approvals through the asker's own action route before the page opens, so the Lab reopens them when they are answered.
- DevTeam's profile (`labs/shift-manager/teams/devteam`), which declares no chief of staff, for **no CoS**.

The seat, channel and board names are read from the tree at run time. Tokens are fresh per run.

**Signal:** each failure is tagged `[<lab>] <leg>`.

- **landing**: `/` and an unknown path draw the Chief of Staff view, its sidebar entry first and current.
- **summary**: the needs-you count equals the store's pending asks, every one is listed, and the stream's running and needs-you counts equal its stored rows and its members' asks.
- **inline**: Approve on one summary item leaves one fewer pending suspension in the store, and both the summary and Inbox drop it.
- **talk**: a fresh token typed to the chief of staff is a user item in one of that seat's direct sessions the moment *delivered* is drawn, and the reply on screen is that session's next assistant item, by id. No reply is drawn that the session doesn't hold.
- **again**: a reload draws the same line and reply.
- **no CoS**: DevTeam lands on the view with its summary and the named state in place of the composer.
- **reach**: the pages throw nothing.

**Anti-game:** the check never reads Shift Manager's state. Its oracles are each Lab's store, read through the Lab's routes with the check's own requests: the asks' suspension items, the board's rows, the person's session listing and the chief of staff's session items. The model's words aren't graded, only that the screen shows the item the session stored. *Delivered* is graded at the instant it is drawn.

**Model:** real — `openai/gpt-5.4-mini` on the built-in `agent` kind, resolved from the environment. With none of `AI_GATEWAY_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY` set, the check fails and says so, rather than passing.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-briefs-and-talks-with-the-chief-of-staff/run.mts`

**Controls:** each rebuilds Shift Manager with one source module swapped for a module under `controls/`. The build fails if the swap never fired.

- `GOAL_CONTROL=optimistic-reply`: `src/lib/cos.ts` is swapped; the composer draws the line and a canned reply without calling the door. Must fail at **talk** ("delivered was drawn while no session … held a user item with the token").
- `GOAL_CONTROL=static-brief`: `src/lib/derive.ts` is swapped; the summary's asks are written in at the first read. Must fail at **inline**, where the store drops to one and the summary stays at two.

**Before-state:** `GOAL_PAGES=<dir>` serves pages built elsewhere instead of building them. Pages built before the view existed fail **landing** and everything after it.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-01 | 744a2f96b+wip | openai/gpt-5.4-mini (vercel gateway) | PASS | Summary 2 need you / 2 pending, `desk.front` 0 running. Approve from the summary: store 2 → 1, summary 2 → 1, Inbox 1. The line was held in a fresh `desk.chief-of-staff` session when *delivered* was drawn; the stored reply was drawn by its id, and again after a reload. DevTeam lands on the view with the summary and the no-chief-of-staff line. |
| 2026-10-01 | 744a2f96b+wip | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `optimistic-reply`, expected) | Only `[desk] talk`: delivered was drawn while no session of desk.chief-of-staff held a user item with the token. |
| 2026-10-01 | 744a2f96b+wip | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `static-brief`, expected) | Only `[desk] inline`: after Approve the summary says 2 need you while the store holds 1, and still lists the answered ask. |
| 2026-10-01 | f2d2c7278+wip (main merged; review fixes) | openai/gpt-5.4-mini (vercel gateway) | PASS | After the merge with main and the review round: summary 2 / 2 pending, Approve 2 → 1 in store, summary and Inbox; line held at *delivered* in a fresh `cos_<hex>` session, reply drawn by id and again after a reload; DevTeam's no-chief-of-staff state. |
| 2026-10-01 | f2d2c7278+wip (main merged; review fixes) | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `optimistic-reply`, expected) | Only `[desk] talk`, as before. |
| 2026-10-01 | f2d2c7278+wip (main merged; review fixes) | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `static-brief`, expected) | Only `[desk] inline`: 2 shown while the store holds 1, and the answered ask still listed. |
