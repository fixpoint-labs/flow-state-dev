# kitchen-sink-talk › an agent replies in the channel

**Issue:** FIX-1594 (VG of the spec's PLAN; the epic FIX-1592's leg c)

**Outcome:** A person posts to `support.desk`, and `support.otto`'s reply appears in that channel under its own name, is still there after a reload, and wakes nobody.

**Input:** `fixtures/input.json`: the channel, the seat that answers there (`support.otto`), the channel's two agent members (`support.iris`, `support.otto`), the scenario marker the scripted model keys on (`[scenario:reply-in-channel]`) and the marker it writes on otto's line (`[reply:in-channel]`). Held-out: each run posts two lines, each with a fresh `reply-token-…`, and only those tokens are graded, so a line another run or test left in the shared channel can never be the one that passes. The second post, with different text, must pass the same way.

**Signal:** one real browser against kitchen-sink's **production build** (built by the run, never assumed), served by `next start` on the scripted model, the in-memory store and **no model key**. Both posts go in from the channel's panel; everything graded is read off the page **after one reload**.

- **line**: for each token, the `support.desk` panel shows exactly one line carrying the token and `[reply:in-channel]`: otto's reply, kept by the channel.
- **author**: that line is labelled `support.otto`, not `devuser`.
- **woken-once**: `support.iris` and `support.otto` each list one run of `support.desk`, and in it each token appears in exactly one turn, the person's post (`devuser in support.desk: [scenario:reply-in-channel] …`). A second turn carrying the token is otto's line waking a seat.

**Anti-game:** no assertion on the reply's wording past its marker, which the script wrote; none on the tool's return value, a dispatch handle, a package test or a CLI run. Only this run's tokens count. The page is read after a reload, so only what the channel and the seats kept can pass. Before the reload the run polls the server until otto's line and both answers land, then waits 1.5s for a wrongly woken seat to run; none of that is graded.

**Model:** n/a. kitchen-sink's scripted model answers the seats (epic FIX-1592 D3): a step calling `post-to-channel` with no text, so the real tool runs, then a text step. Keyless: the server runs with `AI_GATEWAY_API_KEY` empty.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/agent-replies-in-the-channel/run.mts`

**Controls:** on the same command. The app honours each only under `KITCHEN_SINK_TEST_MODE=1` (`apps/kitchen-sink/lib/goal-control.ts`).

- `GOAL_CONTROL=no-author-filter` (FIX-1590's): the wake's author filter dropped. Otto's line is still signed, and now wakes both agents. Must FAIL at **woken-once**, and at nothing else.
- `GOAL_CONTROL=post-without-author` (`apps/kitchen-sink/lib/channel-post-control.ts`): the tool swapped for one that posts no author. The line reads `devuser`, so it must FAIL at **author**. A line with no author is a person's line to the fan-out, so it wakes both agents as well (the spec's BR-10: the author is what the filter reads), and the control must FAIL at **woken-once** too. At nothing else: **line** stays green.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-26 | FIX-1594 branch on 7c533fc41 | scripted | FAIL (control) | **`GOAL_CONTROL=no-author-filter`, taken first.** Failed at **woken-once** only: `support.iris` and `support.otto` each heard each token twice, `devuser in support.desk: [scenario:reply-in-channel] reply-token-a66ce51a06c …` and then `support.otto in support.desk: [reply:in-channel] reply-token-a66ce51a06c …`. **line** and **author** green. |
| 2026-09-26 | FIX-1594 branch on 7c533fc41 | scripted | FAIL (control) | `GOAL_CONTROL=post-without-author`. Failed at **author** (both reply lines labelled `devuser`) and **woken-once** (each agent heard each token twice, the second time as `devuser in support.desk: [reply:in-channel] …`). **line** green: one reply line per token. |
| 2026-09-26 | FIX-1594 branch on 7c533fc41 | scripted | **PASS** | First verdict, `next start` on a fresh production build, keyless. After a reload `support.desk` shows one line per token, labelled `support.otto`: `[reply:in-channel] reply-token-a561c08c606 Refunds post on Fridays.` `support.iris` and `support.otto` each list one run of `support.desk` holding each token once, in the person's post. |
| 2026-09-26 | FIX-1594 branch on 7c533fc41 | scripted | FAIL (blast radius) | The **line** leg, reddened on purpose: `post-to-channel` dropped from otto's `WORKER.md`, uncommitted, which is what `main` does. Failed at **line** only (0 reply lines for each token); **woken-once** green, and **author** has no line to read. Reverted. |
