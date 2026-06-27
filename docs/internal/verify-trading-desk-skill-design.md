# Design — `verify-trading-desk` skill + lean the headless harness

**Date:** 2026-06-26
**Branch / PR:** `claude/busy-goodall-0st9hw` (PR #651, FIX-788)
**Status:** approved, implementing

## Why

PR #651 shipped a headless run + batch harness for the trading-desk `analysis`
flow. Two problems surfaced on review:

1. **Discoverability:** nothing makes an agent *reach for* the harness — only a
   lab-local CLAUDE.md section, no skill, no AGENTS.md pointer.
2. **Redundancy:** the wrapper scripts largely re-implement what `fsdev run`
   already does. `fsdev run --capture` writes `{command, events, result}` with
   `result.output` + `result.exitCode`; `--quiet` silences stderr logs. The
   single-run wrapper is ~80% that plus a file read.

This lands the discoverability + a real lean-out, scoped to the trading-desk.

## Verified facts (grounding)

- `fsdev run` exits `0` for **both** completed and stopped (a guard-stop is
  `success`); non-zero only on execution error ([run.ts:519](../../packages/cli/src/commands/run.ts#L519)).
  So completed-vs-stopped is **not** in the exit code — it lives in resource
  state. That's why `runSummary` (the read action) must exist.
- The discovery path uses the **filesystem store** (`.fsdev/data/state/session/
  <id>/<key>`, one readable JSON per resource). But the desk overrides stores to
  **PGlite** (FIX-772, relational portfolio tables), so a real desk run's
  resources go into Postgres — not file-inspectable. A run's decision is read
  back only via `runSummary`.
- The desk's `createModelResolver` **throws** on an inherited `FSDEV_INTENT_*`
  for an intent it doesn't declare ([createModelResolver.ts:401](../../packages/core/src/models/createModelResolver.ts#L401)).
  That's the crash the harness worked around by stripping env.
- Smoke (this env): `pnpm run:headless '{"ticker":"NVDA","dataSource":"fixture",
  "costPreset":"fast"}'` → `completed`, Buy, conf 0.85, exit 0, 160.7s, all memos
  published. Harness works; `--out` file is clean.

## Decisions (all approved)

- **Scope:** trading-desk only. A generalized headless-verify is out of scope.
- **Lean level:** delete all four wrapper scripts (`run.mts`, `batch.mts`,
  `harness.ts`, `lib.ts`) + their two test files. Keep `runSummary` action +
  `run-summary.ts` schema + their tests + the flow wiring. The skill teaches the
  raw two-step.
- **Resolver fix:** an undeclared `FSDEV_INTENT_<NAME>` warns-and-ignores instead
  of throwing, so raw `fsdev run` works in automation envs with no env-strip.
- **Sequencing:** ship this now; spec the two `fsdev` framework capabilities
  (lean output mode; `--store` override) separately for review — no engine/CLI
  change in this PR.

## The agent-facing workflow (what the skill teaches)

Run everything from `labs/trading-desk` (config search is cwd-only).

```bash
# 1. The real run — trace to the capture file, stderr logs silenced.
pnpm fsdev run analysis analyze \
  -i '{"ticker":"NVDA","dataSource":"fixture","costPreset":"fast"}' \
  --session v1 --capture .fsdev/headless/v1.analyze.json --quiet
# exit 0 = ran (completed OR stopped), non-zero = errored.

# 2. The zero-model read-back — the machine-readable RunSummary.
pnpm fsdev run analysis runSummary \
  -i '{}' --session v1 --capture .fsdev/headless/v1.summary.json --quiet

# 3. Read .fsdev/headless/v1.summary.json → result.output = the RunSummary
#    (status, finalRating, mandate gates, per-memo status, memoErrors).
#    The analyze capture's events[] is the full trace, available on demand.
```

**Verification ladder (record→replay):**
1. **Quick check** → `fixture` + `fast` (cheap, deterministic, default).
2. **Full-flow check needing data fixtures lack** → one-time `record` + `full`
   to populate `fixtures/<TICKER>/<DATE>/`, then replay with `fixture`.
3. **Reading the result:** `status`, `memoErrors`, mandate gates; the analyze
   `capturePath` is the trace pointer for debugging.

## Implementation checklist
1. **Resolver fix (TDD):** undeclared `FSDEV_INTENT_<NAME>` → `warnOnceDev` +
   skip, not throw. Update the two env-override tests; add a changeset (core).
2. **Delete** `run.mts`, `batch.mts`, `harness.ts`, `lib.ts`, `headless-harness.spec.ts`,
   `headless-lib.spec.ts`; remove the `run:headless` / `batch` package scripts.
3. **Rewrite** `goals/trading-desk-headless/fixture-batch-runs-clean` to drive
   raw `fsdev run` (single NVDA run + runSummary, assert completed + decision +
   PM memo). Drop `manifest.fixture.json`. Update the changeset; reword the
   `TRADING_DESK_DATA_DIR` comment (no longer batch-specific).
4. **Skill:** `.claude/skills/verify-trading-desk/SKILL.md` — the workflow above.
5. **Docs:** `AGENTS.md` "Verifying flow changes" pointer; `labs/trading-desk/
   CLAUDE.md` "Verifying changes headlessly" rewritten to the raw two-step.
6. `pnpm --filter @flow-state-dev/trading-desk test` + core resolver tests green.
7. **Examples:** raw fsdev single run + runSummary read; record→replay if keys.

## Residual sharp edge (noted, not fixed here)
An ambient `FSDEV_DEFAULT_MODEL` pointing at a provider the app doesn't configure
is a separate operator misconfiguration (a legit override mechanism). The skill
notes it; the resolver fix covers the undeclared-intent crash only.

## Out of scope (→ separate framework design doc)
- `fsdev run` lean output mode (trace → `--log`, stdout returns key info).
- `fsdev run --store <filesystem|memory>` override.
- Batch sweeps / scoreboard → the eval-suite (FIX-790).
