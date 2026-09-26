# kitchen-sink-talk › it answers a clerk note or files it

**Issue:** FIX-1589 (VG of the spec's PLAN; the epic FIX-1592's leg a for `support.ada`)

**Outcome:** A person who asks the desk clerk something from the kitchen-sink page gets an answer a model wrote, or sees their note filed onto the board that fits it, and never gets their own words back. After a reload the note is still their turn, the reply is under it, and a filed note is a row in the team panel.

**Input:** `fixtures/input.json`: the clerk seat, its desk, the two scenario markers the scripted model keys on and the reply markers each writes, and the channel and board a filing lands on. Held-out: each note carries a fresh token per run, and only that token is graded, so a row or reply another run left behind can never be the one that passes. `GOAL_SEAT` and `GOAL_DESK` point both legs at another desk-clerk seat (`support.grace`, `back`); `GOAL_BOARD=followups` aims the file leg at the other board. A correct implementation still passes.

**Signal:** one real browser against kitchen-sink's **production build** (built by the run, never assumed), served by `next start` on the scripted model, the in-memory store and **no model key**. Everything graded is read **after a reload**.

- **answer**: "New conversation" on the seat, send a note with `[scenario:clerk-answer]` and a fresh token; reload and reopen it. A `user` message holds the note, and an `assistant` message below it starts with the seat's desk tag (`[front desk]`) and carries `[clerk:answered]`, and no reply carries the token.
- **file**: send a note with `[scenario:clerk-file]` and a fresh token; reload. The team panel's `escalations` board (or `GOAL_BOARD`) shows exactly one row carrying the token, and the conversation's reply carries `[clerk:filed]`.
- The boot still warns that `escalations` is unattended (filing is not draining).

**Anti-game:** no assertion on the reply's words past its markers: the script wrote them. The reply must not carry the note's token, which is what an echo cannot avoid. The row is read off the team panel as drawn, not off the ledger or the request log, and only this run's token counts. Everything is read after the reload, so a streamed copy or the composer's own state cannot pass.

**Model:** n/a. kitchen-sink's scripted model answers the clerk (epic FIX-1592 D3). The goal is which path ran and what was kept, not what the reply says. Keyless: the server runs with `AI_GATEWAY_API_KEY` empty.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=echo`: the clerk's `answer` before this goal, the note handed back under the desk tag with no model, no filing and no kept turn. The app honours it only under `KITCHEN_SINK_TEST_MODE=1`. Must FAIL at **answer** and at **file**, and at nothing else.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-26 | FIX-1589 branch on 081f6fe83 | scripted | FAIL (control) | **`GOAL_CONTROL=echo`, taken first, so the PASS below means something.** Failed at **answer** and **file** and nothing else: after the reload the conversation held no user turn (roles on screen: assistant), no reply carried `[clerk:answered]`, a reply handed the note back with its token, no reply carried `[clerk:filed]`, and the escalations board held 0 rows with the run's token. The boot-warning check passed. |
| 2026-09-26 | FIX-1589 branch on 081f6fe83 | scripted | **PASS** | First verdict, `next start` on a fresh production build, keyless. **answer:** after a reload, `support.ada`'s conversation keeps the note as the person's turn with `[front desk] [clerk:answered] …` under it, and no reply carries the token. **file:** after a reload, the team panel's escalations board shows one row `Filed from the desk: clerk-token-f6bdf9028f6` and the reply reads `[front desk] [clerk:filed] Filed onto escalations.` The boot still warns `escalations` is unattended. |
| 2026-09-26 | FIX-1589 branch on 081f6fe83 | scripted | **PASS** | Held-out: `GOAL_SEAT=support.grace GOAL_DESK=back GOAL_BOARD=followups`. `[back desk] [clerk:answered] …` kept under the note; the followups board shows the token's row assigned to `followup-runner`, and the reply reads `[back desk] [clerk:filed] …`. |
| 2026-09-26 | FIX-1589 review round 1 | scripted | FAIL (control) | Re-taken after Codex's review fixes (`seatId` from the roster row, the scripted reply reading the tool's result, the echo control moved to `lib/`). `GOAL_CONTROL=echo` fails the same five assertions at **answer** and **file**, and nothing else. |
| 2026-09-26 | FIX-1589 review round 1 | scripted | **PASS** | Same run shape. `[front desk] [clerk:answered] …` kept under the note; escalations shows one row with the run's token; the reply reads `[front desk] [clerk:filed] Filed onto escalations.` Held-out (`support.grace`, `back`, `followups`): **PASS**, the row assigned to `followup-runner`. |
