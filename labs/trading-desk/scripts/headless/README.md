# Headless run harness

Run the `analyze` pipeline from the terminal and read a machine-readable result,
instead of the browser. This is what lets an agent improve the desk over many
runs the way it runs tests: a command that executes the pipeline, exits with a
status, and leaves a structured record it can read.

It composes the already-shipped pieces — `fsdev run --capture` and the desk's
durable records (the decision-of-record snapshot, the typed memos, the session
stop-state) — rather than re-implementing execution. Run everything from the app
directory (`labs/trading-desk`); `fsdev` config search is cwd-only.

## Single run

```bash
pnpm run:headless '{"ticker":"NVDA","dataSource":"fixture","costPreset":"fast"}'
pnpm run:headless '{"ticker":"NVDA"}' --out summary.json --model openai/gpt-5.4-mini
```

Prints a `RunSummary` (JSON) to stdout. Exit code mirrors the run: **0**
completed, **2** stopped (a guard tripped — e.g. an unresolvable ticker), **1**
error (the run failed to execute). A single run uses the shared `.fsdev/pglite`,
so it lands in the same data the app reads and **appears in Past Reports**.

## Batch

```bash
pnpm batch scripts/headless/manifest.fixture.json
pnpm batch my-manifest.json --model openai/gpt-5.4-mini
```

Runs a matrix with bounded concurrency and appends one `RunSummary` line per run
to a JSONL **scoreboard** — the artifact an agent loop reads. The harness records
what happened; it does not judge whether a run was good (that is the eval-suite's
job, FIX-790).

Each batch run executes in its **own temporary PGlite database**, because PGlite
is single-process and concurrent runs cannot share one data dir. The trade-off:
batch runs do **not** appear in Past Reports — the scoreboard is the batch
artifact. (Set `DATABASE_URL` to back the desk with a real Postgres if you want
concurrent runs to share durable storage.)

### Manifest

Either an explicit `runs` list, or a `tickers × axes` matrix expanded by
cartesian product. Absent axes fall back to the analyze-input defaults.

```json
{
  "concurrency": 3,
  "scoreboard": ".fsdev/headless/scoreboard.fixture.jsonl",
  "tickers": ["NVDA", "AAPL", "JPM"],
  "axes": {
    "date": ["2026-05-06"],
    "costPreset": ["fast"],
    "dataSource": ["fixture"]
  }
}
```

`scoreboard` resolves from the cwd. `concurrency` defaults to 1. An empty
expansion writes an empty scoreboard and exits 0. The batch exits non-zero only
on a harness-fatal condition (manifest unreadable, scoreboard unwritable) —
stopped and errored runs are recorded data, not batch failures.

## The summary

`RunSummary` (`src/flows/analysis/run-summary.ts`) is the contract. Per run:
final rating + decision confidence, target weight + the mandate gates
(`mandateVerdict` / `capacityVetoed` / reward-to-risk / worst-case), trade levels
(direction / size / stop / target / holding period), the stop reason if it
stopped, per-memo status (published / error / pending), `durationMs`, `sessionId`,
and `capturePath` (the analyze capture file — the run's trace pointer). It is the
headless sibling of the UI Summary (`components/summary/aggregate.ts`).

## Goal check

The fixture-mode batch over the 3-ticker corpus is the smoke proof. It runs real
models (fixture stubs DATA tools only) and lives as a `goals/` check:

```bash
pnpm tsx goals/trading-desk-headless/fixture-batch-runs-clean/run.mts
```
