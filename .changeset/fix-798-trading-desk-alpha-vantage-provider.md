---
---

Trading Desk: the private `@flow-state-dev/trading-desk` example gains **Alpha
Vantage** as a data provider — the foundation the rest of the AV data family
builds on. AV is wired as a terminal fallback and stub-completer, never a
primary source: it finishes the two previously-dead stub tools
(`get_earnings_transcript`, `get_analyst_estimates`) and gives
`get_insider_transactions` a second source behind Finnhub.

A new `lib/providers/alpha-vantage.ts` module carries the load-bearing pieces:
`hasAlphaVantageKey()`, a shared `alphaVantageRequest()` helper that injects the
`apikey`, treats AV's HTTP-200 `Note`/`Information` (quota throttle) and
`Error Message` (request-shape) bodies as distinct thrown failures, and runs a
race-free in-process daily-budget guard governed by a single
`ALPHAVANTAGE_DAILY_LIMIT` knob (default 25; `0` disables it for a paid plan).
The guard reserves its unit synchronously before the fetch, so a concurrent
analyst fan-out can't overshoot the cap; it is best-effort (a process restart or
serverless cold-start resets the counter), with AV's server-side throttle as the
real-exhaustion backstop.

The transcript fetcher resolves the latest *reported* fiscal quarter via an
`EARNINGS` probe (deriving the fiscal-quarter label from the issuer's
fiscal-year-end month so offset-fiscal-year filers like Apple resolve
correctly), the estimates fetcher enriches the Finnhub baseline with AV price
targets + forward consensus under primary-wins provenance, and the insider
fetcher maps AV's coarser direction-only rows (blank transaction code, direction
in the sign of `shares`) capped at 50. The disclosure and news analyst prompts
are updated to be provider-agnostic (no stale FMP references; AV insider rows
read by direction + derivative flag). Internal lab / private example — no public
API changes.
