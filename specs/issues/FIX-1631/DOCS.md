# FIX-1631 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Three **replace** operations. No site page or package README changes.

## 1. `.env.local.example`: replace the whole `VERCEL=1` paragraph

Replace all of it: the lead-in ("When deployed on Vercel, VERCEL=1 is set automatically… That
triggers two things in lib/server.ts"), the pool and Neon list, and the trailer ("Setting
VERCEL=1 locally forces the same behavior for testing"). Reviewers quoted the range as about
lines 13–19. Confirm it on `main`.

```sh
# Deploying to Vercel needs no extra variables beyond a database URL.
```

The line doesn't name the store adapter. If an implementer adds a pointer, the import path is
`@flow-state-dev/vercel/store`. The package root doesn't export `vercelPostgresStores()`.

## 2. `.env.local.example`: replace the `STORE_TYPE` note (about lines 21–22)

```sh
# With FSD_ENV unset, a database URL (FSD_DB_URL, else DATABASE_URL) selects
# the prod profile and STORE_TYPE is ignored; with no URL, STORE_TYPE picks the
# local store. FSD_ENV=dev or FSD_ENV=prod picks the profile explicitly.
# Full rules: README → Environment variables.
```

The `FSD_ENV` qualifier is **required**. Without it, a reader who sets `FSD_ENV=dev` along with
a URL is told the wrong thing ([BR-3](BUSINESS-RULES.md)). You may reword the note, but don't
drop the qualifier.

## 3. `README.md` env table: the `STORE_TYPE` and `FSD_DB_URL` rows (L246-247)

```diff
-… Ignored when a database URL is set. |
+… Ignored when a database URL is set, unless `FSD_ENV=dev`. |
-… When set, the app stores everything there. …
+… When set, the app stores everything there, unless `FSD_ENV=dev`. …
```
