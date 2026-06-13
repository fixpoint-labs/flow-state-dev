# Trading Desk fixtures

Hand-curated JSON fixtures keyed by `(ticker, date)`. The fixture
`DataSource` reads from `fixtures/{TICKER}/{YYYY-MM-DD}/{tool-name}.json`.

## Canonical fixtures

| Ticker | Date | Notes |
| --- | --- | --- |
| `NVDA` | `2026-05-06` | Default demo fixture; matches the design handoff. |
| `AAPL` | `2026-05-06` | Demonstrates the (ticker, date) keying mechanism. |
| `JPM` | `2026-05-06` | Demonstrates the (ticker, date) keying mechanism. |

## Recording fixtures

Run the `analyze` action with `dataSource: "record"` to produce a new snapshot.
Every tool payload is fetched live and written to `fixtures/{TICKER}/{DATE}/`.
Macro-indicator tools write to `fixtures/_macro/{DATE}/` because they are
ticker-agnostic. After the run, replay it with `dataSource: "fixture"` and the
same `ticker`, `date`, and `costPreset` to confirm it is clean.

```bash
pnpm fsdev run analysis analyze -i '{"ticker":"XOM","date":"2026-06-12","dataSource":"record","costPreset":"full"}'
pnpm fsdev run analysis analyze -i '{"ticker":"XOM","date":"2026-06-12","dataSource":"fixture","costPreset":"full"}'
```

Use `costPreset: "full"` for a complete corpus. The eight `discover_*` tools
only run on `full`; without it those files are not written and the fixture set
is incomplete.

Record mode runs the live provider chain, so the same API keys required for
live mode apply. Generators (LLM calls) still run live in record mode — the
recorded data is deterministic, not the LLM output.

Providers that cannot be reached return a `source: "unavailable"` payload. The
recorder writes these as-is, and the fixture loader replays them as
`"unavailable"` — a recorded provider miss stays a miss on replay.

Payloads are serialized with recursively sorted keys, 2-space indent, and a
trailing newline. Re-recording unchanged data produces identical bytes, so
`git diff` after a re-record is the drift check — a clean diff confirms nothing
changed.

See also [`../CLAUDE.md`](../CLAUDE.md) for the fixture/live/record mode
distinction and the `FIXTURE_SNAPSHOT` default date.

## Tool-name files

Each per-ticker fixture directory ships one JSON file per ticker-keyed
canonical tool name. Record runs write these names automatically.

- `balance-sheet.json` — `get_balance_sheet`
- `income-statement.json` — `get_income_statement`
- `cashflow.json` — `get_cashflow`
- `fundamentals.json` — `get_fundamentals`
- `prices.json` — `get_price_history`
- `indicators.json` — `compute_indicators`
- `company-news.json` — `search_news`
- `social-sentiment.json` — `get_social_sentiment`
- `reddit-mentions.json` — `get_reddit_mentions`

Macro indicators are date-keyed but ticker-agnostic, so they live under a
sentinel directory:

- `_macro/{YYYY-MM-DD}/macro-indicators.json` — `get_macro_indicators`

## Authoring a fixture by hand (fallback)

Prefer record mode (see above) for new snapshots. Hand-authoring is for cases
where live data is unavailable or a trimmed/synthetic payload is needed.

1. Create `fixtures/{TICKER}/{YYYY-MM-DD}/`.
2. Author each tool-name file by hand (or copy and trim the closest live
   response). Keep payloads small — these run on every demo.
3. Update the table above.
