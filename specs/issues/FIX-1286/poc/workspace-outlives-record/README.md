# POC · a run workspace outlives the request record that binds its id

Retained design evidence for [FIX-1286](../../SPEC.md). Throwaway code, excluded from every
default test and typecheck run: nothing under `specs/` is in a package's vitest `include` or
`tsc` roots, and `knip.json` ignores `specs/issues/*/poc/**`.

## The question

The epic's [D3](../../../../epics/FIX-1635/DECISIONS.md#d3) and the Architect's call on the
issue both rest on one premise: once FIX-1018 stops one user adopting another user's request
record, two users with one request id already have two requests, so the run workspace keyed on
`[tenant, requestId]` needs no change. Does that hold over real HTTP?

## What it runs

The FIX-1018 two-users-one-tenant server (SQLite, a stand-in principal resolver), a flow whose
one action is the bash tool with `{ type: "local", scope: "run" }`, session retention of `1ms`,
and the documented `releaseBashSandbox` cleanup on `request.onFinished`.

1. **LIVE.** Alice writes `note.txt` under request id X. Bob sends X as his own `requestId`.
2. **EVICTED.** Alice writes `note.txt` under X, then a second request in her session completes,
   so retention deletes X's record (her `GET …/requests/X/status` is a 404). Bob sends X.

Bob's command tags its own output (`BOB_SAW:…`), so a hit is his run reading the file, not an
item of Alice's that a replay carried.

## What it showed · 2026-09-29, on FIX-1018's head `71f036a03`

```
[LIVE]    alice=req_…4b7d754d7ab44 bob=req_ec1922…  bob-read-secret=false bob-ran=true
[EVICTED] alice's first record after retention: HTTP 404
[EVICTED] alice=req_…422161cd7e2c7 bob=req_…422161cd7e2c7 same-id=true bob-read-secret=true replay-carries-alice-item=false
```

- **LIVE: the premise holds.** Bob is handed his own id and an empty workspace. FIX-1018 delivers
  this half of ER-4 with no workspace change.
- **EVICTED: the premise fails.** Nothing holds X once its record is gone, so Bob runs under X
  itself and reads Alice's file. The record is deleted; the directory is not, and cleanup only
  drops the in-process sandbox entry. Bob's replay carried none of Alice's items, so the leak is
  the workspace alone.

The EVICTED assertions pin today's leak, which is the point of the POC. The regression case
([PLAN V4](../../PLAN.md#checks)) asserts the opposite and is not this file.

## Run it

On FIX-1018's head until #2377 merges, then on `main`:

```bash
git checkout origin/fix/fix-1018                                   # or main, after #2377
git checkout origin/spec/FIX-1286 -- specs/issues/FIX-1286/poc     # until this spec merges
pnpm install
cd packages/integration-tests
npx vitest run --config ../../specs/issues/FIX-1286/poc/workspace-outlives-record/vitest.config.mts
```

Both cases pass today, which records the leak. After FIX-1286's fix, the EVICTED case fails on
`expect(leaked).toBe(true)`: that red is the fix working.
