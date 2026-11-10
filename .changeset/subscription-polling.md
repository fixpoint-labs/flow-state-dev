---
"@flow-state-dev/workforce": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/core": minor
"@flow-state-dev/node": minor
"@flow-state-dev/vercel": patch
---

A session subscribed to a GitHub pull request or repository hears it with no webhook: the app polls, once per user and pull request (or repository), at most every five minutes, through the same screens and delivery as push (FIX-2536).

- **workforce:** polling is configured once, on the installation: `hireWorkforce(installation, { routines: { poll: { index, everyMinutes? } } })`, with a schedule index of its own (not `routines.index`, which is refused: one index ticks one flow), and `poll: true` on `defineSubscriptionServiceFlow` or `githubServiceFlow`. Every event routine write (the routine verbs, the roster's routine actions, the declared routines' seed, and `followPullRequest({ providers, installation })`) then schedules the user's poll. An event routine takes `everyMinutes` (5, 10, 15, 20, 30 or 60; anything else is refused), the seed included. `SubscriptionProvider` gains an optional `poll`; `githubSubscriptionProvider` implements it on the user's own token, with conditional requests, reading a long list back from its last page to the mark; a poll that couldn't read everything says so in each session. A delivery the host lost lands on a later poll, once; one that can't land is given up after three polls. A declared event routine whose entry left `routines.declared` ends at its next poll. A poll forwards what no ordinary subscription of that user heard to that user's coordinator that follows the same pull request or repository `unmatched`. A declared event routine whose `unmatched` setting changed is rewritten at the next seed.
- **scheduled:** `runScheduleTick` and `startScheduleTick` (from `/collection`) claim a schedule index's due entries and dispatch each; `scheduleDispatchRequest` builds the dispatch call.
- **core:** `SchedulesConfig` takes `index`, the schedule index a host ticks for the flow.
- **node:** `serve()` ticks each minute for every flow whose `schedules.index` is set, dispatching through its own app (mount `createScheduledTransportAdapter()`; `CRON_SECRET` is sent as the bearer when set).
- **vercel:** `createScheduleTickHandler` runs the shared tick; its behaviour is unchanged.

Docs: packages/workforce/README.md (polling: `routines.poll`, the service flow's `poll`, `everyMinutes`, the provider's `poll`), packages/scheduled/README.md (`runScheduleTick`, `startScheduleTick`), packages/node/README.md (`serve()` ticks schedule indexes), apps/docs/docs/server/scheduled.md (the tick a long-lived host runs), apps/docs/guides/webhooks-github.md (polling when the app has no public URL)
