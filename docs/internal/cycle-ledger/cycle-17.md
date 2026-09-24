# Cycle 17 — W5 Workforce release QA epic wrap (FIX-1457) (2026-09-24)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**The class is the one cycle 14 wrote a rule for, and every implementation PR in this epic carried
that rule.** Twelve of the 34 non-`nit` findings on the nine implementation artifacts are assertions
that could not fail. **All nine reviewed heads carry the blast-radius paragraph**, and the authors ran
it: #2065's body certifies *"every control has been seen red at exactly the leg it names"*, and Codex
then found five assertions in that goal that passed on nothing. The operation ran on **controls**. The
defects were in **assertions**. A control going red on its leg says nothing about the other
assertions in that leg.

**Method — scope.** Nineteen artifacts, found by searching PRs for the epic and child ids: the epic PR
#1944, its amendments #2033 and #2141, the cancelled explore #1955 (FIX-1458), the child specs #1957,
#2025, #2023, #2045 and #2138, the spec amendment #2037, the implementation PRs #1958, #2032, #2039,
#2066, #2051, #2065, #2133 and #2147, and the evidence PR #2073 (FIX-1515, written by a Cursor agent
outside the lifecycle). Every review thread, every review list and every commit list was read through
the GitHub MCP. Conversation comments were read for #1944, #2025, #2033, #2065 and #2073. Linear was read
over GraphQL for every child's state and for the FIX-1496 and FIX-1511 comments cited below.
**Findings, endpoints and rounds** follow cycle 15's written rules and cycle 12's spent-wave
definition, unchanged. Every round count is **derived** from review and commit timestamps.
**Direction artifacts end at the human direction approval, and merge or close is recorded
separately.** Approval was read from each PR's timeline (the `spec approved` label, an owner comment)
and from the coordinator's in-session record. On six of the ten, no approval act was recorded apart
from the merge. There, the owner's merge is the approval and the two coincide. *The first draft of
this entry ended every direction row at merge. The recompute moved no round count, because no review
wave landed between an approval and its merge. It did correct one row: #1957 was closed unmerged
under the older never-merge contract, not merged.*

| PR | Kind | Rounds | Endpoint | Feedback classes (deduped) | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1944](https://github.com/fixpoint-labs/flow-state-dev/pull/1944) epic-spec FIX-1457 | epic | ~1 (+3 owner re-cuts, not rounds) | approval 09-20 01:02Z on `89c1a1d` (`spec approved` label, and the owner in session), withdrawn 14:26Z after the D2 flip; re-approved by merge 09-21 22:10Z | missed-edge-case ×3 (1 *vacuous-assertion*: ER-20 was proved by a cross-spec review that never sees shipped code) · stale-restatement ×2 (`ownership.svg`'s count, `path.svg`'s critical path) · spec-ambiguity ×1 (ER-19's owner on the collapse path) · philosophy-drift ×1 (the sign-off re-asked a decided D5, four asks against three) · nit ×7 — *14 from 16 threads* | **yes** — the owner flipped D2, cancelled FIX-1458 and re-cut the epic to release QA, all after the objective gate | — owner direction, not review rework. Two self-caught echoes of the fold (`89c1a1d`, `89c12ca`) |
| [#2033](https://github.com/fixpoint-labs/flow-state-dev/pull/2033) epic amendment | epic (amendment) | **0 before merge** | approval = merge 09-22 11:45:40Z (no separate act) | reviewed **after** merge: Codex clean at 11:46:51Z, Cursor CHANGES_REQUESTED at 11:48:33Z. stale-restatement ×3 (figures still `BLOCKED BY` unconditionally · "Not buildable in W5 today" beside Open 1 · PLAN step 6 contradicting itself) · spec-ambiguity ×1 (a build-order sentence against ER-26) · nit ×3 — *7 from 7*, none folded here; #2141 redrew the figures | **yes** — the recommendation rested on a premise its own settlement measured false | a direction artifact merged 71 s before its first automated review returned |
| [#2141](https://github.com/fixpoint-labs/flow-state-dev/pull/2141) epic amendment 2 | epic (amendment) | ~1 | approval = merge 09-24 17:53Z | stale-restatement ×2 (P1: ER-DevForce recorded PASS while the goal it cites still said the gate was red, a day after FIX-1515 fixed it · P2: the checklist intro still said nothing had been observed live) — *2 from 2*. Plus a pre-review send-back of four stale ER-26 lines in FIX-1497's spec (`a9587e1`) | no | **re-read a carried fact when writing it down**: FIX-1515 went Done 09-23 19:52Z and the record still carried it as open |
| [#1955](https://github.com/fixpoint-labs/flow-state-dev/pull/1955) explore FIX-1458 | spec | ~1 (+1 owner flip) | **close** 09-20 15:48Z (cancelled) | missed-edge-case ×3 (1 *vacuous-assertion*: BR-8's passing leg ran every request as `u_boot`, so it proved an unrelated caller can answer) · spec-ambiguity ×1 · nit ×4 — *8 from 8 threads and one Architect item recorded in `dc60e57`*. Author-found in the fold: the no-park control graded weaker than it read | **yes** — D1 flipped to Model B, then the issue was cancelled | — |
| [#1957](https://github.com/fixpoint-labs/flow-state-dev/pull/1957) explore FIX-1467 | spec | ~1 | approval 09-20 16:22:12Z (`spec approved` label); **closed unmerged** 16:22:22Z | spec-ambiguity ×3 (POC leg 4 asserted the opposite of BR-14; BR-10 promised a widening with no mechanism; read caching unpinned) · missed-edge-case ×3 (1 *vacuous-assertion*: an acceptance case no seat can reach) · over-engineered ×1 · nit ×4 — *11 from 13* | no | — D1's core premise was settled by running POC leg 5, not argued |
| [#2025](https://github.com/fixpoint-labs/flow-state-dev/pull/2025) spec FIX-1481 | spec | **~2** | approval = merge 09-22 02:14Z | design-off ×1 (the badge predicate: six threads, three reviewers) · missed-edge-case ×4 (1 *overclaim*: row 5 deferred to an issue that reads a different collection · 1 *vacuous-assertion*: a synthetic-flow VG · 1 retained POC check that goes red on the PR it enables) · docs-miss ×1 · nit ×3 — *9 from 15* | **yes** — the coordinator pushed `!mayWrite` and withdrew it; the Architect's two-field ask was wrong against the store; D2 rested on a BP-031 hole FIX-1442 had already closed | **the D2 premise came from the coordinator's stale checkout** (#2037's commit says so) |
| [#2037](https://github.com/fixpoint-labs/flow-state-dev/pull/2037) spec amendment FIX-1481 | spec (amendment) | ~1 | approval = merge 09-22 12:43Z | missed-edge-case ×1 (*overclaim*: the replacement premise about `handleListSessions` was wrong, a defect in the fix itself) · docs-miss ×1 (linked unlanded #2033 text, *"the same defect this PR exists to fix, reintroduced by the fix"*) · over-engineered ×1 · nit ×1 — *4 from 5*. Plus a self-driven BR-17 sweep: 3 occurrences where 1 was reported | no | — |
| [#2023](https://github.com/fixpoint-labs/flow-state-dev/pull/2023) spec FIX-1496 | spec | ~1 | approval = merge 09-22 11:43Z | missed-edge-case ×4 (3 *vacuous-assertion*: acceptance met by any passing test; `gap-check`'s regex could not match the canonical API; a planted red that proves a regex, not the wiring · 1 retained POC with no sunset) · over-engineered ×3 · spec-ambiguity ×1 · nit ×3 — *11 from 11*. Self-caught echo: D1's heading kept the pre-trim shape (`853c75d`) | no | — |
| [#2045](https://github.com/fixpoint-labs/flow-state-dev/pull/2045) spec FIX-1497 | spec | **~2** (+ coordinator ruling, + owner Open 1) | approval 09-22 17:10Z (owner answered Open 1), recorded on `daf0df14b` at 17:18Z; merge 20:06Z | missed-edge-case ×6 (2 *vacuous-assertion*: a control that cannot isolate its leg; a readiness probe that accepts another process's `/healthz` · 1 *overclaim*: BR-5 asserted a refusal the design cannot make) · design-off ×1 (the acceptance needed one screen that cannot exist) · spec-ambiguity ×1 (S1 pointed at a POC file its own guardrail forbids) · philosophy-drift ×1 (a `package.json` in a retained POC) · stale-restatement ×1 (BR-16 → BR-19 renumber debris, from the Architect) · nit ×4 — *14 from 14 threads and one review body* | no | the worker routed A, B and C to the owner; the coordinator ruled all three, because a ratified rule closed one branch of each |
| [#2138](https://github.com/fixpoint-labs/flow-state-dev/pull/2138) spec FIX-1502 | spec | ~1 | approval = merge 09-24 17:52Z | missed-edge-case ×2 (1 *vacuous-assertion*: VG could not catch a bare client, since the lab has no resolver) — *2 from 2* | no | — |
| [#1958](https://github.com/fixpoint-labs/flow-state-dev/pull/1958) impl FIX-1467 | impl | ~1 | merge 09-20 17:49Z | missed-edge-case ×5 (2 *overclaim*: the body claimed *all five guards clean* with one red; a dry run reported rows cleared) · over-engineered ×2 · nit ×5 — *12 from 15*. **Found after review by the isolated docs-writer, and again by the docs-editor: D2's silent off-switch.** Author-found in the fold: the wall's verifier *"agreed with the bug it exists to catch"* | no | the docs isolation acted as a second detector with different blind spots |
| [#2032](https://github.com/fixpoint-labs/flow-state-dev/pull/2032) impl FIX-1481 PR-A | impl | ~1 | merge 09-22 13:07Z | missed-edge-case ×2 (the trim against BR-3/BR-4; a test pinning a known defect with no retirement) · docs-miss ×2 (bump, fragment length) · nit ×2 — *6 from 7* | no | — |
| [#2039](https://github.com/fixpoint-labs/flow-state-dev/pull/2039) impl FIX-1481 PR-B | impl | ~1 | merge 09-22 13:14Z | missed-edge-case ×2 (1 *overclaim*: the tooltip promised "every write" refused) · docs-miss ×2 (both *overclaim*) · nit ×4 — *8 from 8*. Self-found after the fold: two framing sentences the fold's own change had falsified (`c65c0b7`) | no | — |
| [#2066](https://github.com/fixpoint-labs/flow-state-dev/pull/2066) impl FIX-1481 VG | impl | ~2 | merge 09-22 23:32Z | missed-edge-case ×3 (1 *vacuous-assertion*: visibility graded on one axis, **which the author confirmed PASSed under a 3000 px mutation** · 2 checks that could never go green) · nit ×7 — *10 from 10* | no | the `silent-park` control was red on row 4 while row 4's visibility assertion was hollow |
| [#2051](https://github.com/fixpoint-labs/flow-state-dev/pull/2051) impl FIX-1496 | impl | ~1 | merge 09-22 20:45Z | missed-edge-case ×5 (**4 *vacuous-assertion***: a row settled `completed` over rejected work; `process.exit(0)` forged the grader; an absence read on an `in_progress` row; presence read as exclusivity) · stale-restatement ×1 (a comment pointing at the path the PR deleted) · nit ×4 — *10 from 10*. Author-found in the fold: branch existence measured provisioning, not work | no | all four were on legs whose controls were red |
| [#2065](https://github.com/fixpoint-labs/flow-state-dev/pull/2065) impl FIX-1497 | impl | ~2 (bots, then owner) | merge 09-22 21:32Z | missed-edge-case ×5 (**all 5 *vacuous-assertion***: a non-202 counted as a pass; a decline never asserted; an empty loop; an empty body skipped; `> 2` for "exactly two") · philosophy-drift ×1 (owner: kinds live under `flows/`) · docs-miss ×1 (owner asked for figures) · nit ×5 — *12 from 11 threads and one comment*. **Shipped a scope fence with no lifecycle: V7 is red on every later branch that touches `packages/` (FIX-1562)** | no | **the body certifies every control red at its leg** |
| [#2133](https://github.com/fixpoint-labs/flow-state-dev/pull/2133) impl FIX-1547 | impl | ~1 | merge 09-24 17:59Z | missed-edge-case ×1 (*vacuous-assertion*: the settle loop accepted `failed` and a timeout) · nit ×2 — *3 from 4* | no | — |
| [#2147](https://github.com/fixpoint-labs/flow-state-dev/pull/2147) impl FIX-1502 | impl | ~1 | merge 09-24 19:00Z | missed-edge-case ×1 (pagination with no bound) · nit ×1 (docs, already pushed after the reviewed head) — *2 from 2*. **Found at wrap:** `apps/docs/docs/workforce/inventory.md:5` still says *"what is actually open right now … one row per open channel"*, in the page this PR edited to say a row means *registered, not open*; `packages/workforce/README.md:1479,1483,1762` the same | no | a pre-fix instance of cycle 16's class (see the scoring) |
| [#2073](https://github.com/fixpoint-labs/flow-state-dev/pull/2073) impl FIX-1515 (evidence) | impl | ~1 | merge 09-23 19:52Z | missed-edge-case ×1 (*vacuous-assertion*: the "same read with an org lands" half calls `act()` in-process and never crosses the transport door) · nit ×3 — *4 from 4*. **The P1 was open and unanswered at merge**; the only later commit is a typecheck fix | no | **#2141 then cited this leg as the re-proof of ER-DevForce** |

**Load: ~11 spent waves across the nine implementation artifacts, and 1 or 2 on every direction
artifact. None reached a third round.** **34 non-`nit` findings on the implementation artifacts, 12
of them *vacuous-assertion* (35%). All 12 are on artifacts that grade a claim** (goal checks and one
hire test: #2051, #2065, #2066, #2073, #2133). The three UI PRs (#2032, #2039, #2147) and #1958 carry
none. The ten direction artifacts carry ten more.

**Claims (looped / settled / verdicts):**
- **#2033: 1 / 1 / CONFIRMED.** The row-5 mechanism was wrong three times across #2033 and #2037,
  each time *"from reasoning about handlers instead of executing them"* (the author's own comment).
  The settlement confirmed that an org-scoped collection with a client read is served cross-org
  isolated, with a negative control, and **the recommendation's premise fell with it**. That is the
  designated cure working as written.
- **#2025: 1 / 0 / —.** The badge predicate was argued in both rounds (`mayWrite` → `!mayWrite` →
  two fields → `writable === false`) and settled by reading the store's refusal in
  `resource-registry.ts`, not by a POC. POC check 2b keeps the rejected predicate runnable.
- Every other direction artifact: 0 / 0 / —.

## The class — twelve assertions that passed on nothing, beside red controls

| Shape | Instances |
|---|---|
| An **absence** read as success | #2051 `no-harness` (read on an `in_progress` row) · #2065 V4 (a non-202 recorded as a note) |
| A **wait that did not require `completed`** | #2133's settle loop |
| **Presence read as exclusivity**, or a bound read as exact | #2051 BR-7's row count · #2065 BR-1's `> 2` |
| A **loop or read over whatever arrived** | #2065 V4's orphan loop · #2065 VB's empty body |
| An **outcome never asserted** | #2065 BR-10's decline · #2051 a row settled `completed` over rejected work |
| The **subject controls its grader** | #2051 `process.exit(0)` in the artifact |
| One axis of two | #2066 visibility |
| The positive half on a **different path** | #2073 `act()` beside a router refusal |

**Every one was folded with a red state named in the reply**, so the operation works once it is
aimed. Before review it was aimed at the leg. #2065 records five controls, each *"seen red at exactly
the leg it names"*. #2051's V5 has three controls that *"must all go red"*. #2066's `silent-park`
fails row 4. None of that reaches an assertion sitting beside the one the control breaks.

**Why the cycle 14 paragraph does not already reach it.** It lists *"a control or goal-check leg that
grades a run"* as a check with no before-state, and asks for *"which checks went red, and that nothing
else did"*. A control is itself one perturbation of one leg. An author who reports every control red
at its own leg has written that report in full, and every assertion the control did not break is
still unexamined. The paragraph never says what the unit of a check is, and the authors read it as the
leg.

## The recommended upstream fix A — one sentence in `issue-implement`'s blast-radius paragraph

After *"A check you cannot write that report for is not evidence yet."*:

> **The unit is the assertion, not the leg:** every outcome the leg claims maps to an assertion, and
> each assertion is shown able to fail — a control that reddens its leg proves neither, and an
> assertion that passes on an absence, on an empty loop, or on a state it never waited for stays
> green beside it.

It is mirrored in one line each into the contracts that are actually dispatched or enforced: the
Step 6 completeness gate, `implementer-prompt.md` and `spec-reviewer-prompt.md`. **Claim coverage is
in the same sentence because two of the ten instances were omitted assertions, not weak ones**
(#2065's decline was never asserted; #2051 never asserted that rejected work could not settle
`completed`). A per-assertion rule alone passes those vacuously.

**It clears the Step-3 gate.** *Generalizable*: any check with more than one assertion per control.
*Grounded*: ten review-filed instances on three carrying artifacts whose authors reported their
controls red (#2065 ×5, #2051 ×4, #2066 ×1). *Not already covered*: the paragraph never defines its
unit, and the authors resolved it to the leg. BP-003 is not the home, since cycles 14–16 measured
another sentence there at zero. *Altitude*: one sentence, in the paragraph this cycle is the first
real measurement of, plus its one-line mirrors. **What would change my mind:** if the next grading-heavy epic still shows
vacuous assertions on legs whose authors report per-assertion perturbations, the unit is not the gap
and the sentence should come out. **What being wrong costs:** one more sentence in a long paragraph,
and more perturbations on goals with many assertions per leg.

## Scoring the previous cycles' fixes and claims

**Cycle 14's fix (the blast radius), asked by ancestry.** `4e03bde0d` landed 2026-09-20T01:16Z. Every
first reviewed head carries it:

```
#1958 c3153620 CARRIES · #2032 802c0537 CARRIES · #2039 795b5509 CARRIES
#2051 c52f08b8 CARRIES · #2065 4abf4851 CARRIES · #2066 1315a183 CARRIES
#2133 ba55bf17 CARRIES · #2147 07d209fe CARRIES · #2073 c76ac596 CARRIES
```

- **Claim 1 (does the report catch a vacuous assertion before review?): no, on this sample.** 12
  review-filed on carrying heads, against cycle 14's pre-fix 17 review-filed. The practice is present
  at leg altitude and absent at assertion altitude. Fix A is aimed at that difference.
- **Claim 2 (does the class sit in the 30–40% band wherever code asserts?): yes.** 35%, a fourth
  point beside 41%, 18% (a documentation denominator) and 34%.
- **Claim 4 (is the class scoped to claim-grading artifacts?): yes, on a second sample.** 12 of 12 on
  goal checks and a hire test, and 0 on the three UI PRs and #1958.

**Cycle 15's fix B (sweeps on direction artifacts), asked by ancestry.** `7c29203be` landed
2026-09-23T20:27Z. #2138 (`2b8aa77e`) and #2141 (`5bcc5655`) carry it; nothing earlier in this epic
does.
- **Cycle 16 claim 2 (do the sweep reports appear by name?): yes, one of one.** #2141's first commit
  names a *"Stale-status sweep"* and the surfaces it moved, figures included. **It still left one
  factual echo inside the folder.** The checklist intro's *"no row below has been observed against a
  running hire"* uses none of the status words the sweep grepped for, and Codex found it. That is
  cycle 13's line again: sweep the citations, then read the claims that span them. One instance,
  recorded.

**Cycle 16's fix (the Step 5C pointer): no carrying artifact, so outside the sample.** `9a72790c8`
reached `main` in #2135 at 2026-09-24T17:54Z. #2147's first head (`07d209fe`, authored 18:27Z) and
last head (`b81acf5c`) were both **written after it and neither carries it**, the same timestamp trap
cycle 16 recorded on #2103. #2147 is a **pre-fix instance of the class** that fix targets. It taught
*registered, not open* in `inventory.md` and left that page's own description saying *open right
now*. Routed to this wrap's docs-polish pass.

**Cycle 16 claim 3 (do coordinator briefs carry facts the spec or tracker owns?): the threshold was a
third instance, and the artifacts show four.**

| Instance | Where it shows |
|---|---|
| D2's BP-031 hole, closed by FIX-1442 the day before | #2037's commit: *"The claim came from the epic coordinator off a stale checkout, not from the spec author"*. It reached five places in the spec set and two outside it |
| FIX-1515 carried as open | the coordinator's FIX-1496 comment (09-22 20:47Z) carries it; FIX-1515 went Done 09-23 19:52Z; #2141 (09-24) recorded PASS without it until Codex's P1 |
| FIX-1511 treated as open | a Linear comment at 09-24 16:50:32Z calls the fix working a *"third trigger"*; corrected at 16:50:57Z |
| ER-26 cited as on `main` while on draft #2033 | #2045's spec says *"not on `main` yet"*, the correction the worker made against the brief |

Cycle 16 named the home: one line in `epic-lifecycle`'s dispatch rules.

## The recommended upstream fix B — one bullet in `epic-lifecycle` → *Your requests are dispatched too*

> **A fact you write into a brief or a status line is read when you write it.** Read an issue's or a
> PR's state from Linear or GitHub at that moment; get a rule's merge state or what the code does
> from a fresh `scout` or worker lookup and cite its result — never from an earlier wake's record.

The code half goes through a lookup, not a coordinator read, because the same skill keeps the
coordinator to handles and status.

**It clears the Step-3 gate.** *Generalizable*: any coordinator relaying another system's state.
*Grounded*: the four instances above, plus cycle 16's two. *Not already covered*: BP-003 says a report
is a claim, which covers what a worker hands back. Nothing covers what the coordinator hands down,
and cycle 16 pre-registered this home for that reason. *Altitude*: one bullet in the skill the
coordinator runs. **What would change my mind:** a third epic where the stale facts come from workers
rather than the coordinator. **What being wrong costs:** one Linear read, or one scout lookup, per
brief.

## Candidates considered and dropped

- **A lifecycle for retained checks** (the coordinator's class 2). Four instances: #2023's
  `gap-check`, #2025's Check 1, #2032's golden-defect test and #2065's V7. Review caught three in
  their first round, and each fold added a retirement rule. One shipped and is filed (FIX-1562). This
  is the first cycle it appears, so it is recorded as a claim below, not minted.
- **Reasoning about handlers instead of reading them** (class 4). BP-003 already calls a careful
  reading a guess, and #2033's loop ended the way `settle-claim` prescribes. Nothing to add.
- **Workers escalating forks the spec already answers** (class 5). Three instances (#2045's A/B/C,
  #2065's refusal sign-off, #2051's red check read as a product fork). BP-041's don't-ask list covers
  it, and the coordinator absorbed all three before they reached the owner.
- **Sharpening BP-003 for the overclaim cluster** (#1958's body, #2039's tooltip and docs, #2037's
  replacement premise). Same reason as cycles 14–16.

## Filed, not proposed

- **#2073 merged with a P1 open and unanswered, and the epic then cited that leg as evidence.** The
  leg *"an org-less read is refused at the transport door while the same read with an org lands"*
  sends its positive half through `act()`, which never reaches `resolvePrincipal`
  (`goals/devforce-lab/lab/host.mts:553-585` on `main`). #2141 records ER-DevForce re-proved on that
  leg. Four Linear searches at collection time found no issue for it. The coordinator filed
  FIX-1564 at wrap (child of FIX-1457) and held the wrap on it. This is the third merge over an open P1 in three
  cycles (#1391, #2091, #2073), and the second on a PR a Cursor agent wrote outside `issue-implement`.
- **#2033 merged 71 s before its first automated review returned.** Cursor's four coherence findings
  landed on a merged PR, and #2141 later fixed the figures.

## Claims to test next cycle

1. **Does the per-assertion unit (fix A) move the grading artifacts?** Baseline: 12 of 34 non-`nit`
   implementation findings, all on claim-grading artifacts, 10 of them beside red controls.
2. **Does fix B stop stale owned facts in briefs?** Baseline: the four artifact-visible instances here.
3. **Do retained checks state a lifecycle?** Baseline: 4 instances, 3 caught by review in one round
   and 1 shipped (FIX-1562). Mint only if a second epic ships one.
4. **Does a named sweep still miss a claim that uses none of the swept words?** One instance (#2141).
5. **Cycle 16's 5C pointer is still unmeasured.** Score it on the next implementation PR whose head
   carries `9a72790c8`.

## Finding map

`T`-numbers are positions in each PR's review-thread list, oldest first. `+` joins threads collapsed
into one finding.

- **#1944** mee ×3: T11 · T12 · T13. stale-restatement ×2: T3 · T14. spec-ambiguity ×1: T1+T7+T8. philosophy-drift ×1: T2 (+ Cursor's review body, item 3). nit ×7: T4 · T5 · T6 · T9 · T10 · T15 · T16.
- **#2033** stale-restatement ×3: T2 · T6 · T7. spec-ambiguity ×1: T4. nit ×3: T1 · T3 · T5.
- **#2141** stale-restatement ×2: T1 · T2.
- **#1955** mee ×3: T6 · T7+T2 · T8. spec-ambiguity ×1: the Architect's SPEC citation, recorded in `dc60e57`'s message. nit ×4: T1 · T3 · T4 · T5.
- **#1957** spec-ambiguity ×3: T1+T5+T11 · T4 · T10. mee ×3: T9 · T12 · T13. over-engineered ×1: T2. nit ×4: T3 · T6 · T7 · T8.
- **#2025** design-off ×1: T1+T7+T12+T13+T14+T15. mee ×4: T8 · T9 · T10 · T2+T3. docs-miss ×1: T11. nit ×3: T4 · T5 · T6.
- **#2037** mee ×1: T4. docs-miss ×1: T2+T5. over-engineered ×1: T3. nit ×1: T1.
- **#2023** mee ×4: T9 · T11 · T6 · T3. spec-ambiguity ×1: T10. over-engineered ×3: T1 · T2 · T8. nit ×3: T4 · T5 · T7.
- **#2045** mee ×6: T4 · T8 · T9 · T12 · T13 · T14. design-off ×1: T7. spec-ambiguity ×1: T1+T6. philosophy-drift ×1: T10. stale-restatement ×1: the Architect review on `635dd3cda`. nit ×4: T2 · T3 · T5 · T11.
- **#2138** mee ×2: T1 · T2.
- **#1958** mee ×5: T1+T10 · T6 · T7+T8 · T9 · T11. over-engineered ×2: T12+T13 · T14. nit ×5: T2 · T3 · T4 · T5 · T15.
- **#2032** mee ×2: T6 · T3. docs-miss ×2: T5+T4 · T7. nit ×2: T1 · T2.
- **#2039** mee ×2: T5 · T6. docs-miss ×2: T7 · T8. nit ×4: T1–T4.
- **#2066** mee ×3: T1 · T9 · T10. nit ×7: T2–T8.
- **#2051** mee ×5: T7 · T8 · T9 · T10 · T6. stale-restatement ×1: T4. nit ×4: T1 · T2 · T3 · T5.
- **#2065** mee ×5: T6–T10. philosophy-drift ×1: T11. docs-miss ×1: the owner's figures comment. nit ×5: T1–T5.
- **#2133** mee ×1: T4+T2. nit ×2: T1 · T3.
- **#2147** mee ×1: T2. nit ×1: T1.
- **#2073** mee ×1: T4 (open at merge). nit ×3: T1–T3.

**Implementation non-`nit`:** 7 + 4 + 4 + 3 + 6 + 7 + 1 + 1 + 1 = **34**. *Vacuous-assertion*:
#2051 4 · #2065 5 · #2066 1 · #2133 1 · #2073 1 = **12**.
