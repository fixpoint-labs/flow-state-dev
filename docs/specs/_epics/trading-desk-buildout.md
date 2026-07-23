# Epic — Trading desk buildout: Alpha Vantage data layer + multi-strategy capital sleeves

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

**Why this body of work.** The trading-desk lab reasons on a thin live data layer and
models a single book with a single risk posture. Two limits fall out of that. First, several
data tools have only one provider, so when that provider has no key or fails the analyst
reasons on nothing instead of a second source — and the desk has no market-wide discovery
input at all, only per-ticker lookups. Second, the book is one undifferentiated capital pool
with one posture, which cannot describe how a real conservative-but-opportunistic book runs
(a defensive core alongside a small, capital-capped aggressive sleeve).

This epic groups the set of issues that close both gaps so their **cross-cutting calls are
made together rather than in a vacuum** — chiefly the Alpha Vantage (AV) provider that a
whole family of data features shares, its 25-request/day budget discipline that every AV
consumer must respect, and the provenance/fallback convention they all plug into.

**Outcome we are signing off on.** Two connected threads that together move the desk toward
broad, budget-disciplined inputs and a segmented book:

- **An Alpha Vantage data layer.** A shared `alpha-vantage` provider foundation (**FIX-798**,
  the keystone) whose fetches fail cleanly — including AV's habit of returning rate-limit
  messages as HTTP-200 bodies — so callers degrade to their next source, with a documented
  **daily-budget discipline** that stops spending once the day's 25-request budget is gone
  and steps aside on a paid tier. On that foundation, the family of AV-fed features: a
  market-wide movers feed for candidate generation (**FIX-800**), ticker-scored news
  sentiment (**FIX-799**), ETF profile & holdings look-through (**FIX-801**), macro &
  commodities series (**FIX-802**), forward corporate events (**FIX-804**), and an
  **evaluation** of whether to use AV's server-side technical indicators at all (**FIX-803**,
  a decision issue, not necessarily a build).
- **A segmented book.** Multi-strategy **capital sleeves** (**FIX-771**): the user declares
  strategies once — each with a capital allotment, posture, objective, and eligibility rules
  — and an analysis run answers *per strategy* whether a trade fits and whether capital is
  free to deploy it, with a v1 funding-source list and per-sleeve utilization in the
  household view.

This is **mostly additive feature work on an existing desk**, not a new subsystem: one new
provider module plus budget discipline, a set of tools that consume it, and a capital-model
change layered on the already-shipped durable mandate and per-run posture.

**What ramps when the objective is approved.** Per the objective gate
(`orchestration.md` §Gates), applying `epic approved` releases the epic's Backlog sub-issues
(FIX-799 / 801 / 802 / 803 / 804) from NEEDS_SPEC so they can be specced. FIX-798, FIX-800,
and FIX-771 **predate the epic** — they are already In Review with open spec PRs, so the
epic wraps them for coordination and does **not** roll them back. What actually paces the AV
work is not the gate but the **sequencing spine**: everything AV-fed sits behind **FIX-798**,
the provider foundation. FIX-771 is independent of the AV work and runs in parallel.

**Holistic-necessity check (does the *set* overbuild even if each issue earns its place?).**

- **The AV family is a genuine cluster on one shared surface.** FIX-799 / 800 / 801 / 802 /
  803 / 804 all consume the *same* provider module and *same* daily-budget discipline that
  FIX-798 introduces. Deciding them apart would let each invent its own budget accounting and
  fallback behavior; grouping them fixes those once. No AV consumer adds surface another
  makes redundant.
- **FIX-803 is an evaluation, not a guaranteed build.** Its deliverable is a decision on
  whether AV's server-side technical indicators are worth wiring; it may close with a "no,
  keep computing client-side" and no code. It is in the set because that decision belongs
  with the rest of the AV budget/provenance calls, not because it commits a build.
- **FIX-771 is a build, but a self-contained one on an already-shipped base.** Its
  dependencies (Postgres model layer, durable mandate, per-run posture, portfolio-fit,
  thesis records, household view) have all shipped; it threads sleeves through them. It does
  not touch the AV layer.
- **FIX-902 is deliberately out.** The opportunity scanner consumes the movers feed but is a
  distinct screening/strategy layer; it is tracked as a related neighbor and specced later
  against real data contracts, not folded in now (tenet 2 — don't pull in speculative
  downstream surface).

Net: one provider foundation, its family of six data consumers (one of them an evaluation),
and one independent capital-model feature — coherent as *trading-desk buildout*, with the
downstream scanner (FIX-902) held out. See §4 for the one honest wrinkle: the set spans two
Linear milestones and could be split into two tighter epics if preferred.

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
their own. **FIX-771 (capital sleeves) is off the spine** — independent of AV, in review now
(spec PR #803), runs in parallel.

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

### 2c. The capital-model surface (FIX-771) — one policy model, not two

FIX-771 lives on a different surface entirely: the durable **portfolio mandate** becomes the
container for declared strategies (sleeves), and the per-run **risk posture** is reused per
sleeve. The long-horizon direction here is *one* policy model — strategies are not a second
parallel config but live on the mandate already shipped. Per-sleeve fit + capital-availability
routing at analysis time, a v1 funding-source list (the *scored* displacement ranking is a
later upgrade that needs the thesis re-validation loop, FIX-763), and per-sleeve utilization
in the household view. This thread shares no code with the AV layer; its coherence with the
rest of the epic is at the level of "the same desk," not the same surface (see §4).

---

## 3. Running index

Durable audit log of every issue under the epic and its PRs. Refreshed from the fleet's
handles as PRs open.

| Issue | Thread | State | Spec PR | Impl PR | Notes |
|---|---|---|---|---|---|
| **FIX-798** | AV foundation | In Review | [#851](https://github.com/fixpoint-labs/flow-state-dev/pull/851) | — | keystone; blocks the AV family |
| **FIX-800** | AV data | In Review | [#802](https://github.com/fixpoint-labs/flow-state-dev/pull/802) | — | movers feed; blocked-by FIX-798 |
| **FIX-799** | AV data | Backlog | — | — | news sentiment; holds at NEEDS_SPEC until `epic approved` |
| **FIX-801** | AV data | Backlog | — | — | ETF profile & holdings |
| **FIX-802** | AV data | Backlog | — | — | macro & commodities (FRED fallback) |
| **FIX-803** | AV data | Backlog | — | — | technical-indicators **evaluation** (decision) |
| **FIX-804** | AV data | Backlog | — | — | forward corporate events |
| **FIX-771** | Capital model | In Review | [#803](https://github.com/fixpoint-labs/flow-state-dev/pull/803) | — | multi-strategy sleeves; independent of AV |

Epic PR (this doc, never merged): [#880](https://github.com/fixpoint-labs/flow-state-dev/pull/880).

---

## 4. Open cross-cutting questions

1. **Two threads, two milestones — one epic or two?** The set spans two Linear milestones:
   the AV work sits in **Data & Providers** (FIX-798 and family), FIX-771 sits in **Portfolio
   Management (system of record)**. They share no code and only loosely share a story ("a
   fuller desk"). This epic is deliberately the **umbrella** the human asked for (FIX-771 was
   a founding member of the set). If tighter epics are preferred, the clean split is: an
   **"Alpha Vantage data layer"** epic (FIX-798 + 799/800/801/802/803/804 — a tightly-coupled,
   self-contained set) and **FIX-771** standing alone or under a portfolio epic. Flagged for
   the `epic approved` decision; no action taken unless you want the split.
2. **Is FIX-803 a build or a close?** It is framed as an evaluation with a recommendation
   leaning negative. If the eval concludes "don't wire AV indicators," it closes with a
   decision and no code, and the epic's build load drops by one. Resolve during its spec.
3. **Where does FIX-902 (scanner) attach later?** Held out as a downstream neighbor. Once
   FIX-800 (and optionally FIX-799) land with real data contracts, decide whether the
   scanner becomes its own epic or a fast-follow — not part of this set's sign-off.
