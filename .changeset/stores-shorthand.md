---
"@flow-state-dev/engine": minor
---

`createFlowState`'s `stores` is optional, and takes one adapter as well as named profiles (FIX-2452).

- **Omitted:** the app runs in memory, as the `default` profile. The startup line says so (`active profile: "default" (no \`stores\` set: the app runs in memory, ...)`), and with `NODE_ENV=production` it also warns once per process, naming `stores` as the fix. Nothing persists across a restart. `FSD_QUIET_WARNINGS=1` silences the production warning.
- **One adapter:** `stores: sqliteStores({ filename })` is exactly `{ default: { primary: sqliteStores({ filename }) } }`. A primary that declares `bus` backs the bus, and an `FSD_ENV` naming another profile still refuses.
- **Named profiles:** unchanged, for an app that picks a store per environment.

**Breaking:** the `queue` and `scheduler` profile slots are removed from `CapabilitySlotMap` (and so from `CapabilitySlot`). Neither backed anything. A typed profile that names one fails to compile: delete the line. Queues come from a worker adapter (`worker:` on `createFlowState`, e.g. `@flow-state-dev/bullmq`); schedules come from the schedule index (`createSQLiteScheduleIndex`, `createPostgresScheduleIndex`, or the Vercel adapter's `scheduleIndex`). `blobs` stays, reserved for the attachment store.

Docs: FIX-2452. Getting-started pages (`getting-started/installation.md`, `quick-start.md`, `your-first-flow.md`, `project-structure.md`, `setting-up-models.md`) drop the `stores` line and its `inMemoryStores` import, and drop the empty `session: { stateSchema: z.object({}) }` blocks. `server/setup.md`, `configuration/runtime.md`, `persistence/overview.md` and `api/server.md` show the bare form first (`stores: sqliteStores({ filename })`), say an app with no `stores` runs in memory and production warns, keep named profiles for per-environment stores, drop `queue` and `scheduler` from the slot list, and keep `blobs` as reserved. Every other guide or page that writes `stores: { default: { primary: inMemoryStores() } }` drops it. packages/engine/README.md, packages/fsdev/README.md and packages/shift-manager/README.md: the same.
