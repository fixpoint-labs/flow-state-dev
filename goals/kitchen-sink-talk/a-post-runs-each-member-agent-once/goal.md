# kitchen-sink-talk › a post runs each member agent once

**Issue:** FIX-1590 (VG of the spec's PLAN; the epic FIX-1592's leg b); re-pointed by FIX-1611

**Outcome:** When a person posts to `support.help` from the kitchen-sink page, the one specialist the channel's route picks runs once on the post and no other member runs, and that run is there in the specialist's conversation after a reload.

**Re-pointed (FIX-1611).** The folder name is kept so its verdict history stays in one place. Until FIX-1611 this read `support.desk`, where every agent member ran on each post. The team now has one routed channel, so the check asks the question that roster answers: the picked specialist once, nobody else.

**Input:** `fixtures/input.json`: the channel, the specialist a post routes to (`support.accounts`), the three members it passes over (`support.devices`, `support.fsd`, `support.general`), the `[route:<member>]` tag the scripted route reads, the scenario marker the scripted model keys on and the reply marker it writes. Held-out: each post carries a fresh token per run, and only that token is graded, so a conversation another run left behind can never be the one that passes. A second post, with different text, must land in the same conversation and pass too.

**Signal:** one real browser against kitchen-sink's **production build** (built by the run, never assumed), served by `next start` on the scripted model, the in-memory store and **no model key**. Everything graded is read off the page **after a reload**, by opening every conversation the seat lists in the rail.

- **support.accounts**: exactly one listed conversation holds the first post's token; it holds the post once, as the seat's `user` turn, with an `assistant` reply carrying `[reply:wake]` right under it. After a second post and a reload, that same conversation holds the second post the same way, and still holds the first.
- **others**: none of `support.devices`', `support.fsd`'s or `support.general`'s conversations holds either token.

**Anti-game:** no assertion on the reply's words past its marker, on the route's output, on the fan-out's output, on a dispatch handle, on the transient name-only line, on a package test or on a CLI run. The seats' conversations are read off the page as drawn, after a reload, so a streamed copy cannot pass. Before each reload the run polls the server until the answer lands; that wait is not graded.

**Model:** n/a. kitchen-sink's scripted model answers the seats and picks the route (epic FIX-1592 D3). The goal is who ran, not what they said. Keyless: the server runs with `AI_GATEWAY_API_KEY` empty.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/a-post-runs-each-member-agent-once/run.mts`

**Controls:** on the same command. The app honours each only under `KITCHEN_SINK_TEST_MODE=1`.

- `GOAL_CONTROL=name-only-notify`: the wake replaced by a line naming each member, and no seat run. Must FAIL at **support.accounts**, and at nothing else.
- `GOAL_CONTROL=no-route`: the channel's `routing:` lines taken off before the channel is bound, so every member hears every post. It is the **others** leg's control, which a fresh server could otherwise pass on empty lists. Must FAIL at **others**, and at nothing else.
- `GOAL_CONTROL=no-author-filter`: the wake's author filter dropped, so a post a seat wrote wakes the members too. It is leg c's control (FIX-1594); a post from the page carries no author, so here it must leave **every** leg green. The members the route passed over do run under it, on the specialist's answer landing as a line, but that line carries no token, and grading it is leg c's job: its red is `goals/kitchen-sink-talk/agent-replies-in-the-channel/`'s **woken-once** and `apps/kitchen-sink/test/channel-wake.test.ts`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-26 | FIX-1590 branch on d5b7ad597 | scripted | FAIL (control) | **`GOAL_CONTROL=name-only-notify`, taken first, so the PASS below means something.** Failed at **support.iris** and **support.otto** and nothing else: after each reload, 0 of each seat's 0 conversations held the first post, and 0 held the second. The **others** leg stayed green. |
| 2026-09-26 | FIX-1590 branch on d5b7ad597 | scripted | **PASS** | First verdict, `next start` on a fresh production build, keyless. After a reload, `support.iris` and `support.otto` each list one conversation, a run of `support.desk`, holding `devuser in support.desk: [scenario:wake] wake-token-a… can someone look at the refund queue?` with a `[reply:wake]` reply under it. The second post landed in that same conversation, answered once. `support.ada`, `support.grace` and `support.wren` hold nothing with either token. |
| 2026-09-26 | FIX-1590 branch on d5b7ad597 | scripted | **PASS** (control) | `GOAL_CONTROL=no-author-filter`: every leg green, as it must be. A post from the page has no author, so this control changes nothing here. Its own red is `channel-wake.test.ts` (a post by `support.otto` runs `support.iris`). |
| 2026-09-26 | FIX-1590 branch on d5b7ad597 | scripted | FAIL (blast radius) | The **others** leg is a negative that the fresh server can pass on empty lists, so it was reddened on purpose: a temporary, uncommitted `onChannelPost` on the `desk-clerk` kind plus a `desk-clerk` wake in the map. Failed at **others** only (`support.ada` and `support.grace` each held 1 conversation with the token); **support.iris** and **support.otto** stayed green. Reverted. |
| 2026-09-26 | FIX-1602 branch on a52bab37a, uncommitted | scripted | FAIL (control) | Re-run on kitchen-sink moved onto Workforce's `wakeMemberSeats`. **`GOAL_CONTROL=name-only-notify`, taken first.** Failed at **support.iris** and **support.otto** only (0 of each seat's 0 conversations held either post); **others** green. |
| 2026-09-26 | FIX-1602 branch on a52bab37a, uncommitted | scripted | **PASS** | Same thinned app, fresh production build, keyless. `support.iris` and `support.otto` each list one run of `support.desk` holding both posts with a `[reply:wake]` reply under each; `support.ada`, `support.grace`, `support.wren` hold neither token. |
| 2026-09-27 | FIX-1611 branch on 315976e5f, uncommitted | scripted | FAIL (control) | **Re-pointed** at `support.help`, routed specialist `support.accounts`, the other three specialists as **others**. **`GOAL_CONTROL=name-only-notify`, taken first.** Failed at **support.accounts** only: after each reload, 0 of its 0 conversations held the first post, and 0 the second. **others** green. |
| 2026-09-27 | FIX-1611 branch on 315976e5f, uncommitted | scripted | FAIL (control) | **Re-pointed.** `GOAL_CONTROL=no-route`, new with the re-point: the **others** leg's own control, in place of the temporary `desk-clerk` wake the FIX-1590 blast-radius row used. Failed at **others** only: `support.devices`, `support.fsd` and `support.general` each held 1 conversation with the posts' tokens. **support.accounts** green. |
| 2026-09-27 | FIX-1611 branch on 315976e5f, uncommitted | scripted | **PASS** (control) | **Re-pointed.** `GOAL_CONTROL=no-author-filter`: every leg green, as it must be. The three passed-over members each list 1 conversation under it, holding neither token: they ran on `support.accounts`' answer line, which is leg c's to grade. |
| 2026-09-27 | FIX-1611 branch on 315976e5f, uncommitted | scripted | **PASS** | **Re-pointed.** Fresh production build, keyless. After a reload `support.accounts` lists one run of `support.help` holding both posts (`devuser in support.help: [route:support.accounts] [scenario:wake] wake-token-a… can someone look at the refund queue?` then the routed-turn line) with a `[reply:wake]` reply under each; `support.devices`, `support.fsd` and `support.general` list 0 conversations. |
