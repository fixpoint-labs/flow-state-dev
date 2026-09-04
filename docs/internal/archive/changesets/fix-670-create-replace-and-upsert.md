---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

Add two `ResourceCollectionRef` APIs for the recurring "exists-or-not" patterns
in setup and incremental-update paths (FIX-670):

- **`create(key, initial?, { replace: true })`** — overwrites an existing
  instance instead of throwing. `setState` semantics: Zod's `.default(null)`
  (per BP-023) fills nullable fields the caller doesn't supply, so the prior
  state's transient fields (body, headline, error message, …) reset cleanly
  on the replace branch. `maxInstances` is only checked on the create branch
  — replacing an existing instance never trips the guard. Fires
  `onInstanceUpdated` on replace, `onInstanceCreated` on create.

- **`upsert(key, update, createOnly?)`** — patch-or-create. On exists: applies
  `update` via `patchState` semantics (other fields preserved). On missing:
  creates with `{ ...createOnly, ...update }` — the create-only extras provide
  fields you only need to supply at creation time (`update` wins on
  overlapping keys). Fires `onInstanceUpdated` on patch, `onInstanceCreated`
  on create. `createOnly` is optional — the 2-arg form patches with `update`
  on exists and creates with `update` alone on missing.

Together with the existing `create` (throw on exists) and `getOrCreate`
(return-as-is on exists), this completes the four "if-exists / if-missing"
patterns app code needs:

| API | If exists | If missing |
| --- | --- | --- |
| `create(k, s)` | throw | create |
| `create(k, s, { replace: true })` | replace | create |
| `getOrCreate(k, init?)` | return as-is | create |
| `upsert(k, update, createOnly?)` | patch | create with `{ ...createOnly, ...update }` |
