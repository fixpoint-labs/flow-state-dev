# FIX-1631 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md)

## Surface

- **`apps/kitchen-sink/.env.local.example`.** Replace the **whole** `VERCEL=1` paragraph,
  including its lead-in ("When deployed on Vercel, VERCEL=1 is set automatically… That triggers
  two things") and its trailer ("Setting VERCEL=1 locally forces the same behavior for
  testing"). Replace the `STORE_TYPE` note too. Keep every variable line and placeholder as it
  is.
- **`apps/kitchen-sink/README.md`.** Change the `STORE_TYPE` and `FSD_DB_URL` rows of the env
  table (L246-247 on `7a23a753`).

**Confirm the line numbers on `main` before you edit.** The spec worker couldn't read `.env*`
files in its session, so the ranges come from reviewer quotes. Jake's comment on the issue gave
12–19 and 22. The second look read the paragraph as 13–19 and the `STORE_TYPE` note as 21–22.

## Order

1. Read `.env.local.example`, `fsdev.config.ts:175-190` and README L240-250.
2. Apply [DOCS.md](DOCS.md). #2350 fixed a precedence comment in the example file. If that
   comment sits next to the `STORE_TYPE` note, merge the new text into it instead of saying the
   same thing twice.
3. Run the checks below and paste their output in the PR.

## Checks

```bash
git grep -n "lib/server\|VERCEL=1" apps/kitchen-sink/.env.local.example   # must print nothing
git grep -n "FSD_ENV" apps/kitchen-sink/.env.local.example                # the qualifier is present
git grep -n "STORE_TYPE\|FSD_DB_URL" apps/kitchen-sink/README.md          # rows 246-247 name FSD_ENV=dev
git diff --stat main... -- apps/kitchen-sink                              # two files
```

**Red state:** on `main`, the first command prints the paragraph's lines. It may also print a
`VERCEL=1` line outside that paragraph. No reviewer quoted one, but the spec worker couldn't read
the file to rule it out. If one turns up, check whether it's accurate before you widen the
replacement.

#2350 closed the six gaps on `main`. Don't re-check them here.

## Guardrails

- **Don't re-land a #2350 bullet or touch the channels guide.** The fence forbids it.
- **Put no real values in the example file.** It's committed and copied as-is.
- **Add no changeset.** `apps/kitchen-sink` is private (BP-022).
- **Change no code,** including the stale `fsdev.config.ts` header comment (L11-13). That's out
  of scope.
- **Don't route this through `docs-writer`/`docs-editor`.** These are config comments and two
  table cells.

## Notes from review

- Cursor suggested keeping the `VERCEL=1` local-testing sentence. We declined, because nothing
  on the store path reads `VERCEL` ([DECISIONS → E2](DECISIONS.md#engineering-calls)).
- Both reviewers noted, as out of scope, that `fsdev.config.ts` L11-13 still says deploys set
  `FSD_ENV=prod`. Next to `defaultProfile`, that's stale.
