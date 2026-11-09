---
"@flow-state-dev/workforce": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/core": minor
"@flow-state-dev/node": minor
"@flow-state-dev/vercel": patch
---

A session subscribed to a GitHub pull request or repository hears it with no webhook: the app polls, once per user and pull request (or repository), at most every five minutes, through the same screens and delivery as push (FIX-2536).

- **workforce:** `defineSubscriptionServiceFlow` and `githubServiceFlow` take `poll: { index, everyMinutes?, declared? }`. Hand the same `poll` to `subscriptionTools` and `followPullRequest`, so a subscribe also schedules the user's poll. `subscribe` takes `everyMinutes` (5, 10, 15, 20, 30 or 60; anything else is refused). `SubscriptionProvider` gains an optional `poll`; `githubSubscriptionProvider` implements it on the user's own token, with conditional requests, reading a long list back from its last page to the mark; a poll that couldn't read everything says so in each session. A delivery the host lost lands on a later poll, once; one that can't land is given up after three polls. With `poll.declared`, a declared event routine whose entry left config ends at its next poll.
- **scheduled:** `runScheduleTick` and `startScheduleTick` (from `/collection`) claim a schedule index's due rows and dispatch each; `scheduleDispatchRequest` builds the dispatch call.
- **core:** `SchedulesConfig` takes `index`, the schedule index a host ticks for the flow.
- **node:** `serve()` ticks each minute for every flow whose `schedules.index` is set, dispatching through its own app (mount `createScheduledTransportAdapter()`; `CRON_SECRET` is sent as the bearer when set).
- **vercel:** `createScheduleTickHandler` runs the shared tick; its behaviour is unchanged.

Docs: packages/workforce/README.md (polling: `poll`, `everyMinutes`, the provider's `poll`, `poll.declared`), packages/scheduled/README.md (`runScheduleTick`, `startScheduleTick`), packages/node/README.md (`serve()` ticks schedule indexes), apps/docs/docs/server/scheduled.md (the tick a long-lived host runs), apps/docs/guides/webhooks-github.md (polling when the app has no public URL)
