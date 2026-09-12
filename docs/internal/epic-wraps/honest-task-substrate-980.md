# Epic wrap detail — honest task substrate (FIX-980)

Per-instance evidence behind [cycle 8 of the cycle ledger](../cycle-ledger.md#cycle-8--honest-task-substrate-epic-wrap-fix-980-2026-09-10).
The ledger carries the counts and the conclusion; the enumeration, the round
reconstruction and the reproduced instrument failure live here so the instrument
stays scannable.

Epic [#983](https://github.com/fixpoint-labs/flow-state-dev/pull/983) (opened 2026-07-29,
closed unmerged 2026-08-16 while the epic was dormant, reopened 2026-08-24, closed at the
wrap 2026-09-10). Two tracks, 28 PRs, plus the `settle-claim` POC
[#1001](https://github.com/fixpoint-labs/flow-state-dev/pull/1001) (merged).

**Still open at the wrap:** [#1677](https://github.com/fixpoint-labs/flow-state-dev/pull/1677)
(FIX-1032, the fix for the lying instrument) and the two never-approved specs
[#992](https://github.com/fixpoint-labs/flow-state-dev/pull/992) /
[#994](https://github.com/fixpoint-labs/flow-state-dev/pull/994). Their rows in the ledger are
partials and must not be frozen as endpoints.

---

## The round reconstruction — why the ledger reports rounds *and* folds

The ledger's Method block fences `folds` as a new measurement and forbids setting a fold count
against an earlier cycle's rounds. BP-040's budget is stated in **rounds**, so the budget
comparison needed a rounds figure, reconstructed here rather than inferred from folds.

**Definition used:** a **spent round** is a maximal group of consecutive automated review passes
with no non-merge commit between them, followed by at least one non-merge commit. This is
cycle 7's *spent review wave* — the ledger's existing unit, not a fifth definition — and it is
the unit BP-040's "converge in two rounds" describes: a review, then a response.

Computed from `GET /pulls/N/reviews` (`cursor[bot]` + `chatgpt-codex-connector[bot]`) interleaved
with `GET /pulls/N/commits` (non-merge only) by timestamp.

| PR | Bot passes | Spent rounds | Folds | Gap (folds − rounds) |
|---|---|---|---|---|
| [#1419](https://github.com/fixpoint-labs/flow-state-dev/pull/1419) FIX-1234 spec | 12 | **8** | 8 | 0 |
| [#1461](https://github.com/fixpoint-labs/flow-state-dev/pull/1461) FIX-1244 spec | 29 | **24** | 30 | 6 |
| [#1673](https://github.com/fixpoint-labs/flow-state-dev/pull/1673) FIX-1238 spec | 2 | **1** | 2 | 1 |
| [#941](https://github.com/fixpoint-labs/flow-state-dev/pull/941) FIX-951 spec | 7 | **5** | 5 | 0 |
| [#995](https://github.com/fixpoint-labs/flow-state-dev/pull/995) FIX-976 spec | 4 | **2** | 2 | 0 |
| [#1005](https://github.com/fixpoint-labs/flow-state-dev/pull/1005) FIX-989 spec | 5 | **5** | 5 | 0 |
| [#1010](https://github.com/fixpoint-labs/flow-state-dev/pull/1010) FIX-992 spec | 9 | **8** | 9 | 1 |
| [#1011](https://github.com/fixpoint-labs/flow-state-dev/pull/1011) FIX-948 spec | 6 | **6** | 6 | 0 |
| [#1022](https://github.com/fixpoint-labs/flow-state-dev/pull/1022) FIX-995 spec | 5 | **3** | 3 | 0 |
| [#1048](https://github.com/fixpoint-labs/flow-state-dev/pull/1048) FIX-1001 spec | 10 | **8** | 8 | 0 |
| [#990](https://github.com/fixpoint-labs/flow-state-dev/pull/990) FIX-978 spec | 17 | **16** | 16 | 0 |
| [#992](https://github.com/fixpoint-labs/flow-state-dev/pull/992) FIX-963 spec | 6 | **4** | 6 | 2 |
| [#994](https://github.com/fixpoint-labs/flow-state-dev/pull/994) FIX-964 spec | 5 | **3** | 8 | 5 |
| [#983](https://github.com/fixpoint-labs/flow-state-dev/pull/983) epic-spec | 12 | **7** | 8 | 1 |

And the implementation rows, measured the same way:

| PR | Bot passes | Spent rounds | Folds |
|---|---|---|---|
| [#1422](https://github.com/fixpoint-labs/flow-state-dev/pull/1422) FIX-1234 | 11 | **9** | 13 |
| [#1571](https://github.com/fixpoint-labs/flow-state-dev/pull/1571) FIX-1244 | 3 | **2** | 2 |
| [#1513](https://github.com/fixpoint-labs/flow-state-dev/pull/1513) FIX-1245 | 3 | **1** | 3 |
| [#1675](https://github.com/fixpoint-labs/flow-state-dev/pull/1675) FIX-1238 | 2 | **1** | 1 |
| [#1677](https://github.com/fixpoint-labs/flow-state-dev/pull/1677) FIX-1032 | 1 | **1** | 1 |
| [#953](https://github.com/fixpoint-labs/flow-state-dev/pull/953) FIX-951 | 3 | **3** | 3 |
| [#1004](https://github.com/fixpoint-labs/flow-state-dev/pull/1004) FIX-976 | 1 | **1** | 1 |
| [#1128](https://github.com/fixpoint-labs/flow-state-dev/pull/1128) FIX-989 | 7 | **6** | 8 |
| [#1035](https://github.com/fixpoint-labs/flow-state-dev/pull/1035) FIX-992a | 8 | **6** | 9 |
| [#1036](https://github.com/fixpoint-labs/flow-state-dev/pull/1036) FIX-992c | 8 | **6** | 6 |
| [#1039](https://github.com/fixpoint-labs/flow-state-dev/pull/1039) FIX-992b | 8 | **3** | 3 |
| [#1031](https://github.com/fixpoint-labs/flow-state-dev/pull/1031) FIX-948 | 2 | **2** | 2 |
| [#1023](https://github.com/fixpoint-labs/flow-state-dev/pull/1023) FIX-995 | 4 | **3** | 3 |
| [#1292](https://github.com/fixpoint-labs/flow-state-dev/pull/1292) FIX-1001 | 4 | **2** | 5 |

**Folds ≥ rounds on every row**, which is the mechanism that makes the two units
non-interchangeable: a batch of correction-only commits answering one review costs one round and
several folds. Among the spec rows the gap is zero on nine of thirteen and concentrated in four —
#994 (8 folds, 3 rounds), #1461 (30 / 24), #992 (6 / 4), #1010 (9 / 8).

**The pass column reproduces exactly.** All 28 `Passes` figures in the ledger's cycle-8 tables
match a fresh count of `cursor[bot]` + `chatgpt-codex-connector[bot]` review submissions, and all
fold counts match except #1513, which an earlier draft counted from a wider reviewer set than its
own pass figure used (5 rather than 3). The defect was the *comparison* of folds to a rounds
budget, not the fold measurement.

**What survives the correction.** On rounds, the overrun is not smaller — it is marginally
larger. Eleven of thirteen spec PRs exceeded two spent rounds; only #995 (2) and #1673 (1) held.
Sorted rounds: 1, 2, 3, 3, 4, 5, 5, 6, 8, 8, 8, 16, **24**.

**The BP-040 carriage split, on rounds.** The three spec PRs carrying BP-040 from their first
commit spent **8, 24 and 1** rounds against a pre-BP-040 median of **5** (the other ten: 2, 3, 3,
4, 5, 5, 6, 8, 8, 16). Two of the three overran, one of them by the widest margin in the ledger.

**Author round numbers are not instrumented.** #1461's author wrote "round 25"; the reconstructed
figure is **24 spent rounds**, against 29 bot passes and 73 total review submissions of all kinds.
Four numbers for one PR, none of them wrong for its own definition. Never quote an author's round
number as a measurement.

---

## The fold loop on #1461 — the narrative

The mechanism is in the data rather than inferred: **29 automated passes across 30 folds**, a 1:1
ratio. Every push drew a fresh review, the review found something, the finding drew another push.

The author named it at fold 5:

> Five rounds folded (budget is two; rounds 3–5 were spent deliberately on evidence-driven
> findings). **I'm stopping now**, because the latest round flags the fix from the previous round —
> each fix is drawing a reshaped finding rather than converging. Per the convergence rule, that's
> the point to raise what's still open instead of pushing again.

Twenty-five folds followed. The diagnosis was correct, the rule was quoted, and neither stopped it.

**What each fold was spending itself on is the link to the honesty class.** The author's own
account of the worst fold: a §12 line promising a rename was added, then a wholesale revert left
§7–§11 asserting the opposite, *"and an implementer following those would skip the rename. My
defect, and **the same one-site-left-standing class as six earlier rounds**."*

A direction document states one decision in many sections. Folding it into the section that owns
it leaves the siblings asserting the old answer; the reviewer finds that on the next push; the fix
creates the next one. **That is not review converging on a document — it is a document and a
reviewer taking turns.**

**The tell that the loop was not tracking value.** The two findings that actually changed the
design came from **outside** the loop. The owner, in two sentences, asked why two verbs existed
and whether the wall of text was necessary — the restraint question 20 automated passes had not
asked:

> resumeFromReview and unparkAndDrain. Why do we need both? … Is the wall of text in the spec
> really necessary?

And when a genuinely direction-level P1 did land at ~round 22 (post-commit failure recovery inside
the composed step — *"the most substantive thing this review has surfaced"*), the implementation
that followed it took **3 passes and 2 folds**.

---

## The honesty defects — per-instance detail

Counts and the register are in the ledger. This is the evidence behind each row.

### The `agent-mailbox#7` wrap post, criterion by criterion

The epic's retirement post on `agent-mailbox#7` (open, updated 2026-09-10T01:12Z) published
*"The objective's first clause is met."* Verified against the epic-spec on `0cc231c25` and live
Linear: it is not.

The spec's §1 "What 'done' looks like" lists **seven** criteria.

- **Criterion 2 — NOT MET.** *"A drain's result distinguishes 'the work completed' from 'the work
  completed and then the recorder fell over' — at a surface that is persisted and branchable."*
  This is FIX-963 verbatim, and FIX-963 is **Backlog**, spec PR
  [#992](https://github.com/fixpoint-labs/flow-state-dev/pull/992) still open, never built. The
  criterion is not adjacent to the objective's first clause (*"every write path either did what it
  reported, or reported that it didn't"*) — **it is that clause.**
- **Criterion 3 — partial at best**, by the epic-spec's own §3.5 row, after FIX-964's descope.
- The remaining five are met.

**Two of seven NOT MET.** The same post said the three surviving issues *"stand alone now"*:
FIX-963, FIX-993 and FIX-1250 all still return `parent: FIX-980`; only FIX-964 is unparented, and
it is *On Hold*, not Backlog. Corrected on the handle with an explicit `kind: correction` comment
rather than a silent edit.

**Why this instance changes the reading.** Every input to the false sentence was verified — the
author checked each issue's Linear state and never re-derived the sentence about what those states
added up to. So the class is not "update the other artifacts after a fold." It is: **a summarizing
artifact inherits the verification burden of a claim, and verifying its inputs is not verifying
it.**

### The other four summary instances

| Instance | The claim | Detail |
|---|---|---|
| #1675's PR description | the wiring-comment overclaim, left standing after `5b99b1550` fixed it in code | **Author self-report; not verifiable from the review record.** GitHub's body-edit history is not reachable from this session and no comment on the PR documents the sweep. Excluded from every count; carried as testimony |
| #983's epic-spec status block (2026-08-24) | *"the doc was describing a codebase that no longer exists… the doc stopped tracking `main` on 2026-07-30"* | Three rows wrong at once — FIX-976 and FIX-948 recorded open when both had shipped; FIX-978/963/964 recorded In Review when all three were Backlog. Found only when someone re-derived the block against live Linear |
| #1461's PR description | *"The PR description says 'six rounds.' Two more landed after it."* | The record does not name who found it |
| #1461's review reply | a summary asserting the owner had settled a decision, with nothing citeable | *"An unciteable settlement is indistinguishable from an invented one"* — the `fsd-architect` seat challenging it |

### The honesty class at every altitude

- **Epic altitude (#983):** counts drifting across four surfaces; §1 and §3 contradicting each
  other; *"Stop claiming Decision 1 resolves S3"*; a load-bearing cost figure wrong by ~4× (the
  blast radius said "6 sites in 3 files" and measured one of four widened methods — the real figure
  is ~22 sites / 4 files to compile, ~30 / 10 to be complete); and the whole document still
  describing a `main` that five merges had moved past.
- **Spec altitude (#1673):** the spec's central guarantee — that the test-blind conditional break
  *"becomes impossible"* — was false. A schema-less `stepIf` insert erases to `any` and the guard
  has nothing to check. And the regression test it proposed held a private copy of the connector,
  so weakening the production one left it green, *"contrary to the stated purpose of detecting
  exactly that simplification."*
- **Implementation altitude (#1675):** the *same two shapes*, in the redesign the first pair
  produced. The wiring comment drew the guard's boundary at *"declares an output"*;
  `outputSchema: z.any()` declares one and compiles clean, so the boundary is whether the output
  type is still **concrete**. And the erosion test asserted only that the parameter is an array, so
  widening the element type to `readonly unknown[]` was silent: exit 0.
- **Across the write path:** *"Don't describe failed content writes as silent"*; two README CAS
  guarantees wider than the code (#1035); a comment claiming a value was *"decoded from a stored
  row"* when durable reads bypass that field's schema (#1513); *"add a real no-op path before
  asserting notification silence"* (#1039).

---

## The four seats that missed them — FIX-1238

On FIX-1238, `chatgpt-codex-connector[bot]` produced **all four** above-the-bar findings across
both PRs, and **every other seat that read the same artifacts produced none.** Verified against
the PRs.

| Seat | On #1673 (spec) | On #1675 (impl) |
|---|---|---|
| `cursor[bot]` — simplify / Code Snob | **APPROVED direction.** Six comments, all editorial (ordering, duplication, a missing POC row). Explicitly **endorsed the test that could not fail**: *"the new `src/**` type-level regression test — I would **not** simplify this away… The test is the guard on the guard"* | *"Too small / already tight. No POC."* Listed by name the eight files it read, including the type test and the tap comment, and pronounced the three-line contract irreducible |
| `fsd-architect` | **Ratified** the approach, on the condition that the residual stay honestly stated — the condition the overclaim then violated | — |
| `second-look` | *"Appropriately scoped."* No candidate cleared the gate | *"Appropriately scoped."* Independently checked the premise and the `TS2304` claim, both correct — and neither was the defect |
| `greptile-apps[bot]` | — | — |

**Two corrections to how this gets read.**

First, *"four defects"* overstates the variety. It is **two shapes, twice**: an overclaim and an
assertion that cannot fail, found at spec altitude, then found **again** in the redesign the first
finding produced. The second pair is the more expensive fact — the redesign was authored knowing
exactly what the first pair was.

Second, this bot's dominance is **not** FIX-1238-specific. It produced all 30 P1s on #990, 26 of 29
bot passes on #1461, and every P1 on #1035, #1128 and #1513. What *is* specific to FIX-1238 is the
**unanimous miss**: on no other artifact in this epic did four other seats read the same thing and
all return "fine." The likeliest reason is uncomfortable and is a claim to test, not a finding —
#1673 is the only spec PR in the epic small enough (2 folds, 1 spent round, a 398-line spec) that a
reviewer could hold all of it, and Cursor's approval reads like a reviewer who read all of it, and
endorsed the defect.

---

## The instruments that lied — reproduced, not taken on report

`scripts/typecheck.mjs` runs `tsc` only when `node_modules/.bin/tsc` exists at the repo root.
Otherwise it walks `src/**.ts`, regex-scans import specifiers, and prints
`static typecheck passed (<pkg>): N source file(s) validated` with **exit 0**.

Reproduced for the wrap rather than quoted. A one-file package whose only source file contains
three unambiguous type errors — `const x: number = "definitely not a number"`, an incompatible
re-export, and a property access on a type that has no such property — run through the real script
with no `node_modules` present:

```
static typecheck passed (packages/probe): 1 source file(s) validated
EXIT=0
```

**The trap is live in this repository today.** The worktree the wrap was written in has no
`node_modules/.bin/tsc`, so every `typecheck` run inside it reports success without checking
anything.

**Both faces.** The same script has an inverse: deps installed but `core`'s `dist` stale reports
~22 type errors in untouched files, which nearly got a correct fix rejected. So the instrument
fabricates a pass when the toolchain is missing and fabricates failures when a sibling build is
stale.

**Cost this epic**, from the author's record on #1675: **four fabricated measurements**, and a
worker came close to reporting an approved spec's central mechanism as broken.

Filed as **FIX-1032** (High, *Ready to Spec*); the fix is open and unmerged at
[#1677](https://github.com/fixpoint-labs/flow-state-dev/pull/1677). A sibling instrument,
`packages/orchestration/test/types.type-test.ts`, states that vitest typecheck covers it; nothing
does (**FIX-1239**, High, Backlog).

**Why this is one step past BP-003.** Its third bullet warns about *"a green result from a command
aimed at a **neighbour** of the claim."* Here the command was aimed at exactly the right claim and
reported success **without performing the check at all.** Same false green, different mechanism,
and the existing sentence does not reach it.

---

## The epic PR (#983) — per-row enumeration

**design-off ×5** — the widened method set FIX-976 actually calls; the terminal guard inside the
atomic mutation rather than at the boundary; FIX-963 coupled to mutation return values;
`updateTask`'s multi-field write not atomic; cascade-skip omitted from the cancel-outcome
migration.

**stale-restatement ×7** — count drift across four surfaces ("six issues" / "two of the eight" /
"five remaining" / eight index rows); §1 and §3 contradicting each other on FIX-972's membership;
the membership narrative repeated 4×; *"Epic evolution is a palimpsest"*; *"Stop claiming Decision 1
resolves S3"*; a Decision-3 parenthetical steering the reader away from a spec that does exist; the
whole doc still describing `main` as of 07-30 after five merges.

**over-engineered ×6** — simplification asks, all deferred.

**docs-miss ×1** — the blast radius understated **~4×**: *"6 sites in 3 files"* measured one of four
widened methods; the real figure is ~22 sites / 4 files to compile, ~30 / 10 to be complete.

**The claim.** One looped claim, settled **CONFIRMED** with two gaps by POC
[#1001](https://github.com/fixpoint-labs/flow-state-dev/pull/1001). Decision 1's Option A survived
review, but its cost was wrong by 4× and two of its three named methods were the wrong ones.

---

## Track 2 — the human-wait board, per-row enumeration

| PR | The findings behind the counts |
|---|---|
| [#1419](https://github.com/fixpoint-labs/flow-state-dev/pull/1419) FIX-1234 spec | **design-off ×4** — parked dependencies in complete mode; sibling workers not stopped after the park-exit decision; the carried verdict not isolated per drain invocation (raised **twice**, folds 2 and 3); `onReview: "exit"` refused against only one of two `onIdle` values. **missed-edge-case ×3** — retry-budget precedence in mixed outcomes; id-less `initialTasks`; explicitly-blocked rows masked by the park rung. **stale-restatement ×2** — every README publishing the outcome union; the detached-work architecture contract. **docs-miss ×3** — the changeset; *"the parts to rebuild both are exported"* overstates the public surface; a detached-recapture premise asserted, then **refuted** and swept in fold 8 |
| [#1422](https://github.com/fixpoint-labs/flow-state-dev/pull/1422) FIX-1234 | **missed-edge-case ×7 — 5 convergence** (a row the worker parked completed anyway; the parked-row refusal outside the atomic write; rung 5 unguarded on a parked row; unrelated ready rows and lapsed in-progress rows inside the park closure; stale park verdicts surviving another worker's cap hit) + 2 (session reuse on a resumed task; hand-off guarantee wider than the lease). **docs-miss ×3** — a false guarantee in the guide; design history inside an exported API comment; implementation history inside the release note. **stale-restatement ×1** — `parked` on every surface that claims the decline set. **over-engineered ×2** — `excusedParked` counted but only ever read as `> 0` |
| [#1461](https://github.com/fixpoint-labs/flow-state-dev/pull/1461) FIX-1244 spec | **design-off ×5** — answer data in routing metadata; retries bound to the specific review request; a committed unpark recovered before refusing retries; a representable missing-task refusal; post-commit failure recovery inside the composed step (*"the most substantive thing this review has surfaced"*, arriving at ~round 22). **docs-miss ×3** — an owner approval recorded as "settled" with nothing citeable; a no-lost-answer guarantee wider than the stores whose CAS holds it; a wrong-ledger answer promised to always throw. **stale-restatement ×3** — a §12 rename promise left standing while §7–§11 asserted the opposite (*"the same one-site-left-standing class as six earlier rounds"*, the author's words); two further stale claims corrected in fold 19. **over-engineered ×4** — two verbs where one would do; Part I over budget, cut and restored twice. **spec-ambiguity ×3** |
| [#1571](https://github.com/fixpoint-labs/flow-state-dev/pull/1571) FIX-1244 | **missed-edge-case ×2.** A clean implementation off a 30-fold spec |
| [#1513](https://github.com/fixpoint-labs/flow-state-dev/pull/1513) FIX-1245 | **missed-edge-case ×4 — all convergence, and the dual-read shipped missing three of its four readers**: `readTaskState` casts cached store JSON straight past the shim; in-flight counting; completion derivation from persisted item logs; a fourth read path in Conductor, closed on the last commit **eight days** after the first. **docs-miss ×2** — a comment saying "decoded from a stored row" when durable reads bypass that field's schema; the changeset omits the publishable DevTool package. **stale-restatement ×1** — the maintained atlases |
| [#1673](https://github.com/fixpoint-labs/flow-state-dev/pull/1673) FIX-1238 spec | **docs-miss ×1** + **missed-edge-case ×1** — the two honesty defects, enumerated above. Both from one reviewer |
| [#1675](https://github.com/fixpoint-labs/flow-state-dev/pull/1675) FIX-1238 | **docs-miss ×1** + **missed-edge-case ×1** — the same two shapes again, enumerated above |
| [#1677](https://github.com/fixpoint-labs/flow-state-dev/pull/1677) FIX-1032 | **missed-edge-case ×2.** In flight |

---

## Track 1 — write path and drain report, per-row enumeration

| PR | The findings behind the counts |
|---|---|
| [#941](https://github.com/fixpoint-labs/flow-state-dev/pull/941) FIX-951 spec | **stale-restatement ×2** — a heading saying "five writers" over a six-row table; a stale metadata-write requirement. Plus design-off ×2, missed-edge-case ×3, over-engineered ×2 |
| [#953](https://github.com/fixpoint-labs/flow-state-dev/pull/953) FIX-951 | **missed-edge-case ×2** — advisory writes not bound to the claimed attempt; no-op after settlement. docs-miss ×1 |
| [#995](https://github.com/fixpoint-labs/flow-state-dev/pull/995) FIX-976 spec | **over-engineered ×3** — scope levers, all taken. spec-ambiguity ×2. **stale-restatement ×1** — blast radius argued in three places |
| [#1004](https://github.com/fixpoint-labs/flow-state-dev/pull/1004) FIX-976 | No finding above the bar. The cheapest implementation in the epic |
| [#1005](https://github.com/fixpoint-labs/flow-state-dev/pull/1005) FIX-989 spec | design-off ×3, missed-edge-case ×4, docs-miss ×2 |
| [#1128](https://github.com/fixpoint-labs/flow-state-dev/pull/1128) FIX-989 | **missed-edge-case ×6 — convergence**: write tokens per incarnation; collision-free discriminator; withhold when either id is absent; cross-process-unique ids ×2 sites; truncation marker preserved across later writes. docs-miss ×2 |
| [#1010](https://github.com/fixpoint-labs/flow-state-dev/pull/1010) FIX-992 spec | design-off ×6, missed-edge-case ×8, over-engineered ×2. Split into three PRs after review |
| [#1035](https://github.com/fixpoint-labs/flow-state-dev/pull/1035) FIX-992a | **missed-edge-case ×12 — convergence across every backing**: tombstone revives guarded by version in Postgres **and** SQLite; blind writes bumped atomically in both; raced deletes treated as success in both; numeric `-1` rejected in both; plus create/CAS races. **docs-miss ×2** — the adapter README's CAS guarantee; the resource-state CAS docs. **The sharpest convergence instance in Track 1: eight findings are the same rule missing from its second adapter** |
| [#1036](https://github.com/fixpoint-labs/flow-state-dev/pull/1036) FIX-992c | missed-edge-case ×5. **docs-miss ×3** — *"Don't describe failed content writes as silent"*; the failed-create content contract; the state-and-scopes CAS status. **stale-restatement ×1** — the architecture route reference |
| [#1039](https://github.com/fixpoint-labs/flow-state-dev/pull/1039) FIX-992b | **missed-edge-case ×7**, one of which is the vacuous assertion — *"add a real no-op path before asserting notification silence"*; the assertion passed because nothing exercised it. docs-miss ×2 |
| [#1011](https://github.com/fixpoint-labs/flow-state-dev/pull/1011) FIX-948 spec | design-off ×2, missed-edge-case ×3, docs-miss ×2 |
| [#1031](https://github.com/fixpoint-labs/flow-state-dev/pull/1031) FIX-948 | missed-edge-case ×2 |
| [#1022](https://github.com/fixpoint-labs/flow-state-dev/pull/1022) FIX-995 spec | missed-edge-case ×3, over-engineered ×2 |
| [#1023](https://github.com/fixpoint-labs/flow-state-dev/pull/1023) FIX-995 | missed-edge-case ×4. **docs-miss ×1** — a docblock documenting a function that had moved below it. **stale-restatement ×1** — `TaskTransitionOptions` still describing advisory declines as silent |
| [#1048](https://github.com/fixpoint-labs/flow-state-dev/pull/1048) FIX-1001 spec | design-off ×5, missed-edge-case ×7, over-engineered ×2 |
| [#1292](https://github.com/fixpoint-labs/flow-state-dev/pull/1292) FIX-1001 | missed-edge-case ×3, docs-miss ×1 |

---

## The three specs reviewed and never built — outcomes

| PR | Outcome |
|---|---|
| [#990](https://github.com/fixpoint-labs/flow-state-dev/pull/990) FIX-978 | Linear **Canceled** 2026-08-25. All three of its claims re-checked against `origin/main` and found already closed by sibling work. Two of its P1s were the reviewer escalating to *"keep implementation blocked on the unresolved design"* — the block held, and then the issue evaporated |
| [#992](https://github.com/fixpoint-labs/flow-state-dev/pull/992) FIX-963 | Converged, never approved, **still open**. Now mildly decayed: it names `awaiting_review`, which survives on `main` only as `LEGACY_PARKED_STATUS` after FIX-1245 |
| [#994](https://github.com/fixpoint-labs/flow-state-dev/pull/994) FIX-964 | Descoped by the owner 2026-08-24/25. Issue **On Hold**, unparented from the epic, PR **still open** |

The cost is concentrated: #990 alone is 1,884 lines and 30 P1s, more review than any
*implementation* PR in this epic received.
