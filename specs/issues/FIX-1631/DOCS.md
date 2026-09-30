# FIX-1631 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Destination: `apps/kitchen-sink/.env.local.example`. Two operations, both **replace**. No site
page, README or package README changes.

## 1. Replace the pooling / Neon block (Jake's comment: lines 12–19)

Replaces the comment that describes pooling and Neon behaviour in `lib/server.ts`.

```sh
# With a database URL set, the app runs the prod profile on vercelPostgresStores()
# from @flow-state-dev/vercel. That adapter sets the pool options for Vercel and
# swaps in Neon's WebSocket driver when the URL is a *.neon.tech endpoint. There
# is nothing to configure here for either.
```

## 2. Replace the `STORE_TYPE` note (Jake's comment: line 22)

Replaces the line saying `STORE_TYPE` is ignored when `DATABASE_URL` is set.

```sh
# STORE_TYPE is ignored when FSD_DB_URL or DATABASE_URL is set, because a
# database URL selects the prod profile. Setting FSD_ENV=dev overrides that.
```

The second sentence covers [BR-3](BUSINESS-RULES.md). If the surrounding comments are
terser, the implementer may drop it; the first sentence may not be dropped.
