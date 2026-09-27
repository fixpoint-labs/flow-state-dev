# kitchen-sink-talk › it answers a clerk note or files it

**Issue:** FIX-1611 (VG of the spec's PLAN), re-pointed from FIX-1589 (the epic FIX-1592's leg a). The path is kept: retained specs cite it.

**Outcome:** A person who opens kitchen-sink finds one support channel and four specialists named for what they handle. A question gets one specialist's answer in the channel; a case that needs a person is filed onto `escalations` and the specialist says so. Nobody gets their own words back, and after a reload the answer is still under the specialist's name and a filed case is a row in the team panel.

**Input:** `fixtures/input.json`: the channel and its board, the one seat kind, the four specialists with their `description:` lines, the specialist both legs aim at (`support.devices`), the scenario markers the scripted model keys on and the reply markers each writes, and the live leg's five posts. Held-out: each post carries a fresh token per run, and only that token is graded, so a line or row another run left behind can never be the one that passes. `GOAL_SEAT` aims both legs at another specialist; a correct build still passes.

**Signal:** one real browser against kitchen-sink's **production build** (built by the run, never assumed), served by `next start` on the scripted model, the in-memory store and **no model key**. Each post is routed with `[route:<seat>]`, which the scripted route honours. Everything graded is read off the page as drawn.

- **roster**: the rail's Channels section lists one kind, `channel`, holding one channel, `support.help`; its Seats section lists one kind, `agent`, holding exactly the four specialists. Opened, each shows the kind `agent` and its `description:` as the fixture has it. No "Hire another" anywhere on the page.
- **answer**: post a question with `[scenario:wake]` and a fresh token; reload. The channel shows exactly one line after the post, labelled with the seat, carrying `[reply:wake]` and not the token.
- **file**: post a case with `[scenario:needs-a-person]` and a fresh token; reload. Graded as two assertions: **file:line**, exactly one line after the post, labelled with the seat, carrying `[reply:escalated]`; **file:row**, the team panel's `escalations` board shows exactly one row carrying the token.
- **warning**: the boot warns that `support.help`'s `escalations` is unattended, and warns about no other board (filing is not draining).

**Anti-game:** no assertion on the generated map, the ledger or the request log: the rail, the channel and the board column as drawn. A "filed" line alone never passes: the row is its own assertion. The reply must not carry the post's token, which is what an echo cannot avoid. Only this run's tokens count. Waiting before the reload polls the server until the seat's line lands and the row is written; none of that is graded.

**Model:** n/a for the graded legs: kitchen-sink's scripted model answers and routes (epic FIX-1592 D3). The goal is which path ran and what was kept, not what the reply says. Keyless: the server runs with `AI_GATEWAY_API_KEY` empty.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it/run.mts`

**Live:** `GOAL_LIVE=1` on the same command, with `AI_GATEWAY_API_KEY`. After the scripted legs, the same build served out of test mode, on the app's own models and route. Three posts that plainly need a person must each add one row to `escalations`; two that do not must add none; each must get one answer line.

**Controls:** on the same command. The app honours each only under `KITCHEN_SINK_TEST_MODE=1` (`apps/kitchen-sink/lib/goal-control.ts`).

- `GOAL_CONTROL=no-landing` (`apps/kitchen-sink/lib/channel-landing-control.ts`): the agent kind swapped for one that hears posts and answers with the seat's tools, and lands nothing. A text answer no longer lands, and the specialist's "filed" is a text answer too, so it must FAIL at **answer** and **file:line**. The row still lands, so **file:row** stays green: nothing else.
- `GOAL_CONTROL=no-filing` (`apps/kitchen-sink/lib/escalate-control.ts`): `escalate` swapped for a stand-in that says it filed and files nothing. Must FAIL at **file:row** only: the line still says it filed.
- Today's `main`, before this issue, must FAIL at **roster**: it lists three channels on two kinds, and six seats on three kinds. Its "Hire another" is never reached there: the button draws only on an opened seat, and none of the four specialists exists to open. That assertion's own red state is the button put back by hand, recorded below.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-26 | FIX-1589 branch on 081f6fe83 | scripted | FAIL (control) | **`GOAL_CONTROL=echo`, taken first, so the PASS below means something.** Failed at **answer** and **file** and nothing else: after the reload the conversation held no user turn (roles on screen: assistant), no reply carried `[clerk:answered]`, a reply handed the note back with its token, no reply carried `[clerk:filed]`, and the escalations board held 0 rows with the run's token. The boot-warning check passed. |
| 2026-09-26 | FIX-1589 branch on 081f6fe83 | scripted | **PASS** | First verdict, `next start` on a fresh production build, keyless. **answer:** after a reload, `support.ada`'s conversation keeps the note as the person's turn with `[front desk] [clerk:answered] …` under it, and no reply carries the token. **file:** after a reload, the team panel's escalations board shows one row `Filed from the desk: clerk-token-f6bdf9028f6` and the reply reads `[front desk] [clerk:filed] Filed onto escalations.` The boot still warns `escalations` is unattended. |
| 2026-09-26 | FIX-1589 branch on 081f6fe83 | scripted | **PASS** | Held-out: `GOAL_SEAT=support.grace GOAL_DESK=back GOAL_BOARD=followups`. `[back desk] [clerk:answered] …` kept under the note; the followups board shows the token's row assigned to `followup-runner`, and the reply reads `[back desk] [clerk:filed] …`. |
| 2026-09-26 | FIX-1589 review round 1 | scripted | FAIL (control) | Re-taken after Codex's review fixes (`seatId` from the roster row, the scripted reply reading the tool's result, the echo control moved to `lib/`). `GOAL_CONTROL=echo` fails the same five assertions at **answer** and **file**, and nothing else. |
| 2026-09-26 | FIX-1589 review round 1 | scripted | **PASS** | Same run shape. `[front desk] [clerk:answered] …` kept under the note; escalations shows one row with the run's token; the reply reads `[front desk] [clerk:filed] Filed onto escalations.` Held-out (`support.grace`, `back`, `followups`): **PASS**, the row assigned to `followup-runner`. |
