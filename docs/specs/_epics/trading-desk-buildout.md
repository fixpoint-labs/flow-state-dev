# Epic — Trading desk: Alpha Vantage data layer

> **Coordination artifact, not an implementing spec.** The issues under this epic do
> **not** derive from this doc — they *reference and align* to it. This is the shared
> surface, the sequencing spine, and the running index for the set. See
> [`docs/contributing/orchestration.md`](../../contributing/orchestration.md) for what an
> epic-spec is.
>
> **Epic issue:** FIX-934 · **Epic branch:** `epic/trading-desk-buildout` (never merged,
> never deleted) · **Project:** Trading Desk Lab · **Team:** flow-state

---

## 1. Purpose & objective *(the `epic approved` sign-off surface)*

**Why this body of work.** The trading-desk lab reasons on a thin live data layer. Several
data tools have only one provider, so when that provider has no key or fails the analyst
reasons on nothing instead of a second source; two tools were scaffolded against a provider
that was never wired at all; and some data the desk wants — fund look-through, a forward
events calendar, a ticker-scored sentiment number — has no provider behind it.

This epic adds **Alpha Vantage (AV)** — a NASDAQ-licensed source broad enough to close these
gaps — and groups the family of features that share it so their **cross-cutting calls are
made together rather than in a vacuum**: one provider module, one budget discipline, and one
fallback/provenance convention that every AV consumer plugs into.

**Outcome we are signing off on.** A shared `alpha-vantage` provider foundation
(**FIX-798**, the keystone) whose fetches fail cleanly — including AV's habit of returning
rate-limit messages as HTTP-200 bodies — so callers degrade to their next source, with a
documented **daily-budget discipline** that stops spending once the day's 25-request budget
is gone and steps aside on a paid tier. On that foundation, the family of AV-fed features:

- ticker-scored **news sentiment** (**FIX-799**),
- **ETF profile & holdings** look-through (**FIX-801**),
- **macro & commodities** series (**FIX-802**),
- **corporate events** — a forward earnings calendar and dividends (AV includes declared
  future payouts), plus **historical** splits (AV's SPLITS endpoint is historical-only, so no
  future-splits path) (**FIX-804**),
- and an **evaluation** of whether to use AV's server-side technical indicators at all
  (**FIX-803**) — a spike run at the appropriate time to decide relevance, not a committed
  build.

The market-wide **movers feed** (**FIX-800**) is **not** a deliverable of this epic. It is
built on this provider foundation, but candidate generation belongs to the opportunity-scanner
epic (**FIX-937**), which owns it: the provider is ours, the purpose is theirs, and the
dependency is cross-epic. It stays in the §3 index for history — it is why the foundation was
scoped broad enough to serve a market-wide feed — not as work this epic must land.

This is **mostly additive feature work on an existing desk**, not a new subsystem: one new
provider module plus budget discipline, and a set of tools that consume it.

**What ramps when the objective is approved.** Per the objective gate
(`orchestration.md` §Gates), the release signal is **an approving comment or GitHub Review
from a human on this epic PR** — the `epic approved` label is only the durable mirror the
coordinator writes afterwards, never the gate itself. Applying the label by hand does not
authorize ramping. On that human signal, the epic's Backlog sub-issues
(FIX-799 / 802 / 803 / 804) are released from NEEDS_SPEC so they can be specced. FIX-798
**predates the epic** — already in flight when the epic formed — so the epic wrapped it for
coordination rather than rolling it back. It has since landed, so the **sequencing spine**
that used to pace everything AV-fed no longer holds anything back.

**Holistic-necessity check (does the *set* overbuild even if each issue earns its place?).**

- **The AV family is a genuine cluster on one shared surface.** FIX-799 / 801 / 802 / 803 /
  804 all consume the *same* provider module and *same* budget discipline that FIX-798
  established (as does FIX-937's movers feed, cross-epic). Deciding them apart would have let
  each invent its own budget accounting and fallback behavior; grouping them fixed those once.
  No AV consumer adds surface another makes redundant.
- **FIX-803 is an evaluation, not a guaranteed build** (see §4 Q1) — it belongs in the set
  because that decision sits with the rest of the AV calls, but may close with no code.
- **Candidate generation is a different epic.** The opportunity scanner (FIX-902) and the
  movers feed it consumes (FIX-800) both sit under **FIX-937** — a screening/strategy layer,
  not a data-layer concern. This epic supplies the provider they source from and nothing more
  (tenet 2 — don't pull in speculative downstream surface).

Net: one provider foundation and its family of five data consumers (one of them an
evaluation) — a tightly-coupled, self-contained set. The capital-sleeves work (FIX-771),
originally grouped here, is a distinct capital-model concern in a different milestone and now
stands alone.

---

## 2. Themes & long-horizon direction

### 2a. The sequencing spine — FIX-798 was the keystone

FIX-798 is the provider foundation the entire AV family builds on: its module, its budget
discipline, and its provenance tag are shared infrastructure. It has **landed** (impl PR
#889), so it no longer gates anything. Spine:

**FIX-798 (landed) → { FIX-799 news-sentiment, FIX-801 ETF (landed), FIX-802 macro,
FIX-803 indicators-eval, FIX-804 events }.** FIX-937's movers feed (FIX-800) hangs off the
same foundation, cross-epic.

A consumer no longer waits on a spec to learn the shape it inherits — the budget, pacing,
cache, and provenance decisions are in the code and recorded in §4 Q3–Q5. What a consumer
must still do is align to that shape rather than reinventing it (§2b), and clear its own
`spec approved` gate (the per-issue gate always stands). FIX-803 is spiked when its turn
comes.

### 2b. The shared AV surface — one provider, one budget, one fallback convention

Every AV consumer agrees on the same three things FIX-798 established, so none of them
reinvents any of it:

- **One provider module.** All AV fetches go through the single `alpha-vantage` provider
  (`labs/trading-desk/lib/providers/alpha-vantage.ts`) on the desk's established provider
  convention — not per-tool HTTP.
- **One budget discipline.** AV's free tier is **25 requests/day (5/min)**. Wired naively
  across a fan-out of analysts, a single multi-ticker session exhausts it. Every consumer
  (news, ETF, macro, events, indicators — and the scanner epic's movers feed) spends against
  the *same* process-scoped daily counter and degrades honestly when it's gone, and against
  the *same* per-minute admission pacing, which waits for a slot instead of firing. Both step
  aside on a paid tier, so the discipline never becomes a hard dependency. What a consumer
  inherits, and what it must size its per-call cost against, is §4 Q3.
- **One fallback / provenance convention.** AV returns rate-limit messages as HTTP-200
  bodies; the provider detects that and fails cleanly so callers degrade to their next
  source, and every AV-sourced datum carries the same provenance tag. Where AV supplements a
  provider that already answers, provenance is **primary-wins** (§4 Q5). FIX-798 defined
  this; consumers inherit it.

### 2c. Consumers inherit, they don't reinvent

Each AV consumer extends an *existing* tool's fallback chain rather than standing up a
parallel pipeline — **FIX-799** behind the Finnhub news tools (`search_news` /
`get_market_news` / `get_macro_news`), **FIX-802** as a commodities *supplement* with FRED
still owning rates/liquidity (`get_macro_indicators`) — while **FIX-801** (landed) and
**FIX-804** add genuinely new primitives (ETF look-through, events calendar). Each issue
states its inheritance explicitly when it ramps. This keeps FIX-798's shared surface thin and
is why the family is one epic rather than five standalone tools.

**Deliberately out of the AV layer:** making AV the *preferred* source for any datum an
existing tool already covers — displacing Finnhub / FRED / Yahoo / Massive is the FIX-675
bake-off's call, not this epic's. **The rule, per consumer: AV is the *sole* source only for
data points no existing tool covers; everywhere an existing path exists, AV is a
supplement / fallback, never a replacement.** The epic does **not** pre-classify whole issues
as AV-only, because most bundle both kinds of datum — each consumer's spec makes the call
datum by datum. Known overlaps to respect (non-exhaustive): FIX-804's earnings calendar and
dividends are new, but **historical splits already have a Yahoo backfill path**
(`backfillSplits` in `portfolio-writes.ts`); FIX-802's commodities are partly covered (FRED
WTI via `get_macro_indicators`, Massive CL/GC via `get_futures_curve`); FIX-799's news extends
Finnhub. The one clearly-new primitive with no existing tool is ETF holdings look-through
(FIX-801, landed). Generalized multi-provider composition +
the per-run rate-budget for capped providers belong to **FIX-675** (see §4 Q3); premium-gated
AV surface (realtime options/index) is out.

---

## 3. Running index

Durable audit log of every issue under the epic and its PRs. Refreshed from the fleet's
handles as PRs open.

| Issue | State | Spec PR | Impl PR | Notes |
|---|---|---|---|---|
| **FIX-798** | **Merged** | ~~#851~~ (auto-closed at impl) | [#889](https://github.com/fixpoint-labs/flow-state-dev/pull/889) | keystone; **landed** — no longer blocks the AV family |
| **FIX-800** | On hold | [#802](https://github.com/fixpoint-labs/flow-state-dev/pull/802) | — | movers feed; **reparented out of this epic** into the scanner epic (FIX-937), then paused. Listed here for history only |
| **FIX-799** | Ready to Spec | — | — | news sentiment; released, not yet specced |
| **FIX-801** | **Merged** | — | [#923](https://github.com/fixpoint-labs/flow-state-dev/pull/923) · [#924](https://github.com/fixpoint-labs/flow-state-dev/pull/924) · [#927](https://github.com/fixpoint-labs/flow-state-dev/pull/927) | ETF profile & holdings — **landed** in three sub-PRs (data path / arithmetic / UI wiring). UX redesign of the resulting surface tracked separately as FIX-954 |
| **FIX-802** | Ready to Spec | — | — | macro & commodities — AV **supplements** commodities; FRED stays primary for rates/liquidity (§2c). Released, not yet specced |
| **FIX-803** | Backlog | — | — | technical-indicators **evaluation** (spike when appropriate) |
| **FIX-804** | Ready to Spec | — | — | corporate events: forward earnings calendar + dividends (incl. declared); **historical** splits only |

Epic PR (this doc, never merged): [#880](https://github.com/fixpoint-labs/flow-state-dev/pull/880).

---

## 4. Cross-cutting questions

Q1 is open. Q2–Q5 are **recorded resolutions** — the decisions a consumer spec inherits
rather than re-deciding.

1. **Is FIX-803 a build or a close?** *(open)* Framed as an evaluation leaning negative.
   Spike it at the appropriate time; if it concludes "don't wire AV indicators," it closes
   with a decision and no code, and the build load drops by one.
2. **Where does FIX-902 (scanner) attach?** *(resolved)* It is its own epic — **FIX-937**,
   which owns the scanner and the movers feed (FIX-800) it consumes. This epic's only tie to
   it is the provider foundation FIX-800 sources from, a cross-epic dependency.
3. **The AV budget substrate — what consumers inherit.** *(resolved in code)* FIX-798 built
   the AV-*specific* substrate FIX-675 can later generalize, not a parallel budget system,
   and it lives entirely inside the one shared `alphaVantageRequest`
   (`lib/providers/alpha-vantage.ts`). A daily counter keyed on the UTC day is reserved
   synchronously before any `await` (so a concurrent analyst fan-out can't overshoot),
   governed by `ALPHAVANTAGE_DAILY_LIMIT` — default 25, exact string `"0"` disables it for a
   paid plan. Per-minute admission pacing (`ALPHAVANTAGE_MINUTE_LIMIT`, default 5, same `"0"`
   sentinel) gates *before* the daily reservation and **waits** rather than throwing, since
   5/min is a rate limit, not exhaustion. Both counters hang off `globalThis` so a
   re-bundled module doesn't get its own private budget. Scope and durability: **process-scoped
   and best-effort** — a restart or serverless cold start resets it, and AV's own HTTP-200
   `Note`/`Information` throttle body (thrown as `AlphaVantageRateLimitError`) is the
   real-exhaustion backstop. A consumer adds no counter and no pacing of its own; it calls
   `alphaVantageRequest` and sizes its per-call unit cost against the 25/day cap (the landed
   transcript path costs 2 units, 3 with its alternate-label retry; the analyst enrichment
   costs 2). The generalized multi-provider rate budget remains FIX-675's.
4. **The durable day-scoped cache was not built.** *(resolved — no shared cache exists)* Neither
   FIX-798 nor FIX-801 added one. The desk's general cache is still `lib/cache.ts` — 120s TTL,
   in-memory, process-scoped, with in-flight dedup — and no AV fetch is day-cached. FIX-801
   solved its own case with **feature-owned durable storage** instead: `app.etf_profiles`, one
   global row per fund ticker (jsonb payload or a typed refusal, `fetched_at` staleness bound,
   per-failure-class `retry_at` backoff). That is the precedent a consumer should follow when
   its data is daily-or-slower and re-read across processes — own the table, don't assume a
   shared cache exists and don't quietly build a second general one. A **shared, cadence-keyed
   provider day-cache (or scheduled prefetch)** remains desirable if a third consumer needs the
   same thing; it is an unbuilt, untracked follow-up, not a blocker or an open question for any
   consumer spec.
5. **The two formerly FMP-stubbed tools are done, on AV.** *(resolved in code)* FIX-798
   completed both; `lib/providers/fmp.ts` is a key-check stub with no callers, and finishing
   FMP-PR2 is no longer on the table for these tools. `get_earnings_transcript` is
   **AV-only**: gated on `ALPHAVANTAGE_API_KEY`, it resolves the latest reported *fiscal*
   quarter via an `EARNINGS` probe (correct for offset fiscal years), retries once with the
   alternate calendar label, and returns unavailable when no key is set or the resolved
   quarter has no transcript.
   `get_analyst_estimates` keeps **Finnhub as the baseline** (recommendation trends +
   earnings surprises) and layers AV `OVERVIEW` + `EARNINGS_ESTIMATES` on top when a key is
   set, under **primary-wins provenance**: `source` stays `"finnhub"` whenever the baseline
   answered and is `"alphavantage"` only when Finnhub is absent and AV filled a field. That
   merge pattern is the model for any later consumer that supplements an existing primary.
