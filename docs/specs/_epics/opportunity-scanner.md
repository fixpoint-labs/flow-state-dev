# Epic — Trading desk: opportunity scanner

> **Coordination artifact, not an implementing spec.** The issues under this epic do
> **not** derive from this doc — they *reference and align* to it. This is the shared
> surface, the sequencing spine, and the running index for the set. See
> [`docs/contributing/orchestration.md`](../../contributing/orchestration.md) for what an
> epic-spec is.
>
> **Epic issue:** FIX-937 · **Epic branch:** `epic/opportunity-scanner` (never merged,
> never deleted) · **Project:** Trading Desk Lab · **Team:** flow-state

---

## 1. Purpose & objective *(the `epic approved` sign-off surface)*

**Why this body of work.** The desk is entirely reactive. Every analysis starts from a
ticker the user already picked; the Phase 1–5 pipeline underwrites a name but nothing
*proposes* one. This epic makes the desk discover: a market-wide **opportunity scanner**
that screens candidates across pluggable strategies — value screens, short-squeeze setups —
and feeds the survivors into the existing pipeline for full analysis. The scanner proposes;
the desk still decides.

The scanner cannot screen without market-wide and positioning inputs it does not have today,
so this epic groups it with the two feeds it depends on. That grouping is the whole point.
A data feed with no committed consumer is speculative surface (tenet 3): you build it,
tag it, and hope something uses it. Tie the movers feed and the positioning lens to a scanner
that is *committed* to consuming them and the same two feeds become earned — built to a real
demand, screened by a real caller, with the screening discipline (the genuinely hard part)
owned by the consumer rather than deferred into a vacuum.

**Outcome we are signing off on.** A committed direction for candidate generation on the
desk: **candidate source(s) → strategy screen → the existing analysis pipeline**, with the
scanner (**FIX-902**) as the keystone consumer and the two feeds it needs built against it:

- a market-wide **movers feed** for the first candidate source (**FIX-800**, already In
  Review), and
- a **positioning / flow lens** — CFTC COT plus short-interest trend — as the squeeze
  strategy's data prerequisite (**FIX-810**).

The scanner's own contracts are **not** what is being signed off. FIX-902 is Backlog with no
spec yet, and its hard parts — the two-tier funnel, the strategy schema, where a scan runs,
whether squeeze ships in v1 — are open (§4). What `epic approved` authorizes is the
*direction* and the *grouping*: that the desk should propose names, that a strategy is a named
screen feeding the pipeline, and that the movers feed and positioning lens are worth building
because this scanner will consume them. The frozen contracts come later, per issue, at spec
time.

**What ramps when the objective is approved.** Per the objective gate
(`orchestration.md` §Gates), applying `epic approved` releases the epic's Backlog sub-issues
(**FIX-902**, **FIX-810**) from NEEDS_SPEC so they can be specced. **FIX-800** predates the
epic — already In Review with an open spec PR (#802) — so the epic wraps it for coordination
and does **not** roll it back. What actually paces the work is the **sequencing spine** (§2a):
the scanner consumes the two feeds, so its screening layer can only be built out as they land.

**Holistic-necessity check (does the *set* overbuild even if each issue earns its place?).**

- **This is a consumer-anchored cluster, not a foundation-first one.** Unlike a data-layer
  epic where a shared provider is the keystone and consumers ride it, here the *consumer*
  (FIX-902) is the keystone and the two feeds are its prerequisites. The set earns its place
  precisely because the scanner is the committed demand that makes the feeds non-speculative.
  Remove the scanner and FIX-800/FIX-810 drift back toward "data foundations, hope something
  uses them" — which is the state the epic exists to fix.
- **FIX-810 carries independent lane value — flag it honestly.** The positioning lens is the
  honest realization of the COT seam `get_futures_curve` already names as deferred, and it
  helps the Macro/Quant lane reason about positioning extremes regardless of the scanner. So
  it is the *least* scanner-dependent member: it would earn a place even without this epic.
  It belongs here because the short-squeeze strategy is its most concrete consumer and forces
  its shape (short-interest *trend*, not a static snapshot), but the set is more loosely
  coupled than a single-provider family — this is grouping by consumer demand, not by shared
  infrastructure.
- **FIX-902's scope is genuinely unspecced.** The epic commits to a direction, not a build.
  Its Case can open on `epic approved`, but the strategy schema and funnel shape stay open
  until its own spec, and several §4 questions must resolve before its Build Plan is real.
  This is deliberate: freezing the scanner's contracts now, before FIX-800/FIX-810 land with
  real data shapes, would invite the rework the epic exists to avoid.

**What is deliberately *out*.** Named, not silent:

- **FIX-799** (ticker news sentiment) — stays in the AV data-layer epic (FIX-934). It is a
  *possible* squeeze-catalyst signal but not a committed prerequisite; the scanner more likely
  needs a cheap per-candidate bull/bear pass than a market-wide sentiment score (§4 Q6). Its
  fallback value is independent of the scanner, so it is not pulled in here.
- **FIX-706** (Options Trader) — downstream consumer of the scanner's output; should consume
  the shortlist, not duplicate its screening. Specced later against real contracts.
- **FIX-793** (outcome scoring / backtest) and **FIX-812** (track-record surface) — validation
  and presentation of a strategy's hit rate over time. The scanner's design should not
  preclude them, but they are not members.
- **FIX-771** (capital sleeves) / **FIX-776** (rubric weighting) — adjacent "named strategy"
  concepts. All three (a scanner strategy, a sleeve mandate, a rubric profile) are variations
  on "a named way of caring about a name," so their schemas should be *reconciled* (§4 Q4),
  but sleeves and rubric are not sub-issues of this epic.

Net: one keystone consumer and its two data prerequisites, grouped by a committed demand
rather than a shared provider — a genuine cluster, with the honest caveats that FIX-902's
contracts are still open and FIX-810 has standalone lane value beyond the scanner.

---

## 2. Themes & long-horizon direction

### 2a. The sequencing spine — the consumer is the keystone

The usual data-layer shape (foundation first, consumers after) is **inverted** here. The
keystone is the scanner, and the two feeds are its prerequisites:

**{ FIX-800 movers, FIX-810 positioning } *(data prerequisites)* → FIX-902 scanner
*(consumes them)*.**

- **FIX-800** is already **In Review** (spec PR #802) and near-ready. As the first candidate
  source it is the least blocked path to a working value scan.
- **FIX-810** is **Backlog, unspecced.** It is the squeeze strategy's data prerequisite
  (elevated short interest + a positioning trend), so how hard a dependency it is depends on
  whether squeeze ships in v1 (§4 Q1).
- **FIX-902** is **Backlog, unspecced**, and can only be built out as the feeds it screens
  land. Its Case (Part I) may open on `epic approved`, but its Build Plan (Part II) holds
  until at least FIX-800's data contract is settled — the funnel and strategy schema commit
  to a candidate-source shape, and pre-committing before the feed is real invites rework.

The value path (movers → value strategy → pipeline) is buildable well before the squeeze
path (positioning → squeeze strategy → per-candidate catalyst check → pipeline), which is why
§4 Q1 — squeeze in v1 vs value-first — is the load-bearing sequencing decision for the set.

### 2b. The two-tier funnel — screening discipline is the hard part

The scanner's central design commitment, and the thing FIX-800 explicitly deferred as "the
genuinely hard part," is a **two-tier funnel**:

- a **cheap deterministic pre-filter** over a universe — data-only, **no model spend** —
  narrows the field, then
- **LLM scoring runs only on the names that clear it.**

This is what lets the desk screen a broad universe without spending full-pipeline model
budget on every name. It is a screening-cost discipline, and it shapes every strategy: the
deterministic tier does the filtering, the model tier only ranks and qualifies survivors.

### 2c. Strategy-as-named-config, and the no-black-boxes stance

A **strategy** is a named configuration, not a hardcoded code path: candidate source(s) + a
deterministic filter predicate + an optional LLM scoring rubric + eligibility. Two initial
cases with the mechanism not hardcoded to either:

- **Value** — mostly deterministic: a fundamentals screen (P/E, FCF yield, and similar) over
  a broad universe, LLM used only to rank/qualify survivors.
- **Short-squeeze** — the harder case and the one most exposed by current data gaps: elevated
  short interest (FIX-810), a catalyst signal that counters the bear thesis (open — §4 Q6),
  and a crowding proxy (days-to-cover / borrow rate) the desk does not source today.

Each strategy's screening logic must be **inspectable and auditable, not a black box**,
consistent with the framework's no-black-boxes stance (tenet 2 — composition over opaque
mechanism). The output feeds the existing pipeline as a new "propose tickers" entry point —
a pre-step, **not** a fork of the pipeline.

### 2d. One shared schema question — "a named way of caring about a name"

A scanner strategy, a capital sleeve (FIX-771), and a rubric-weighting profile (FIX-776) are
three variations on the same idea: a named lens that changes how the desk treats a name.
Whether they share a schema or stay conceptually separate is a cross-cutting decision worth
settling before more than one is specced (§4 Q4). This epic owns only the scanner strategy,
but its spec should reconcile the shape rather than invent a third incompatible one.

### 2e. The cross-epic AV dependency stays cross-epic

FIX-800 sources its movers list from Alpha Vantage `TOP_GAINERS_LOSERS` via the AV provider
foundation **FIX-798**, which lives in the **AV data-layer epic (FIX-934)** — not here. That
split is deliberate: **FIX-800's *provider* belongs to the AV epic** (its key handling,
daily-budget discipline, and provenance convention are the AV family's shared surface);
**FIX-800's *purpose* — candidate generation — belongs to this epic.** The dependency is
tracked as cross-epic and is not pulled inward; this epic does not re-own the AV provider.

---

## 3. Running index

Durable audit log of every issue under the epic and its PRs. Refreshed from the fleet's
handles as PRs open.

| Issue | Role | State | Spec PR | Impl PR | Notes |
|---|---|---|---|---|---|
| **FIX-902** | opportunity scanner (keystone consumer) | Backlog | — | — | the screening/strategy layer, the hard part; released to spec on `epic approved` |
| **FIX-800** | market-wide movers feed (first candidate source) | In Review | [#802](https://github.com/fixpoint-labs/flow-state-dev/pull/802) | — | predates epic; sources AV via FIX-798 (cross-epic, FIX-934) |
| **FIX-810** | positioning / flow lens (CFTC COT + short-interest trend) | Backlog | — | — | squeeze-strategy data prerequisite; released to spec on `epic approved`; has standalone Macro/Quant-lane value |

Epic PR (this doc, never merged): [#896](https://github.com/fixpoint-labs/flow-state-dev/pull/896).

---

## 4. Open cross-cutting questions

Q1 is the load-bearing sequencing decision for the set; the rest shape the scanner's contracts
and resolve in FIX-902's / FIX-810's specs.

1. **Squeeze in v1, or value-first?** Does v1 ship value-only (movers → fundamentals screen →
   pipeline) and defer squeeze, or does it include the squeeze strategy? This decides whether
   FIX-810 (and any catalyst signal) is a **hard prerequisite** for the epic's first
   deliverable or a fast-follow. Current lean is unresolved; value-first is the lower-risk path
   since FIX-800 is already In Review and FIX-810 is unspecced.
2. **Where does a scan run?** A new flow, a headless batch job (FIX-788's batch harness is a
   precedent), or a scheduled action (the framework already has declarative scheduled actions)?
   Affects how the "propose tickers" entry point attaches to the existing pipeline.
3. **Strategy definition — code or user config?** Is a strategy authored in code
   (flow-author-defined) or exposed as user-facing config? Decides whether adding a strategy
   needs a PR or just a config change.
4. **Strategy schema reconciliation with FIX-771 / FIX-776.** Does a scanner strategy share a
   schema with capital sleeves and rubric-weighting profiles — all three "a named way of caring
   about a name" — or stay separate? Worth settling before more than one is specced.
5. **COT: folded or standalone (from FIX-810).** Does CFTC COT fold into `get_futures_curve`
   (one cross-asset positioning tool, which the curve tool's own comment implies was always the
   intent) or live as its own `get_cot_positioning` tool the Macro/Quant analyst calls
   separately? Also open in FIX-810: the percentile window for "extreme" (1y/3y/5y) and how the
   freshness model represents an intentionally-lagged weekly series.
6. **Is FIX-799 news sentiment the squeeze catalyst signal?** The squeeze strategy needs a
   catalyst that counters the bear thesis. FIX-799's market-wide ticker sentiment is probably
   too generic; the desk more likely needs a cheap per-candidate run of the existing bull/bear
   debate machinery. Decide at FIX-902 spec time whether this epic should later pull in FIX-799
   (currently held in the AV epic) as a catalyst input, or build a dedicated per-candidate
   catalyst check.
