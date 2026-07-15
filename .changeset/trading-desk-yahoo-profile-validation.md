---
---

Trading Desk: Yahoo lookups no longer discard a usable result when Yahoo returns
incomplete metadata (FIX-762). `yahoo-finance2` validates every response against a
strict schema and throws on any miss — a null `summaryDetail.currency` / an
incomplete `quoteType` (sector classification) or a null `meta.currency` / absent
`meta.regularMarketPrice` (price history + quotes) — both common for real held
tickers. That throw discarded data we don't even read: the `assetProfile.sector`
Yahoo actually returned, or the OHLCV bars behind unused `meta` fields. Because
the classifications route only persists successes, an affected ticker re-hit Yahoo
and re-threw on every request (the loud "Failed validation" logs).

The identity/sector fetch and the chart fetch now read the raw result
(`validateResult: false`), each still keeping its own honest fallback (the profile
fetch throws when Yahoo genuinely returns no name; the chart fetch filters bars by
present open/close). The fundamentals / short-interest fetches keep strict
validation plus provider-chain fallback — the correct behavior for numeric data
feeding analysis. Also bumps `yahoo-finance2` to the latest v3 (`^3.15.4`), picking
up its security fixes (cookie-file permissions, constant-time token comparison).

The sector fetch also normalizes dotted class-share tickers (`BRK.B` → `BRK-B`,
Yahoo's spelling) before the lookup — the `fetchYahooSplits` precedent. This fetch
has no fallback provider (Yahoo is the only sector source), so an unnormalized
dotted ticker silently never resolved; price refresh never showed the gap because
it falls through to Finnhub first.

The Health view's "Unclassified" bucket also no longer swallows funds mistyped as
equities. A broad-market / sector / thematic ETF or crypto trust whose ticker
shape is indistinguishable from a real equity's (`VOO`, `XLE`, `IBIT`, …) was
imported `assetType: "equity"`, and Yahoo correctly reports no GICS sector for a
fund — so it sat permanently "Unclassified". A sector miss is now checked against
Yahoo's own instrument-kind field (`fetchYahooQuoteKind`); when it confirms a
fund/crypto/money-market asset, the holding is auto-corrected via the classifier
every import path already uses (a known bond ETF still lands `fixed_income`, not a
blanket `etf`), preserving any manual class override. A one-time
`backfill-fund-classification` script catches up holdings imported before the fix
(run with the dev server stopped — it opens its own embedded-DB connection).

Sector-exposure bars are now expandable to their constituent tickers (weight
desc), so a fund-heavy book can see which funds drive the "Funds (no
look-through)" slice (real ETF look-through remains FIX-801).

Internal lab change — no public API.
