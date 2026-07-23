---
name: verify-trading-desk
description: Verify a trading-desk analysis change by running the real analyze pipeline headlessly and reading a machine-readable RunSummary — no browser, no custom harness. Use after changing desk analysis logic (a block, generator, orchestration step, scoring math, prompt, capability) when you need to confirm the real path produced a decision, not just that unit tests pass. Drives raw `fsdev run` for analyze + the zero-model runSummary read action.
argument-hint: "[what you changed, e.g. 'reweighted the lens convergence' or 'new macro tool']"
---

You are verifying a change to the `@flow-state-dev/trading-desk` `analysis` flow
by running it for real and reading the outcome. This is the desk's answer to
"how do I know my change works end-to-end" — the equivalent of running tests, but
for the live generator path that `pnpm test` mocks away.

## Core principle

**Run it, then read the summary.** `pnpm test` mocks every generator, so it
proves wiring, not behavior. A real `fsdev run` exercises the actual analyst →
research → trader → risk → PM pipeline against real models. You confirm the
change by reading a `RunSummary` (the decision + per-memo status), not by
watching a browser.

## When to use

- You changed desk analysis logic: a block, generator, orchestration step,
  scoring/valuation math, a prompt, a capability preset, a tool.
- You want to confirm a real run still **completes with a decision** (and the
  memo you touched still publishes), or to see how the decision moved.

Not for: UI/rendering changes (open the app), or pure unit-level wiring
(`pnpm --filter @flow-state-dev/trading-desk test`).

## The workflow — two raw `fsdev` calls + a file read

Run everything from `labs/trading-desk` (fsdev config search is cwd-only). There
is no wrapper script; you drive `fsdev run` directly.

```bash
# Pick a session id you can reuse across both calls.
SID=verify_$(date +%s)

# 1. The real run. --capture writes {command, events, result} to a file;
#    --quiet silences the [flow-state] stderr logs. The NDJSON trace still
#    streams to stdout (redirect it to a log if you don't want it inline).
pnpm fsdev run analysis analyze \
  -i '{"ticker":"NVDA","dataSource":"fixture","costPreset":"fast"}' \
  --session "$SID" --capture ".fsdev/headless/$SID.analyze.json" --quiet \
  > ".fsdev/headless/$SID.analyze.log" 2>&1

# 2. The zero-model read-back. runSummary reads the desk's stored decision
#    snapshot + memos (which live in PGlite, NOT in the NDJSON stream) and
#    returns the machine-readable RunSummary as its output.
pnpm fsdev run analysis runSummary \
  -i '{}' --session "$SID" --capture ".fsdev/headless/$SID.summary.json" --quiet \
  > /dev/null 2>&1

# 3. Read the decision. The RunSummary is the runSummary capture's result.output.
cat ".fsdev/headless/$SID.summary.json" | python3 -c \
  'import json,sys; print(json.dumps(json.load(sys.stdin)["result"]["output"], indent=2))'
```

**Why a separate `runSummary` call?** `fsdev run`'s NDJSON/capture record items
and events, not resource VALUES. The desk's decision lives in a session resource
(and the desk stores resources in PGlite, which isn't a readable file). The
zero-model `runSummary` action is the blessed read-path back out — it projects
the decision snapshot + every memo's status into one object.

## Reading the result

The RunSummary (`src/flows/analysis/run-summary.ts`) is the contract. Read these:

| Field | Meaning |
| -- | -- |
| `status` | `completed` (a decision) / `stopped` (a guard tripped) / `error` |
| `stopReason` | why a stopped run stopped (e.g. `unresolvable-ticker`) |
| `finalRating` | `Sell`…`Buy` — null on stopped/errored runs |
| `decisionConfidence`, `targetWeightPct`, `direction`, `sizePct`, `stopPrice`, `targetPrice` | the trade decision |
| `mandateVerdict`, `capacityVetoed`, `rewardToRiskLossAdjustedGlr`, `worstCaseReturnPct` | the risk-mandate gates (null when mandate-blind) |
| `memos[]` | `{ key, agentName, status }` per participant — find the memo you touched and confirm `status: "published"` |
| `memoErrors` | count of memos that errored (a non-fatal partial; the run can still produce a decision) |

**Exit codes:** `fsdev run` exits `0` when the action ran (completed OR stopped)
and non-zero only when it errored. So the exit code alone can't tell completed
from stopped — read `status`. The `analyze` capture's `result.execution.durationMs`
and `result.exitCode` carry timing/exit; `result.events` is the full trace if a
memo errored and you need to see why.

## The verification ladder (cost discipline)

Default to the cheapest run that answers your question. Escalate only when you
must.

1. **Quick check (default)** — `dataSource:"fixture"`, `costPreset:"fast"`.
   Fixtures stub the DATA tools (deterministic, no provider keys) but generators
   run live, so this exercises your change on the real model path. Cheap.
2. **Full flow** — `costPreset:"full"` runs the lens pack + the heavier presets.
   Use it when your change touches `full`-only logic (lenses, convergence,
   investigate preset). Fixture mode still works if the corpus has the data.
3. **Record → replay** — when the full flow needs data the fixtures lack
   (a new tool, a new ticker, a non-primary tool gap that shows up as
   `memoErrors`): run it **once** live with `dataSource:"record"` to capture the
   real provider payloads into `fixtures/<TICKER>/<DATE>/`, then replay
   deterministically with `dataSource:"fixture"`. You pay for live data once;
   every later verification is free and reproducible. Recording needs the live
   provider keys (`FINNHUB_API_KEY`, `FRED_API_KEY`, …) and `costPreset:"full"`
   so the `discover_*` tools run. See `fixtures/README.md`.

A genuinely live verification (`dataSource:"live"`) is for confirming the live
data path itself — slowest, most expensive, real market data.

## Environment notes

- `AI_GATEWAY_API_KEY` is required (fixture runs still call real models through
  the Vercel gateway).
- The desk's `fsdev.config.ts` owns its model ladder. An inherited
  `FSDEV_INTENT_*` for an intent the desk doesn't declare is now harmless (the
  resolver warns and ignores it). But an ambient `FSDEV_DEFAULT_MODEL` pointing
  at a provider the desk doesn't configure will still break generation — unset it
  for verification runs if your environment pins one.
- A single run uses the shared `.fsdev/pglite`, so it appears in the app's Past
  Reports. For a throwaway run that shouldn't, set `TRADING_DESK_DATA_DIR` to a
  temp dir.

## The committed smoke proof

`goals/trading-desk-headless/fixture-run-clean/run.mts` is this exact two-step
over a single NVDA fixture run, asserting `completed` + a decision + a published
PM memo. Run it (`pnpm tsx goals/trading-desk-headless/fixture-run-clean/run.mts`)
to confirm the path end-to-end after a broad change.
