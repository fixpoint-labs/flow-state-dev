# Trading Desk fixtures

Hand-curated JSON fixtures keyed by `(ticker, date)`. The fixture
`DataSource` reads from `fixtures/{TICKER}/{YYYY-MM-DD}/{tool-name}.json`.

## Canonical fixtures

| Ticker | Date | Notes |
| --- | --- | --- |
| `NVDA` | `2026-05-06` | Default demo fixture; matches the design handoff. |
| `AAPL` | `2026-05-06` | Demonstrates the (ticker, date) keying mechanism. |
| `JPM` | `2026-05-06` | Demonstrates the (ticker, date) keying mechanism. |

## Tool-name files

Each fixture directory ships one JSON file per canonical tool name:

- `balance-sheet.json` — `get_balance_sheet`
- `income-statement.json` — `get_income_statement`
- `cashflow.json` — `get_cashflow`
- `fundamentals.json` — `get_fundamentals`
- `prices.json` — `get_price_history`
- `indicators.json` — `compute_indicators`
- `company-news.json` — `search_news`
- `macro-indicators.json` — `get_macro_indicators`
- `social-sentiment.json` — `get_social_sentiment`
- `reddit-mentions.json` — `get_reddit_mentions`

Files land in Steps 5 and 6 of the implementation sequence; this directory
is the pre-allocated home for them.

## Adding a new fixture

1. Create `fixtures/{TICKER}/{YYYY-MM-DD}/`.
2. Author each tool-name file by hand (or copy and trim the closest live
   response). Keep payloads small — these run on every demo.
3. Update the table above.
