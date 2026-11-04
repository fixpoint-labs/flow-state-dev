# webhook-routing › it delivers each event once to its subscribers

**Issue:** FIX-2534 (epic FIX-2471)
**Outcome:** A session that subscribed to a thread hears each event on it once, from the service, after code-only screens, and nothing it didn't ask for, can't read, or caused itself. Two sessions on one PR each hear each event. A redelivery adds nothing. One user never hears another user's private repo. The run reports what share of deliveries the config screens decided, the number the epic's kill line reads.
**Input:** `fixtures/subscriptions.json` (20 subscriptions over two users, `alice` and `bob`: two sessions on one PR, a private PR only alice can read, kinds, every listed screen kind, outsider opt-ins, one subscription unsubscribed at event 150, one on a thread that closes at event 200) and `fixtures/events.json` (300 normalized GitHub-shaped events, then 40 redeliveries of events already sent). Written once from a fixed seed by `fixtures/make.mts`; the events are synthetic and already normalized, since mapping a recorded GitHub delivery is FIX-2535's. Held-out: the expected set per session comes from an oracle in `run.mts` that restates the spec's rules over the fixture, and imports no screen or delivery code, so a different valid fixture must still pass a correct implementation. **The 20 subscriptions were frozen in commit `e539616a`, before the first share was read.**
**Signal:** All of them, on one run:
- **(a)** each session's stored message-log rows from the service equal the oracle's set exactly, every one `delivered`, and the session holds one `From service:` message item per row;
- **(b)** 0 reads of another user's cell from a request (the service's requests read the org's thread index and no user's cell; each delivery reads only its own user's), and bob's subscription to alice's private PR is refused `not_readable`, with nothing of it landing for bob;
- **(c)** 0 model resolutions;
- **(d)** 0 deliveries to the unsubscribed subscription after event 150, or to the closed thread's after event 200;
- **(e)** no outsider's event reaches a subscription that didn't opt in.
- **Reported:** `SHARE` = config-decided ÷ selected over the 300 first deliveries, with `KILL LINE` when under 0.5. Config-decided counts every refusal and every pass on a subscription that listed a screen of its own; a pass on one that listed none is open, since only its sentence says what it wants.

**Anti-game:** a hollow pass would count `sendMessage` calls or owner runs fired, or grade one session per PR. The check reads stored rows and items only, so a send that never landed, or landed twice, shows. A dedupe key without the session passes every single-session case, which is why the fixture has two sessions on one PR (`a2`) and the `one-key` control. Each list an assertion grades is floored with `tell.over`, including the reads inside the service's own requests, so an instrument that tagged nothing reads CAN'T TELL, not PASS. (b) tags each store read with the principal of the request it ran in (AsyncLocalStorage set at the host's dispatch); the host's own row check before each delivery reads the nominated cell by design and is not counted. The cap is set past the fixture's reach (`capPerHour: 10_000`) so the oracle needs no model of it; the cap is unit-tested in `packages/workforce/test/subscriptions-delivery.test.ts`. The fixture's edits can give one object version two senders, so (e) counts a version as an outsider's only when only outsiders sent it.
**Model:** n/a (model-free: no generator or evaluator is on this path, and (c) asserts it)
**Run:** `pnpm tsx goals/webhook-routing/delivers-each-event-once-to-its-subscribers/run.mts`
**Controls:**
- `GOAL_CONTROL=one-key` drops the session from a delivery's message id (`sub_<object>@<version>`). Must FAIL **(a)**: the second session on a PR hears nothing. It also reads CAN'T TELL on (d)'s floor for `b7`, which then has no deliveries at all (a co-failure of the same cause, not another assertion going red).
- `GOAL_CONTROL=fail-open` makes the sender screen pass every outsider. Must FAIL **(e)**. (a) goes red with it, since (a) is an exact set and the outsiders' events are extra rows.
- Today's `main` has none of the API this run imports, so it stops before grading; it was not run as a control.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | e539616a+ (uncommitted run) | n/a | FAIL (expected) | `GOAL_CONTROL=one-key`: (a) only, 10 sessions short (a2 got 3 of 22, b7 0 of 13); CAN'T TELL on d · b7 (read 0). Nothing in (b), (c), (e). |
| 2026-11-04 | e539616a+ (uncommitted run) | n/a | FAIL (expected) | `GOAL_CONTROL=fail-open`: (e) 4 lines, outsider events reached subscriptions without the opt-in; (a) 14 sessions with extra rows. SHARE 0.826. |
| 2026-11-04 | e539616a+ (uncommitted run) | n/a | PASS | 236 deliveries matched the oracle over 20 subscriptions, 300 events and 40 redeliveries; reads in the service's requests 593, user-cell reads in requests 1486, cross-user 0; model resolutions 0; d floors 13 and 13; outsider events 75, 20 delivered to opted-in subscriptions. **SHARE 0.867 (1014/1170)**, over the kill line. |
