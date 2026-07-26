# ETF profile & holdings look-through (FIX-801)

The Health view answers "how balanced is my book?" honestly for individual
stocks and gives up on funds — own an S&P 500 fund and Apple directly, and the
old view reported two unrelated positions, with the fund's whole value dumped
into a bucket literally labelled "Funds (no look-through)". Look-through is a
**second, additive read** that sees inside a fund: a direct holding and the
same name held through a fund add up instead of sitting apart, and a fund's
sector mix attributes to real sectors instead of the placeholder bucket.

**The honesty posture, up front.** The data is a third party's *stated*
composition, not a live position feed, and the provider is quietly unreliable
about it — some funds it covers well, some it covers badly, and it says
nothing about which. So every derived number carries its own coverage figure,
uncovered weight is never renormalized away, and a fund whose data is too thin
is left **opaque and named as incomplete**, not half-attributed. The wrapper
basis (the plain per-account figures the Health view has always shown) is
completely unchanged by this — look-through sits beside it, never replaces it.

This doc is the methodology reference. The user-facing surface is the Health
perspective's look-through section (`components/portfolio/health-section.tsx`);
the arithmetic is `domain/portfolio/math/etf-look-through.ts`
(`computeLookThroughExposure`, a pure leaf — no IO); the data path is
`lib/providers/etf-profile.ts` + `app.etf_profiles` (`db/schema.ts`) +
`app/api/portfolio/etf-profiles/route.ts`.

## Where the data comes from

A fund's holdings composition is fetched, once, from Alpha Vantage's
`ETF_PROFILE` endpoint — the shared provider request already built for the
desk's other Alpha Vantage consumers (FIX-798), extended with per-minute
pacing so a fan-out over several uncached funds doesn't get throttled after
already spending its daily budget on requests whose answers never arrive.

The response carries **no as-of date and no echo of which fund it describes**
— identity comes from the request, and the fetch's own timestamp is the only
date the desk has. Constituent weights and coverage totals arrive as strings
with an `"n/a"` sentinel for non-attributable rows (foreign lines, futures,
cash), in either of two weight formats; a documented asset-allocation field is
absent from live responses despite being documented and must be treated as
gone. All of that provider-quirk absorption happens once, at the fetcher —
every downstream layer receives an already-normalized, already-judged profile.

The fetched profile is kept in a durable, ticker-keyed table
(`app.etf_profiles`) — the second table of this shape beside
`instrument_classifications` (FIX-762), refreshed only when the stored copy is
older than ~30 days (a ceiling the data itself imposes: some large funds
publish holdings with a two-week lag, so a tighter bound would just re-spend
budget re-fetching an unchanged file). It is reference data, not a quote: a
fund's constituent list barely moves (an index reconstitutes quarterly or
annually), so fetching it once and remembering it is the correct cadence, not
a corner cut.

## What `lookThrough` means

`lookThrough` is a two-state read: `"none"` (no funds held, or none could be
attributed) and `"partial"` (at least one fund contributed real exposure).
There is deliberately no `"full"` state — coverage is never exactly 100% on
real data, and a state that can't occur would invite code to branch on it.
`"partial"` carries a nullable `lookThroughExposure` block: effective per-name
exposure (with a per-wrapper source breakdown — which slice came from a direct
holding vs. which fund), real attributed sectors, two independent coverage
figures (names and sectors), the look-through basis's own tagged concentration
flags, and the list of funds left opaque, each with why.

## The eligibility predicate and the coverage floor

A fund only decomposes into names if it passes two gates.

**Eligibility** rules out funds whose constituents aren't resolvable single
names at all: mutual funds (the endpoint is ETF-only), leveraged/inverse funds
(read from the payload's own flag — never inferred from weights over 100%),
and bond/commodity funds (constituents are unsymboled debt or bullion). A
constituent that is itself a fund is detected by an ordered evidence oracle,
not the default classifier (which would otherwise type a bare ticker as
`equity` and let an all-ETF allocation fund report its component ETFs as false
single-name concentrations) — see `resolveTickerIsFund`'s own docblock in
`etf-look-through.ts` for the full evidence order. When a material share of a
fund's constituent weight resolves as other funds, the whole fund is a
fund-of-funds and stays opaque rather than half-decomposed.

**Coverage** catches the silent failure mode the provider doesn't warn about:
for a US-equity fund it typically returns the whole book (~500 constituents
summing to 99.5%+), but for an international fund it can silently return only
the US-listed slice — one measured example gave **15 of 137 holdings, summing
to 26% of the fund, with no error and no warning**. Below an 85% floor
(`LOOK_THROUGH_COVERAGE_FLOOR_PCT`, a tuning number, not a contract) the fund
stays opaque on that axis and is named "holdings data incomplete" — never
attributed at a fabricated confidence. The gate is evaluated **per axis**: name
coverage and sector coverage are independently incomplete provider fields, so a
fund can pass for names and fail for sectors, or the reverse — never a single
both-or-nothing verdict. A thin profile is stored, not refused: the row is
still persisted and re-read normally (coverage can improve on the next
refresh), and only genuine fetch failures or permanent ineligibility become a
refusal with its own retry backoff (below).

A stored profile can also be internally inconsistent (a duplicated or
corrupted row) even when its declared coverage looks fine — the leaf
reconciles the declared coverage against what the rows actually sum to and
rejects the axis as malformed, rather than trusting a number a corrupted row
would otherwise inflate into a false concentration alert.

## Why both bases are kept, and the lower-bound reading

The wrapper-basis fields (today's plain per-account figures) are never
replaced — they're what the brokerage statement says, observed rather than
derived, and existing readers of `lookThrough: "none"` keep working exactly as
before (nothing today reshapes on this change). Look-through is additive
context beside it, and every figure on it is an honest **lower bound**:
uncovered fund weight is an explicit residual, never renormalized to make a
fund's attribution reach 100%. Renormalizing sounds harmless but isn't — on a
badly-covered fund it can inflate a real 7% constituent into a reported 27%, a
near-4× fabrication presented as a concentration alert. So a look-through flag
firing is trustworthy; a flag **not** firing is not a clean bill of health,
since the uncovered remainder could hide more. The effective-position count
(the look-through analogue of "1/HHI") is reported as an interval, not a point
estimate, for the same reason — the unattributed residual could sit anywhere
from a long tail to piling entirely onto the largest name already seen, and
the interval's width says so honestly rather than picking a number.

**This reading does not move the analysis pipeline's deterministic sizing
gates** (mandate cap, policy clamp, evidence-sufficiency gate) — it reaches the
trader and portfolio manager as narrative context they reason with, not as an
input to a size cap. A household 25% concentrated in a name *through funds*
still clears a policy gate measured on the wrapper basis; that's a deliberate,
flagged non-goal (making the gates look-through-aware is a real-money behavior
change with its own sign-off, not bundled into this feature).

## Read-only in the analysis seed

The Health pane is what fetches — the analysis seed (`build-portfolio-context.ts`,
via `seedSession`) reads the SAME stored table **read-only and never fetches**,
exactly like it already does for sector classifications. One real consequence,
surfaced rather than hidden: the same household can read `lookThrough: "partial"`
in the browser and `"none"` in a headless analysis run whose funds nobody has
opened the Health view for yet. That's accepted rather than worked around — the
alternative (letting an analysis run spend the shared Alpha Vantage budget
mid-run) is worse, and the seed's numbers are always an honest *subset* of the
full picture, never a contradiction of it.

## The shared budget, pacing, and refusal backoff

Alpha Vantage's free tier caps at 25 requests/day and 5/minute, shared across
every consumer in the desk (analysis tools and this feature alike). The route
that fills `app.etf_profiles` derives its fund set **server-side** from the
user's own holdings, pre-filters what's already known for free (the curated
bond-ETF list, unpriced funds), fetches only misses/stale rows at low
concurrency, and caps how many misses one call will fetch — roughly a minute's
worth — so one page load can't spend half a day's budget; the remainder defers
to the next read. A failed fetch is remembered, not retried on every mount:
each refusal class gets its own retry-at (a `quota` refusal heals at the
provider's next daily reset; `not_an_etf`/`ineligible` — near-permanent facts —
wait ~90 days; `transient`/`malformed` are shorter), so a mistyped symbol or an
ineligible fund can't quietly starve the analysis pipeline of its shared
allowance.

## Worked arithmetic

A household holds $10,000 of Apple directly, $30,000 in a Nasdaq-100 fund, and
$60,000 in an S&P 500 fund (the two funds' stated weight in Apple: roughly 10%
each). The wrapper basis reports Apple at its direct 10.0% of the $100,000
book. Look-through adds the two funds' Apple slices ($3,000 + $6,000 = $9,000)
to the direct holding: an effective **19.0%**, coverage-qualified by however
much of each fund's own holdings the provider actually reported — 90% higher
than the line item the old view showed, and the number a concentration read
actually needs to be honest.

## What it deliberately doesn't do

Mutual-fund look-through · leveraged/inverse/commodity/bond-fund attribution ·
multi-level look-through (a fund inside a fund resolves one level only; a
fund-of-funds is detected and left opaque, never half-decomposed) · merging
dual share classes (kept separate, matching the provider's own reporting) ·
drift-vs-target math (a separate, mandate-gated slice) · a new analysis-catalog
ETF tool or analyst wiring (a separate issue, once one has a caller) · changing
the analysis pipeline's deterministic decision gates (flagged as an explicit
open question, not decided here) · a generalized durable day-cache for Alpha
Vantage beyond this one table (a cross-cutting follow-up for the whole
provider family).

See also [`bond-etf-asset-class-design.md`](specs/bond-etf-asset-class-design.md)
for the curated bond-ETF list this feature reads (but does not supersede) as
one of its fund-detection evidence layers.
