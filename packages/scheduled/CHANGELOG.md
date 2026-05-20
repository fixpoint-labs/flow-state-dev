# @flow-state-dev/scheduled

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-11 — Scheduled actions: schedule index, auto-mirroring (FIX-581)

New `ScheduleIndex` interface for store-backed schedule fan-out. Implementations track `(userId, key, cron, timezone, nextFireAt)` rows and expose `upsert`, `remove`, and atomic `claimDue`. New `defineScheduleCollection` wraps `defineResourceCollection` with the standard schedule state schema and mirrors every create / update / delete into an attached index automatically. Rows with `enabled: false` are removed from the index, so disabling a schedule stops it firing without deleting the record.

### 2026-05-10 — Scheduled actions: declarative cron + dispatch endpoint (FIX-440)

New `@flow-state-dev/scheduled` package shipping `createScheduledTransportAdapter`, `findScheduledRequest`, and `createResourceCollectionScheduleResolver`. Mounts `POST /api/flows/:kind/schedules/:scheduleId/dispatch` and a sibling `GET .../schedules` listing endpoint. Two-phase auth: `host.resolvePrincipal` establishes the gateway principal and each schedule carries an optional `principal` that wins for the action's effective user. Idempotency (per-process LRU keyed on `(scheduleId, nominalFireTime)`, default 60s window). `onOverlap: "skip" | "allow"` (skip is default).
