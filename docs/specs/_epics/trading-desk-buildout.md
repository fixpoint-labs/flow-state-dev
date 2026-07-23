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
reasons on nothing instead of a second source — and the desk has no market-wide discovery
input at all, only per-ticker lookups. Two stubbed tools (earnings-call transcripts, analyst
estimates) were scaffolded against a provider that was never finished, so they return
"unavailable" in live mode even with a key configured.

This epic adds **Alpha Vantage (AV)** — a NASDAQ-licensed source broad enough to close these
gaps — and groups the family of features that share it so their **cross-cutting calls are
made together rather than in a vacuum**: one provider module, one daily-budget discipline,
and one fallback/provenance convention that every AV consumer plugs into.

**Outcome we are signing off on.** A shared `alpha-vantage` provider foundation
(**FIX-798**, the keystone) whose fetches fail cleanly — including AV's habit of returning
rate-limit messages as HTTP-200 bodies — so callers degrade to their next source, with a
documented **daily-budget discipline** that stops spending once the day's 25-request budget
is gone and steps aside on a paid tier. On that foundation, the family of AV-fed features:

- a market-wide **movers feed** for candidate generation (**FIX-800**),
- ticker-scored **news sentiment** (**FIX-799**),
- **ETF profile & holdings** look-through (**FIX-801**),
- **macro & commodities** series (**FIX-802**),
- forward **corporate events** — earnings calendar + splits/dividends (**FIX-804**),
- and an **evaluation** of whether to use AV's server-side technical indicators at all
  (**FIX-803**) — a spike run at the appropriate time to decide relevance, not a committed
  build.

This is **mostly additive feature work on an existing desk**, not a new subsystem: one new
provider module plus budget discipline, and a set of tools that consume it.

**What ramps when the objective is approved.** Per the objective gate
(`orchestration.md` §Gates), applying `epic approved` releases the epic's Backlog sub-issues
(FIX-799 / 801 / 802 / 803 / 804) from NEEDS_SPEC so they can be specced. FIX-798 and FIX-800
**predate the epic** — already In Review with open spec PRs — so the epic wraps them for
coordination and does **not** roll them back. What actually paces the work is not the gate
but the **sequencing spine**: everything AV-fed sits behind **FIX-798**, the provider
foundation.

**Holistic-necessity check (does the *set* overbuild even if each issue earns its place?).**

- **The AV family is a genuine cluster on one shared surface.** FIX-799 / 800 / 801 / 802 /
  803 / 804 all consume the *same* provider module and *same* daily-budget discipline that
  FIX-798 introduces. Deciding them apart would let each invent its own budget accounting and
  fallback behavior; grouping them fixes those once. No AV consumer adds surface another
  makes redundant.
- **FIX-803 is an evaluation, not a guaranteed build.** Its deliverable is a decision on
  whether AV's server-side technical indicators are worth wiring; it may close with a "no,
  keep computing client-side" and no code. It is in the set because that decision belongs
  with the rest of the AV budget/provenance calls; it is spiked when the appropriate time
  comes, not committed up front.
- **FIX-902 (scanner) is deliberately out.** It consumes the movers feed but is a distinct
  screening/strategy layer; tracked as a related neighbor and specced later against real
  data contracts (tenet 2 — don't pull in speculative downstream surface).

Net: one provider foundation and its family of six data consumers (one of them an
evaluation) — a tightly-coupled, self-contained set. The capital-sleeves work (FIX-771),
originally grouped here, is a distinct capital-model concern in a different milestone and now
stands alone.

---

## 2. Themes & long-horizon direction

### 2a. The sequencing spine — FIX-798 is the keystone

FIX-798 is the provider foundation the entire AV family builds on. Sequence it **first**:
its module, its budget discipline, and its provenance tag are shared infrastructure, and a
Linear `blocks` relation ties it to FIX-800 and the rest of the family. It is **In Review**
now (spec PR #851). Spine:

**FIX-798 (keystone, in review) → { FIX-800 movers (in review), FIX-799 news-sentiment,
FIX-801 ETF, FIX-802 macro, FIX-803 indicators-eval, FIX-804 events }.** FIX-800 is already
in spec review and can implement as soon as FIX-798 lands; the four Backlog consumers ramp
after `epic approved` and align to FIX-798's provider/budget shape rather than pre-committing
their own; FIX-803 is spiked when its turn comes.

### 2b. The shared AV surface — one provider, one budget, one fallback convention

Every AV consumer must agree on the same three things FIX-798 establishes, so they must not
each reinvent them:

- **One provider module.** All AV fetches go through the single `alpha-vantage` provider on
  the desk's established provider convention — not per-tool HTTP.
- **One daily-budget discipline.** AV's free tier is **25 requests/day (5/min)**. Wired
  naively across a fan-out of analysts, a single multi-ticker session exhausts it. The
  budget accounting FIX-798 introduces is shared: every consumer (movers, news, ETF, macro,
  events, indicators) spends against the *same* daily budget and degrades honestly when it's
  gone, and the whole discipline steps aside on a paid tier so it never becomes a hard
  dependency.
- **One fallback / provenance convention.** AV returns rate-limit messages as HTTP-200
  bodies; the provider detects that and fails cleanly so callers degrade to their next
  source, and every AV-sourced datum carries the same provenance tag. FIX-798 defines this;
  consumers inherit it.

**Deliberately out of the AV layer:** making AV a *preferred/primary* source anywhere (that's
the FIX-675 data-quality bake-off), and any premium-gated AV surface (realtime options/index).

---

## 3. Running index

Durable audit log of every issue under the epic and its PRs. Refreshed from the fleet's
handles as PRs open.

| Issue | State | Spec PR | Impl PR | Notes |
|---|---|---|---|---|
| **FIX-798** | In Review | [#851](https://github.com/fixpoint-labs/flow-state-dev/pull/851) | — | keystone; blocks the AV family |
| **FIX-800** | In Review | [#802](https://github.com/fixpoint-labs/flow-state-dev/pull/802) | — | movers feed; blocked-by FIX-798 |
| **FIX-799** | Backlog | — | — | news sentiment; released to spec on `epic approved` |
| **FIX-801** | Backlog | — | — | ETF profile & holdings |
| **FIX-802** | Backlog | — | — | macro & commodities (FRED fallback) |
| **FIX-803** | Backlog | — | — | technical-indicators **evaluation** (spike when appropriate) |
| **FIX-804** | Backlog | — | — | forward corporate events |

Epic PR (this doc, never merged): [#880](https://github.com/fixpoint-labs/flow-state-dev/pull/880).

---

## 4. Open cross-cutting questions

1. **Is FIX-803 a build or a close?** It is framed as an evaluation with a recommendation
   leaning negative. Spike it at the appropriate time; if the eval concludes "don't wire AV
   indicators," it closes with a decision and no code, and the epic's build load drops by one.
2. **Where does FIX-902 (scanner) attach later?** Held out as a downstream neighbor. Once
   FIX-800 (and optionally FIX-799) land with real data contracts, decide whether the
   scanner becomes its own epic or a fast-follow — not part of this set's sign-off.
