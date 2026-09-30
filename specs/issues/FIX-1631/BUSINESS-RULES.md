# FIX-1631 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A reader copies `.env.local.example` | It names no `lib/server.ts`, no `VERCEL=1` switch, and no pool or Neon details | The `git grep` in [PLAN → Checks](PLAN.md#checks) prints nothing |
| BR-2 | A reader sets `FSD_DB_URL` or `DATABASE_URL` and leaves `FSD_ENV` unset | The example file and README say the app uses the prod profile and ignores `STORE_TYPE` | Read against `defaultProfile` at `fsdev.config.ts:190` |
| BR-3 | A reader sets `FSD_ENV=dev` along with a database URL | Neither file says the URL always wins. Every "a URL selects prod" or "`STORE_TYPE` is ignored" claim is qualified by `FSD_ENV` | Read against `fsdev.config.ts:175-189` |
| BR-4 | The PR lands | It changes `apps/kitchen-sink/.env.local.example` and the `STORE_TYPE` and `FSD_DB_URL` rows of `apps/kitchen-sink/README.md`, and nothing else | `git diff --stat main...` lists those two files, and the README hunk covers those two rows only |
