# Epic — Trading desk: AI evaluation & self-improvement loop

> **Coordination artifact, not an implementing spec.** The issues under this epic do
> **not** derive from this doc — they *reference and align* to it. This is the shared
> surface, the sequencing spine, and the running index for the set. See
> [`docs/contributing/orchestration.md`](../../contributing/orchestration.md) for what an
> epic-spec is.
>
> **Epic issue:** FIX-938 · **Epic branch:** `epic/trading-desk-self-improvement-loop`
> (never merged, never deleted) · **Milestone:** M3 — AI evaluation & self-improvement
> loop · **Project:** Trading Desk Lab · **Team:** flow-state

---

## 1. Purpose & objective *(the `epic approved` sign-off surface)*

**Why this body of work.** The trading-desk lab can now *run* an analysis headlessly and
*score* whether a run was internally coherent, but the loop that would turn those scores into
**repeatable improvement** isn't closed. When a prompt or pipeline change lands, there is no
mechanical way to tell a real behavioral gain from ordinary LLM variance; there is no bounded
protocol an agent can follow to iterate unattended under a spend cap without inventing the
rules each time; and there is nowhere a human can read to answer the only question a skeptic
actually asks — *is the desk any good, and is it getting better?* Each of those gaps has been
filed as its own issue, and several of the substrate pieces have already shipped. What this
epic does is **make the cross-cutting calls once** — what the eval artifacts are, what stays
frozen during a campaign, how spend is bounded, and where "compute a score" ends and "present
the evidence" begins — so the two consumers don't each answer them differently.

**Outcome we are signing off on.** A measurement substrate — the headless batch harness
(**FIX-788**, shipped), the run-quality eval suite (**FIX-790**, shipped), the run-diff /
golden-baseline regression scorecard (**FIX-791**, in review), and per-run cost + budget caps
(**FIX-792**) — feeding **two distinct endgames**:

- **Endgame A — the self-improvement loop (FIX-794).** A repo-local skill that takes a
  qualitative objective plus a budget ("improve debate engagement by ≥0.10 without regressing
  evidence quality, spend ≤ $15 or 8 experiments, only touch debate prompts") and runs a
  bounded, autoresearch-style campaign: freeze the evaluator, establish a replicated baseline,
  make one hypothesis-driven change, measure it, keep only credible wins, revert losses,
  persist a resumable ledger. This is the desk *optimizing itself*.
- **Endgame B — the track-record surface (FIX-812).** A standing, human-readable surface that
  aggregates the eval + outcome signals into a legible verdict — hit rate and calibration
  against realized outcomes, quality-score trend across runs — so improvement is *visible*,
  not just asserted. This is the showcase artifact a reviewer reads.

Endgame B needs ground truth that the fixture corpus doesn't carry, so a **ground-truth spur**
sits under it: a historical point-in-time corpus with known forward outcomes (**FIX-789**) and
the outcome-scoring / backtest pass that consumes it (**FIX-793**). That same outcome signal is
also the strongest input the loop (A) can optimize against once it exists.

**What ramps when the objective is approved.** Per the objective gate (`orchestration.md`
§Gates), applying `epic approved` releases the Backlog sub-issues (FIX-789 / 792 / 793 / 794 /
812) from NEEDS_SPEC so they can be specced. FIX-788 and FIX-790 are **Done** and FIX-791 is
**In Review** — the epic wraps shipped and in-flight work for coordination and does **not** roll
it back. What actually paces the work is not the gate but the **two sequencing spines** (§2a).

**Holistic-necessity check (does the *set* overbuild even if each issue earns its place?).**

- **The substrate is genuinely shared, not incidental.** FIX-794 and FIX-812 both consume the
  *same* per-run quality records, the *same* JSONL scoreboard, and the *same* run-diff verdict.
  FIX-791's `keep | discard | inconclusive` output is the exact primitive FIX-794's compare step
  needs; FIX-792's cost accounting is both a hard gate on FIX-794's unattended spend *and* a
  column in FIX-791's diff. Deciding these apart would fork the artifact format and the budget
  system. Grouping them fixes that once.
- **Two endgames, honestly independent.** The loop (A) and the showcase (B) are *not* the same
  deliverable and shouldn't be pretended into one — the loop wants a machine-readable file, the
  showcase wants a page (FIX-812 §Open questions flags this fork explicitly). They share the
  substrate and diverge above it. The epic exists to hold the shared floor coherent, not to
  force the two roofs together.
- **The ground-truth spur is the expensive, riskiest arc — and it is scoped as its own track.**
  FIX-789 (a leakage-audited historical corpus) carries real open questions (commercial
  point-in-time fundamentals, non-retro-fetchable news) and gates FIX-793 and the outcome half
  of FIX-812. It is included because outcome truth is what upgrades "coherent" to "predictive,"
  but it is deliberately *behind* the cheaper loop track so the epic can deliver value before
  paying for it (§2a).
- **Adjacent work is deliberately out** (§4): the product-facing review loop (FIX-763), the
  data/analyst factual-accuracy benchmark (FIX-808), and the sibling AV-data (FIX-934) and
  scanner (FIX-937) epics are neighbors, not sub-issues.

Net: one measurement substrate (mostly shipped) + two independent consumers + a ground-truth
spur that feeds both — a coherent set whose only real "could we cut it" question is *how far to
go on FIX-789*, which §2a and §4 Q1 hold open on purpose.

---

## 2. Themes & long-horizon direction

### 2a. Two sequencing spines — the loop is the cheaper, framework-reusable prize

The set is **not** one linear chain. Below a shared substrate it splits into two spines that
can proceed independently:

**Substrate (shared floor):**
FIX-788 *(Done)* → FIX-790 *(Done)* → **FIX-791** *(in review)* → **FIX-792**.

**Loop spine (Endgame A):**
FIX-791 → **FIX-792** → **FIX-794**. FIX-792 is a **hard prerequisite** for FIX-794 — an
unattended loop that spends real money must account for every generator *and* judge call and
fail closed when usage is unavailable (FIX-794 §Budget: `--max-cost-usd` must not silently mean
"judge calls only"). This spine is the shorter one and its payoff, FIX-794, is explicitly
structured to be *"trading-desk-specific in v1 but structured so another FSD app can adopt the
same shape."* That reusability is the strategic reason to sequence this spine **first**: the
prize isn't a better trading desk, it's a repeatable evaluate-and-auto-optimize protocol the
framework inherits.

**Showcase spine (Endgame B):**
FIX-789 → **FIX-793** → **FIX-812**. This is the heavier arc — FIX-789's corpus is the
long-pole — and it delivers the *demo/evidence* value rather than a reusable capability. Recommend
sequencing it **after** the loop spine unless the immediate need is a reviewer-facing artifact.

The two spines share only the substrate; neither blocks the other below it. A fleet running this
epic would parallelize the two spines against each other and gain little more, because each spine
is internally sequential — so **per-spine issue-lifecycle chains, not a wide fan-out**, is the
right execution shape.

### 2b. The shared eval surface — one artifact set, one frozen evaluator, one budget

Everything in the substrate must agree on the same primitives so the two consumers plug into one
surface rather than three:

- **One artifact set.** The batch runner appends **one separable record per run to a JSONL
  scoreboard** (FIX-788/790); the run-diff (FIX-791) *composes and compares* those records and
  never re-derives them; the track-record surface (FIX-812) *presents* them and computes nothing
  the eval layers don't already own. New signals (cost from FIX-792, outcome scores from FIX-793)
  **light up additively** as columns/fields on the existing record — consumers read them when
  present, degrade honestly when absent.
- **One frozen-evaluator discipline.** During a FIX-794 campaign the evaluator implementation,
  rubrics, fixtures, manifest, judge/executor model ids, thresholds, and eval version are
  **frozen** — a candidate may change only its declared editable surface. This is what keeps a
  "win" a real win and not a moved goalpost; it is a cross-cutting rule every consumer honors, not
  a FIX-794-private one.
- **One budget discipline.** FIX-792 owns whole-command token/dollar accounting and the batch cap
  (stop cleanly, mark remaining runs `skipped-for-budget`, never a mid-run abort). FIX-794 spends
  against *that* accounting; FIX-791 reports cost deltas from *that* accounting. No second budget
  system.
- **Variance is two numbers, not one.** Judge-only variance (re-grade a fixed stored run) is
  already FIX-790's `variance`; the loop additionally needs **end-to-end analysis variance**
  (multiple independent runs of the same fixture). FIX-791's comparison surface must expose both,
  and a candidate is a win only when the effect exceeds **both** the declared minimum and the
  relevant noise band. Do not conflate the two — re-judging one session is not run variance.

### 2c. Compute vs. present — the load-bearing seam

The single most important cross-cutting decision in this epic is the **compute/present split**,
because it is where the two endgames diverge and where scope creep would blur them:

- **Compute layers** (FIX-790 quality, FIX-793 outcome, FIX-791 regression diff) own every number.
  They emit machine-readable records built for an agent loop — a JSONL line, a scoreboard, a diff
  verdict — and they never render for a human.
- **Present layer** (FIX-812) owns legibility. It aggregates already-stored records into a page a
  person trusts, computes nothing new, spends no model tokens to view (the FIX-727 "read it without
  re-running" discipline), and is honest about thin data (a small corpus is shown as small, not
  laundered into false confidence).
- **The loop (FIX-794) is a *third* kind of consumer** — it reads the compute layers' files to
  decide keep/discard, and it writes an experiment ledger, but its ledger is **campaign state**,
  not the committed `goals/` regression surface and not the FIX-812 track record. Keep the three
  stores distinct: gitignored campaign ledger (FIX-794), committed goal checks (existing), standing
  evidence surface (FIX-812).

**Outcome semantics are owned upstream, not re-litigated here.** What "the call was right" means —
the horizon window, the benchmark, the `outcomeVerdict` shape — is defined by FIX-793 (and
coordinated with the product-side FIX-763), and FIX-812 *reports against* that definition. FIX-789's
leakage discipline (`point-in-time-true` / `reconstructed` / `unavailable-at-date` per payload) is
the audited foundation both depend on.

---

## 3. Running index

Durable audit log of every issue under the epic and its PRs. Refreshed from the fleet's handles as
PRs open.

| Issue | State | Track | Spec PR | Impl PR | Notes |
|---|---|---|---|---|---|
| **FIX-788** | Done | substrate | — | [#651](https://github.com/fixpoint-labs/flow-state-dev/pull/651) | headless run + batch harness; the JSONL scoreboard |
| **FIX-790** | Done | substrate | [#736](https://github.com/fixpoint-labs/flow-state-dev/pull/736) | [#738](https://github.com/fixpoint-labs/flow-state-dev/pull/738) | run-quality eval suite: invariants + LLM-judge + judge variance |
| **FIX-791** | In Review | substrate | [#804](https://github.com/fixpoint-labs/flow-state-dev/pull/804) | — | run-diff + golden baseline; `keep \| discard \| inconclusive` |
| **FIX-792** | Backlog | loop | — | — | per-run cost + token accounting + batch budget caps; **hard prereq for FIX-794** |
| **FIX-794** | Backlog | loop | — | — | the self-improvement loop skill *(Endgame A)*; blocked-by 790/791/792 |
| **FIX-789** | Backlog | showcase | — | — | historical point-in-time corpus with known outcomes; the long pole |
| **FIX-793** | Backlog | showcase | — | — | outcome scoring / backtest; blocked-by 789/790 |
| **FIX-812** | Backlog | showcase | — | — | track-record surface *(Endgame B)*; blocked-by 790/793 |

Epic PR (this doc, never merged): _to be filled when the epic PR opens_.

---

## 4. Open cross-cutting questions

1. **How far does FIX-789 go in v1?** The corpus is the epic's long pole and its open questions
   are real: point-in-time fundamentals-as-known-then are commercial (EDGAR filing dates are
   reconstructible; news/social generally aren't retro-fetchable). The epic's position is that
   FIX-789 records the gap honestly (`unavailable-at-date`) rather than faking it, and the *showcase
   spine's whole value* rises and falls with how much honest ground truth it can assemble. Settle
   the v1 depth in FIX-789's spec **before** committing FIX-793/812 scope — the showcase can't
   over-promise on a corpus that doesn't exist.

2. **Is FIX-812 a page, a file, or both?** FIX-812 §Open questions flags a genuine fork: the loop
   wants a machine-readable artifact, the showcase wants a browsable page, and these may not be the
   same surface. Resolve at FIX-812 spec time; the compute/present seam (§2c) means the *data* is
   settled regardless, so this is a rendering decision, not a data-model one.

3. **Which budget system is canonical?** FIX-792 owns whole-command token/dollar accounting for the
   eval loop. Confirm in FIX-792's spec that FIX-794 spends against exactly that accounting (not a
   parallel estimator) and that FIX-791's cost-delta column reads the same source — so "improved
   quality 3%, tripled cost" is one number, computed once.

4. **Where does the outcome definition live?** `outcomeVerdict` semantics (window, benchmark) are
   shared by the eval-side FIX-793 and the product-side FIX-763. Fix the field shapes once, in
   FIX-793, so both the backtest and the product review loop read the same snapshot fields; FIX-812
   reports against that definition and does not invent its own.

5. **Sequencing: does the loop spine ship before the showcase spine?** The recommendation (§2a) is
   yes — FIX-792 → FIX-794 first, because it's the shorter chain and yields the framework-reusable
   protocol, while FIX-789 → FIX-793 → FIX-812 is heavier and delivers demo value. This is a
   direction, not a gate; the `epic approved` sign-off is on the *set*, and the spines can be
   re-ordered if a reviewer-facing artifact becomes the priority.
