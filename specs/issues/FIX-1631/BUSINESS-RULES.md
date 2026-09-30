# FIX-1631 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A reader asks where Postgres pool tuning or the Neon driver comes from | `.env.local.example` names `vercelPostgresStores()` in `@flow-state-dev/vercel`, and no file that doesn't exist | No `lib/server.ts` anywhere under `apps/kitchen-sink` on the fix commit ([PLAN → Checks](PLAN.md#checks), row 7) |
| BR-2 | A reader sets `FSD_DB_URL` and `STORE_TYPE=filesystem` together | The example file says `STORE_TYPE` is ignored when either database URL is set, matching `defaultProfile: databaseUrl ? "prod" : "dev"` in `fsdev.config.ts` | Row 8 |
| BR-3 | A reader sets `FSD_ENV=dev` with a database URL | Nothing in the example file contradicts it: an explicit `FSD_ENV` picks the profile. The file may say so in a clause; it must not claim the URL always wins | Row 8 |
| BR-4 | Any of the six gaps from the walk-through | Its answer on `main` is unchanged by this PR | The diff touches `apps/kitchen-sink/.env.local.example` only |
| BR-5 | The PR lands | Nothing a user of the app sees changes: no code, no product copy, no `escalate` behaviour | Same diff check. No changeset (private app, BP-022) |
| BR-6 | The example file gains or keeps a variable line | It holds placeholders only, never a real key or connection string | Read of the diff |
