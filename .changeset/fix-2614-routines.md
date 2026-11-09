---
"@flow-state-dev/workforce": minor
"@flow-state-dev/scheduled": patch
"@flow-state-dev/shift-manager": minor
---

Routines: one name, list and tool set for everything that fires on its own as a user (FIX-2614). A routine has one trigger: a clock (a schedule that files a task) or an event (a subscription to one thread). Stored rows don't change.

- **workforce:** four verbs over both triggers, as roster-flow actions for the user and as a worker's tools: `listRoutines`, `saveRoutine({ name?, trigger: { clock } | { event }, task?, worker?, description? })`, `pauseRoutine({ id, paused })` and `deleteRoutine({ id })`. A routine's id is `clock:<key>` or `event:<subscription id>`; each lists who made it (`madeBy`: the user, a worker, or the app). A paused event routine leaves the thread index; a resume subscribes again from its row, checking read access, and keeps its task. The user reaches all their routines; a worker reaches only the ones that act through it (`not_yours`).
- **workforce:** `routineTools({ providers, index? })` replaces `subscriptionTools`; `hireWorkforce`'s `routines: { index?, providers?, declared? }` replaces `schedules: { index }`. `listedRoutineSchema`, `LIST_ROUTINES_ACTION` and `ROUTINE_VERBS` (also from `./browser`) replace `listedScheduleSchema` and `LIST_SCHEDULES_ACTION`. The roster's `saveSchedule`, `listSchedules` and `deleteSchedule` are gone, with no aliases.
- **workforce:** `routines.declared`: the app's own routines, seeded into each user's collections when their roster flow runs a request (or only an entry's `owner`), keyed `cfg_<hash>` and written only when missing or changed. The user may pause one; save and delete refuse with `declared`. A config change keeps the pause. `hireWorkforce` throws on an entry that would never fire.
- **workforce:** `subscribe(ctx, providers, input, target?, write?)` takes an optional server-side target `{ sessionId, flow, worker, taskId? }` and write options `{ id?, madeBy?, paused? }`. A task's failure or cancel also ends its paused subscriptions. A delivery to a user's not-yet-open conversation with a worker opens it.
- **scheduled:** a schedule row takes an optional `metadata` record, kept and never read by the resolver, the index or dispatch.
- **shift-manager:** *Scheduled work* is now **Routines** (`/routines`; `/schedules` still opens it): clock and event routines in one list, each with its maker, paused, resumed or deleted from its line. An app's routine can only be paused.

Docs: packages/workforce/README.md (the new Routines section; Subscriptions' tools and ending; the API table), apps/docs/docs/workforce/delegating-work.md ("Tasks on a clock", the old "Recurring work"), apps/docs/docs/shift-manager/overview.md (the Routines row). At release: a `workforce/routines.md` page after `messaging-workers`, with the subscribe section shrunk to a link, and the published glossary's *Routine* row.
