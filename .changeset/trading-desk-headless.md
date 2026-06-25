---
---

Trading Desk: add a headless run + batch harness to the private
`@flow-state-dev/trading-desk` example. A single command runs `analyze`
end-to-end from the terminal and emits a machine-readable **run summary** (final
rating + clamps, target weight + mandate gates, stop reason, per-memo status,
duration, session id, capture path); its exit code distinguishes completion vs
stop vs error, and a single run lands in the shared data so it appears in Past
Reports. A batch runner takes a manifest (an explicit run list or a
`tickers × axes` matrix), executes runs with bounded concurrency — each isolated
in its own temporary database — and appends one summary line per run to a JSONL
**scoreboard**, the artifact an agent loop reads instead of the browser. A new
zero-model `runSummary` flow action projects the stored decision snapshot,
memos, and stop-state into the summary; a `TRADING_DESK_DATA_DIR` env seam backs
the per-run isolation. The trading-desk guide gains a "verifying changes
headlessly" section, and a `goals/` smoke check runs the fixture batch over the
3-ticker corpus. Internal-only — no publishable package surface changes.
