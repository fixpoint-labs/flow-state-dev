# workforce-channels › a routed post gets one answer

**Issue:** FIX-1610 (VG of the spec's PLAN; feeds the epic FIX-1592's closure, FIX-1601)

**Outcome:** A person's post to a channel that declares `routing:` runs exactly one specialist, the one its purpose and the recent lines point to. That specialist answers with the recent lines in view, and its answer lands in the channel as its own line every time, whatever the model does with its tools. A channel without the line behaves as before. The host writes no router: it passes `routeByPurpose(seats, { model })`.

**Input:** `fixtures/workforce/`: one team, four agent specialists (no `flow:`, each with a `description:`), one routed channel (`routing: fallback:` naming one of them), and one unrouted channel naming all four. `host.mts` is the app: the tree, the published packages, `wakeMemberSeats(seats)` and `routeByPurpose(seats, { model })`. Held-out: the specialists and the fallback are read off the tree (the routed channel's `members:` and `fallback:`), never hardcoded, and each run's posts carry fresh tokens. Renaming the team, both channels and every worker, and reordering `members:`, passed unchanged.

**Signal:** the host served in-process on in-memory stores and scripted models. One person posts eight times to the routed channel and once to the unrouted one. Everything graded is read back through the host's own router (each seat's conversations, dispatch runs included, and the channel's `channel-post` lines), plus the route model's own calls.

- **import**: `routeByPurpose` resolves from `@flow-state-dev/workforce`. Checked first; the rest needs it.
- **source**: `host.mts` imports only `@flow-state-dev/*`, calls `routeByPurpose`, and builds no `dispatcher`, `keyedRouter` or `router`; exactly one channel file declares `routing:`.
- **one**: a device, an account and a framework post are each heard by their specialist and by no other member.
- **lands**: each of those, and the unclear post, has exactly one answer line in the channel, by the seat that was routed it. The answer script never calls the post tool, so a line there is the landing's.
- **followup**: a follow-up after the account answer is heard by the account specialist alone, routed by one evaluation whose lines included that answer.
- **held**: a post sent while the device specialist has not answered its last post (its answer to that one was empty, so no line) is heard by it alone, with no evaluation call.
- **context**: "where can I buy it?", routed to the fallback specialist, which was never sent the post naming "it", is answered by naming that post's item. The fallback's stored conversation keeps neither that post nor any message carrying another post's line.
- **fallback**: a post the evaluation cannot place is heard by the fallback alone.
- **unrouted**: the unrouted channel's post is heard once by each of the four agents, and nothing lands there.

**Anti-game:** no assertion on a route record, a dispatch handle, a router decision, or a unit test. Who ran is read from each seat's own kept conversation; what landed is read from the channel's lines; "no evaluation" and "the evaluation saw the line" are read from the route model's own calls, a real side effect. The scripts answer only from what they are handed: the route from the lines and post the route read (`[route:<member>]`, else `[follow-up]` to whoever last spoke in those lines, else a failed call), the answer from its turn and the context it was shown. Waiting is polling until every request in the host settles, ungraded.

**Model:** scripted, keyless (epic FIX-1592 D3), for every graded leg. The live leg (below) runs once with a key: the route on the host's own model string `vercel/typesafe-ai/jev` through the app's resolver, the answers on `vercel/openai/gpt-5.4-mini`.

**Run:** `pnpm --dir goals exec tsx workforce-channels/a-routed-post-gets-one-answer/run.mts`

**Live:** `GOAL_LIVE=1` on the same command, with `AI_GATEWAY_API_KEY`. After the scripted legs, the same host on real models: the POC's five posts, the laptop post its follow-up answers, and "where can I buy it?". Each post must reach one member (the expected one where the POC named it) and get one line by it.

**Controls:** on the same command. Each is applied by the check around the host, never inside a package.

- `GOAL_CONTROL=no-route`: the `routing:` line stripped from the channel file. Every agent hears every post and nothing lands. Must FAIL at **one**, **lands**, **followup**, **held**, **context** and **fallback**, and at nothing else.
- `GOAL_CONTROL=no-landing`: the agent kind replaced by one of the app's own that hears posts, answers with the recent lines in view, and posts nothing. Must FAIL at **lands**, and, because no specialist ever has a line so the hold keeps each next post on the last one, at **one**, **followup**, **held** and **context**. Nothing else.
- `GOAL_CONTROL=no-transcript`: the route's evaluation is handed the post without the recent lines. Must FAIL at **followup**, and at nothing else.
- `GOAL_CONTROL=no-context`: the host's notify strips the recent lines from each delivery. Must FAIL at **context**, and at nothing else.

The **import**, **source** and **unrouted** legs have no control; each was reddened by hand, logged below.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-27 | FIX-1610 branch on 0efb98483, uncommitted | scripted | FAIL (control) | `GOAL_CONTROL=no-route`. Failed at **one**, **lands**, **followup**, **held**, **context**, **fallback** only: `tok-…p1 was heard by [support.devices, support.accounts, support.fsd, support.general] (want [support.devices])`; `tok-…p1 has 0 answer line(s)`; `tok-…p3's route made 0 evaluation call(s)`; `support.general's answer to tok-…p8 does not name item-…: []`. |
| 2026-09-27 | FIX-1610 branch on 0efb98483, uncommitted | scripted | FAIL (control) | `GOAL_CONTROL=no-landing`. Failed at **one**, **lands**, **followup**, **held**, **context** only: `tok-…p1 has 0 answer line(s) in support.help: [] (want one, by support.devices)`; `tok-…p2 was heard by [support.devices] (want [support.accounts])` (held for devices, which never answered in the channel). |
| 2026-09-27 | FIX-1610 branch on 0efb98483, uncommitted | scripted | FAIL (control) | `GOAL_CONTROL=no-transcript`. Failed at **followup** only: `tok-…p3 was heard by [support.general] (want [support.accounts])`; `tok-…p3's route made 1 evaluation call(s), not seeing a line by support.accounts`. |
| 2026-09-27 | FIX-1610 branch on 0efb98483, uncommitted | scripted | FAIL (control) | `GOAL_CONTROL=no-context`. Failed at **context** only: `support.general's answer to tok-…p8 does not name item-…` (it answered `Buy what?`). |
| 2026-09-27 | FIX-1610 branch on 0efb98483, uncommitted | scripted | FAIL (by hand) | `routeByPurpose` dropped from the channel barrel: failed at **import** (`@flow-state-dev/workforce exports no routeByPurpose`), as `main` before this issue does. Restored. |
| 2026-09-27 | FIX-1610 branch on 0efb98483, uncommitted | scripted | FAIL (by hand) | `host.mts` given a `dispatcher(` of its own: failed at **source** only (`host.mts builds its own dispatcher`). Restored. |
| 2026-09-27 | FIX-1610 branch on 0efb98483, uncommitted | scripted | FAIL (by hand) | The channel flow's unrouted fan-out cut to its first member: failed at **unrouted** only (`support.accounts heard tok-…p9 in 0 turns (want 1)`, and the same for two more). Restored. |
| 2026-09-27 | FIX-1610 branch on 0efb98483, uncommitted | scripted | FAIL (by hand) | The agent kind's kept user message given the recent lines: **context** failed on both storage checks (`keeps the line it was shown as context`; `kept message(s) carrying other posts' lines`). Restored. |
| 2026-09-27 | FIX-1610 branch on 0efb98483, uncommitted | scripted | **PASS** | First verdict. Each of three posts reached its specialist alone and landed once by it; the follow-up reached `support.accounts` by one evaluation that saw its line; the post after an unanswered one went to `support.devices` with no evaluation; `support.general`, never sent the laptop post, answered `You can buy the item-… at the shop.` and kept none of the lines; the parking post went to `support.general` alone; the lounge woke all four. Also PASS with every folder and id renamed (`helpdesk.ask`/`helpdesk.chat`, `helpdesk.hw`/`billing`/`framework`/`catchall`) and `members:` reordered. `a-fresh-host-wakes-its-member-agents` still PASS. |
| 2026-09-27 | FIX-1610 branch on 0efb98483, uncommitted | route `vercel/typesafe-ai/jev`, answers `vercel/openai/gpt-5.4-mini` | **PASS** (live) | `GOAL_LIVE=1`. Every post routed by the evaluation (no fallback taken): the laptop post, its follow-up ("It sees it. It fails right after the password.") and the phone post to `support.devices`; "Where can I buy it?" to `support.devices`, answered "If you're after a replacement charging cable, you can buy it from the phone maker's official store…"; the double charge to `support.accounts`; the structured-output question to `support.fsd`; the parking pass to `support.general`. One line each, by the member routed it. |
| 2026-09-27 | FIX-1610 branch on bb16f3ab7, uncommitted | scripted | **PASS** | After the review fold (the route carries its block; the fan-out split into a routed and a roster arm; one walk over the items; undescribed seats not offered to the evaluator; the answered claim kept per post, never trimmed). PASS, and each control again failed at exactly its own legs: `no-route` at one, lands, followup, held, context, fallback; `no-landing` at one, lands, followup, held, context; `no-transcript` at followup; `no-context` at context. |
