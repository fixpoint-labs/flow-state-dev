# Epic — Trading desk: AI evaluation & self-improvement loop

> **Coordination artifact, not an implementing spec.** The issues under this epic do
> **not** derive from this doc — they *reference and align* to it. This is the shared
> surface, the sequencing spine, and the running index for the set. See
> [`docs/contributing/orchestration.md`](../../contributing/orchestration.md) for what an
> epic-spec is.
>
> **Epic issue:** FIX-938 · **Epic branch:** `epic/trading-desk-self-improvement-loop`
> (never merged, never deleted) · **Epic PR:** [#898](https://github.com/fixpoint-labs/flow-state-dev/pull/898)
> · **Milestone:** M3 — AI evaluation & self-improvement loop · **Project:** Trading Desk Lab
> · **Team:** flow-state

---

## 1. Purpose & objective *(the `epic approved` sign-off surface)*

**Why this body of work.** The desk can now *run* an analysis headlessly and *score* whether a
run was internally coherent, but the loop that turns those scores into **repeatable improvement**
isn't closed. A prompt or pipeline change lands with no mechanical way to tell a real gain from
LLM variance; no bounded protocol lets an agent iterate unattended under a spend cap; and nothing
answers, for a human, *is the desk any good, and is it getting better?* This epic groups the
measurement substrate (mostly shipped) with its consumers so the cross-cutting calls — the eval
artifact format, what stays frozen during a campaign, how spend is bounded, and the
compute-vs-present seam — are made **once** (§2), not re-answered per issue.

**Outcome we are signing off on.** A shared substrate — headless batch harness (**FIX-788**),
run-quality eval suite (**FIX-790**), run-diff / golden-baseline scorecard (**FIX-791**), and
per-run cost + budget caps (**FIX-792**) — feeding **two independent endgames**:

- **Endgame A — the self-improvement loop (FIX-794).** A skill that takes a qualitative objective
  + budget ("improve debate engagement ≥0.10 without regressing evidence quality, ≤ $15 or 8
  experiments, only touch debate prompts") and runs a bounded, autoresearch-style campaign: freeze
  the evaluator, replicate a baseline, make one hypothesis-driven change, measure, keep only
  credible wins, revert losses, persist a resumable ledger. The desk *optimizing itself* — and the
  framework-reusable prize (FIX-794 is scoped trading-desk-specific in v1 but shaped so another FSD
  app can adopt it).
- **Endgame B — the track-record surface (FIX-812).** A standing, human-readable page that
  aggregates eval + outcome signals into a legible verdict — hit rate, calibration, quality trend.
  Improvement made *visible*, not asserted. The showcase artifact a reviewer reads.

Endgame B needs ground truth the fixture corpus lacks, so a **ground-truth spur** sits under it:
a leakage-audited historical corpus with known forward outcomes (**FIX-789**) and the
outcome-scoring / backtest pass over it (**FIX-793**) — which is also the strongest signal Endgame
A can optimize against once it exists.

**Holistic-necessity check (does the *set* overbuild?).** No — one shared substrate + two
consumers + a spur that feeds both:

- **The substrate is genuinely shared.** FIX-794 and FIX-812 consume the *same* per-run records,
  scoreboard, and run-diff verdict; FIX-791's `keep | discard | inconclusive` is the exact
  primitive FIX-794's compare step needs; FIX-792's accounting is both a hard gate on FIX-794's
  spend and a column in FIX-791's diff. Deciding these apart would fork the artifact format and the
  budget system.
- **Two endgames, honestly distinct — not forced into one.** The loop wants a machine-readable
  file; the showcase wants a page. They share the substrate and diverge above it.
- **The spur is the expensive, riskiest arc and is scoped deferrable** (§2a) — the showcase spine
  can be held for a follow-up without blocking the loop.
- **Out of scope** (§4): the product-facing review loop (FIX-763), the data/analyst factual-accuracy
  benchmark (FIX-808), and the sibling AV-data (FIX-934) and scanner (FIX-937) epics.

**What ramps on approval.** The epic-objective gate is an approving comment or GitHub Review from a
**human** on the epic PR (#898) — the coordinator then *mirrors* it to the `epic approved` label,
which records the gate but does not trigger it (a worker waits for the human approval, not the
label). Approval releases the not-yet-specced sub-issues (FIX-789 / 792 / 793 / 794 / 812) from
NEEDS_SPEC; the already-shipped and in-flight substrate (FIX-788 / 790 / 791) is wrapped for
coordination, not rolled back. Current per-issue state lives only in the running index (§3) — itself
a projection refreshed from Linear + PR handles, with Linear and the PRs as the state authority.

---

## 2. Themes & long-horizon direction

### 2a. Two spines — loop-first; the showcase spine is deferrable

Below the shared substrate the set splits into two internally-sequential spines that don't block
each other:

- **Loop spine (Endgame A):** FIX-791 → **FIX-792** → **FIX-794**. Shorter, and its payoff is the
  framework-reusable protocol. **Sequence first.**
- **Showcase spine (Endgame B):** FIX-789 → **FIX-793** → **FIX-812**. Heavier (FIX-789 is the long
  pole) and delivers demo/evidence value, not a reusable capability. **Explicitly deferrable** —
  M3 can ship the closed loop before this spine is funded, and it may split to a follow-up epic if
  the corpus proves costly. §3 marks the priority.

Because each spine is internally sequential, the right execution shape is **per-spine
issue-lifecycle chains, not a wide fan-out.**

### 2b. Shared contracts — decided once here

Every issue in the set plugs into these four contracts rather than reinventing them:

- **One artifact set.** The batch runner appends one separable record per run to a **JSONL
  scoreboard** (FIX-788/790); the run-diff (FIX-791) *composes and compares* those records; the
  track-record surface (FIX-812) *presents* them. New signals (cost from FIX-792, outcome scores
  from FIX-793) light up **additively** as fields — consumers read them when present, degrade
  honestly when absent.
- **One frozen evaluator.** During a FIX-794 campaign the evaluator, rubrics, fixtures, manifest,
  judge/executor model ids, thresholds, and eval version are frozen; a candidate may change only
  its declared editable surface. This is what keeps a "win" real. It is a set-wide rule, not a
  FIX-794-private one.
- **One budget owner.** FIX-792 owns whole-command token/dollar accounting and the batch cap (stop
  cleanly, mark remaining runs `skipped-for-budget`, never mid-run abort). FIX-794 spends against
  *that* accounting; FIX-791's cost-delta column reads *that* accounting. No second budget system,
  no estimator fork.
- **The compute/present seam.** Compute layers (FIX-790 quality, FIX-793 outcome, FIX-791 diff) own
  every number and emit machine-readable records only. The present layer (FIX-812) owns legibility,
  computes nothing new, spends no tokens to view (the FIX-727 "read it without re-running"
  discipline), and is honest about thin data. The loop (FIX-794) is a *third* consumer — it reads
  those records and writes a **campaign ledger** that stays distinct from both the committed
  `goals/` regression surface and the FIX-812 track record. Three stores, kept separate.

**Dual-variance win gate — the load-bearing cost guardrail.** A win must clear *both* the declared
minimum effect *and* the noise band, and that means two variances: judge-only (re-grade a fixed run
— already FIX-790's `variance`, cheap) and end-to-end analysis (independent re-runs of a fixture —
`O(fixtures × replications × analyze_cost)`, expensive). To keep an unattended campaign from
burning budget before it produces signal, child specs **must** default to: baseline replicated
**once per campaign**; a **tiered compare** (cheap low-k screen → bounded full-replication confirm
only for promising candidates); and explicit caps on manifest size and replication count. Re-judging
one stored session is *not* run variance — don't conflate them.

**Outcome semantics are owned upstream.** What "the call was right" means — horizon, benchmark,
`outcomeVerdict` shape — is defined by FIX-793 (coordinated with product-side FIX-763); FIX-812
reports against it and invents nothing. FIX-789's per-payload leakage tags (`point-in-time-true` /
`reconstructed` / `unavailable-at-date`) are the audited foundation both depend on.

### 2c. Child-spec gates (settled decisions, enforced downstream — not open questions)

- **FIX-792 must land whole-command accounting before FIX-794 ships.** The shipped `--max-cost-usd`
  budgets *judge* calls only; unattended spend requires every generator *and* judge call accounted,
  failing closed when usage is unavailable. This is a **requirement**, not a confirmation.
- **FIX-794 must be subprocess-bound** (drive the `labs/trading-desk` `pnpm eval` sweep exit codes
  + ledger), never poll/sleep loops.
- **FIX-793 scores stored decision artifacts** against recorded forward prices — it does not
  re-analyze historical rows.
- **Child specs link, don't restate** the existing substrate — and must not collapse its two roles
  into one. **`pnpm eval sweep`** in `labs/trading-desk` (`scripts/eval-runs.ts`) is the **record
  producer**: it appends per-run `QualityRecord` rows to `scoreboard.jsonl` and exits non-zero on run
  errors / hard-invariant failures, but it does **not** emit the compare verdict. The
  `keep | discard | inconclusive` **verdict is owned by the FIX-791 run-diff / golden scorecard**
  over those records (§2b) — a campaign routes its decision through that diff, never raw scoreboard
  rows or sweep exit status. See `labs/trading-desk/docs/run-quality-eval.md` for the sweep CLI
  (required `--manifest`, budget/judge flags), plus the scorers in `labs/trading-desk/eval/*`. The `verify-trading-desk` skill is a **single-run
  smoke verifier** (`fsdev run` + `runSummary`) for focused real-path diagnosis — **not** the
  scoreboard/batch path, so FIX-794 must not compose it as the eval loop. And the `distill-lessons`
  campaign-ledger pattern — disambiguating **desk eval loop** from the dev cycle-ledger, which are
  different things.

---

## 3. Running index

A durable audit log — **a projection refreshed from Linear + PR handles, not a second live
source**; Linear and the PRs remain the state authority. Within this doc, per-issue state is
tracked here only (not restated in §1/§2), refreshed as PRs open.

| Issue | State | Spine | Priority | Spec PR | Impl PR | Notes |
|---|---|---|---|---|---|---|
| **FIX-788** | Done | substrate | — | — | [#651](https://github.com/fixpoint-labs/flow-state-dev/pull/651) | headless run + batch harness; the JSONL scoreboard |
| **FIX-790** | Done | substrate | — | [#736](https://github.com/fixpoint-labs/flow-state-dev/pull/736) | [#738](https://github.com/fixpoint-labs/flow-state-dev/pull/738) | run-quality suite: invariants + LLM-judge + judge variance |
| **FIX-791** | In Review | substrate | — | [#804](https://github.com/fixpoint-labs/flow-state-dev/pull/804) | — | run-diff + golden baseline; keep/discard/inconclusive |
| **FIX-792** | Backlog | loop | **P1** | — | — | cost + token accounting + batch caps; **hard prereq for FIX-794** |
| **FIX-794** | Backlog | loop | **P1** | — | — | the self-improvement loop skill *(Endgame A)*; blocked-by 790/791/792 |
| **FIX-789** | Backlog | showcase | P2 *(deferrable)* | — | — | historical point-in-time corpus; the long pole |
| **FIX-793** | Backlog | showcase | P2 *(deferrable)* | — | — | outcome scoring / backtest; blocked-by 789/790 |
| **FIX-812** | Backlog | showcase | P2 *(deferrable)* | — | — | track-record surface *(Endgame B)*; blocked-by 790/793 |

Epic PR (this doc, never merged): [#898](https://github.com/fixpoint-labs/flow-state-dev/pull/898).

---

## 4. Open cross-cutting questions

Genuinely undecided — for spec time, not settled decisions (those are §2c).

1. **How far does FIX-789 go in v1?** Point-in-time fundamentals-as-known-then are commercial;
   EDGAR filing dates are reconstructible; news/social generally aren't retro-fetchable. The
   showcase spine's whole value rises and falls with how much honest ground truth the corpus can
   assemble. Settle v1 depth in FIX-789's spec **before** committing FIX-793/812 scope — and it is
   the reason the showcase spine is marked deferrable (§2a).
2. **Is FIX-812 a page, a file, or both?** The loop wants a machine-readable artifact, the showcase
   wants a browsable page; these may not be one surface. A rendering decision only — the
   compute/present seam (§2b) settles the *data* regardless.
3. **What exact snapshot fields serve *both* the eval backtest and the product review loop?**
   Ownership is settled — FIX-793 defines `outcomeVerdict` (§2b/§2c). What's open is the concrete
   shape: the fields (horizon window, benchmark, per-horizon returns, max drawdown) that satisfy
   eval-side FIX-793 *and* product-side FIX-763 from one schema, not two. Resolve in FIX-793's spec
   against FIX-763's needs.
