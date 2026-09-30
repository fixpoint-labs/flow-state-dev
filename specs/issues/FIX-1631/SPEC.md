# FIX-1631 · Kitchen-sink docs gaps found by the closure's blind walk-through

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Improvement · docs · `apps/kitchen-sink` only · tiny · 1 PR · epic
[FIX-1592](https://linear.app/fixpoint-labs/issue/FIX-1592), soft polish, not a closure
blocker · sibling of FIX-1607 · builds on
[#2350](https://github.com/fixpoint-labs/flow-state-dev/pull/2350) (merged)

## The problem

#2350's last commit, `425cc4c1`, closed all six gaps this issue lists: direct `escalate` filing,
where things sit in the rail, the lingering working row, which model the specialists use, the
channels-guide fallback, and database URL precedence. What's left is the residue that Jake's
comment on the issue names, plus the README rows the review found:

- **`.env.local.example` describes a `VERCEL=1` switch that no longer exists.** The paragraph
  says Vercel sets `VERCEL=1`, that this "triggers two things in `lib/server.ts`" (pool tuning
  and the Neon driver), and that setting it locally forces the same behaviour. `lib/server.ts` is
  gone, and the store no longer reads `VERCEL`. The prod profile's store adapter supplies the
  pool and Neon settings (`packages/vercel/src/store.ts:1-10`).
- **The docs say a database URL always wins.** The example file says `STORE_TYPE` is ignored when
  `DATABASE_URL` is set. The README env table says `STORE_TYPE` is "Ignored when a database URL
  is set" (L246) and that with `FSD_DB_URL` set "the app stores everything there" (L247). All
  three are wrong when `FSD_ENV=dev` is set, because an explicit `FSD_ENV` picks the profile and
  the dev profile honours `STORE_TYPE` (`apps/kitchen-sink/fsdev.config.ts:175-190`).

## The goal, and how we'll know it's met

**Nothing in the kitchen-sink README or `.env.local.example` tells a reader something about
database setup that the app doesn't do.**

- **Smaller, and rejected:** close it, because #2350 did the work. That leaves a setup file that
  points at a file that doesn't exist.
- **Bigger, and not this issue's:** treating the working row as a product timing bug, the stale
  `fsdev.config.ts` header comment, and anything that changes `escalate` or FIX-1591's call.

**Evidence:** on the fix commit,
`git grep -n "lib/server\|VERCEL=1" apps/kitchen-sink/.env.local.example` prints nothing, and
both README rows name the `FSD_ENV` exception. The exact commands are in
[PLAN.md → Checks](PLAN.md#checks).

## What changes

```diff
 # apps/kitchen-sink/.env.local.example  (shape only; exact text in DOCS.md)
-# When deployed on Vercel, VERCEL=1 is set automatically … lib/server.ts …
-# … Setting VERCEL=1 locally forces the same behavior for testing.
+# (the whole paragraph becomes one line: nothing extra to set for Vercel)
-# STORE_TYPE is ignored when DATABASE_URL is set.
+# (defaults stated as "when FSD_ENV is unset", then a pointer to the README)

 # apps/kitchen-sink/README.md, env table
-| `STORE_TYPE` | … Ignored when a database URL is set. |
-| `FSD_DB_URL` | … When set, the app stores everything there. … |
+| `STORE_TYPE` | … Ignored when a database URL is set, unless `FSD_ENV=dev`. |
+| `FSD_DB_URL` | … When set, the app stores everything there, unless `FSD_ENV=dev`. … |
```

The example file stops restating how the app picks a profile. It points at the README env
table, which owns those rules.

## What stays as it is

The app's behaviour, the channels guide, every other README line, the `escalate` filing (which
works as designed), the lingering working row, and every bullet #2350 landed.

## Sign off

**Approve to merge.** The direction is decided ([D1](DECISIONS.md#d1)). If it's wrong, the cost
is a comment and two table cells that still disagree with the code.

**Open: none.**
