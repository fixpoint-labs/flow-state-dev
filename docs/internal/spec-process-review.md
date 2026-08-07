# Spec process review — OpenSpec comparison and where our loop actually leaks

**Date:** 2026-08-07 · **Status:** proposal, not adopted · **Scope:** the spec artifact, its
storage, and the approval gate

Three questions were asked: adopt OpenSpec or keep ours; keep specs in the repo or move them
to Linear; split the spec into multiple documents. This reviews all three against evidence
rather than intuition. Six parallel lenses were run — OpenSpec mechanism, as-is cartography,
empirical PR/Linear data, storage architecture, document design, and a red team.

The short version: **keep the process, borrow three ideas, and fix one thing that is costing
real money.** Two of the three premises behind the questions turned out to be backwards.

---

## 1. The finding that matters most: the gate is staffed by bots

On the spec PRs sampled reviewer-by-reviewer, every review was `cursor[bot]` or
`chatgpt-codex-connector[bot]`. No human review content.

FIX-925 is what that costs:

| Date | Event |
|---|---|
| Jul 24 | Cancelled at the spec gate — *"modeling an agent-as-a-tool reads as odd"* |
| Aug 6 | Built anyway, 13 days later, to the cancelled spec — `44764a9`, **+1,311 / −96** |
| Aug 6 | Cursor approves: *"a clean implementation of the right design"* |
| Aug 6 | One human sentence on the **implementation** PR: *"We already support tools, why not just have agents be agent workers and tools be tool workers"* |
| Aug 6 | `58863c2` — **+800 / −1,313**. The design is deleted |

Both diffstats verified against the repo. Four rounds of automated spec review affirmed a
design that one human sentence dissolved.

The causal chain is the point:

```
Part I runs 240–311 lines
  → the approver does not read it at the gate
    → the gate is de facto bot-only
      → bots check a design against itself, not against direction
        → the wrong direction survives the gate
          → the human catches it at the implementation PR, where correction costs ~10x
```

Every *measured* cost of the spec PR is small: median lifetime 1h 19m, spec-close →
impl-open handoff ~35 minutes. The expensive event was 1,311 lines built and deleted. So
shortening Part I is not an ergonomics nicety — it is the fix for the most expensive failure
class we have measured.

**A separate hole, worth fixing regardless:** FIX-925 was *cancelled* on Jul 24 and
implemented on Aug 6. Nothing in the pipeline noticed. That is independent of anything else
here.

---

## 2. Three premises that are backwards

| Premise | Verdict | Evidence |
|---|---|---|
| "Specs grow large" | **Refuted as a trend** | Median spec length fell **48%** May→Jul (546 → 284 lines, n=250 Linear docs). Part I by date: 241 (Jul 30) → 311 (Aug 3) → **93** (Aug 6) |
| "Specs get out of date" | **Refuted for the repo, confirmed for Linear** | Zero of 8 repo specs were content-edited after their implementation merged. But 5 of 8 Linear mirrors diverge — FIX-911 at 6.7% similarity, FIX-895 at 11%, FIX-954 has **no Linear document at all** |
| "The two-PR process is cumbersome" | **Refuted on latency, confirmed on inventory** | **0 of 39** spec PRs have ever merged — there is one merge, not two. But 13 spec PRs are open, 7 of them ≥8 days, carrying **6,614 lines** of written-but-unimplemented design — 1.6× everything that has ever reached `main` |

The process does not run slow. It **overproduces**, and the excess lands nowhere.

Note the direction of the staleness finding: the copy being considered as the new home is the
copy that is demonstrably broken.

---

## 3. OpenSpec: borrow, do not adopt

Read at `e50bd09` (v1.8.0): 41,575 LOC source, 57,124 LOC tests, 129 test files.

**Why not adopt.** It is one year old with two maintainers, and has already churned its entire
workflow once — shipping a 950-line `legacy-cleanup.ts` that deletes files from your repo and
strips markers out of `AGENTS.md`/`CLAUDE.md`. It has **no** issue-tracker, git, or PR
integration by design (`docs/team-workflow.md`: *"OpenSpec doesn't touch git… Everything below
is convention, not enforcement"*). Its approval gate is one paragraph of prose asking the model
to stop. Ours is a PR with automated review, a two-round convergence rule, and a twelve-round
cap. And its flagship deterministic merge engine is **routed around in its own default path** —
`openspec-sync-specs` has an LLM do the merge instead, so two shipping code paths disagree about
what a `MODIFIED` block means.

Adopting means abandoning Linear as the hub, the multi-agent review lenses, epic parallelism
with worktrees, and the round budgets — and rewriting ~7,500 lines of skill prose. Running both
conventions side by side is worse: tenet 1 names averaging two patterns as the worst outcome for
coherence, and incoherence is our primary ranked failure.

**Worth stealing, ranked.**

1. **Delta-against-a-capability.** The real insight, and it names our structural flaw:
   `docs/specs/<ISSUE-ID>.md` is *issue-shaped*, so it is per-change forever. After 300 issues
   we have 300 orphaned documents and still no statement of what the system does. An
   issue-shaped document can only decay; a capability-shaped one gets amended and stays true.
2. **The scenario-loss guard** (`validator.ts:536-620`) — ~40 lines that refuse a rewritten
   requirement block which silently drops half its scenarios. Highest value per line in the
   project.
3. **A structural spec linter in CI.** Their `--strict` (warnings become failures) is a good
   two-tier design. Converts review rounds into a red check.
4. **An archive convention.** `docs/specs/` grows unboundedly with no archive.

What OpenSpec does *not* solve, despite the marketing: staleness. Nothing in it compares
`openspec/specs/` to code. The guarantee is purely *"if every change goes through the workflow,
the spec stays true."* That is discipline, not mechanism.

---

## 4. Storage: the review surface and the durable record are orthogonal

This is the unlock, and it dissolves the repo-vs-Linear question.

**The spec-PR review gate requires the spec to be on a branch with an open PR. It has never
required the spec to be on `main`.** Landing a spec on `main` adds exactly zero review value —
the review already happened on `spec/<ISSUE-ID>`.

So we can keep the gate at full strength *and* put zero specs on `main`.

**Linear is already the hub**: 357 issue-attached spec documents vs **8** in the repo. The repo
holds ~2%. But Linear cannot host the gate — measured, not assumed:

| Linear capability | Reality |
|---|---|
| Document CRUD, issue attachment, size | Fine — no practical limit |
| Version history | `documentContentHistory` exists but returned **0 entries** for a real spec |
| Comments | `Document.comments` exists — **0 comments across 60 sampled documents** |
| Diff / blame / approval / bot review | None |
| Markdown round-trip | **Lossy** — bullets re-render, bold markers corrupt across line wraps |

That last row is decisive: a sync rule over a lossy transport cannot be mechanized. BP-037's
"never let them drift" is prose addressed to an agent, and it has a 5-in-8 failure rate.

**BP-037 is currently cited as authority for the practice it prohibits.** It says merging
"would accumulate point-in-time spec docs on main that go stale." Yet 7 specs sit on `main`, put
there by commits like `b705a49`, whose body reads: *"The spec PR closes unmerged by convention
when implementation starts, **so the versioned doc lands here (BP-037)**."* The mechanism was
obeyed while the purpose was defeated, citing the rule as justification. An agent-facing rule
that reliably produces its own inverse is worse than no rule.

**Why it happens is legitimate:** after the spec PR closes and its branch is deleted, the only
copy is Linear — and Linear is not trustworthy. The durable half of a spec has no home, so
agents invent one.

Evidence that code is reaching for that missing home:

```
packages/node/src/bind-guard.ts:15        → "see the known limits in docs/specs/FIX-893.md §3"
packages/node/src/bind-guard.ts:65        → "see docs/specs/FIX-893.md §8"
labs/trading-desk/.../alpha-vantage.ts:19 → "See docs/specs/FIX-798.md"
```

Neither file was ever committed to this repo. `bind-guard.ts` is citing the known limits of a
security rail — a textbook durable design decision that belongs in
`docs/architecture/authentication.md`, which already exists.

**The promotion path is broken.** Verified: of 8 specs, exactly **1** (FIX-995) had an
implementation that touched `docs/architecture/`. A 12.5% fire rate.

### Where each layer belongs

| Layer | Content | Durability | Home |
|---|---|---|---|
| Intent — what & why | Problem, why now | Durable, already duplicated | **Linear issue** (it is already there) |
| Design decisions — how, and why not otherwise | Tradeoffs, rejected alternatives, numbered Decisions | **Enduring** | **`docs/architecture/*`, promoted at merge** |
| Implementation plan | Design sketch, sequence, edge cases, tests, docs plan | **Spent on merge** | Spec PR (dies) + Linear archive. Never `main` |

~58% of spec bytes are the disposable half. Path-level staleness is currently mild (56 file
paths cited across 8 specs, 3 dead — 5%), which supports the read that these documents are
*historical records*, not *wrong documents*. What they harm is agents grepping `main` for
current truth, not humans browsing Linear.

**Deleting a spec from `main` does not delete it from history.** `git show <sha>:docs/specs/…`
works forever. "Keep them for historical purposes" does not justify keeping them on `main`.

---

## 5. Documents: two, not four — and it is already two

`docs/contributing/spec-template.md` (landed Jul 23) already defines the split: **Part I "The
Case"** for the human, **Part II "The Build Plan"** for the implementing agent. So the proposed
PRD/proposal/design split is a re-cut of a line already drawn.

**A PRD would be a third copy of the problem statement.** `issue-spec` Step 7 already reshapes
the Linear issue into exactly a PRD — problem, who benefits, success criteria, no file paths.
Tenet 5: a decision restated in three places is corrected in none.

**BP-039 is being followed and it is not enough.** FIX-995's §1 is genuinely excellent plain
language. But BP-039 governs *voice*, not *position or scope*:

| Spec | Plain-language problem statement starts at line… | of |
|---|---|---|
| FIX-995 | 64 | 769 |
| FIX-990 | 47 | 638 |
| FIX-895 | 74 | 857 |

A good paragraph 64 lines down, followed by 700 more, still requires navigation.

**The four executive questions are not fields anywhere:**

| Question | Today | Coverage |
|---|---|---|
| What risks? | Incidental prose, buried in edge-case tables | Never structured |
| What complexity are we adding? | Nowhere — you count the Files table yourself | 0 of 8 |
| Aligned with philosophy? | A `**Philosophy**` line in §2 | 4 of 8 |
| Reversibility / one-way door | Zero occurrences of `reversib`/`one-way`/`irreversible` | **0 of 8** |

FIX-895 is the case in point. It requires a one-time destructive wipe of the desk's
`ledger_events`, `holdings` and `realized_gains` tables — unrecoverable for anything
hand-entered. It *is* mentioned (line 58 in the reconciliation block, line 157 in prose, line
369 in a files table) and the owner did approve it. But it is never surfaced as a structured
*this is irreversible* field. The gap is narrower than "nobody was told" — it is that
irreversibility is a prose detail rather than a field the approver's eye lands on first.

**Where Part I's length goes** (§6 is the offender):

| Section | FIX-995 | FIX-990 | FIX-925 |
|---|---|---|---|
| §1 Problem | 26 | 35 | 6 |
| §2 Solution in plain terms | 22 | 35 | 13 |
| §3 Tradeoffs | 34 | 33 | 6 |
| §4 Focus practices | 16 | 20 | 7 |
| §5 Usage examples | 48 | 50 | 40 |
| **§6 Decisions** | **162** | **65** | **18** |
| **Part I total** | **311** | **241** | **93** |

The executive core — §1+§2 — is already only 22–70 lines. It exists, it is good, and it is
structurally indistinguishable from the 263 lines around it.

**Template conformance is drifting, and a linter would catch all of it.** 3 specs carry the
Part I/II divider; FIX-951 has the numbered sections without it; 4 predate the template
entirely. FIX-895 opens with `## 0. v1 Reconciliation (post-review — AUTHORITATIVE)` — the
exact addendum pattern `spec-template.md:22` bans by name.

---

## 6. Recommendation

Four changes. Three are removals or enforcement of rules we already have.

### 6.1 Add an At-a-glance block at the top of every spec — *ship this first*

Above everything, including the reviewer contract and Spec evolution. Five fields plus two
tables, answering all four executive questions in the first ~40 lines:

| Field | Rule |
|---|---|
| **Doing** | 1–2 sentences, plain language. If a reader stops here, this is what they know |
| **Not doing** | What a reader will assume is included and isn't. The only home for non-goals |
| **Size** | S/M/L · N files · ~N LOC · N PRs · which packages |
| **Reversibility** | **Two-way door** + how we back it out, or **ONE-WAY DOOR** + the specific thing that cannot be undone. Never blank |
| **Philosophy** | Leans on tenet N (how); in tension with tenet N (why justified), or "none". Never blank |
| **Complexity delta** *(table)* | Public exports · config knobs · new concepts · persisted schema · files — **Added and Removed columns**, since tenet 3 says subtract as you go. All-zeros is a good answer; blank is not |
| **Risks** *(table, ≤3)* | Risk · likelihood · blast radius (and whether it fails *silently*) · mitigation, or "accepted — not mitigated" |

These are forcing functions, not prose slots: a spec claiming "0 new concepts" that ships three
becomes a falsifiable claim rather than a judgment call.

### 6.2 Hard-cap Part I at ~120 lines

Demote §6's per-decision detail and §4 (Focus practices — BP references aimed at the
implementer) into Part II. FIX-925 already proved 93 lines works. A cap makes regression
detectable rather than gradual.

### 6.3 Stop landing specs on `main`; make promotion real

- Correct BP-037 so it is no longer cited as authority for the practice it forbids.
- Promote the durable half — §3 rejected alternatives and §6 Decisions — into the relevant
  `docs/architecture/*` doc at implementation merge. Add a "Rejected alternatives" slot there
  rather than standing up a parallel ADR corpus.
- Make §11 of the template answer *"which architecture doc does this change, or why none"*, and
  have the `review` completeness lens check it.
- **Rescue FIX-954 first** — 41KB, repo-only, no Linear document. The only genuine data-loss
  risk on the board.
- Fix the two dangling code citations.
- Then delete the 8 spec files from `main`; keep `README.md`, rewritten to say where specs live
  and how to find a historical one.

**Stated plainly: this step is the risky one.** It depends on a promotion that fires 12.5%
today. If promotion does not become reliable, the durable decision exists only in Linear and the
repo loses it — strictly worse than today. Either enforce it in the completeness lens, or do not
do this part.

### 6.4 Add `scripts/validate-specs.mjs`

Fits the existing `scripts/validate-*.mjs` convention. Enforce: Part I line cap; At-a-glance
fields present and non-empty; required section order; no `AUTHORITATIVE` addenda; no dangling
`docs/specs/*` citations from source. Adopt OpenSpec's two-tier `--strict` semantics.

This is the answer to the CLI envy — and to the cycle-ledger's own conclusion that the dominant
failure class is *attention at edit time*, not knowledge of the rule. A linter fixes attention
problems; more prose does not.

### Deferred

**The file split** (`<ID>.md` + `<ID>.build.md`). It buys one real mechanism: approval survives
build-plan-only rounds, checkable with `git diff --name-only <approved-sha>..HEAD --
docs/specs/<ID>.md`, which kills most re-reads across convergence rounds. But it touches ~7
process files. Ship the block and the cap first; see whether 120 is the right number.

### Rejected

- **Adopting OpenSpec** — generic framework, bespoke flow, five load-bearing capabilities absent.
- **A PRD document** — the Linear issue already is one.
- **Four documents** — violates tenets 3, 5 and 6; altitude comes from ordering, not dispersal.
- **Linear-only specs** — kills the gate, and Linear is the copy that is already broken.

---

## 7. The honest counter-argument

The red team's strongest point, which shapes everything above: **only three specs exist under
the current convention**, spanning 15 days, and the trend is already correcting on its own
(241 → 311 → **93**). FIX-925 got to 93 lines by dropping the 45-line reviewer-contract block
that FIX-995 wrongly duplicated inline — a correction the loop found without anyone adding a
document.

Overhauling now destroys the control group: we would not be able to tell whether an improvement
came from the change or from the correction already in flight.

That is why the recommendation is small, mostly removals, and defers the file split. It is also
why the linter matters more than the templates — `docs/internal/cycle-ledger.md` already
concluded, after a twelve-round attempt to fix one class *committed that same class inside the
fix*, that written guidance may not close it at all:

> Written guidance cannot close this class at all, because the failure is one of *attention at
> edit time*, not of knowing the rule.

Both baselines in that ledger have already been invalidated by definition changes. Treat any
rounds trend there — and any claimed improvement from this proposal — with the same suspicion.

---

## Appendix: what was verified directly

Diffstats for `44764a9` / `58863c2`; `docs/architecture/` touches per spec (1 of 8); spec file
creation dates and template landing date; Part I/§6 line counts; absence of `FIX-893.md` /
`FIX-798.md` from all branches; template conformance per spec; absence of any spec validation
tooling; FIX-895's wipe positions.

Not independently re-verified (single-agent findings): the 39/0 spec-PR merge counts, Linear
corpus sizes and similarity percentages, reviewer identity at scale (2-PR sample), and the
May→July median-length trend.
