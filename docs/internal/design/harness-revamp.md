# Design — Harness revamp: philosophy-grounded, self-improving development loop

**Date:** 2026-07-22
**Branch:** `claude/dev-process-improvement-6irwyn`
**Status:** IN PROGRESS — one PR (docs-only). WS-1 (philosophy) drafted; grilling
through the remaining workstreams with the user.

> **Historical naming note:** skill names below reflect what they were called when this
> was written. Since then: `create-spec` → `issue-spec`, `implement-issue` →
> `issue-implement`, `quick-fix` → `adhoc-quick-fix`, `create-issue-and-commit` →
> `adhoc-commit-as-new-issue`, and `dispatch-remote` / `plan-dispatch` (in the "Planning /
> Linear family" list) have been **removed**. Don't invoke the old names — this doc is a
> point-in-time design record, not current reference.

> This is the blueprint. It proposes the target system and the sequence to get
> there. Nothing below is built yet — the point is to agree the *shape* before
> churning the harness. Read §1 (the diagnosis) and §3 (the one-page target),
> then skim the workstreams.

---

## 1. The diagnosis — what's actually wrong

Our loop works: `issue → spec PR → implementation PR → multi-agent review`, with
a Cloud session babysitting each PR. But it costs too much and drifts. Concretely:

1. **No philosophy layer.** `grep -ri philosophy docs/` returns internal build
   plans only. We have 39 best practices (BP-001–039) and generic LLM-coding
   hygiene in `CLAUDE.md`, but nothing *above* the BPs that says how **we** think
   about software. So BPs are born ungrounded — they proliferate, get granular,
   and can't be pruned against a principle. And "the design feels off" at review
   has no name: there's no altitude at which to catch it before the code exists.

2. **Specs read like reference manuals.** `create-spec` already tries a human/
   agent split (BP-039, "solution in plain terms"), but the whole doc is one dense
   artifact. `FIX-895.md` is 857 lines and *opens* with a "v1 Reconciliation —
   AUTHORITATIVE" section that folds review rounds into legalese. Specs get
   **patched with addenda** instead of rewritten. The human — the decision-maker,
   the pattern/smell detector — has no clean surface tuned to their strengths.

3. **Implementation force-follows the spec.** The implementer treats the spec as
   truth. There is no standing "challenger" viewpoint to catch where the spec
   *misunderstood* something only visible from inside the code — so we either
   force-follow a flawed direction or silently deviate.

4. **Review has no philosophy altitude.** The three review agents (completeness,
   simplification, quality) all operate at the code level. None asks "does this
   design cohere with how we build?" — the exact question whose absence produces
   "directionally right spec, whole design feels off on implementation."

5. **No coherence audit of the codebase itself.** Cruft accumulates across PRs.
   `improve-codebase-architecture` and `second-look` are adjacent but neither
   hunts *incoherence* — patterns conflicting with each other or with our
   philosophy.

6. **Self-improvement is weak and unmeasured.** `distill-lessons` exists but is
   used inconsistently and produces low-quality output. Nothing measures the loop,
   so nothing knows whether it's improving. The review loop "extends to 10+ rounds"
   — that cost is invisible and therefore never attacked at its source.

7. **Grounding is noisy.** Out-of-date content, verbosity that eats context,
   detail that doesn't matter. Every noisy doc is a tax on every agent, every turn.

The through-line: **we optimize each artifact locally but have no shared, stated
sense of "good" to make them cohere — and no feedback signal to improve the loop.**

---

## 2. The core bet

Add one keystone — a **philosophy layer** — and re-point every stage of the loop
at it:

- Specs argue *from* the philosophy and are reviewed *against* it.
- Best practices become derived, prunable consequences of it (not free-floating).
- Review gains a philosophy altitude that catches "feels off" before code.
- The codebase is audited for *coherence* with it.
- Self-improvement measures the loop's dominant cost — **rework rounds** — and
  pushes fixes upstream into the philosophy / spec skill / BPs / grounding so
  recurring failure *classes* stop recurring.

The unit we optimize is **the recurring cause of rework**, not the individual
lesson. That is what keeps the system from bloating while getting more efficient.

---

## 3. The target system (one page)

```
GROUNDING (what "good" means — stable, deep, small)
  philosophy.md ..... our convictions about building software (the constitution)
    ↑ derives / disambiguates
  architecture/* .... locked contracts (unchanged role)
  best-practices .... derived, testable consequences of philosophy; each cites a tenet
  AGENTS.md / CLAUDE.md ... process protocol + always-loaded mirror

THE LOOP (each stage points at grounding)
  create-spec ....... Part I "The Case" (human)  +  Part II "The Build Plan" (agent)
                      argues from philosophy; decisions surfaced, not buried;
                      shows 1–5 usage examples; names 1–5 focus practices.
  implement-issue ... follows spec + a standing CHALLENGER sub-agent that catches
                      where the spec misunderstood something (escalates, not deviates)
  review ............ PHILOSOPHY SKEPTIC (altitude) + completeness + simplification + quality
  audit-coherence ... periodic codebase sweep for incoherence (code-level + philosophy-level)

SELF-IMPROVEMENT (the loop that improves the loop)
  cycle-ledger ...... near-free record per spec/impl PR: #rounds + feedback CLASS
  distill-lessons* .. reads ledger, finds recurring classes, pushes the SMALLEST
                      upstream fix that kills the class; gates hard against BP bloat.
                      Efficiency target: fewer review rounds + fewer "design feels off".
```

`*` = reframed, not new.

---

## 4. Workstreams

Each is independently shippable. Recommended order is the numbering.

### WS-1 — The philosophy layer (the keystone)

**Add** `docs/philosophy.md`: short and deep, a few pages of conviction, not a
rulebook. It states, for *this* project (an AI-workflow framework):

- What good software is here, and the handful of load-bearing tenets. Draft
  candidates, mined from existing BPs + architecture + `CLAUDE.md` (to be
  sharpened with you, not invented):
  - *Compose primitives; don't accrete features.* (the necessity gate, BP-029/038)
  - *The framework absorbs infrastructure, never vendor knowledge.* (Step 3.5)
  - *Minimal public surface — every export is a permanent contract.* (BP-038)
  - *Fix at the layer that owns it.* (BP-028)
  - *Coherence over local cleverness — a pattern that fits beats a better-in-isolation one.*
  - *Readability is an output, not a courtesy — for humans at review altitude.*
  - *Subtract before you add.*
- How we make the recurring tradeoffs (simplicity vs. flexibility; when an edge
  case is worth handling; when a problem doesn't need solving at all).
- The authority chain and how BPs descend from tenets.

**Change** the authority hierarchy to: **Philosophy → Architecture → Best
Practices → AGENTS.md.** Each BP gets a one-line `Serves:` pointer to the tenet
it derives from. BPs that serve no tenet are candidates for pruning or for
surfacing a missing tenet.

**Why:** creates the abstraction the whole revamp hangs on. Without it every
other workstream has nothing to point at.

*(Sourcing: I'll draft a strawman from repo evidence, then grill you on only the
load-bearing / contested tenets. The philosophy is yours; I'm a mirror, not an
author.)*

### WS-2 — Spec restructure: two halves, one contract

**Change** the spec document (and `create-spec`) into an explicit two-part shape
with a hard divider:

- **Part I — The Case (for the human).** Narrative, scannable, decision-oriented:
  - The problem — *and whether it deserves solving* (is it an edge case? a
    workaround exists? does it serve our priorities?). We already have a necessity
    gate; this pulls its verdict up into human-readable prose.
  - The solution in plain terms, and the *philosophy that arrived at it*.
  - Tradeoffs and the simpler alternatives weighed (and why not).
  - **1–5 focus practices** tuned to this problem, at human altitude, aligned to
    the philosophy — to set the reviewer's altitude. Not a re-list of global BPs.
  - **1–5 usage examples** — what *calling* the new API / using the feature looks
    like (usage, not implementation). Humans review far better against examples.
  - **Decisions & rules**, surfaced and scannable — so they aren't buried in Part
    II and force-followed blindly. High-level enough to sign off fast, specific
    enough to constrain. Some interpretation room is fine; the implementer is smart.
- **Part II — The Build Plan (for the agent).** 80% mapped, 20% left to in-the-
  weeds judgment. Files/functions changed/removed, sequencing, test seams, edge
  cases. Granular enough to direct, *not* so granular a reviewer nitpicks phrasing.

**Change** the anti-addenda rule: a spec that would need a "reconciliation /
AUTHORITATIVE" section on major review pivot gets **re-drafted**, not patched.
Coherence applies to the spec artifact itself.

**Interactivity:** one skill, an interactivity dial — default asks key decisions
up front then drafts a full spec you review; `--interactive` pauses at each
load-bearing decision for the hands-on user. (Reuses `grill-me` for the deep-dive
mode rather than a parallel skill.)

**Why:** gives the decision-maker a surface tuned to human strengths (pattern,
smell, direction, tradeoff) and keeps the agent-facing detail where it belongs.

### WS-3 — Implementation: the standing challenger

**Add** to `implement-issue` a persistent **challenger** sub-agent viewpoint.
Its job is *not* to re-litigate the reviewed spec — it's to catch where the spec
**didn't realize or misunderstood** something that only surfaces in the code.
Triggered when the implementer hits friction / "this feels off." It decides:
is this friction a signal the spec missed something? → **escalate to the human**
(or fold into the spec) rather than force-follow or silently deviate. Meta-
awareness becomes part of the implementation loop, not an afterthought.

**Why:** the spec does the hard 80%; the challenger owns the 20% where reality
contradicts the plan, without discarding the review the spec already passed.

### WS-4 — Review: add the Philosophy Skeptic

**Add** a fourth review agent, the apex of the panel:

- Views the solution only at a high level; ignores low-level detail.
- Verifies the solution fits the **project philosophy** and the spec's stated
  philosophy; verifies that stated philosophy actually makes sense *here*.
- Ensures the focus practices are properly defined and the solution fits them.
- Ensures the research verified the right philosophy-relevant things.
- Ensures coherence with philosophy **as documented and as embodied in existing
  code patterns**.

The other three (completeness, simplification, quality) stay, re-pointed to cite
tenets where relevant.

**Why:** this is the missing altitude — the one that catches "directionally-right
spec, whole design feels off" while it's still cheap.

### WS-5 — Codebase coherence audit (new skill)

**Add** `audit-coherence`: a periodic sweep of the codebase (not a single PR) that
hunts **incoherence**:
- Code-level: where patterns conflict with each other.
- Philosophy-level: where we've drifted from stated philosophy.
- Philosophy-gap: where we're incoherent *and there's no tenet to disambiguate* —
  which is a signal to sharpen the philosophy, not just the code.

Output feeds two places: pruning PRs (code) **and** WS-1/WS-6 (philosophy/BP
refinement). Distinct from `improve-codebase-architecture` (deepening) and
`second-look` (per-feature retrospective).

### WS-6 — Self-improvement: measure rework, fix upstream

The novel ask: a loop that improves the loop, that knows how to measure itself and
what the right *unit of improvement* is.

- **Unit of improvement = the recurring cause of rework.** Every review round and
  every rework is evidence something upstream failed to prevent a predictable
  problem.
- **Efficiency metric = review-loop cost:** rounds-to-approval per spec PR and per
  implementation PR, and frequency of "design felt off at review." This is the
  dominant real cost today (10+ rounds), so it's the honest thing to optimize.
- **cycle-ledger (near-free signal).** One tiny structured record per spec/impl PR:
  `#rounds`, feedback *classes* seen (design-off · missed-edge-case ·
  over-engineered · spec-ambiguity · philosophy-drift · docs-miss · nit), and a
  one-line "what would have prevented this." Auto-derive what we can from PR/Linear
  data; keep it to seconds of human effort. No vanity metrics.
- **distill-lessons, reframed.** Periodically (every N cycles / on demand), read
  the ledger, cluster recurring classes, and propose the **smallest upstream
  change that kills the class** — a sharpened tenet, a sharpened *existing* BP, a
  spec-skill checklist line, a grounding fix. Adding a new BP is the last resort.
  Gates hard against BP bloat (your stated complaint). Success = the class stops
  appearing in later ledgers.

**Why:** turns "capture every lesson" (which bloats) into "eliminate recurring
rework classes at their source" (which compounds). The right granularity is the
*class of failure*, not the incident.

*(This section will be sharpened with lessons from the referenced harness-
engineering repo — research in flight; I'll fold in its measurement/pruning
discipline here.)*

### WS-7 — Grounding hygiene / pruning

**Add** a lightweight discipline + periodic pass to keep grounding lean: out-of-
date content removed, verbosity cut, unimportant detail dropped. Context bloat is
a measurable cost (token budget, agent confusion) and folds into WS-6's metric.
The `CLAUDE.md` always-loaded surface gets the strictest budget.

---

## 5. Sequencing & delivery

Recommended: **one focused PR per workstream, philosophy first**, because every
later stage references it. WS-1 → WS-2 → (WS-3, WS-4 can parallel) → WS-5 → WS-6 →
WS-7. WS-6's ledger can start collecting the moment WS-2/WS-4 land, so the self-
improvement loop has data by the time we build it.

This design doc is itself the dogfood case: it should read at the altitude WS-2
prescribes.

## 6. Decisions (resolved)

- **Delivery:** one PR (docs-only revamp).
- **Philosophy sourcing:** strawman-then-grill; the user stays involved (grill) through
  *every* workstream, not just philosophy.
- **Spec modes:** one `create-spec` with an interactivity dial (default = key decisions
  up front, then draft; `--interactive` = pause at each load-bearing decision).
- **Chief enemy → apex tenet:** incoherence, with bloat the close second; the philosophy
  frames them as one enemy on two timescales.
- **Framework/app boundary:** balanced — absorb what most apps need, opinionated
  defaults OK, escape hatch for the long tail.
- **Tenet collisions:** surface the tradeoff to a human; never average or pick silently.
- **Composition** is its own tenet; a **doc/code disagreement** is surfaced as a
  coherence gap, not auto-ranked.
- **Grounding is three tiers:** Philosophy → Principles (the tenets) → Best Practices.
  Principles are the lasting layer; BPs stay *few*. Situational guidance is worked out
  **per spec** (the 1–5 focus practices), not from a large global registry. This
  makes WS-7 include a **BP tone-down** — prune the granular global BPs to a lean
  universal core, keep the rest as a short established set specs reason from.
- **Necessity gate → refinement lens:** not strict-vs-lenient. Friction between a
  request and the framework is a signal to *refine the substrate* (subtract+add /
  realign a primitive), compose, escape-hatch a rare edge, or not build. Bias:
  refine, don't accrete.

Drafted: `docs/philosophy.md` (WS-1) — 7 tenets, coherence-apex, three-tier grounding.
`docs/contributing/spec-template.md` (WS-2) — the two-part Case/Build-Plan contract;
`create-spec` wired to it (refinement-lens Step 3.5, interactivity dial, anti-addenda,
structure now lives in the template — skill shrank).
WS-3: `implement-issue` challenger sub-agent (`challenger-prompt.md`) — LLM-judged
high-risk boundaries, best-judgment+loud-flag when AFK.
WS-4: Philosophy Skeptic (`philosophy-skeptic-prompt.md`) as the apex reviewer in
the Step 6 panel (now four reviewers).

Review notes folded in: spec-review feedback splits directional (fold in) vs
in-the-weeds (leave as implementer notes); the throwaway spec PR hosts full examples;
philosophy scopes framework-vs-labs; "align as you go" made explicit given current
known bloat/incoherence.
WS-5: new `audit-coherence` skill (standalone; three kinds — code-conflict /
philosophy-drift / philosophy-gap).
WS-6: `distill-lessons` reframed into the self-improvement engine — auto-derived
cycle-ledger (rounds + feedback classes from GitHub/Linear), metric = rounds &
design-off trending down, unit = recurring class, smallest-upstream-fix preference.
WS-7: BP tone-down (universal tier) applied — folded BP-001/028/029/038 into
tenets 1/5/2/3 (marked Superseded, kept for history), trimmed the always-loaded
`CLAUDE.md` mirror to the operational core (BP-003/007/022/030/031/034/035). Situational
category BPs retained as the per-spec reference set. BP-030/034 flagged as demote
candidates for a later situational-tier pass.
WS-7 grounding wiring: philosophy wired into the always-loaded surfaces — `CLAUDE.md`
orientation + authority hierarchy, `AGENTS.md` startup reads + authority order, skills
table. **Remaining WS-7: the BP tone-down** (prune the 39 granular BPs to a lean
universal core + established set), which needs user judgment per-BP.

## 7. Verification (how we'll know it worked)

- WS-1–5, WS-7 are docs/skills — verified by review + dogfooding the next real
  issue through the revamped loop and checking the artifacts read as intended.
- WS-6 is verified by the ledger itself: rounds-to-approval and "design-off"
  frequency trend **down** over successive cycles. That trend *is* the proof the
  harness is self-improving.

## 8. Skill-library composition & overlap map

Applying tenet 2 (composition) to the harness's own skills — sub-agents, sub-skills,
skill forks.

### Done — review consolidation

The review lenses were defined twice (implement-issue's inline panel + the standalone
audit skills). Now there is **one** definition:

- **`review`** (new) is the single composition point. It runs the lenses as
  parallel sub-agents over a change (PR / branch / diff) or a codebase slice, dedupes,
  and synthesizes one ranked report. Lenses: **Coherence** (`audit-coherence`),
  **Restraint** (`second-look`), **Correctness** (code-reviewer + BP-035),
  **Completeness** (spec match + red + goal, when a spec is in scope), and optional
  **Depth** (`improve-codebase-architecture`, non-blocking).
- **`implement-issue` Step 6** now *invokes `review`* instead of an inline
  four-agent panel. Retired: `philosophy-skeptic-prompt.md` (→ coherence lens) and
  `simplification-reviewer-prompt.md` (→ restraint lens).
- **`second-look`** refined to cede redundancy / pattern-conflict / drift to
  `audit-coherence`; it stays the restraint lens (does this change's surface earn its
  keep?). `audit-coherence` gained a change/PR scope so it works as the coherence lens
  on a diff, not just codebase slices.

### Mapped, not built (per user: "just map, don't build")

- **Planning / Linear family** — `plan-day`, `plan-dispatch`, `dispatch-remote`,
  `linear-triage` overlap on "what to work on / route issues." *Recommendation:* one
  `plan` orchestrator that composes triage → prioritize → dispatch as sub-steps, with
  the current skills becoming its stages; keep standalone entry points. Not built.
- **Ship-small family** — `quick-fix`, `create-issue-and-commit`, `implement-issue`
  share issue→branch→commit→PR plumbing. *Recommendation:* extract the shared
  issue/PR plumbing into one referenced sub-routine the three call, rather than three
  copies; keep the three as distinct entry points (they differ in when the issue is
  created and how much review runs). Not built.
- **Prompt/lens assets** — `spec-reviewer-prompt.md` is now referenced by both
  `implement-issue` (5B.3 per-task) and `review` (completeness lens); if a third
  consumer appears, promote it to a shared location. Watch, don't move yet.
