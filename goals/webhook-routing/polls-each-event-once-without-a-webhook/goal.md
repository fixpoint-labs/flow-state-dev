# webhook-routing › it polls each event once without a webhook

**Issue:** FIX-2536 (epic FIX-2471)
**Outcome:** With no webhook, a session subscribed to a thread hears each event on it once, within one poll period, through the same screens and delivery as push; nothing polls more often than every 5 minutes, one user's sessions on a thread share one fetch, and no user's poll reaches another user. A subscription declared in config polls the same way from startup, as one row.
**Input:** FIX-2534's fixture (`../delivers-each-event-once-to-its-subscribers/fixtures/`: 24 subscriptions over `alice` and `bob`, 300 normalized events) replayed as a provider's timeline, one event every 10 seconds from 10:00 (50 minutes), then a 30-minute tail. A fake GitHub provider answers each poll with the thread's events at or after the cursor's `since`, as the polling user, with an ETag per thread (`304` when nothing new is visible). The run's clock is moved (`clock.mts`), one minute a beat; each beat runs `@flow-state-dev/scheduled`'s `runScheduleTick` over a SQLite schedule index and the real dispatch endpoint (`createScheduledTransportAdapter`), over `sqliteStores`. Four legs, each on its own file:
- **leg 1** polled only, webhook off.
- **leg 2** polled, with each of 15 sessions' last expected delivery lost: 10 dispatches the store never records once, 4 takes that fail once (accepted, never taken), 1 dispatch lost every time. Each is a session's last event on its thread, so no later event on that thread can carry its retry.
- **leg 3** pushed (every event routed through `routeServiceEvent` at its time) and polled.
- **leg 4** two config-declared subscriptions for alice (the repo every 15 minutes, a PR at the default), seeded through the service flow's seed entry on a cold start, then again after a restart over the same file; then one entry leaves config.

Held-out: the expected set per session is the oracle FIX-2534's run restates, written again here and importing no screen or delivery code. For a subscription that unsubscribes (b7, at event 150), polled legs expect only what its user's row had fetched by then: polling hears an event within one period, so a subscription that ends inside the period misses the rest of it, as the goal allows.
**Signal:** All of them, on one run:
- **(a)** each session's delivered service rows equal the oracle exactly, every leg (leg 2 less the never-taken one; leg 3 the push oracle, and no row twice);
- **(b)** no row fires within 5 minutes of its last fire;
- **(c)** every row's fires are exactly its cadence apart, every fire accepted (`202`): fires are the due rows;
- **(d)** reported: the polls answered `304` (unchanged), which deliver nothing;
- **(e)** each lost or never-taken-once delivery lands exactly once, on a later poll;
- **(f)** no poll ran as a user who can't read its thread;
- **(i)** the delivery lost every time is given up after three polls: nothing owed at the end, the mark past it;
- **(j)** the config seed writes on a cold start, writes nothing on a restart, the row count equals the entries, the config rows hear events, and a removed entry's row ends `config_removed` at its next fire;
- **(k)** the 15-minute row fires 15 minutes apart, and a cadence of 3 is refused;
- **(l)** no user fetches a thread twice within a cadence, alice's two sessions on #412 included.

**Anti-game:** assertions read stored message-log rows, schedule rows and subscription rows, and the provider's own record of who fetched what; nothing counts a function call in the code under test. Each graded list is floored with `tell.over`, so an instrument that saw nothing reads CAN'T TELL. Losses are chosen by rule (each session's last expected delivery, in fixture order), not by seed, and the lossy leg's planned losses must all happen or the run fails.
**Model:** n/a (model-free: no generator or evaluator is on this path)
**Run:** `pnpm tsx goals/webhook-routing/polls-each-event-once-without-a-webhook/run.mts` (about ten minutes)
**Controls:**
- `GOAL_CONTROL=poll-per-subscription` keys a poll row by subscription, not by user and thread. Must FAIL **(l)**.
- `GOAL_CONTROL=mark-moves` moves the mark to the poll's end whatever is owed. Must FAIL **(e)**.
- `GOAL_CONTROL=walk-all` claims every row each beat, due or not. Must FAIL **(b)**/**(c)**.
- `GOAL_CONTROL=under-floor` fires every row each minute. Must FAIL **(b)**.
- `GOAL_CONTROL=hold-forever` never gives a delivery up. Must FAIL **(i)**.
- `GOAL_CONTROL=etag-while-held` sends validators while a delivery is owed. Must FAIL **(e)**.
- `GOAL_CONTROL=seed-every-boot` gives a declared subscription a new id each boot. Must FAIL **(j)**.
- `GOAL_CONTROL=ignore-cadence` polls every row at the default. Must FAIL **(k)**.
- Today's `main` has none of the API this run imports, so it stops before grading; not run as a control.

Not in this run: the spec's (g)/`no-screened` (a refused version judged once) and (h)/`outage-screened` (a screen down, then up) need a screen that can be down, which FIX-2537's evaluator screen brings; unit tests cover `screened` (`packages/workforce/test/subscriptions-poll.test.ts`). Leg 3's count of push refusals a poll judges again is not reported.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
