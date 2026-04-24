# Business & Markets

Extra guidance when the question is about earnings, mergers and acquisitions, market moves, company announcements, executive changes, or industry-sector trends. Load this on top of the core `check-news` playbook.

## Recency targets

- **Intraday market moves** → last 24 hours, with the timestamp visible in the response.
- **Earnings, guidance, material filings** → last 14 days, tied to the reporting period.
- **M&A, funding rounds, leadership changes** → last 30 days.
- **Sector or industry shifts** → last 90 days for trends, cite dated data points inside.

Market narratives drift hour by hour. A headline from last week may contradict what happened yesterday.

## High-signal sources

1. **Primary filings**: SEC EDGAR (`sec.gov/cgi-bin/browse-edgar`) for 10-K, 10-Q, 8-K, S-1, proxy statements. Equivalent regulators elsewhere: SEDAR+ (Canada), UK Companies House, HKEX, etc. Always cite the filing, not a summary.
2. **Company IR pages**: official earnings releases, press releases, guidance updates. Usually at `investors.<company>.com` or `<company>.com/news`.
3. **Wire services**: Bloomberg, Reuters, Dow Jones. Earliest breakers for market-moving news.
4. **Business dailies**: WSJ, FT, Nikkei, Handelsblatt. Good for analysis and context.
5. **Market data providers**: for prices, use a recognizable source with a visible timestamp (Yahoo Finance, Google Finance, official exchanges). Always include the timestamp — prices stale within minutes.

Lower-signal:

- **Analyst notes** from sell-side banks — useful as opinion, not as fact. Attribute them ("Morgan Stanley analyst X argued ...").
- **StockTwits / Reddit WSB** — sentiment, not facts.
- **Crypto news sites** — vary wildly in quality. Prefer on-chain data plus established outlets (CoinDesk, The Block, Bloomberg crypto desk).

Avoid:

- Penny-stock promoters and "insider" newsletters with paywalled vague claims.
- AI-generated "earnings summary" aggregators — they often mix quarters or misread figures.

## Search query patterns

- `<ticker> earnings <quarter> <year>` e.g. `NVDA earnings Q4 2026`
- `<company> 8-K <month> <year>` for material disclosures
- `site:sec.gov <company>` to find filings directly
- `<company> announces <topic> <year>`
- `<sector> outlook <quarter> <year>`

## Numbers are the whole point

Business questions usually turn on specific numbers. Be strict:

- **Units**: millions vs billions, USD vs EUR vs JPY. Mixing these is a common wire error; reconfirm from the filing when a number sounds off.
- **Period**: quarterly vs annual vs TTM (trailing twelve months). Label it.
- **GAAP vs non-GAAP**: companies report both. Non-GAAP omits things companies don't want to count; GAAP is the regulated view. State which you're quoting.
- **Year-over-year vs quarter-over-quarter**: different stories from the same data. Pick one consistently in a comparison.

Every number should be paired with a period and a unit. A raw "revenue was 12" is useless.

## Timing and market hours

Note the market timezone for intraday claims. US markets: NYSE/NASDAQ 9:30–16:00 ET. After-hours moves are real but thinly traded. If a question comes in at an odd hour, make the timezone and the session (pre-market / regular / after-hours) explicit.

## Common traps

- **Revenue vs bookings vs ARR**: SaaS companies use each differently. Check the definition in the filing.
- **Adjusted EBITDA vs operating income**: "adjusted" hides real costs. Compare like with like.
- **Stock-based compensation**: non-GAAP often excludes it. Worth flagging when large.
- **"Record" anything**: at a company growing 5 percent annually, "record revenue" is noise. Context matters.
- **Forward guidance**: differentiate what was just announced from what was already expected.

## When to caveat

Open the answer with a caveat when:

- The data point is from before the most recent reporting period.
- The number is non-GAAP without a GAAP comparison.
- Prices quoted are not real-time.
- Reporting on M&A or funding is pre-confirmation ("people familiar with the matter" kind of sourcing).
