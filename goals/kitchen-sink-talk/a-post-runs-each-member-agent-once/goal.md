# kitchen-sink-talk › a post runs each member agent once

**Issue:** FIX-1590 (VG of the spec's PLAN; the epic FIX-1592's leg b)

**Outcome:** When a person posts to `support.desk` from the kitchen-sink page, each agent seat in that channel runs once on the post and no other seat runs, and each run is there in that seat's conversation after a reload.

**Input:** `fixtures/input.json`: the channel, its two agent members (`support.iris`, `support.otto`), its three other members (`support.ada`, `support.grace`, `support.wren`), the scenario marker the scripted model keys on and the reply marker it writes. Held-out: each post carries a fresh token per run, and only that token is graded, so a conversation another run left behind can never be the one that passes. A second post, with different text, must land in the same conversation of each agent and pass too.

**Signal:** one real browser against kitchen-sink's **production build** (built by the run, never assumed), served by `next start` on the scripted model, the in-memory store and **no model key**. Everything graded is read off the page **after a reload**, by opening every conversation the seat lists in the rail.

- **support.iris**, **support.otto**: exactly one listed conversation holds the first post's token; it holds the post once, as the seat's `user` turn, with an `assistant` reply carrying `[reply:wake]` right under it. After a second post and a reload, that same conversation holds the second post the same way, and still holds the first.
- **others**: none of `support.ada`'s, `support.grace`'s or `support.wren`'s conversations holds either token.

**Anti-game:** no assertion on the reply's words past its marker, on the fan-out's output, on a dispatch handle, on the transient name-only line, on a package test or on a CLI run. The seats' conversations are read off the page as drawn, after a reload, so a streamed copy cannot pass. Before each reload the run polls the server until the answers land; that wait is not graded.

**Model:** n/a. kitchen-sink's scripted model answers the seats (epic FIX-1592 D3). The goal is who ran, not what they said. Keyless: the server runs with `AI_GATEWAY_API_KEY` empty.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/a-post-runs-each-member-agent-once/run.mts`

**Controls:** on the same command. The app honours each only under `KITCHEN_SINK_TEST_MODE=1`.

- `GOAL_CONTROL=name-only-notify`: today's stub back, a line naming each member and no seat run. Must FAIL at **support.iris** and **support.otto**, and at nothing else.
- `GOAL_CONTROL=no-author-filter`: the wake's author filter dropped, so a post a seat wrote wakes the agents too. It is leg c's control (FIX-1594); a post from the page carries no author, so here it must leave **every** leg green. Its own red is `apps/kitchen-sink/test/channel-wake.test.ts`, where a post by `support.otto` then runs `support.iris`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-26 | FIX-1590 branch on d5b7ad597 | scripted | FAIL (control) | **`GOAL_CONTROL=name-only-notify`, taken first, so the PASS below means something.** Failed at **support.iris** and **support.otto** and nothing else: after each reload, 0 of each seat's 0 conversations held the first post, and 0 held the second. The **others** leg stayed green. |
| 2026-09-26 | FIX-1590 branch on d5b7ad597 | scripted | **PASS** | First verdict, `next start` on a fresh production build, keyless. After a reload, `support.iris` and `support.otto` each list one conversation, a run of `support.desk`, holding `devuser in support.desk: [scenario:wake] wake-token-a… can someone look at the refund queue?` with a `[reply:wake]` reply under it. The second post landed in that same conversation, answered once. `support.ada`, `support.grace` and `support.wren` hold nothing with either token. |
| 2026-09-26 | FIX-1590 branch on d5b7ad597 | scripted | **PASS** (control) | `GOAL_CONTROL=no-author-filter`: every leg green, as it must be. A post from the page has no author, so this control changes nothing here. Its own red is `channel-wake.test.ts` (a post by `support.otto` runs `support.iris`). |
| 2026-09-26 | FIX-1590 branch on d5b7ad597 | scripted | FAIL (blast radius) | The **others** leg is a negative that the fresh server can pass on empty lists, so it was reddened on purpose: a temporary, uncommitted `onChannelPost` on the `desk-clerk` kind plus a `desk-clerk` wake in the map. Failed at **others** only (`support.ada` and `support.grace` each held 1 conversation with the token); **support.iris** and **support.otto** stayed green. Reverted. |
