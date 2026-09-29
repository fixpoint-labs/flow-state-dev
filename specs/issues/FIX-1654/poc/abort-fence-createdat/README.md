# POC · the abort fence on `createdAt` fails in both directions

Retained design evidence for [FIX-1654](../../SPEC.md). Throwaway code, excluded from every
default test and typecheck run: nothing under `specs/` is in a package's vitest `include` or
`tsc` roots, and `knip.json` ignores `specs/issues/*/poc/**`.

## The question

The cancel route (`POST …/requests/:id/abort`) reads the record, checks the caller may reach it,
then writes the cancellation with `setFieldsIfStatus(…, record.createdAt)`. The issue says two
records under one id created in the same millisecond let that write land on the newer request.
Is that so on `main`, and does the fence also fail the other way, when a same-owner retry's
hand-off rewrites `createdAt` on a request that is still running?

## What it runs

The real cancel route handler and the real in-memory store. Between the route's read and its
write, the store's `get` is wrapped to do one thing:

1. **SAME MILLISECOND.** Delete tenant A's record and create tenant B's under the same id, both
   `createdAt: 1000`, each with its own minted incarnation.
2. **HAND-OFF.** Call the engine's own `claimRequestRecord` with the owner's retry record
   (`createdAt: 2000`), which hands the running record off.

## What it showed · 2026-09-29, on `main` `70f777def`

```
[SAME-MS]  status=202 stored-tenant=tenant_b same-createdAt=true same-incarnation=false other-tenant-aborted=true
[HAND-OFF] status=404 running=in_progress createdAt 1000->2000 incarnation-kept=true abort-recorded=false
```

- **SAME MILLISECOND: the premise holds.** Tenant A's cancel was recorded on tenant B's request.
  The incarnations differed; `createdAt` did not.
- **HAND-OFF: a second failure the issue didn't name.** The owner was told the request does not
  exist while it kept running. The hand-off kept the incarnation and rewrote `createdAt`, so an
  incarnation fence would have hit.

Not measured: how often an HTTP retry reaches the hand-off while the request is still running.
The interleave is forced here; the store behaviour under it is real.

The assertions pin today's defects, which is the point of the POC. The regression cases
([PLAN V1](../../PLAN.md#checks)) assert the opposite and are not this file.

## Run it

From the repository root, on `main` (and on the spec branch until it merges):

```bash
pnpm install
bash specs/issues/FIX-1654/poc/abort-fence-createdat/run.sh
```

`run.sh` copies the case into `packages/engine/test/`, runs it with the engine's vitest config,
and removes the copy on exit. After FIX-1654's fix both cases fail on their `expect`s: that red is
the fix working.
