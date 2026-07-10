---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

Add `defineExternalResourceCollection` — a read-only collection whose instances are read through to an app-owned store (a SQL table, an API) instead of framework storage. The app stays the source of truth; the framework re-queries on read, so there is no copy and no staleness. Point it at data you already own and it inherits the collection surface — per-record state, template-rendered content, client projection — from one definition, without mirroring rows into FSD storage.

Define one with a required `read({ key, ctx })` hook (and a `search` hook the search/list tools will use in a follow-up). Reads through `ctx.resources.<collection>.get(key)` / `.getOptional(key)` and the client state/content routes resolve against your hook, validated through the collection's `stateSchema`. The ref is read-only by type — no `create`/`upsert`/`delete`, and the client write routes are closed — so the app's own writes are the only path. Patterns are wildcard-only; the `read`/`search` context carries a trusted, server-derived `userId`/`scope`/`tenantId` (never caller input).

This first slice covers the definer and read projection. Agent search/list pushdown and app-driven change signals land in follow-ups.
