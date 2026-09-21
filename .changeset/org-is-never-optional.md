---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/testing": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/bullmq": minor
"@flow-state-dev/fsdev": minor
---

Organization identity is now required on every request (FIX-1442).

A session, request, dispatched child and scheduled job each carry an
organization, and the server checks it on reads and execution alongside the
user. It comes from a configured `resolvePrincipal`, or — when an app
configures no resolver — from the new reserved `DEFAULT_ORG_ID` exported by
`@flow-state-dev/core`. A caller-supplied `orgId` is never authoritative.

**What you need to change**

- A resolver must return a verified `orgId`. Returning none, a blank one, or
  `DEFAULT_ORG_ID` is refused with 401. A machine transport may return
  `{ orgId }` alone and let `defaultUserId` name its system user.
- Direct `runAction` calls must pass `orgId` — your verified organization, or
  `DEFAULT_ORG_ID` for single-organization development.
- `authentication.requireOrg` and a block's `requireOrg` are removed.
  Organization is unconditional, so the declaration had nothing left to say;
  a config that still carries either is rejected at definition time rather
  than ignored.
- Client and React session APIs no longer take an `orgId` — the server owns
  it. `SessionDetail.orgId` is now required on the way back.
- `openChannels` no longer takes an `orgId`; the server binds the channel.
- A queued BullMQ job that carries no organization now fails terminally
  instead of being retried: a worker runs below principal resolution, so no
  later attempt could supply one. Subscribers receive an error terminal rather
  than waiting for a job that never completes.

**The schedule index stores the organization.** `schedule_index` gains a
nullable `org_id` column in both the SQLite and PostgreSQL adapters, so the
organization a schedule fires into survives a round trip through the database.
The column is added for you on the next schema init — there is no manual DDL
step. Existing rows read back with no organization and are quarantined rather
than dispatched, so a schedule written before this upgrade does not fire until
it is attributed; rewriting it stamps the organization of the execution that
writes it.

**Upgrading a store with existing data.** Records written before this carry no
organization. They are preserved and refused (`409 migration-required`) rather
than guessed at, and listings and scheduler scans skip them. Attribute them
offline first — the procedure, including dynamic schedules, index rebuild and
the reserved-id collision check, is in the persistence guide under "Which
organization a record belongs to".
