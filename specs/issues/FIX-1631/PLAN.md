# FIX-1631 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md)

## Surface

One file: `apps/kitchen-sink/.env.local.example`. Replace the two comment blocks Jake's issue
comment names (around lines 12–19: pooling and Neon in `lib/server.ts`; around line 22:
`STORE_TYPE` ignored under `DATABASE_URL`) with the text in [DOCS.md](DOCS.md). Keep every
variable line and placeholder as is.

**Access note:** in the spec worker's session, reading `.env*` files was denied by permission
settings, so the exact current lines were taken from Jake's comment, not read. The implementer
needs read access to that file; confirm the line numbers against it before editing.

## Order

1. Read `.env.local.example`, `apps/kitchen-sink/fsdev.config.ts` (lines 1–15, 47, 175–190) and
   `packages/vercel/src/store.ts` (header, `build()`).
2. Apply [DOCS.md](DOCS.md), adjusting wording to the surrounding comment style.
3. Fill the checks table below on the fix commit, and paste it in the PR.

## Checks

Fill on the fix commit. The control column is the same row at `15087779b`; rows 1–6 must fail
there.

| # | Question | Doc line that answers it | Code that makes it true |
|---|---|---|---|
| 1 | Does a direct conversation's `escalate` land on the channel board? | README, "talk to a specialist directly" | `workforce/blocks/escalate.ts` |
| 2 | Where are `support.help` and the specialists in the rail? | README, "expand `channel`" / "expand `agent`" | rail grouping |
| 3 | Can working outlast the answer? | README, "can show as working for a few seconds" | — (observed) |
| 4 | Which model do specialists answer with? | README, "`chat` intent … `fsdev.config.ts`" | `models.intents` in `fsdev.config.ts` |
| 5 | When does the fallback take a post? | channels.md, "the member who takes a post the route can't place" + step 3 | `routeByPurpose` |
| 6 | Which database URL wins? | `.env.local.example`, persistence comment | `fsdev.config.ts:47` |
| 7 | Where does pool tuning live? | `.env.local.example`, new comment | `packages/vercel/src/store.ts` header; `git grep -n "lib/server" -- apps/kitchen-sink` prints nothing |
| 8 | When is `STORE_TYPE` ignored? | `.env.local.example`, new comment; README env table | `defaultProfile` in `fsdev.config.ts` |

Rows 1–6 hold on `main` today (checked while drafting); rows 7–8 are what this PR makes true.

## Guardrails

- **Touch only `.env.local.example`,** because the fence forbids re-landing #2350's bullets and
  the README already says the right thing.
- **No real values in the example file,** because it is committed and copied as-is.
- **No changeset,** because `apps/kitchen-sink` is private (BP-022).
- **Don't route through `docs-writer`/`docs-editor`,** because this is a code comment in a config
  example, not user-facing site prose; a two-line correction doesn't earn the isolation.

## Notes from review

None yet.
