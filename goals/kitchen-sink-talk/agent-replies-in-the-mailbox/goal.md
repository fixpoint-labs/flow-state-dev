# kitchen-sink-talk › an agent replies in the mailbox

**Issue:** FIX-1594 (VG of the spec's PLAN; the epic FIX-1592's leg c); re-pointed by FIX-1611

**Outcome:** A person posts to `support.help`, and the specialist the route picks, `support.devices`, answers in that mailbox under its own name through its `post-to-mailbox` tool. The line is still there after a reload, and wakes nobody.

**Re-pointed (FIX-1611).** The folder name is kept so its verdict history stays in one place. Until FIX-1611 this read `support.otto` answering in `support.desk`, beside a second agent member. The team now has one routed mailbox, so the answering seat is the routed specialist and "wakes nobody" covers the three members the route passed over.

**Input:** `fixtures/input.json`: the mailbox, the specialist a post routes to (`support.devices`), the three members it passes over (`support.accounts`, `support.fsd`, `support.general`), the `[route:<member>]` tag the scripted route reads, the scenario marker the scripted model keys on (`[scenario:reply-in-mailbox]`) and the marker it writes on the specialist's line (`[reply:in-mailbox]`). Held-out: each run posts two lines, each with a fresh `reply-token-…`, and only those tokens are graded, so a line another run or test left in the shared mailbox can never be the one that passes. The second post, with different text, must pass the same way.

**Signal:** one real browser against kitchen-sink's **production build** (built by the run, never assumed), served by `next start` on the scripted model, the in-memory store and **no model key**. Both posts go in from the mailbox's panel; everything graded is read off the page **after one reload**.

- **line**: for each token, the `support.help` panel shows exactly one line carrying the token and `[reply:in-mailbox]`: the specialist's answer, kept by the mailbox.
- **author**: that line is labelled `support.devices`, not `devuser`.
- **woken-once**: `support.devices` lists one run of `support.help`, and in it each token appears in exactly one turn, the person's post (`devuser in support.help: [route:support.devices] [scenario:reply-in-mailbox] …`). `support.accounts`, `support.fsd` and `support.general` list no run of `support.help` holding either token. A second turn carrying the token, or another member's run, is the specialist's line waking a seat.

**Anti-game:** no assertion on the reply's wording past its marker, which the script wrote; none on the tool's return value, the route's record, a dispatch handle, a package test or a CLI run. Only this run's tokens count. The page is read after a reload, so only what the mailbox and the seats kept can pass. Before the reload the run polls the server until the line and the specialist's answer land, then waits 1.5s for a wrongly woken seat to run; none of that is graded.

**Model:** n/a. kitchen-sink's scripted model picks the route and answers the seat (epic FIX-1592 D3): a step calling `post-to-mailbox` with no text, so the real tool runs, then a text step. Keyless: the server runs with `AI_GATEWAY_API_KEY` empty.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/agent-replies-in-the-mailbox/run.mts`

**Controls:** on the same command. The app honours each only under `KITCHEN_SINK_TEST_MODE=1` (`apps/kitchen-sink/lib/goal-control.ts`).

- `GOAL_CONTROL=no-author-filter` (FIX-1590's): the wake's author filter dropped. The specialist's line is still signed, so the mailbox does not route it; it fans out to every member, and now wakes them. Must FAIL at **woken-once**, and at nothing else.
- `GOAL_CONTROL=post-without-author` (`apps/kitchen-sink/lib/mailbox-post-control.ts`): the tool swapped for one that posts no author. The line reads `devuser`, so it must FAIL at **author**. A line with no author is a person's post, so the route places it and a seat hears the specialist's own words: it must FAIL at **woken-once** too. At nothing else: **line** stays green.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-26 | FIX-1594 branch on 7c533fc41 | scripted | FAIL (control) | **`GOAL_CONTROL=no-author-filter`, taken first.** Failed at **woken-once** only: `support.iris` and `support.otto` each heard each token twice, `devuser in support.desk: [scenario:reply-in-mailbox] reply-token-a66ce51a06c …` and then `support.otto in support.desk: [reply:in-mailbox] reply-token-a66ce51a06c …`. **line** and **author** green. |
| 2026-09-26 | FIX-1594 branch on 7c533fc41 | scripted | FAIL (control) | `GOAL_CONTROL=post-without-author`. Failed at **author** (both reply lines labelled `devuser`) and **woken-once** (each agent heard each token twice, the second time as `devuser in support.desk: [reply:in-mailbox] …`). **line** green: one reply line per token. |
| 2026-09-26 | FIX-1594 branch on 7c533fc41 | scripted | **PASS** | First verdict, `next start` on a fresh production build, keyless. After a reload `support.desk` shows one line per token, labelled `support.otto`: `[reply:in-mailbox] reply-token-a561c08c606 Refunds post on Fridays.` `support.iris` and `support.otto` each list one run of `support.desk` holding each token once, in the person's post. |
| 2026-09-26 | FIX-1594 branch on 7c533fc41 | scripted | FAIL (blast radius) | The **line** leg, reddened on purpose: `post-to-mailbox` dropped from otto's `WORKER.md`, uncommitted, which is what `main` does. Failed at **line** only (0 reply lines for each token); **woken-once** green, and **author** has no line to read. Reverted. |
| 2026-09-26 | FIX-1602 branch on a52bab37a, uncommitted | scripted | FAIL (control) | Re-run on kitchen-sink moved onto Workforce's `wakeMemberSeats`, the control now an input adapter that drops `author` before the helper. **`GOAL_CONTROL=no-author-filter`.** Failed at **woken-once** only: each agent heard each token twice, the second time as `devuser in support.desk: [reply:in-mailbox] …`. **line** and **author** green. |
| 2026-09-26 | FIX-1602 branch on a52bab37a, uncommitted | scripted | **PASS** | Same thinned app. One line per token labelled `support.otto` after a reload; `support.iris` and `support.otto` each hold one run of `support.desk`, each token heard once, in the person's post. |
| 2026-09-27 | FIX-1611 branch on 315976e5f, uncommitted | scripted | FAIL (control) | **Re-pointed** at `support.help`, replier `support.devices` (routed by `[route:support.devices]`), the other three specialists as the members **woken-once** now also reads. **`GOAL_CONTROL=no-author-filter`, taken first.** Failed at **woken-once** only: the specialist's signed line fanned out unrouted and woke every member, so `support.devices` heard each token in 2 turns (the post, then its own line) and `support.accounts`, `support.fsd` and `support.general` each held a run with a token. **line** and **author** green. |
| 2026-09-27 | FIX-1611 branch on 315976e5f, uncommitted | scripted | FAIL (control) | **Re-pointed.** `GOAL_CONTROL=post-without-author`: failed at **author** (both lines labelled `devuser`) and **woken-once** (`support.devices` heard each token twice: the mailbox held the unauthored line on the member already on the person's last post, so the route sent the specialist its own words), and at nothing else. **line** green. |
| 2026-09-27 | FIX-1611 branch on 315976e5f, uncommitted | scripted | **PASS** | **Re-pointed.** Fresh production build, keyless. After one reload `support.help` shows one line per token, labelled `support.devices`, e.g. `[reply:in-mailbox] reply-token-a… Refunds post on Fridays.`; `support.devices` lists one run of `support.help`, each token heard once in the person's post; the other three specialists list 0 runs. |
