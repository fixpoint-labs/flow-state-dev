# Epic — Trading desk: report completeness & analytical depth

**Linear:** [FIX-1067](https://linear.app/fixpoint-labs/issue/FIX-1067/trading-desk-report-completeness-and-analytical-depth) · **Branch:** `epic/trading-desk-report-completeness` · **Project:** Trading Desk Lab

This is a coordination artifact for a set of twelve related issues. It is **not** an
implementing spec, and the issues under it do not derive from it — they reference and align
to it. What an epic-spec is: [`docs/contributing/orchestration.md`](../../docs/contributing/orchestration.md).

---

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** A finished report should show the analysis that actually ran, and should be
honest about how good each number in it really is. Today it is neither. The desk computes the
research manager's stance and the disagreements it could not resolve, the trader's
invalidation criteria, the PM's absolute-versus-relative rating split, and the risk
assessment's own confidence calibration — stores every one of them, and displays none of
them. To a reader that is indistinguishable from analysis that never happened. Alongside
that, several figures the report *does* show are blunter than they look, and a few are
computed from data that was never there.

When this epic lands, a reader can answer one question from the report alone: **does this
faithfully represent the analysis that ran?**

**The epic does two things, and the objective owns both.** Ten of the twelve issues add
nothing new — they make an existing figure honest. The other two deepen an analysis:

- **FIX-826** adds trend characterization: strength, persistence, inflection. The desk cannot
  produce that read today.
- **FIX-1066** takes the lens pack from four to six, activating two generator-backed lenses
  that `agents/lenses/lenses.ts` currently defers to FIX-705. Two real analyses, and roughly
  half again as much phase-2b model spend on the `full` preset — a recurring per-run bill, not
  a one-time cost.

**Decided at the objective gate — both stay, at full scope (product owner).** FIX-826 keeps
strength, persistence and inflection; it is *not* narrowed to a disclaimer on the existing
moving-average labels. FIX-1066 keeps the 4→6 expansion. And **per-run model cost is ruled out
as a scope constraint at current run volume**: no issue in this set is to be trimmed,
deferred, or redesigned to save model spend, and no child issue should re-litigate it.

**The fence that still binds: no new data lane.** No issue here adds a provider, a paid
entitlement, or a new data tool (§2 theme 5). Broadening the objective covers generator-backed
analysis and model cost. It does not open the data lane by a millimetre.

**And the honesty guarantee is forward-looking.** It applies to runs made after the fix.
Reports already persisted are *marked*, not migrated — a limitation of what those records
carry, not a convenience; §2 theme 1 has the reason and the mechanism.

**Holistic necessity.** Twelve issues, and the honest check is whether the set overbuilds. It
splits three ways and the three groups earn their place differently.

**Group A — render what we already compute.** Four issues, all in the UI layer, all
independent of each other. The cheapest work in the epic and the highest value per unit of
it. If the epic shipped only A it would still deliver most of the reader-visible gain.

**Group B — visible correctness.** Three defects that make a finished report read as broken:
a price chart missing from most reports, flat-stance runs rendering a nonsensical
stop-above-target, wrong-company snippets reaching analyst prompts. Small, local, each
individually justified.

**Group C — analytical depth and data honesty.** This is where the overbuild risk sits, and
one issue in it carries the epic. FIX-1063 (unavailable payloads zero-fill) is **not** a
labeling problem. A missing market cap is stored as a real `0` and enters the valuation math
as one: price-to-book comes out as zero, and enterprise value comes out equal to net debt
with the entire equity value silently dropped. Every EV multiple then reads as radically
cheap on data nobody has. It is the one outright real-money hazard in the set, and the rest
of C is downstream of it being fixed.

**FIX-826 was the set's weakest issue on paper, and the owner decided it stays whole.** The
desk labels its moving-average stack but cannot characterize strength, persistence, or
inflection. Review proposed narrowing it to a disclaimer on the existing labels — put to the
product owner at the objective gate and **declined**: FIX-826 builds the characterization. The
honesty rule still binds its *output* (a trend read that cannot characterize strength must not
imply that it can, §2 theme 2), but it is no longer an alternative to doing the work. The
remaining guardrail is scope, not ambition: a new indicator *suite* beyond strength,
persistence and inflection is the signal that the extra belonged in a later epic.

**Not doing.** Five fences, each a real boundary rather than a gap in this epic: **provider
acquisition and paywalled data lanes** (Reddit has no live provider; options chain and futures
curve need a paid entitlement; 13F is premium — the fix is a purchasing decision, and it stays
in Data & Providers); **the outcome and review loop** (entry price, outcome scoring, track
record — the single largest completeness gap in the product, but it is "close the loop", not
"complete the report a user reads today"; coordinate the decision-snapshot field shapes with
it, don't fold it in); **FIX-808, the factual-accuracy benchmark** (it measures whether the
*data* is right; this epic makes sure what we have is shown and honestly labeled — a
neighbour, not a sub-issue); **FIX-776, configurable factor and lens weighting** (adjacent to
FIX-1066's convergence weighting — reconcile the schema, don't merge the work); and
**fixture-corpus breadth** (only NVDA is a complete offline snapshot — real, but it is
eval/test infrastructure, not report content).

## 2. Themes & long-horizon direction

These sit above any single issue. An issue spec cites one by number; an issue that finds it
needs to change one comments **up** on the epic PR rather than deciding locally.

### 1. The nullability contract — unobserved is `null`, never `0`, and never a label inferred from nothing

One rule the whole set follows: **a figure the desk did not observe is `null` everywhere —
in the payload, in the derived math, in the prompt, and in the renderer — and it presents to
a reader as "unavailable", visually distinct from a measured zero.** No consumer may
re-collapse a null into a zero to keep a chart or a ratio drawing.

Four things this rule has to reach that a narrow reading of FIX-1063 would miss:

- **The tool output *schemas*, not just the empty-payload builders.** `marketCap`,
  `priceToSales`, `returnOnEquity`, `operatingMargin`, `grossMargin` and the macro and
  indicator fields are declared `z.number()` — non-nullable. Nulling the builder without
  widening the schema does not type-check, so the schema change is part of the contract, not
  an implementation detail.
- **Derived labels, not only derived numbers.** `compute_indicators`' empty payload sets
  `trend: "flat"`. Nulling the numbers under it and leaving the label behind produces a
  report asserting a flat trend it never measured — the same defect one layer up.
- **Downstream consumers each present "unavailable" distinctly**: the valuation math, the
  factor/setup scores, the analyst and PM prompt context, the Summary renderers, and the
  lens convergence read.
- **Every producer that reports a live source while defaulting a field it did not observe —
  not only the empty-payload builders.** This is the reach the epic's first draft missed, and
  it is the one that fabricates on a *successful* fetch, which is strictly worse than the
  unavailable case because nothing marks the value as missing. **The test is provenance, not
  the file.** Two instances are confirmed against the code:

  - **Insufficient history.** `indicators-math.ts` returns a literal `0` whenever there isn't
    enough history — `sma(…)` and `rsi(…)` short-circuit on `values.length < period`, `macd`
    on `< 35` bars, `bollinger`, `stochastic` and `kdj` likewise — and `trendLabel` maps
    `sma50 === 0 || sma200 === 0` straight to `"flat"`. A recent IPO with fewer than 200 daily
    bars persists zeroed indicators and an asserted flat trend tagged with a live source.
    Insufficient history must emit `null` and no trend, on the same footing as a provider miss.
  - **A partially-successful fetch.** `get_macro_indicators` pulls nine FRED series, degrades
    each to `[]` on failure, and returns `emptyPayload` **only when every series fails**.
    Otherwise it stamps `source: "fred"` and `?? 0`s whatever is missing — unemployment, fed
    funds, the 10-year, WTI, the 2s10s slope, the HY spread, the dollar index, industrial
    production — plus a `cpiYoy` that resolves to `0` when the year-ago print is absent. Its
    own module header records the symptom this already caused once: *"the payload came back
    tagged `fred` but with 7-of-9 fields zeroed."* A partial provider miss is a miss.

  Widening the schemas and nulling the empty payloads satisfies neither, so neither is
  optional. FIX-1063 owns both. One adjacent case was checked and is deliberately **outside**
  the contract: `composite-math.ts` zero-weights a missing term but returns `missingInputs`
  alongside the score, so it already labels rather than fabricates — FIX-1063 need not touch
  it, and an issue that finds a third fabricating producer should comment up rather than
  widen the contract locally.

**This is a BP-030 tolerate-the-old-shape change, and FIX-1063 owns it.** Recorded fixture
snapshots under `fixtures/<TICKER>/<DATE>/` and every persisted memo, valuation spine, and
decision snapshot already carry the zero-filled shape. Dual-read them: an old record's `0`
must not be re-interpreted as a *new* honest zero, and a new record's `null` must not crash a
legacy read path.

**One owner, a named set of boundaries — not twelve consumers each writing `if (x === 0)`.**
"Whichever issue lands the schema change" was too vague to coordinate against: the payloads
have many readers, and a per-consumer coercion is how the zero-fill quietly survives in the
one path nobody updated. FIX-1063 owns the legacy coercion and it lands at the two **ingest
boundaries** (fixture load and valuation-spine ingest) plus the **persisted-resource
boundary** below, so every downstream issue may assume it is reading normalized,
honestly-null inputs. An issue in group A or C that finds itself writing its own
legacy-zero check has hit a gap in FIX-1063, not a task of its own — comment up.

**Three read boundaries, not two — the third is the already-persisted report.** Reopening or
exporting an existing session crosses neither ingest boundary:
`components/summary/report-summary.tsx` hydrates the stored valuation spine directly, and
`flows/analysis/orchestration/run-artifacts-action.ts` returns that same stored spine plus the
generated memo strings. Both baked the zeros in at write time, so normalizing raw inputs
cannot reach them. **FIX-1063 owns this boundary too.**

**At that boundary a legacy record is marked, not repaired — decided, and the call was
forced.** An old record carries no version and no per-field provenance, so nothing in it
separates a missing zero from a genuinely measured zero. A migration would have to *guess*
which zeros were real, which is the same dishonesty one layer down. So:

- **A pre-fix record surfaces to the reader as generated before the data-honesty fix**, so a
  stale `$0` is never presented as a current measurement.
- **New records are stamped with a version/provenance marker, and that half is not
  deferrable** — without the stamp, the marking has nothing to key on.
- **The guarantee is therefore forward-looking.** No issue in this set may promise more than
  that, in a renderer, a memo, or a spec.

**Reuse the two sentinels that exist; do not invent a third.** The UI already renders missing
values as `—` (`portfolio-format.ts`, `mandate-helpers.ts`) and the prompt formatters already
render `"n/a"`. "Unavailable" presents through those, per surface. A new marker string would
give the same fact three spellings across the set.

### 2. The honesty rule for a displayed figure — observed · approximated · invented

The epic's acceptance question is *does the report faithfully represent the analysis that
actually ran?* For a figure the desk displays, that resolves to one of exactly three
dispositions, picked by **where the figure's inputs came from**:

| Input provenance | Disposition | Example |
|---|---|---|
| **Observed** — real measured inputs, exact method | **Show it** | EV/Sales from reported revenue |
| **Approximated** — real observed inputs, a named blunt method | **Show it, labeled with the approximation** | operating income used as an EBIT proxy; a 21% flat-tax ROIC; revenue growth in place of EPS growth in PEG |
| **Invented** — an input the model produced rather than measured | **Do not present it as a measurement** | the "deterministic" reward-to-risk figure, whose scenario probabilities the forecaster emits |

The line that matters is **approximated versus invented**, and it is the one the four issues
in C would otherwise each redraw. An approximation is a real number under a stated method, so
a label makes it honest. An invented input is not a measurement at all, so no label rescues
it — the figure either stops being presented as deterministic, or its inputs stop being
invented. A figure whose *inputs* are missing is theme 1's case and nulls.

This binds FIX-1064 (label the proxies rather than silently improving them), FIX-1065 (the
reward-to-risk figure — see the open question in §5), FIX-1066 (a convergence read must say
how many lenses actually returned a verdict and which flagged a data gap — before the pack
grows it is four of six, and after it grows a lens that ran on thin data still must not count
as full-pack conviction), and FIX-826 (it builds the characterization, so this rule binds the
*run* rather than the scope: a name without the bars to measure strength or persistence says
so instead of implying a read it does not have).

### 3. Renderer ownership — who owns which file

Group A's four issues run in parallel branches, so file ownership is stated once here rather
than negotiated in three specs:

| Owner | Files |
|---|---|
| **FIX-1060** | `labs/trading-desk/components/summary/**` — including `aggregate.ts` — **except** the pre-fix marker seam in `report-summary.tsx`, which is FIX-1063's (below) |
| **FIX-1061** | `labs/trading-desk/components/theses/**` — the trader + risk memo renderers |
| **FIX-1062** | the cross-pane navigation contract: the header button in `components/theses/**`, `mobileTab` in `app/page.tsx`, and the scroll target in `components/transcript/**` |
| **FIX-783** | the PM prompt + writer under `flows/analysis/agents/portfolio-manager/` |

**The code says these do not collide, and the epic's framing overstated the risk.**
`aggregate.ts` lives *inside* `components/summary/` and is imported only by
`components/summary/*` — it is not a shared surface between A's two halves. The Theses pane
reads `ClientDataOf<typeof memosCollection>` straight off the resource, so it needs nothing
from the aggregate. Treat that as the boundary and it holds without coordination.

**FIX-1062 is not a theses-local change, and the first draft of this table said it was.**
`app/page.tsx` owns `mobileTab` and renders *either* `ThesesPane` *or* `TranscriptPane` below
the `lg` breakpoint — they are never mounted together. So a change confined to
`components/theses/**` cannot reveal, scroll to, or focus the target: on mobile the target
isn't in the tree. FIX-1062 therefore owns a small navigation contract spanning three
surfaces, and that is the boundary FIX-1061 must not cross. The two still don't collide —
FIX-1061 renders memo bodies, FIX-1062 moves the viewport — but they are adjacent inside
`components/theses/**`, so FIX-1062 lands its header-button edit first if both are in flight.

**One seam inside `components/summary/` is FIX-1063's, and the round-two fold created that
overlap without saying so.** Theme 1 handed FIX-1063 the persisted-report boundary; that
boundary *is* `report-summary.tsx`, which this table had already given to FIX-1060 whole. They
are two seams in one file. `report-summary.tsx` hydrates the stored spine
(`useResource(session, "valuationSpine")`) and hands it to `buildReportSummary` — **FIX-1063
owns that read and the pre-fix marker it keys on**, and **FIX-1060 owns which stored fields the
view renders**. Neither rewrites the view model, so they don't collide semantically; they are
simply adjacent in one file, so **FIX-1063 lands its marker edit first if both are in flight**
— which costs nothing, since it already sequences first. A group-A issue writing its own
version or provenance check has hit the gap theme 1 names: comment up, don't build a second one.

**One thing genuinely is shared, and it is upstream of both:** the memos collection ships the
*whole* memo state to the client (no projection declared). So every field either pane needs
is already in the browser, and **no issue in group A needs a resource or schema change.** An
A-issue that finds itself editing `flows/analysis/resources.ts` has left its lane.

**A scoping note for FIX-1060, because the framing suggests one seam and there are two.**
Some fields reach `aggregate.ts` and are then read by no component — the research manager's
stance, the trader's invalidation criteria. Others never enter the aggregate at all — the
research manager's unresolved disagreements, the risk assessment's `confidenceCalibration`
and `calibrationRationale`. Both are "computed, stored, never shown", but they are fixed at
different layers, and a change that only re-reads the aggregate's existing fields recovers
the first class and misses the second.

### 4. Load-bearing sequencing — and only this

Everything not listed here runs in parallel. Four orderings are real:

- **FIX-1063 before FIX-1064.** FIX-1063 changes the nullability of the exact fields
  FIX-1064's valuation math consumes. Building the multiples work first means building it
  twice.
- **FIX-1063 before FIX-826.** The same reason one lane over, and this document missed it
  while Linear already carried the relation. FIX-826 extends the very indicator contract
  FIX-1063 moves from numeric-and-`"flat"` to nullable-and-no-trend on insufficient history.
  Strength, persistence and inflection built against the old contract either preserve the
  fabricated zeros or get rebuilt after FIX-1063 lands.
- **FIX-780 before FIX-1061.** The new trader/risk memo renderer must not hard-code
  stop/target labels that FIX-780 is in the middle of changing.
- **FIX-1064 before FIX-1066** — the one ordering that also changes what FIX-1066 contains.
  `lenses.ts` defers mechanical-deep-value and GARP because the lens surface lacks EV
  multiples, earnings yield, ROIC and PEG, and it still does: the lens bundle carries
  `valuationSpine`, and `formatValuationSpine` emits expected return, fair value, DCF,
  triangulation and setup score — none of those four. `computeValuation` already derives all
  four from data the desk has, and `formatValuation` already shows them to the *analysts*, so
  putting them on the lens surface is a formatting change inside this epic's fence, not a new
  data lane. **FIX-1066 owns that surfacing and may not activate the two lenses without it**
  — otherwise the epic pays for two generator passes that flag a data gap and degrade into a
  second quality-value read, which is exactly what `lenses.ts` deferred them to avoid.
  FIX-1064 lands first so what the new lenses read is a labeled proxy rather than a blunt
  number presented as a measurement (§2 theme 2).

The first three are wired as Linear blocking relations; the fourth was added when this fold
landed. A fifth is weaker but worth stating: **FIX-1065 should be specced before anything else
in C is built against the reward-to-risk figure** — it may remove or reframe a value two
deterministic gates currently consume (§5).

**"Parallel" here means no ordering, not no adjacency.** Two pairs share a file without
sharing a seam, and §2 theme 3 carries both: FIX-1062 lands its header-button edit before
FIX-1061, and FIX-1063 lands its pre-fix marker in `report-summary.tsx` before FIX-1060. Read
this section alone and both pairs look unconstrained, which is how the second one reached
round three unnoticed. Neither is a blocking relation and neither belongs in Linear as one.

### 5. No new data lane

This epic works on the data the desk already has. No issue here adds a provider, a paid
entitlement, or a new data tool. An issue that concludes it needs one has hit the "Not doing"
fence in §1 — comment up on the epic PR; do not quietly widen the lane.

**Broadening the objective did not soften this fence.** §1 now owns two analysis adds and
their model cost; that is about *analysis*, not about data. Reformatting a metric the desk
already derives onto a surface that lacked it — FIX-1066's EV-multiple / earnings-yield / ROIC
/ PEG surfacing, for instance (§2 theme 4) — is inside the fence. Fetching one is not.

## 3. Shape of the whole

**No end-state POC was built, and that is a deliberate skip.** The division into issues here
is unusually well established: five of the twelve were filed months before this epic existed,
each against a separately observed report defect, and four of those are already `Todo`. The shared
surfaces (§2 theme 3) turned out on inspection to be *less* entangled than the framing
assumed. The question an end-state POC exists to answer — *does the division into issues hold
once it's all there?* — is answerable from the code, and it does: the set is still twelve
issues, and where two of them touch one file they own different seams in it (§2 theme 3 splits
`report-summary.tsx` between FIX-1060 and FIX-1063, and names the order they land in).

**The skip stands; the confidence behind it was overstated, and review proved it.** This
section first said a grep confirmed what a POC would have. It didn't quite — reading
`components/theses/**` in isolation is exactly what made FIX-1062 look theses-local, when
`app/page.tsx` never mounts the theses and transcript panes together on mobile (§2 theme 3).
A running end-state would have surfaced that in the first click. It cost one review round
instead, which is a cheaper place to find it than implementation, so the call was still
right — but "answerable from the code" means answerable by reading the *call sites*, not the
directory.

**What the report looks like once all twelve land.** The Summary opens with the decision as
it does today, but the conviction strip now reads against a research-manager stance that is
shown rather than merely stored, with its unresolved disagreements named beneath it. The
trader's block carries its invalidation criteria — the conditions that would falsify the
trade — instead of only its levels, and a flat-stance run reads as a monitoring range rather
than as a stop above a target. The price chart is present on every run rather than two in
thirteen. The PM's rating shows its absolute and relative halves and the band that clamped
it; the risk assessment shows its own calibration. Every memo's "jump to transcript" goes
somewhere.

Below that, the numbers are labeled for what they are. A multiple built on a blunt proxy says
which proxy. A figure whose input was never fetched — or whose ticker had too little history
to compute it, or whose provider answered for only some of its series — reads `—` rather than
`0` or `$0`, and a fundamentals miss can no longer make
a name look cheap by dropping its equity value out of enterprise value. A name with three
months of bars no longer asserts a flat trend it never measured. The lens convergence read
names how many lenses actually returned a verdict and which of them flagged a data gap. The
trend read characterizes strength, persistence and inflection — and on a name without the
history to measure them, says so.

**A report generated before this epic landed says so.** It is marked as pre-fix rather than
silently re-presenting its old zeros as current measurements, because nothing in an old record
distinguishes a missing zero from a measured one (§2 theme 1). The guarantee is
forward-looking, and the end state shows that on its face.

**Ten of those twelve sentences describe a value the desk already computes, shown honestly.**
Two do not: the fifth and sixth lenses are analyses that do not run today, and trend
characterization is a read the desk cannot currently produce. Both are owned by the objective
in §1 — this section is the picture of the end state, and the picture includes them.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| **A — render what we already compute** | | | | | |
| [FIX-1060](https://linear.app/fixpoint-labs/issue/FIX-1060) | Summary renders the stored structured fields it silently drops *(owns `components/summary/**` except the pre-fix marker seam in `report-summary.tsx`, §2 theme 3)* | **bug** | — | — | Backlog |
| [FIX-1061](https://linear.app/fixpoint-labs/issue/FIX-1061) | Dedicated renderer for the trader + risk-persona memos | spec | — | — | Backlog |
| [FIX-1062](https://linear.app/fixpoint-labs/issue/FIX-1062) | Jump-to-transcript actually jumps — spans theses + `page.tsx` + transcript (§2 theme 3) | **bug** | — | — | Backlog |
| [FIX-783](https://linear.app/fixpoint-labs/issue/FIX-783) | PM memo prose stops reading as a template; `items` arrays used | spec | — | — | Todo |
| **B — visible correctness & grounding** | | | | | |
| [FIX-782](https://linear.app/fixpoint-labs/issue/FIX-782) | `priceHistory` persists on every run, so the price chart is there — *its filed cause is stale; the row survives on a different one (below)* | **bug** | — | — | Todo |
| [FIX-780](https://linear.app/fixpoint-labs/issue/FIX-780) | Flat-stance runs stop overloading stop/target with a range | spec | — | — | Todo |
| [FIX-779](https://linear.app/fixpoint-labs/issue/FIX-779) | Entity-identity validation on discovery snippets | **bug** | — | — | Todo |
| **C — analytical depth & data honesty** | | | | | |
| [FIX-1063](https://linear.app/fixpoint-labs/issue/FIX-1063) | Unavailable payloads *and* every live-tagged producer that defaults an unobserved field — short-history indicator math, partial-FRED macro — null instead of zero-fill; owns the BP-030 dual-read at all three boundaries — fixture load, spine ingest, and the persisted report — plus the version stamp new records carry *(sequence first, §2 theme 1)* | spec ⚠ | — | — | Backlog |
| [FIX-1064](https://linear.app/fixpoint-labs/issue/FIX-1064) | Valuation multiples labeled or sharpened, not silently blunt *(after FIX-1063)* | spec | — | — | Backlog |
| [FIX-1066](https://linear.app/fixpoint-labs/issue/FIX-1066) | Lens pack to 6 *(activates the two lenses `lenses.ts` defers to FIX-705 — an analysis add the objective owns, §1)*; owns putting EV multiples / earnings yield / ROIC / PEG on the lens surface, so **after FIX-1064** (§2 theme 4); convergence accounts for per-lens data gaps | spec | — | — | Backlog |
| [FIX-1065](https://linear.app/fixpoint-labs/issue/FIX-1065) | The reward-to-risk figure stops resting on invented inputs | spec | — | — | Backlog |
| [FIX-826](https://linear.app/fixpoint-labs/issue/FIX-826) | Trend strength / persistence / inflection — built, not disclaimed (§1); a run without the history to measure it says so *(after FIX-1063)* | spec | — | — | Backlog |

*A `bug` row carries no spec PR by design — it routes straight to implementation
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec").
An empty Spec PR cell on a bug row is correct, not a gap. No spec or implementation branch
exists for any of the twelve issues yet, so every PR cell is empty; Route and State are
re-derived from Linear on each refresh.*

**FIX-782's filed cause is stale, and the row survives on a different one. The set is still
twelve.** Review argued the issue is already done: `storePriceHistory` is wired into
`analyze.ts`, persists a thinned slice, and is tested — all on `main`. That is half right, and
the half it gets right is the *diagnosis*, not the issue. FIX-782 was filed against a warm-cache
dependency (all three of its suspects are cache-related), and the FIX-758 spine migration
removed that cache from this path — the tap now reads the session `technicalData` spine, so the
description no longer describes the code. But the acceptance criteria are not met. The spine
write is gated on the subject ticker **at the canonical summary range**
(`SUMMARY_PRICE_RANGE = "1mo"`), so an analyst that fetched prices at any other range satisfies
the issue's first criterion — *"the technical analyst successfully fetched prices"* — while
leaving the tap nothing to find; and the tap still returns silently on a miss, so the second
criterion, an observable miss, is unmet outright. The corrected starting point is routed to the
issue as an implementer note rather than carried here.

**⚠ FIX-1063's route, corrected against Linear — twice.** Earlier drafts of this table said
the issue is labeled `Bug` and flagged the routing for the worker to re-check before building.
Round two corrected that to "no category label at all", and concluded the route derives to
**spec** by the fail-closed rule. The conclusion was right and the fact was not: the missing
label was the residue of a failed label write, not the issue's condition. Read back from
Linear, **FIX-1063 carries `Improvement` (Kind)**, so the route is `spec` outright rather than
by failing closed. Either way the worry the flag existed to raise is answered — the issue that
widens a tool output schema, owns the BP-030 dual-read at three boundaries and stamps new
records does **not** reach code without a spec gate. Both round-one reviewers argued for
promoting it; there is nothing to promote.

**The ⚠ stays for one reason.** The route is re-derived from the Linear category label on
every refresh, so a label added later re-routes the issue — and if `Bug` is ever applied, this
is the row where escape hatch 3 (*the "fix" changes a contract other code depends on →
promote it*) has to be the worker's call. Nothing else in the set carries this flag.

## 5. Open cross-cutting questions

- **Does removing the reward-to-risk figure take two deterministic gates down with it?**
  Raised while grounding §2 theme 2 against the code. Under the honesty rule, a figure built
  on invented inputs cannot be presented as a measurement — but the reward-to-risk value is
  not only displayed. The FIX-752 risk-appetite gate reads it as its reward-to-risk floor, and
  the FIX-781 evidence gate reads its `evidenceBasis` as one of its three layers. So FIX-1065
  cannot simply delete it without deciding what those two gates do afterward, and that is a
  decision about how conservative the desk is — not FIX-1065's alone. **Blocks nothing**;
  FIX-1065 specs it and the ask below is put to the product owner at the spec gate.

  **Corrected after epic review — the gates are downward-only in *effect*, not in *error*.**
  The first draft argued that a soft input driving a conservative-only check is a small sin,
  because both gates cap size and never inflate it. That reasoning does not hold. A gate that
  only ever caps still has to *decide whether to fire*, and both decide on the invented
  number: `computeEvidenceGate` clears its reward-to-risk layer on
  `rewardToRiskEvidenceBasis === "sufficient"`, which an optimistic distribution with enough
  finite buckets produces; `computeMandateGates` clears its soft cap when the GLR beats the
  mandate's `rewardToRiskFloor`. So an optimistic invention makes the protections **silently
  fail to fire** — permissive relative to a fail-closed treatment, even though nothing in the
  code path ever increases a size. The recommendation below is rewritten around that.

  > ### Reward-to-risk: fix the inputs, or stop calling it a measurement?
  >
  > **Plain terms.** The desk shows a reward-to-risk number and treats it as a hard fact — it
  > is used to decide whether a position is worth taking and how big it can be. But the odds
  > underneath it are not measured from anything. An AI wrote them. So a figure the desk
  > presents as arithmetic is, at its base, a guess wearing a decimal point.
  >
  > **Worse than it first looked.** Two automatic safety checks decide whether to shrink a
  > position by reading this number. When the AI's guess is optimistic, both checks quietly
  > conclude everything is fine and don't fire. So the number can't inflate a position
  > directly, but it can switch off the things that would have cut it. That is not a
  > cosmetic labeling problem.
  >
  > **The trade-off.** Three ways out. **Ground the odds** in something real — historical
  > outcome distributions, option-implied probabilities — which is genuinely new analytical
  > work and pulls a data lane this epic has fenced off. **Demote and fail closed** — label
  > the figure as model-estimated, and stop letting an estimate *satisfy* a safety check: it
  > may still trigger one, it may no longer clear one. **Demote and accept** — relabel it,
  > leave the checks reading it as they do today, and write down that optimistic guesses can
  > bypass them.
  >
  > **My recommendation: demote it and fail closed.** An estimate is not a measurement, so it
  > should not be able to answer a question that asks for one — that is exactly the rule the
  > rest of this epic is built on, and applying it anywhere but here would be arbitrary. In
  > practice this means more runs land on "don't add", which is the correct direction to be
  > wrong in for real money. Grounding the odds properly is a real piece of work and deserves
  > its own issue outside this epic.
  >
  > **What would change my mind:** if failing closed turns out to gate most runs rather than
  > the thin ones. A check that fires nearly always has stopped discriminating and become
  > noise people learn to ignore, which is worse than the status quo. That is measurable —
  > run the eval suite over the fixture corpus before and after and count. If it does gate
  > most runs, "demote and accept", with the bypass written down, is the honest interim.
  >
  > **Cost of being wrong: moderate, and it now runs both ways** — the first version of this
  > ask claimed it ran one way, which was the mistake above. Fail closed when we didn't need
  > to, and the desk under-sizes good setups and trains people to override the gate. Leave
  > the checks reading an optimistic guess, and they keep silently not firing on exactly the
  > thin theses they exist to catch. Worth twenty minutes of your time; not worth an
  > afternoon.

- **~~Should FIX-1062 fold into FIX-1061?~~** *Resolved: no, keep them separate.* Both
  reviewers proposed merging them on the premise that jump-to-transcript is ten lines inside
  `components/theses/**`, the same surface FIX-1061 owns. The premise is wrong: on mobile
  `app/page.tsx` renders the theses pane and the transcript pane exclusively, so the fix
  spans the header button, `mobileTab`, and the transcript's scroll target (§2 theme 3). It
  is a small navigation contract across three files, not a stub swap inside one. Merging it
  into a memo-rendering issue would bury a cross-pane behavior change inside a renderer PR.
  Recorded here so a third reviewer doesn't reopen it. The epic is twelve issues.

- **~~Do the epic's two capability adds belong in it?~~** *Resolved by the product owner at
  the objective gate: yes — both stay at full scope, and the objective broadened to own them.*
  FIX-826 keeps strength/persistence/inflection and is not narrowed to a disclaimer; FIX-1066
  keeps the 4→6 lens expansion. **Per-run model cost is ruled out as a scope constraint at
  current run volume** — settled, and not a child issue's to reopen. The no-new-data-lane
  fence (§2 theme 5) is unaffected and stands: the broadening covers generator-backed analysis
  and model spend, nothing else. §1 carries the decision.

- **~~Does the nullability guarantee cover already-persisted reports?~~** *Resolved: no — the
  guarantee is forward-looking. Legacy reports are marked, not migrated.* The call was forced
  rather than chosen: an old record carries no version and no per-field provenance, so nothing
  in it separates a missing zero from a measured one and a recompute would be guessing which
  zeros were real. Marking is the only honest option. FIX-1063 gains the third read boundary,
  the pre-fix marker, and the version stamp new records carry (the stamp is not deferrable —
  the marker has nothing to key on without it). §2 theme 1 carries the mechanism.

---

## Epic evolution

- **Epic drafted** — twelve issues under one outcome: the report faithfully represents the
  analysis that ran. Preserved the A/B/C grouping and the "Not doing" fence from the Linear
  issue. Added five cross-cutting decisions the framing gestured at but did not pin down, and
  corrected four claims about the code: `valuation.ts` lives at `flows/analysis/lib/`, not
  `lib/`; **four** empty-payload builders zero-fill, not three (`get_fundamentals`,
  `compute_indicators`, `get_macro_indicators`, `get_social_sentiment` — plus
  `get_reddit_mentions`' `mentions7d: 0`); the zero-fill **corrupts the valuation spine's
  arithmetic**, it does not merely display badly; and `aggregate.ts` is inside
  `components/summary/`, so group A's two halves do not share a file after all. Recorded the
  end-state POC as a deliberate skip.
- **After epic review (round 1)** — corrected the objective and four decisions the review
  falsified. §1 no longer claims the epic adds no capability: FIX-1066's lens pack 4→6
  activates two generator-backed lenses deferred to FIX-705, which is an analysis add and a
  standing model-cost increase, and FIX-826 is a second one — the gate is signing off two
  additions, not zero. Theme 1 now reaches the **live** indicator math (`indicators-math.ts`
  zero-returns on short history and `trendLabel` asserts `"flat"` from them, persisted with a
  live source — a fabrication on a *successful* fetch that the empty-payload framing missed),
  names FIX-1063 as the single dual-read owner at the ingest boundaries, and pins the two
  existing sentinels. Theme 3 widens FIX-1062 to the cross-pane navigation contract, because
  `page.tsx` never mounts the theses and transcript panes together on mobile. §5's
  reward-to-risk recommendation flipped to demote-and-fail-closed: the gates are downward-only
  in effect but decide whether to fire on the invented number, so an optimistic estimate
  switches the protections off rather than merely wearing a wrong label.
- **After epic review (round 2) + the owner's answers** — the two questions this epic asked
  came back answered and are recorded in §5 as settled. §1 stops hedging: the epic does two
  things (finish the report we compute, deepen two analyses), both capability adds stay at
  full scope, and per-run model cost is out as a scope constraint. Theme 1 gains a **third**
  read boundary — the persisted report (`report-summary.tsx`'s stored-spine hydration and
  `run-artifacts-action.ts`'s artifact return), where a pre-fix record is *marked* rather than
  migrated and new records carry a version stamp. Theme 4 goes from two orderings to four:
  **FIX-1063 → FIX-826** (already a Linear relation this doc had missed) and **FIX-1064 →
  FIX-1066**, the latter because the lens bundle still lacks the EV multiples, earnings yield,
  ROIC and PEG that `lenses.ts` deferred the two lenses for — `computeValuation` derives them
  and `formatValuation` shows them to analysts, but `formatValuationSpine` does not, so
  FIX-1066 owns that surfacing. And §4's route for FIX-1063 was **wrong**: the issue carries
  no category label, so it derives to `spec`, not `bug`.
- **After epic review (round 3)** — the authorized third round, spent on two above-the-bar
  findings and two corrections. Theme 1's live-path reach is now stated **by provenance rather
  than by file**: any producer that reports a live source while defaulting an unobserved field
  is inside the contract, and `get_macro_indicators` is a second confirmed instance — it stamps
  `source: "fred"` whenever *one* of nine series survives and `?? 0`s the rest, a fabrication
  the short-history framing did not reach. Theme 3 resolves an overlap the round-two fold
  created and did not declare: `report-summary.tsx` was owned whole by FIX-1060 *and* handed to
  FIX-1063 as the persisted-report boundary, so the two seams are now split and FIX-1063 lands
  its marker edit first. Two corrections cost nothing: **FIX-782's filed cause is stale** — the
  FIX-758 spine migration removed the warm cache its diagnosis rests on — but the row survives,
  because the summary-range gate and the silent miss leave both acceptance criteria unmet, so
  the set is still twelve; and **FIX-1063 does carry `Improvement` (Kind)** — the earlier "no
  category label" reading was a failed label write, not the issue's state.
