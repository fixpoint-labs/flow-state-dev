# kitchen-sink-talk › it keeps both sides across a reload

**Issue:** FIX-1585 (V6 and V7 of the spec's PLAN; the otto leg is the epic FIX-1592's leg a for `support.otto`)

**Outcome:** From the kitchen-sink page, a person talks to an agent seat and posts to a channel, and after a reload both conversations are still there, showing who said what. The line posted to `support.desk` reads as `devuser`. The message sent to `support.otto` shows as the person's turn, with the seat's reply under it. A seat whose kind takes no messages (`support.wren`) has no composer and says why.

**Input:** `fixtures/input.json`: the channel and its expected label, the agent seat and the scenario marker its scripted reply keys on, the read-only seat, and the port. Held-out: the posted line and the message carry a fresh token each run, and are graded by that token, so a line another run or test left in the shared channel can never be the one that passes. `GOAL_CHANNEL` and `GOAL_SEAT` point the same legs at another built-in channel and agent seat; a correct implementation still passes.

**Signal:** one real browser against kitchen-sink's **production build** (built by the run, never assumed), served by `next start` on the scripted model and the in-memory store. Everything graded is read **after a reload**, so only what the server kept can pass.

- **desk** (V6): post a unique line from the channel's panel; reload; the channel's transcript holds exactly one copy, labelled `devuser`.
- **otto** (V7): "New conversation" on the seat's row, send a unique message; reload and reopen that conversation; a `user` message holds the text and an `assistant` message carrying the scripted reply marker sits below it.
- **wren** (V7): the read-only seat's panel has no composer and shows a non-empty reason.

**Anti-game:** a hollow pass would grade the page before the reload (the composer's own state or a streamed copy would pass), grade any line in the shared channel rather than this run's token, or run the seat leg on a `desk-clerk` seat, whose reply echoes the note and so hides a lost question. The check reads after the reload only, grades by the run's token, runs the seat leg on the `agent` kind, and checks the message's **role**, not only its text. A control that leaves its leg green, or reddens another leg, fails the run.

**Model:** n/a. kitchen-sink's scripted model answers the seat (epic FIX-1592 D3). The goal is what is kept and who said it, not what the reply says. Keyless.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/keeps-both-sides-across-a-reload/run.mts`

**Controls:** on the same command. Each strips one kind of kept item from everything the page is served (every session read and every action stream, before and after the reload), which is what the page sees when the server keeps none.

- `GOAL_CONTROL=no-post-item`: no `channel-post` component items. Must FAIL at **desk** only.
- `GOAL_CONTROL=drop-user-message`: no `user` message items. Must FAIL at **otto** only.

The controls act at the network, not in the server, so the product carries no switch for them. The server half is proved by hand mutation, recorded below: `run` without its `userMessage`, rebuilt, fails the otto leg.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-25 | 977e411e8 + goal files (pre-PR) | n/a (scripted, keyless) | PASS | Production build, `next start`, headless Chromium. desk: after a reload, `support.desk` shows "goal line 36e9e560" labelled `devuser`, once. otto: after a reload, conversation `sess_1790375823702_6e3814b1c27b1` shows the message as the `user` turn and the `[reply:talk-to-seat]` reply under it. wren: no composer, reason "This seat runs rows from a board and has nothing to answer with, so it takes no messages." An earlier attempt failed at wren only because the check read the panel before the wren conversation replaced otto's; the check now waits for the wren conversation to be current. |
| 2026-09-25 | same | n/a | FAIL (expected) | `GOAL_CONTROL=no-post-item`: `[desk] after the reload, support.desk's transcript holds 0 copies of the posted line "goal line b55c6319" (want 1); it shows 0 lines`. No other leg failed. |
| 2026-09-25 | same | n/a | FAIL (expected) | `GOAL_CONTROL=drop-user-message`: `[otto] after the reload, support.otto's conversation does not hold the person's message ... as their turn (roles on screen: assistant)`. No other leg failed. |
| 2026-09-25 | same, with `run`'s `userMessage` removed by hand (restored after) | n/a | FAIL (expected) | Server-side proof of the otto control: rebuilt without the line, `[otto] ... does not hold the person's message ... as their turn (roles on screen: assistant)`. desk and wren green. |
| 2026-09-25 | same | n/a | PASS | Held-out: `GOAL_CHANNEL=support.ada-wren GOAL_SEAT=support.iris`. ada-wren shows "goal line 58d8d0aa" labelled `devuser`, once; iris's conversation keeps the message as the user's turn with the reply under it; wren as above. |
