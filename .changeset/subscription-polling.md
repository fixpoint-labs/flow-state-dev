---
"@flow-state-dev/workforce": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/core": minor
"@flow-state-dev/node": minor
"@flow-state-dev/vercel": patch
---

A session subscribed to a GitHub thread hears it with no webhook: the app polls, once per user and thread, at most every five minutes, through the same screens and delivery as push (FIX-2536).

- **workforce:** `defineSubscriptionServiceFlow` and `githubServiceFlow` take `poll: { index, everyMinutes?, declared? }`. Hand the same `poll` to `subscriptionTools` and `followPullRequest`, so a subscribe makes the user's poll row for its thread. `subscribe` takes `everyMinutes` (5, 10, 15, 20, 30 or 60; anything else is refused). `SubscriptionProvider` gains an optional `poll(thread, cursor, ctx)`; `githubSubscriptionProvider` implements it on the user's own token, with conditional requests. A delivery the host lost lands on a later poll, once; one that can't land is given up after three polls. Subscriptions a config declares are written once per entry under a stable id, so a restart adds none.
- **scheduled:** `runScheduleTick` and `startScheduleTick` (from `/collection`) claim a schedule index's due rows and dispatch each; `scheduleDispatchRequest` builds the dispatch call.
- **core:** `SchedulesConfig` takes `index`, the schedule index a host ticks for the flow.
- **node:** `serve()` ticks each minute for every flow whose `schedules.index` is set, dispatching through its own app (mount `createScheduledTransportAdapter()`; `CRON_SECRET` is sent as the bearer when set).
- **vercel:** `createScheduleTickHandler` runs the shared tick; its behaviour is unchanged.

Docs: packages/workforce/README.md (polling: `poll`, `everyMinutes`, the provider's `poll`, config-declared subscriptions), packages/scheduled/README.md (`runScheduleTick`, `startScheduleTick`), packages/node/README.md (`serve()` ticks schedule indexes), apps/docs/docs/server/scheduled.md (the tick a long-lived host runs), apps/docs/guides/webhooks-github.md (polling when the app has no public URL)
