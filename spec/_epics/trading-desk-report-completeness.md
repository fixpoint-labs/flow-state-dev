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
faithfully represent the analysis that ran?** No new provider and no new data lane — that
fence is absolute (§2 theme 5). Every previous trading-desk epic added a capability; this one
almost entirely finishes the report we already build.

**Almost, not entirely — and the objective has to say so.** Ten of the twelve issues add
nothing; they make an existing figure honest. Two do add analysis, and both are named here
rather than left in an issue, because *"this epic adds no capability"* is the sentence the
objective gate signs off:

- **FIX-826** adds trend characterization (strength, persistence, inflection). Already flagged
  below as the weakest issue in the set.
- **FIX-1066** is the one the original framing hid. Taking the lens pack from four to six
  activates two generator-backed lenses that `agents/lenses/lenses.ts` currently defers to
  FIX-705 — so it adds two real analyses and roughly half again as much phase-2b model spend
  on the `full` preset. That is a capability add and a recurring cost, not a rendering change.

Neither is disqualifying, and neither is being smuggled. But the gate is signing off a set
that adds two analyses, not zero.

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

**The weakest issue is FIX-826** (trend depth). The desk labels its moving-average stack but
cannot characterize strength, persistence, or inflection. That is a real gap — but it is one
of only two issues here that add analytical *capability* (FIX-1066 is the other), where the
remaining ten make an existing figure honest. **Kept, scoped to the honesty framing**:
characterize the trend, or say plainly that the desk can't. If it grows a new indicator suite
during implementation, that is the signal it belonged in a later epic.

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
- **The live math path, not only the empty-payload builders.** This is the reach the epic's
  first draft missed, and it is the one that fabricates figures on a *successful* fetch.
  `indicators-math.ts` returns a literal `0` whenever there isn't enough history — `sma(…)`
  and `rsi(…)` short-circuit on `values.length < period`, `macd` on `< 35` bars, `bollinger`,
  `stochastic` and `kdj` likewise — and `trendLabel` maps `sma50 === 0 || sma200 === 0`
  straight to `"flat"`. A recent IPO with fewer than 200 daily bars therefore persists zeroed
  indicators and an asserted flat trend **tagged with a live source**, which is strictly worse
  than the unavailable case: nothing marks it as missing. Widening the schemas and nulling the
  empty payloads does not satisfy this contract. Insufficient history must emit `null` and no
  trend, on the same footing as a provider miss.

**This is a BP-030 tolerate-the-old-shape change, and FIX-1063 owns it.** Recorded fixture
snapshots under `fixtures/<TICKER>/<DATE>/` and every persisted memo, valuation spine, and
decision snapshot already carry the zero-filled shape. Dual-read them: an old record's `0`
must not be re-interpreted as a *new* honest zero, and a new record's `null` must not crash a
legacy read path.

**One owner, one boundary — not twelve consumers each writing `if (x === 0)`.** "Whichever
issue lands the schema change" was too vague to coordinate against: the payloads have many
readers, and a per-consumer coercion is how the zero-fill quietly survives in the one path
nobody updated. FIX-1063 owns the legacy coercion and it lands at the **ingest boundaries**
(fixture load and valuation-spine ingest), so every downstream issue may assume it is reading
normalized, honestly-null inputs. An issue in group A or C that finds itself writing its own
legacy-zero check has hit a gap in FIX-1063, not a task of its own — comment up.

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
as full-pack conviction), and FIX-826 (a trend read that cannot characterize strength must not
imply that it can).

### 3. Renderer ownership — who owns which file

Group A's four issues run in parallel branches, so file ownership is stated once here rather
than negotiated in three specs:

| Owner | Files |
|---|---|
| **FIX-1060** | `labs/trading-desk/components/summary/**` — including `aggregate.ts` |
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

Everything not listed here runs in parallel. Two orderings are real:

- **FIX-1063 before FIX-1064.** FIX-1063 changes the nullability of the exact fields
  FIX-1064's valuation math consumes. Building the multiples work first means building it
  twice.
- **FIX-780 before FIX-1061.** The new trader/risk memo renderer must not hard-code
  stop/target labels that FIX-780 is in the middle of changing.

Both are already wired as Linear blocking relations. A third is weaker but worth stating:
**FIX-1065 should be specced before anything else in C is built against the reward-to-risk
figure** — it may remove or reframe a value two deterministic gates currently consume (§5).

### 5. No new data lane

This epic finishes the report on the data the desk already has. No issue here adds a
provider, a paid entitlement, or a new data tool. An issue that concludes it needs one has
hit the "Not doing" fence in §1 — comment up on the epic PR; do not quietly widen the lane.

## 3. Shape of the whole

**No end-state POC was built, and that is a deliberate skip.** The division into issues here
is unusually well established: five of the twelve were filed months before this epic existed,
each against a separately observed report defect, and four of those are already `Todo`. The shared
surfaces (§2 theme 3) turned out on inspection to be *less* entangled than the framing
assumed. The question an end-state POC exists to answer — *does the division into issues hold
once it's all there?* — is answerable from the code, and it does: the set is still twelve
issues and no two of them own the same seam.

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
to compute it — reads `—` rather than `0` or `$0`, and a fundamentals miss can no longer make
a name look cheap by dropping its equity value out of enterprise value. A name with three
months of bars no longer asserts a flat trend it never measured. The lens convergence read
names how many lenses actually returned a verdict and which of them flagged a data gap. The
trend read either characterizes strength and persistence or says the desk cannot.

**Ten of those twelve sentences describe a value the desk already computes, shown honestly.**
Two do not: the sixth lens pack is two analyses that do not run today, and trend
characterization is a read the desk cannot currently produce. Both are called out in §1 —
this section is the picture of the end state, and the picture includes them.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| **A — render what we already compute** | | | | | |
| [FIX-1060](https://linear.app/fixpoint-labs/issue/FIX-1060) | Summary renders the stored structured fields it silently drops | **bug** | — | — | Backlog |
| [FIX-1061](https://linear.app/fixpoint-labs/issue/FIX-1061) | Dedicated renderer for the trader + risk-persona memos | spec | — | — | Backlog |
| [FIX-1062](https://linear.app/fixpoint-labs/issue/FIX-1062) | Jump-to-transcript actually jumps — spans theses + `page.tsx` + transcript (§2 theme 3) | **bug** | — | — | Backlog |
| [FIX-783](https://linear.app/fixpoint-labs/issue/FIX-783) | PM memo prose stops reading as a template; `items` arrays used | spec | — | — | Todo |
| **B — visible correctness & grounding** | | | | | |
| [FIX-782](https://linear.app/fixpoint-labs/issue/FIX-782) | `priceHistory` persists on every run, so the price chart is there | **bug** | — | — | Todo |
| [FIX-780](https://linear.app/fixpoint-labs/issue/FIX-780) | Flat-stance runs stop overloading stop/target with a range | spec | — | — | Todo |
| [FIX-779](https://linear.app/fixpoint-labs/issue/FIX-779) | Entity-identity validation on discovery snippets | **bug** | — | — | Todo |
| **C — analytical depth & data honesty** | | | | | |
| [FIX-1063](https://linear.app/fixpoint-labs/issue/FIX-1063) | Unavailable payloads *and* short-history live math null instead of zero-fill; owns the BP-030 dual-read at the ingest boundaries *(sequence first, §2 theme 1)* | **bug** ⚠ | — | — | Backlog |
| [FIX-1064](https://linear.app/fixpoint-labs/issue/FIX-1064) | Valuation multiples labeled or sharpened, not silently blunt | spec | — | — | Backlog |
| [FIX-1066](https://linear.app/fixpoint-labs/issue/FIX-1066) | Lens pack to 6 *(activates the two lenses `lenses.ts` defers to FIX-705 — a capability add, §1)*; convergence accounts for per-lens data gaps | spec | — | — | Backlog |
| [FIX-1065](https://linear.app/fixpoint-labs/issue/FIX-1065) | The reward-to-risk figure stops resting on invented inputs | spec | — | — | Backlog |
| [FIX-826](https://linear.app/fixpoint-labs/issue/FIX-826) | Trend strength / persistence / inflection, or an honest "can't" | spec | — | — | Backlog |

*A `bug` row carries no spec PR by design — it routes straight to implementation
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec").
An empty Spec PR cell on a bug row is correct, not a gap.*

**⚠ FIX-1063's route is flagged for the worker to re-check before it builds.** It is labeled
`Bug`, which routes it direct with no spec gate — but the fix widens a tool output *schema*
that other code depends on and needs a BP-030 dual-read of persisted records (§2 theme 1).
That is escape hatch 3 in "Which issues get a spec": *the "fix" changes a contract other code
depends on → promote it.* The routing call is the worker's, not this document's; it is named
here so it is not missed. Nothing else in the set carries this flag.

**Review strengthened the case, and it is recorded rather than acted on.** Both reviewers
independently read this as a promote, and theme 1 has since widened the issue's scope twice —
it now also owns the short-history live math path and the single dual-read boundary every
other issue depends on. That is more contract, not less. The route is still derived from the
Linear category label on every refresh and the promotion is still the worker's call
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec"),
so this document does not relabel the issue; it records that two reviewers and the epic all
point the same way.

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
