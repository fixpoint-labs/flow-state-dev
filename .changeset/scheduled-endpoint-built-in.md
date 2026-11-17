---
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/workforce": patch
---

A flow with `schedules` fires them and answers on its dispatch endpoint with nothing in the app beyond `schedules` on the flow (FIX-2753).

- **engine:** the router mounts the scheduled endpoint itself, on every app, beside the HTTP routes: `POST /api/flows/:flowKind/schedules/*scheduleId/dispatch` and `GET /api/flows/:flowKind/schedules`. A flow registered after the router is built is routed too. A registered flow with no `schedules` answers both routes `404 { "error": "flow_not_found" }`, the same as an unknown flow, before any principal resolver runs; before, the listing route ran the resolver and answered an empty list. `createFlowState` no longer refuses to start a flow with schedules and no adapter. An app adapter that registers one of the two paths is refused at startup by the router's route-collision check. `SCHEDULED_TRANSPORT_SOURCE` is exported from `@flow-state-dev/engine`.
- **scheduled (breaking):** `createScheduledTransportAdapter`, its `basePath` option, `CreateScheduledTransportAdapterOptions`, `SCHEDULED_TRANSPORT_SOURCE` and `findScheduledRequest` are removed. Delete the `adapters: [createScheduledTransportAdapter()]` line and its import; import `SCHEDULED_TRANSPORT_SOURCE` from `@flow-state-dev/engine`. The schedule routes live under `/api/flows` only: an app that serves the flow API under another prefix (`serve({ basePath })`, a Next.js route elsewhere) still fires its schedules from the local cron, but an outside cron or `vercelScheduler()` sending to that prefix gets a 404, as webhooks do. `FIRED_RECORDS_PATTERN` and `firedRecordCollectionKey` move from `@flow-state-dev/scheduled/collection` to `@flow-state-dev/core/types`. The package keeps schedule collections, the resolver, the `ScheduleIndex` contract, `createBadCronWarner`, `parseNextFireAt` and `./testing`, and no longer depends on the engine.
- **core:** `FIRED_RECORDS_PATTERN` and `firedRecordCollectionKey` are exported from `@flow-state-dev/core/types`.
- **workforce:** reads the fired-record helpers from core; no behaviour change.

The pending note that said `createScheduledTransportAdapter` stops refusing `idempotencyWindowMs` and `idempotencyOptions` is superseded: the factory is gone.

Docs: apps/docs/docs/server/scheduled.md (drop the mount step; the endpoint is always there, under `/api/flows`; a flow with no schedules answers 404; drop the lines that say the adapter throws on `idempotencyWindowMs` or `idempotencyOptions`), apps/docs/guides/keeping-a-flow-running.md, apps/docs/guides/scheduled-dynamic.md, apps/docs/guides/scheduled-vercel-cron.md and apps/docs/docs/workforce/delegating-work.md (drop the adapter line), apps/docs/docs/advanced/inbound-transports.md (the scheduled endpoint is built in), packages/scheduled/README.md (the collections-and-index package; no endpoint, no `basePath`), packages/engine/README.md (drop the commented adapter line; `SCHEDULED_TRANSPORT_SOURCE`).
