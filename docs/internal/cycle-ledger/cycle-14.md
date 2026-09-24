# Cycle 14 — W4 work-routing & package-cohesion epic wrap (FIX-1407) (2026-09-20)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**The first wrap-time collection where the dominant class is a single recognisable defect shape with a
name the repo already uses: a check written so it could only pass.** Twenty-one instances across seven
of the nine implementation artifacts. It is also the cycle in which reviewers began **citing BP-003 by
number** while filing it — four times on one PR — which retires the question cycle 13 left open about
whether the rule was reaching its readers. It reaches them. It does not deter them.

**Method — scope, declared first because it is narrower than the epic.** The nine implementation and
POC artifacts below were **thread re-read** in full (every review thread, both bot and human, with the
author's replies). The **five child spec PRs** (#1915, #1916, #1917, #1919, #1935) were **not**
thread-collected this cycle: they are recorded with endpoint and approval time only, carry no class
distribution, and are **excluded from every count in this entry**. The epic PR #1905 was collected. A
class distribution that quietly included five artifacts nobody read would be this entry's own dominant
defect, so the denominator is stated rather than implied.

**Method — rounds.** `Rounds` = **spent waves**, per cycle 12's definition: a commit drawing at least
one automated pass, followed by a push. Read from `/pulls/N/reviews` for #1905, #1920, #1921, #1929,
#1936, #1940 and #1943. For **#1922, #1923 and #1928 the count is derived** from the branch's
review-round commits against automated-pass timestamps rather than read from the reviews endpoint —
a weaker derivation, marked `~`, and not to be compared against an exactly-read count.

**Method — endpoints.** Per the endpoint table: implementation PRs end at merge; the epic PR ends at
**epic close**, which is this wrap (#1905 closed 2026-09-20T01:02Z). **#1921 and #1940 are open**, so
they fall back to collection time and are **partials**, labelled as such and never compared to a total.

| PR | Kind | Rounds | Endpoint | Feedback classes (deduped) | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1905](https://github.com/fixpoint-labs/flow-state-dev/pull/1905) epic-spec FIX-1407 | epic | **1** | epic close | over-engineered ×2 (all four docs 50–80% over the word ceiling) · stale-restatement (sign-off says "Open: two", DECISIONS has three) · spec-ambiguity | no | — |
| [#1920](https://github.com/fixpoint-labs/flow-state-dev/pull/1920) impl FIX-1405 (PR-A) | impl | ~2 | merge | **missed-edge-case ×6 (all six *vacuous-assertion*)** · docs-miss ×2 · nit | no | **2 filed; the author's own mutation sweep of the same file found 4 more** |
| [#1921](https://github.com/fixpoint-labs/flow-state-dev/pull/1921) impl FIX-1394 (ratify + POC) | impl | **2 (in flight)** | collection time | **missed-edge-case ×5 (all five *vacuous-assertion*)** · over-engineered · nit | no | **four of the five cite BP-003 by number; the equivalence was circular** |
| [#1922](https://github.com/fixpoint-labs/flow-state-dev/pull/1922) impl FIX-1385 | impl | ~2 | merge | missed-edge-case ×4 (cross-runtime policy leak, org-less writes, `claimedBy` leak, capability-name collision) · docs-miss ×2 · nit ×3 | no | — **zero instances of the dominant class** |
| [#1923](https://github.com/fixpoint-labs/flow-state-dev/pull/1923) impl FIX-1405 (collections) | impl | ~2 | merge | missed-edge-case ×1 (*vacuous-assertion*) · over-engineered ×2 · docs-miss ×2 · nit ×2 | no | a case asserting two of the three things its own seed wrote |
| [#1928](https://github.com/fixpoint-labs/flow-state-dev/pull/1928) impl FIX-1405 (binder) | impl | ~3 | merge | missed-edge-case ×3 (public action forges seats; partial commit ×2) · docs-miss ×3 · over-engineered ×2 | no | — **zero instances of the dominant class** |
| [#1929](https://github.com/fixpoint-labs/flow-state-dev/pull/1929) impl FIX-1430 | impl | **3** | merge | **missed-edge-case ×4 (all four *vacuous-assertion*)** · over-engineered ×2 · nit ×2 | no | **a lab whose purpose is grading routing, four of whose own graders could not fail** |
| [#1936](https://github.com/fixpoint-labs/flow-state-dev/pull/1936) impl FIX-1451 | impl | **2** | merge | **missed-edge-case ×2 (both *vacuous-assertion*)** · docs-miss ×3 · over-engineered · nit | no | **the fixture never produced the input the negative assertion was about** |
| [#1940](https://github.com/fixpoint-labs/flow-state-dev/pull/1940) impl FIX-1430 (verdict) | impl | **2 (in flight)** | collection time | **missed-edge-case ×1 (*vacuous-assertion*)** · over-engineered ×2 | no | **the control graded *which* leg went red, never *how many times*** |
| [#1943](https://github.com/fixpoint-labs/flow-state-dev/pull/1943) impl FIX-1381 | impl | **3** | merge | **missed-edge-case ×4 (2 *vacuous-assertion*)** · docs-miss ×2 · over-engineered ×3 · nit | no | **`hired ?? []` — the 404 was going to arrive whatever happened** |
| #1915 · #1916 · #1917 · #1919 · #1935 | spec ×5 | — | approval | **not collected this cycle** | — | — |

**Load: 21 rounds across the nine implementation artifacts**, two of them partial. Both specs and the
epic PR held their two-round budget; no direction artifact reached a third round, so by BP-040's rule
there was no direction-level finding anywhere in the set.

## The dominant class — 21 instances, and it has a shape

**Classes (closed set), 61 non-`nit` findings on the ten collected artifacts:** `missed-edge-case` 30
· `docs-miss` 14 · `over-engineered` 15 · `stale-restatement` 1 · `spec-ambiguity` 1 · `design-off` 0.

**Of the 30 `missed-edge-case` findings, 17 carry the `vacuous-assertion` reading label** — an
assertion that passes for a reason unrelated to what it claims to check. Adding the four the #1920
author found by sweeping rather than by review gives **21 distinct instances of the class**. The
distribution across artifacts is the thing to read, not the total:

| Artifact | Instances | What the artifact is |
|---|---|---|
| #1920 | **6** (2 filed + 4 swept) | a reader's unit suite |
| #1921 | **5** | a POC matrix asserting two formats are equivalent |
| #1929 | **4** | a lab that exists to grade routing |
| #1936 | **2** | tests pinning a prompt's exact wording |
| #1943 | **2** | a goal check over a permission boundary |
| #1923 | **1** | a collections suite |
| #1940 | **1** | a verdict log's control |
| **#1922, #1928** | **0** | ordinary feature code with ordinary tests |

**The two artifacts with zero are the tell.** #1922 and #1928 are substantial feature PRs — a channel
board surface and a boot binder — and between them they drew seven `missed-edge-case` findings, none
of them vacuous. What separates them from the other seven is not size or care. It is that **their
checks do not grade a claim the change itself is making.** The class lives wherever a check is
standing in for an argument: an equivalence, a count, an identity, an absence, a verdict.

**The five shapes, with the instance that fixes each one's meaning:**

1. **Never ran the check.** #1921's matrix command printed its cells and exited zero regardless of
   their verdicts, so V2 rested on someone transcribing correctly.
2. **Aimed at a neighbour.** #1921's P5 ran the *bystander* seat, which holds nothing, and so proved
   only that an unattached seat has no tools — while claiming to prove that a package-holding seat
   without `tools:` gets none.
3. **Scope wider than the real one.** #1921's `C3-skill-files` read a TypeScript source regex and
   reported it as proof that an opt-in unit can ship a document, a claim the same PR disproves.
4. **Fixture too clean to contain the failure.** #1936's `seed()` parsed `allowed-tools` with a
   bracket-only regex, so the spec's *primary* space-separated form seeded as though no tools were
   declared; the note never rendered, and `not.toMatch(/tools are available/i)` passed against an
   empty string.
5. **Graded the kind, never the cardinality.** #1940's `repointed-map` control asserted the run went
   red at leg (c) and at no other leg, but never how many times — so one identity mismatch graded
   green beneath a verdict row saying three. #1929's filing check is the same shape: four rows exist
   and each input is a substring of some row, which a model satisfies by combining two inputs in one
   row and duplicating another.

Shapes 1–3 are BP-003's own three bullets, written out in the rule, in the tree, on the branch.

## The finding — the rule was quoted at the defect and did not deter it

**Cycle 13 inferred that a correctly-worded prose rule was failing to bind, from six cycles of
correlation. This cycle observed it directly.** On #1921, Greptile and Codex filed five findings and
**four of them name BP-003 explicitly**:

> *"This violates BP-003's requirement that verification exercise the actual claim rather than a
> neighboring condition."* — on the compiler that never opened either manifest
>
> *"...violates BP-003's requirement to test the behavior being claimed."* — on P5's bystander
>
> *"BP-003 requires behavioral evidence for this claim."* — on `C3-skill-files`
>
> *"BP-003 requires verification with explicit pass criteria."* — on the matrix exiting zero

That is a rule whose text is correct, whose scope covers the case, which the reviewer can quote by
number, and which the author had read — failing to prevent four defects in one artifact. **The
seventh consecutive cycle in which this happens, and the first where the citation is on the record.**
The marginal return on sharpening BP-003 is not merely unmeasured; it is now measured against a
condition where the rule was maximally available.

**So this cycle does not sharpen BP-003, and that is the recommendation's whole point.** A seventh
sentence added to a rule that was being quoted verbatim at the defect would be the class itself,
applied to the grounding: an intervention with no state in which it could fail.

## What actually worked — and it is already in the repo, unwritten

Every successful fold in this cycle did the same thing, and none of the failures did. The author
**named a perturbation and reported its blast radius.** Verbatim, from four different artifacts:

- #1943: *"Proved falsifiable by making the refusal per-worker instead of whole-roster — leg (f)
  fails, and nothing else does."*
- #1940: *"Red: with leg (c) temporarily short-circuited after its first note, the new assertion fires
  — 'went red 1 time(s), but the swap moved 3 row(s) … Never named: …'."*
- #1936: *"Red evidence: perturbing the note back to 'seat' fails exactly the two wording tests and
  nothing else."*
- #1923: *"removing the membership `upsert` from the seed entirely used to leave this case **green**;
  it now goes red here too, on `expected length 3, got 0`."*
- #1921: *"Watched it fail before trusting it: planting an error on the sibling's turn turns both
  modes red — then restored and re-confirmed green."*

**And #1920 is the measurement, not the anecdote.** Review filed two vacuous assertions in
`read-declared-roster.test.ts`. The author then applied the same operation to the rest of that one
file and reported: *"That prompted a sweep of the rest of the file for the same shape. It found **four
assertions that could not fail**, all now fixed, **each proved red under its own mutation**."*

**Two filed by three bots; four more found by the author mutating deliberately, in the same file.**
That is the same result cycle 13 landed at document altitude — enumerate the bounded set rather than
reason about the words — reproduced here at assertion altitude, and it is the only intervention in
two cycles with a positive measured yield.

## Why red-before-green does not already cover this

`issue-implement`'s **"Red is a gate, not a suggestion"** paragraph is the obvious candidate for
already owning this class. It does not, and the reason is precise enough to act on.

Its **unit** is *"write ONE behavioural test → run it → observe it fail → write the minimal code →
observe it pass."* That perturbs **the code you are about to write**, and it needs a before-state.
The class recurring here lives in checks that have no before-state:

- a **negative** assertion (`not.toMatch`, "no other leg failed", "nothing was hired") is green before
  the change and green after — there is no red phase to observe;
- a **cardinality** claim ("exactly three", "one row per piece") is not a behaviour being added;
- a **control leg** or **goal-check leg** grades a run rather than introducing a behaviour;
- an **equivalence** (#1921's whole matrix) is a property of two artifacts, not of a new code path.

Red-before-green is satisfiable in full by every one of the 21 instances. #1921's probes *did* have
fixtures and *did* go red on them and green after — while remaining circular, because the compiler and
the assertion drew the expected text from the same constants. The two operations are orthogonal:
red-before-green perturbs the implementation; this class needs perturbing **the property the check
claims**, which may be a fixture, a count, an identity, or an input the check was never given.

Worse, the paragraph's **exception (a)** — parity work, "no red-green cycle by design" — reads as
covering exactly these cases to an author who has just written a check over existing behaviour.

## The recommended upstream fix — one sharpening, in `issue-implement`

**Add the blast radius to the existing "Red is a gate" rule, and extend its unit to checks with no
before-state.** One new paragraph under Core Principles, wired into Step 6 and the PR evidence
bullet — not a new BP, and not a seventh BP-003 bullet. The rule already
demands red. What is absent — everywhere in the grounding, despite being the repo's own consistent
successful practice — is **"and nothing else went red."**

The blast-radius half is what catches shapes 4 and 5, and it is the half that cannot be satisfied by
reading:

- On #1936's broken fixture, perturbing the note fails **nothing**, because no note ever rendered.
  "Tests pass" hides that; "perturbing X fails exactly these two tests" cannot.
- On #1940's control, perturbing leg (c) to fail once leaves the control green while the log says
  three — visible the moment you are obliged to say which checks moved and how far.
- On #1920's `.message` assertions, the mutation `new Error(e.error.message)` leaves **both** green,
  which is a report you cannot write down without noticing.

**Reachability walk — trigger → obligation → report, on the bounded instance set.** This is cycle 13's
claim-6 method, applied here to this cycle's own proposed rule rather than landed as a step (see the
scoring below for why it is applied and not minted).

- **Trigger:** a check offered as evidence for a claim the change is making. Already BP-003's scope;
  no new gate, and in particular not gated on "changed behaviour", which is the gate that excluded
  cycle 13's motivating cases.
- **Obligation:** break the claimed property — not the implementation — and run.
- **Report:** name what was broken, which checks went red, and that nothing else did.

Walked against all 21 instances: **20 fall out cleanly.** Each has a concrete perturbation that turns
the defect visible — delete `PACKAGE.md` (#1921, matrix stays green); construct a package-holding
seat (#1921 P5, which cannot be done without discovering the probe never had one); flip a cell's
verdict (#1921 matrix, exit stays zero); plant an error on the sibling (#1921 VG, stays green);
perturb the host map (#1929 recovery, comparison cannot move because both sides come from the tree);
make leg (c) fail once (#1940, control stays green); remove the membership `upsert` (#1923, case stays
green); rebuild the error from its text (#1920, both `.message` assertions stay green); reword the
note to "only these tools are usable" (#1936, assertion stays green). **One does not:** #1929's
control race is a flake rather than a vacuity, and the blast-radius report only surfaces it as "leg
(c) sometimes does not fire" — partial credit, recorded as partial.

**It clears the Step-3 gate.** *Generalizable* — every change that offers a check as evidence.
*Grounded* — 21 named instances on nine artifacts, every one linkable. *Not already covered* — BP-003
demands the red state and does not mention the blast radius; `issue-implement`'s rule owns the
before-state case and demonstrably not the others. *Altitude* — a sharpening of one paragraph in the
skill that already owns verification discipline, which is where cycle 13 landed for the same reason
and by the same measurement.

## Scoring the previous cycles' open claims

- **Claim 3 — "does a per-claim guard survive its own PR?" — first `yes` in three cycles.** Cycle 13's
  baseline was three instruments built, zero retained, with `scripts/check-isolation-coordinate.mjs`
  sitting on `main` referenced by nothing. It is now **wired into CI** (`.github/workflows/ci.yml:143`)
  by [#1906](https://github.com/fixpoint-labs/flow-state-dev/pull/1906), *"ci(guards): run the
  isolation-coordinate check, with a negative control"* — and the negative control is the point.
  Separately, `goals/scripts/validate-control-shape.mts` (rules C1–C4) runs from the **root**
  `pnpm typecheck`. Retention is 1 of 3 and rising; score again next cycle.
- **Claim 6 — "is a loop fix's reachability the thing that fails?" — not measurable this cycle.**
  Claim 6's population is *the loop's own fixes*, and this sample contains none: all 21 instances are
  product checks. Scoring it against them would be the neighbour defect. **The method was applied
  rather than minted** — the reachability walk above is claim 6's procedure run on this cycle's
  proposed rule, and it changed the recommendation (it is what demoted "gate on changed behaviour" and
  surfaced the #1929 partial). Carry claim 6 forward unminted; a cycle that applies a step and finds
  it useful has not yet shown the step is needed by anyone who was not already going to do it.
- **Claim 1 / `vacuous-assertion` measurability — answered, and the answer is large.** Cycle 13 carried
  **6 of 34** forward and asked for a sample containing code PRs. This sample is nine of them:
  **21 of 61** non-`nit` findings carry the label, **34%**, against cycle 12's 15 of 37 (41%) and cycle
  13's 6 of 34 (18%). The 21 counts the four an author swept rather than a reviewer filing them, and
  the 61 counts only review findings, so 34% is a ceiling; review-filed alone is 17 of 61, **28%**.
  The populations differ — cycle 13's was four documentation PRs — so the honest
  reading is that the class is **flat in the 30–40% band wherever the artifacts assert**, and that cycle
  13's dip measured its denominator. This also settles the promotion question the file header leaves
  open: `vacuous-assertion` has now been the dominant shape in every cycle that sampled asserting code.
- **Claim 5 — "are the loop's fixes landed at the gate?"** This cycle's fix is proposed at wrap, on a
  draft PR, unmerged. Third consecutive cycle landing at the gate; baseline holds.
- **`stale-restatement` — collapsed to 1 of 61**, against cycle 13's 12 of 38. Same caveat in the other
  direction: this set is nine code PRs and one epic-spec, and cycle 13's was mostly documentation. Not
  scoreable as progress on 10.6's checklist line. The one instance is #1905's *"Open: two"* against
  three items in DECISIONS — an epic-spec sign-off disagreeing with its own decision list.

## Candidates considered and dropped

- **A new BP for the cardinality shape ("grade the count, not only the kind").** Dropped. It is one of
  five shapes of one class; minting a BP per shape is the bloat this skill exists to prevent, and the
  blast-radius report catches it without a new number.
- **A seventh bullet in BP-003.** Dropped, and the reason is this cycle's headline: the rule was
  quoted by number at four defects on one PR and deterred none of them.
- **A mechanical "vacuous assertion" linter** (flag `not.toMatch` without a positive counterpart, flag
  sort-before-compare). Dropped as undecidable in general and trivially gamed — but noted as the
  *narrow* case worth revisiting, since #1920's sort-before-compare and #1929's
  compare-two-values-from-the-same-source are both syntactically recognisable. Filed here, not built.
- **Requiring a control beside every goal verdict** (generalising #1940's argument). Dropped as
  already owned by `validate-control-shape.mts` C1–C4 for the goals corpus; widening it repo-wide
  before that guard has a second cycle of evidence would be premature.
- **A `docs-miss` fix for the changeset-format finding that appeared on five of nine PRs.** Deliberately
  not escalated: it is a compliance gap against a rule whose text is already unambiguous, the author
  identified it as recurring on #1923 unprompted (*"the third consecutive PR in this epic to fail the
  same rule"*), and it is one sentence. More words would not fix compliance — the same conclusion
  cycle 13 reached about 10.6's first sweep.

## Claims to test next cycle

1. **Does the blast-radius report catch a vacuous assertion before review does?** Baseline: **21
   instances, 17 filed by review, 4 found by one author sweeping one file.** Score whether an author
   obliged to report the blast radius finds them at authoring time, on a sample containing at least
   one artifact that grades its own claim (a lab, a goal check, a POC matrix, a wording pin).
2. **Does the class stay in the 30–40% band wherever code asserts?** Three data points now — 41%,
   18%, 34% — with the dip explained by a documentation denominator. A fourth code-heavy sample
   settles whether that band is the resting rate or whether cycle 12–14 are flat because nothing has
   yet acted on it.
3. **Does the retained guard stay retained?** `check-isolation-coordinate.mjs` and
   `validate-control-shape.mts` are both wired now. The failure mode is not deletion, it is going
   green forever: check next cycle that each has fired at least once, or that its negative control
   still fails when the guard is disabled.
4. **Is the zero on non-grading artifacts real?** #1922 and #1928 drew seven `missed-edge-case`
   findings and no vacuous ones. If that holds on a second sample, the class is scoped to
   claim-grading checks and any future instrument should be scoped there too rather than to all tests.
