# Cycle 20 — hard-gates-before-public-release epic wrap (FIX-1635) (2026-10-01)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**Three implementation PRs carried two thirds of the epic's review load, and all three were the
same loop.** #2393 (FIX-1647), #2430 (FIX-1654) and #2405 (FIX-1634 PR-A) took 37 of the 57 fix
waves and 88 of the 131 non-`nit` implementation findings. Most of those findings are an
interleaving: a read and a later act on a request whose id another run, another process or a new
owner can change in between. Each fix narrowed one gap, and the next review found the next one,
often worded *"fresh evidence beyond the earlier fix"*. The closing fix was the same every time: an
operation the store contract does not have. That is an incarnation-conditional terminal write, a
per-attempt id that crosses processes, or a sidecar namespace. FIX-1665 was filed for exactly that
at 09-30 02:00Z. #2430 opened nine minutes later and still ran twelve rounds on one structure, the
abort controller's identity across an incarnation hand-off, before its first deferral to FIX-1665.
That deferral came on round twelve. Cycle 19 recorded two long tails of the same shape (#2319 and
#2320) and dropped them as "one of each". With three more, the class recurs.

**Method — scope.** Twenty-one reviewed artifacts. They were found from FIX-1635's sixteen Linear
children and their attachments, read over GraphQL, and from a listing of every repository PR
opened since 09-28 matched on the epic id and each child id. The artifacts are:
- the epic PR #2360 and its amendment #2464;
- four issue specs: #2380 (FIX-1634), #2385 (FIX-1286), #2415 (FIX-1654) and #2521 (FIX-1636, the
  closure);
- fifteen implementation PRs, the closure #2543 among them.

The bug children have no spec PR, by the bug route. **Out of the sample:**
- POCs #2379, #2386 and #2409, which closed unreviewed and were adopted into #2378, #2384 and
  #2405.
- #1469 and #1470 (FIX-1256 and FIX-1261), merged 08-26, five weeks before the epic opened. Those
  children closed on verification.
- #2359, the project spec.
- #2368, #2369–#2374, #2402, #2403 and #2410, which belong to the keeping-flows-alive epic and only
  name FIX-1634.
- #2459 and #2527, which are not children.

FIX-1665 is listed as a child in #2464's set table, but it has no Linear parent now and no PR. Every
review, review thread, conversation comment, commit list and timeline was read through the GitHub
REST API. **Endpoints and rounds** follow cycle 19 unchanged:
- Direction artifacts end at the human direction approval, which here is the owner's merge on all
  six.
- Implementation rounds are spent fix waves. For the three long PRs the row also gives the number of
  heads Codex reviewed, because the twelve-round cap counts rounds *handled*, which the PR data
  cannot see directly.
- A second-look or Architect conversation comment is read as one review body. Its items are itemized
  where they were folded (`SL1`…).

**Every act sits behind the shared `jhoffner` login**, and this entry does not guess who pressed
what.

| PR | Kind | Rounds | Endpoint | Feedback classes (deduped) | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#2360](https://github.com/fixpoint-labs/flow-state-dev/pull/2360) epic-spec FIX-1635 | epic | ~1 | approval = merge 09-29 19:37Z | over-engineered ×4 (leg a as a standing CI job · leg b's re-proof of old commits · rule trim · the duplicate docs draft) · missed-edge-case ×3 (an unpinned control · the generator leg undefined · ER-10 against the create-if-absent contract) · stale-restatement ×1 (Codex P1: leg b contradicted D3) · docs-miss ×1 (Codex P1: request id stops being a capability, now an EVOLUTION row) · spec-ambiguity ×1 · nit ×5 — *10 from 15* | no | — |
| [#2464](https://github.com/fixpoint-labs/flow-state-dev/pull/2464) epic amendment (joiners) | epic (amendment) | **0** | **merged 09-30 20:25:11Z, 42 s after it opened and before any automated review** | spec-ambiguity ×1 (Codex P1 and the second look: whether FIX-1665 gates the closure, left in a table cell) · stale-restatement ×2 (the set-table anchor, still broken on `main` at `PLAN.md:39` · "ten open" and "twelve" in figures) · over-engineered ×1 (the table used as a status board) · nit ×5 — *4 from 9*. **All seven threads unanswered** | — | merge-ready rule (filed) |
| [#2380](https://github.com/fixpoint-labs/flow-state-dev/pull/2380) spec FIX-1634 | spec | **2** | approval = merge 09-29 21:56Z | missed-edge-case ×6 (Codex P1 ×3: places not renewed off-slot · old workers on place-bearing jobs · the webhook duplicate ack · 1 *vacuous-assertion*: P2 bypassed the real `{ id }` envelope) · spec-ambiguity ×2 · design-off ×1 (SL5: policy split from the lease backend, D2 re-expressed) · over-engineered ×1 · docs-miss ×1 · stale-restatement ×1 (every authoritative concurrency contract) · nit ×1 — *12 from 13* | no | — |
| [#2385](https://github.com/fixpoint-labs/flow-state-dev/pull/2385) spec FIX-1286 | spec | ~1 | approval = merge 09-29 21:22Z | design-off ×1 (Codex P1 and SL4: a `createdAt` key collides within a millisecond, so D1 moved to a random incarnation token) · missed-edge-case ×4 (the same-owner creation race · a missed consumer · 1 *vacuous-assertion*: the evicted leg's setup) · over-engineered ×2 · spec-ambiguity ×1 · nit ×2 — *8 from 10* | no | — |
| [#2415](https://github.com/fixpoint-labs/flow-state-dev/pull/2415) spec FIX-1654 | spec | ~1 | approval = merge 09-30 01:34Z | missed-edge-case ×2 (Codex P1: fence the in-process fire · the integration scenario) · philosophy-drift ×1 (SQLite's type-only engine boundary) · nit ×6 (all recorded as implementer notes) — *3 from 9* | no | — |
| [#2521](https://github.com/fixpoint-labs/flow-state-dev/pull/2521) spec FIX-1636 (closure plan) | spec | ~1 | approval = merge 10-01 00:41Z | over-engineered ×4 · missed-edge-case ×4 (`--control` parse · skip semantics · unpinned consumer versions · the POC's Linear errors) · spec-ambiguity ×2 (SL1: the resolution guard's mechanism) · stale-restatement ×1 (part 2 still in the sequence) — *11 from 11*. **No Codex: usage limit at 23:24Z** | no | — |
| [#2376](https://github.com/fixpoint-labs/flow-state-dev/pull/2376) impl FIX-1431 | impl | 1 | merge 09-29 22:29Z | missed-edge-case ×3 (**2 *vacuous-assertion***: a crashed import counted as a pass · an optional-peer import accepted on any throw) · over-engineered ×1 · nit ×3 — *4 from 7*. Merged head `3e4e0c6` unread | no | — |
| [#2377](https://github.com/fixpoint-labs/flow-state-dev/pull/2377) impl FIX-1018 | impl | 1 | merge 09-29 21:38Z | missed-edge-case ×2 (Codex P1 and Bugbot High: two principals racing on an unused id both acked) · docs-miss ×1 (*overclaim*: the `x-request-id` header) · nit ×2 — *3 from 5*. Merged head `71f036a` unread | no | — |
| [#2378](https://github.com/fixpoint-labs/flow-state-dev/pull/2378) impl FIX-1334 | impl | 1 | merge 09-29 22:31Z | over-engineered ×2 (one with Code Snob's POC #2379) · missed-edge-case ×1 (*vacuous-assertion*: a bundle-referenced asset could be missing) · nit ×4 — *3 from 7*. Merged head `df752e0` unread | no | — |
| [#2381](https://github.com/fixpoint-labs/flow-state-dev/pull/2381) impl FIX-1628 | impl | 3 | merge 09-29 22:21Z | docs-miss ×4 (the changeset · the resume exception · 2 *overclaim*: the join claim narrowed twice, then audited) · nit ×5 — *4 from 9*. Terminal clean pass on the merged head | no | — |
| [#2383](https://github.com/fixpoint-labs/flow-state-dev/pull/2383) impl FIX-1328 | impl | 1 | merge 09-29 22:24Z | missed-edge-case ×1 (*vacuous-assertion*: a fixed sleep under a negative assertion) · nit ×2 — *1 from 3* | no | — |
| [#2384](https://github.com/fixpoint-labs/flow-state-dev/pull/2384) impl FIX-1022 | impl | 1 | merge 09-29 21:38Z | missed-edge-case ×4 (Codex P1: user mismatches settled a stranger's row · queued admission · debug and legacy probes) · over-engineered ×1 (POC #2386 adopted) · nit ×1 — *5 from 6*. Merged head `df771cd` unread | no | — |
| [#2387](https://github.com/fixpoint-labs/flow-state-dev/pull/2387) impl FIX-1021 | impl | 1 | merge 09-29 21:38Z | missed-edge-case ×2 (legacy masking · **abort's check and write split across an id reuse, fenced on `createdAt`**, which FIX-1654 replaced) · docs-miss ×1 (the changeset) · nit ×3 — *3 from 6*. Merged head `fb6ac0e` unread | no | — |
| [#2389](https://github.com/fixpoint-labs/flow-state-dev/pull/2389) impl FIX-1046 | impl | 5 | merge 09-29 22:26:57Z; **a Codex P2 landed on the merged head 3 min later, unanswered** | docs-miss ×4 (the changeset · 3 *overclaim*, each one a narrowing of the last) · stale-restatement ×2 · missed-edge-case ×2 (Codex P1: replay after record GC · T12 post-merge) · spec-ambiguity ×1 (401 vs 404, escalated to the owner) · over-engineered ×1 · nit ×2 — *10 from 12* | no | — |
| [#2393](https://github.com/fixpoint-labs/flow-state-dev/pull/2393) impl FIX-1647 | impl | **16 waves · 15 Codex heads · cap reached** | merge 09-30 20:21Z on a merge of `main`; last read `8fd1fdc` | **missed-edge-case ×32** (about twenty interleavings: deletes racing appends, retention racing a finishing run, finalization across overlapping attempts, three deferred to FIX-1665 on rounds 12–14) · docs-miss ×6 (the changeset ×2) · stale-restatement ×2 · nit ×2 — *40 from 42* | **yes** — ended at the cap with the cross-process half deferred | **the proposal** |
| [#2400](https://github.com/fixpoint-labs/flow-state-dev/pull/2400) impl FIX-1286 | impl | 2 | merge 09-29 22:37Z | docs-miss ×2 (the changeset's bump and length) · nit ×3 — *2 from 5*. Terminal clean pass on the merged head | no | — |
| [#2405](https://github.com/fixpoint-labs/flow-state-dev/pull/2405) impl FIX-1634 PR-A | impl | **10 waves · 12 Codex heads** | merge 09-30 20:20Z on a merge of `main`; last read `9f0407e` | missed-edge-case ×19 (renewal, give-back and ordering across a shared backend · T29–T33 after merging FIX-1654's fence, T33 deferred to FIX-1665) · stale-restatement ×6 (the concurrency contract restated across docs, atlas and the host contract) · over-engineered ×3 (POC #2409 adopted) · docs-miss ×2 · philosophy-drift ×1 (concurrency imports route shaping) · nit ×2 — *31 from 33*. **Clean at `b426320` (round 9); merging `main` reopened three rounds** | **late** — the cap's same objection after the merge | **the proposal** |
| [#2416](https://github.com/fixpoint-labs/flow-state-dev/pull/2416) impl FIX-1648 | impl | 2 | merge 09-30 18:41Z | missed-edge-case ×1 (Codex P1: the listing used a narrower filter) · docs-miss ×1 (the changeset) · over-engineered ×1 · nit ×3 — *3 from 6*. Terminal clean pass on the merged head | no | — |
| [#2430](https://github.com/fixpoint-labs/flow-state-dev/pull/2430) impl FIX-1654 | impl | **12 (cap): 11 waves · 11 Codex heads** | merge 09-30 18:40Z; last read `8cc7ca6`, merged `86d04f2` (the round-12 fix) unread | **missed-edge-case ×13**: twelve interleavings on one structure, the abort controller across an incarnation hand-off (T5–T19), and 1 *vacuous-assertion* (T10) · docs-miss ×3 (the changeset · the cancellation topology ×2) · over-engineered ×1 · nit ×3 — *17 from 20* | **yes** — first deferral to FIX-1665 at round 12, 2 h 24 min after the issue existed | **the proposal** |
| [#2507](https://github.com/fixpoint-labs/flow-state-dev/pull/2507) impl FIX-1634 PR-B | impl | 1 | merge 09-30 23:09Z | missed-edge-case ×2 (Bugbot: a wait-time loss aborts a held turn · a completed run failed on late lease loss) · over-engineered ×1 · nit ×1 — *3 from 4*. **No Codex (usage limit 21:27Z); Bugbot read `87d18c5` once, then ran out at 22:10Z.** Merged head `f58d779` unread | no | reviewer exhaustion (filed) |
| [#2543](https://github.com/fixpoint-labs/flow-state-dev/pull/2543) closure FIX-1636 | impl (closure) | 1 | merge 10-01 16:57Z | over-engineered ×2 (a shared vitest runner · one scan) · nit ×3 — *2 from 5*. **No Codex, no Bugbot (both at their limits).** Cursor's simplify and Code Snob and the second look read `7a8b666`; merged head `0007b6e` unread | no | reviewer exhaustion (filed) |

**Load.** 57 fix waves across the 15 implementation artifacts, and 131 non-`nit` findings.
**#2393, #2405 and #2430 carry 88 of the 131 and 37 of the 57 waves.** Without them the other
twelve average 3.6 findings and 1.7 waves (cycle 19 without its two tails: 2.5 and 1.6). Five of
the 131 are *vacuous-assertion*, or 4% (cycle 19: 10%). The six direction artifacts carry 48
non-`nit` findings, 8.0 each. One reached a second round (#2380) and none reached a third.
Stale-restatement is 5 of the 48 (cycle 19: 11 of 113). Across all 179 non-`nit` findings:
missed-edge-case is 101 (56%), docs-miss 26, over-engineered 25, stale-restatement 15,
spec-ambiguity 8, design-off 2 and philosophy-drift 2. Nine of the implementation docs-misses are in a
`.changeset/*.md` fragment, seven of them the same Codex P1 (*"condense to one sentence"*).

**Claims (looped / settled / verdicts):** 0 / 0 on every artifact. No `settle-claim` ran. The
looping on #2393, #2405 and #2430 is not a claim argued twice. Every finding was accepted as real.
The loop was in the fixes.

## The class: a race fixed one window at a time

| PR | Waves · Codex heads | Interleaving findings | When the closing primitive had a home | First deferral to it |
|---|---|---|---|---|
| #2393 FIX-1647 | 16 · 15 | about 20 of 32 `mee` | FIX-1665 filed 09-30 02:00Z, during wave 12 | T33 and T35 at 02:09Z (wave 13), T38 at 02:50Z |
| #2430 FIX-1654 | 11 · 11 | **12 of 13 `mee`, all on one structure** | **before the PR opened** (02:09Z) | T18 at 04:24Z, round 12 |
| #2405 FIX-1634 A | 10 · 12 | about a dozen of 19 `mee` | the same | T33 at 09-30 19:30Z, the third round after merging FIX-1654 |

**What #2430's twelve rounds were.** The spec (#2415) fenced the abort route's write on the
request's incarnation. Every later finding was a place where a controller, a stored cancel or a
queued gate still knew the request only by its id:
- T5: tag the queued controller as soon as the record is claimed.
- T6: bind the controller to the record actually adopted.
- T8: fence the catch-up read.
- T9: rebind at the gate hand-off.
- T11: reset cancellation on adoption.
- T13: poll after claim-time adoption.
- T14: keep an unfenced abort across adoption.
- T15: keep it after a fenced fire.
- T16: keep fenced-fire provenance after displacement.
- T17: fence the gate to its tagged incarnation.
- T18: make the queued terminal write incarnation-atomic.
- T19: keep the fence through adoption.

T18 is the one the author could not close. Its reply says why: *"today's conditional write
(`setFieldsIfStatus`) deliberately excludes `status`… It's tracked in FIX-1665."* FIX-1665's
description, written two hours earlier, already named the structure: *"Abort controllers are keyed
by request id alone (`abort-registry.ts`)."*

**Why nothing caught it before round twelve.**
- **Every finding was real**, and each fix was correct for the window it closed. Under `issue-implement`
  10.3 each one is *actionable code feedback*, and 10.4 says make the change. Nothing in the loop asks
  whether the change closes the class or only this instance of it.
- **10.3 already has the trigger for shape, not for races.** *"A second 'why is it shaped like this' on
  one surface is a model question, not a wording one"* sends the author back to the spec on the second
  ask. A second race on one structure has no equivalent.
- **The cap fires at twelve by design.** It is a loop detector (`orchestration.md` → *PR feedback: the
  round cap*), and it did its job: all three PRs stopped there or deferred there. But its step 3 asks the
  agent to *"name the suspected loop"*, so the loop is first named at the cap. Neither #2393 nor #2430
  carries the pause comment that step 2 requires. They merged 17 h and 14 h after their last round.
- **BP-035's *concurrent / duplicate calls*** bullet tells the author to handle concurrency. It does not
  say how to tell a fix that closes a race from one that moves it.

**Is the class recurring?** Cycle 19 recorded #2319 (8 waves; three races on a seat-side claim,
ended by the redesign in #2324) and #2320 (11 waves, one short of the cap; late tenancy and identity
edges). It dropped both as *"one of each, and neither points at a spec-altitude miss."* It was right
that the miss is not at spec altitude. #2415's spec review found the in-process fire, and #2385's
found the incarnation itself within the round. The miss is in the feedback loop, which is where the
proposal goes.

## The recommended upstream fix — one trigger in `issue-implement` 10.3

One paragraph, placed beside the existing *model question* trigger in 10.3:

> **A second race on the same structure is a missing primitive, not another window.** When a finding is
> an interleaving — a read and a later act on state another run, process or reused id can change in
> between — and the fix you can make narrows the gap rather than closing it (a re-read, a tag, an extra
> check), the next round will find the next gap. On the second such finding against the same structure,
> name the atomic operation the closing fix needs (a conditional write, a per-attempt id, a namespace),
> file it or point to the issue that already holds the class, and answer this thread and every later one
> on that structure there. In this PR, fix only the gaps the existing primitives can close.

**It clears the Step-3 gate.**
- *Generalizable*: any concurrency fix under multi-reviewer review, in any package.
- *Grounded*: #2430's twelve rounds on one structure, with the primitive's issue open from round 0;
  #2393's sixteen waves; #2405's three reopened rounds; and cycle 19's #2319 and #2320.
- *Not already covered*: BP-035 names the path but not the stop. The cap stops at twelve. 10.3's
  model-question trigger covers shape, not races.
- *Altitude*: a skill checklist line, the fourth rung. It sits in the step where each finding is
  classified, which is where #2430 kept classifying each one as *actionable*. It is not a BP. It
  changes no tenet.

**What would change my mind:** the next race-heavy PR names its primitive by round 3 and still runs
long on findings that the existing primitives *could* close. Then the cost is review depth, not
looping, and the line does nothing. **What being wrong costs:** one paragraph. The risk is that an
author defers a race that a re-read would have closed. The line limits deferral to the second finding
on one structure, and fixing what existing primitives can close stays mandatory.

**What it would not have caught:** the docs tails. #2389 (T8–T11) and #2381 (T8–T9) narrowed one
claim per round until the author audited every statement of it. That is cycle 15's second-order
correction. Fix B there (*name the sweeps*) applied, and the audits eventually ran.

## Candidates considered and dropped

- **A spec-altitude rule: a decision that makes an id reusable owes an inventory of what is keyed on
  it.** D3 made a caller's request id a reusable address (#2360 T9 recorded the retired capability). The
  identity primitive was found at spec time within hours: #2385 T6 replaced `createdAt` with an
  incarnation token, and FIX-1654 was filed the same night. What took twelve rounds was atomicity across
  processes, not identity. That needs a store operation, not an inventory.
- **Sharpening BP-035 with a "freed-and-reused id" bullet.** This would add a line to a universal
  checklist for a case the specs already found. The cost was in the loop, not in the first pass.
- **The changeset fragment (nine findings, seven of them the same one-sentence P1).** Cycle 15's reason
  holds: Codex recited `release-notes-workflow.md` correctly at every instance. The rule is mechanical,
  so the remedy is a guard. See *Filed*.
- **The docs narrowing tails on #2389 and #2381.** These are covered by cycle 15's fix B, and the authors
  ran the audit. Carry.

## Filed, not proposed

- **Reviewer exhaustion is invisible to the merge-ready rule.** Codex hit its usage limit at 09-30 21:27Z
  and Bugbot at 22:10Z. #2507 is the cross-process lease backend, PR-A's partner, and PR-A drew twelve
  Codex rounds. #2507 got no Codex pass and one Bugbot pass, which found two races. Its fix commit was
  never read by a correctness reviewer. #2521 and #2543 got neither bot. `issue-implement` and
  `orchestration.md` (*A merge-ready head has been reviewed*) accept "Codex or Cursor". Cursor's
  simplify and Code Snob automations ran throughout, so a PR whose correctness reviewers were out still
  reads as reviewed. **The decision is the owner's: buy capacity, or name which automation counts as a
  correctness pass.**
- **#2464 merged 42 s after it opened, before any automated review.** It is the first such merge since
  cycle 18's enforcement (cycle 19: 0 of 34). All seven threads are unanswered. One is a Codex P2 whose
  defect is still on `main`: `specs/epics/FIX-1635/PLAN.md:39` links `SPEC.md#the-set--as-of-2026-09-29`,
  and the heading now reads *as of 2026-09-30*. The Codex P1 on whether FIX-1665 gates the closure did
  reach the owner through FIX-1636's spec (`DECISIONS.md:95`: *"the owner's question on it is open, and
  the recommendation is to close the epic without it"*).
- **#2389 merged 3 min before a Codex P2 landed on its merged head** (T12, legacy singleton requests in
  flow-scoped reads), and nothing answers it. Merging over an open finding recurs; cycles 15–19 each
  recorded one.
- **The cap's step 2 did not happen.** There is no pause comment on #2393, #2430 or #2405, and the two
  capped PRs merged 17 h and 14 h after their last round. The owner's direction may have come through
  another channel, but the PR does not record it.
- **A changeset-length guard.** `scripts/validate-changeset-refs.mjs` already parses every fragment a
  PR adds or edits. Failing a body that is longer than one sentence would have caught seven P1s here,
  #2118 in cycle 16, and #1391 and #1396 in cycle 15.
- **`Process guards` was red on every PR in the epic** because #2359 merged a project spec to `main`.
  About one *"not caused by this PR"* comment per artifact followed until `9185ad9` ported #2392's removal onto `main`.

## Scoring the previous cycles' fixes and claims

```
d50a3a6 (cycle 19's control-unit convergence, on main 09-29 12:00Z):
  #2521 first head 34363df CARRIES · #2543 first head 7a8b666 CARRIES
```

- **Cycle 19's claim 1 (does converging the control unit move the plan and the first head?):
  partly, and confounded.**
  - #2521's new control row names its signal: *"the resolution check must fail"*. Its sequence figure
    still says *"must FAIL · names its leg"* (`SPEC.md:43`), one leg restatement left over.
  - #2543's first head drew no *vacuous-assertion* finding, against seven on #2348. Its author reports
    the control caught the guard passing on a swapped symlink on the first local run.
  - Neither Codex nor Bugbot read #2543, so the zero is from a thinner review than #2348 had.
  - Across the epic, *vacuous-assertion* is 4% of implementation findings (cycle 19: 10%).
  - Carry for one unconfounded instance.
- **Cycle 19's claim 2 (do folds after the last pass cost anything?): not derivable, and the count
  rose.**
  - 10 of 15 merged implementation PRs merged a head no automated reviewer read: #2376, #2377, #2378,
    #2384, #2387, #2393, #2405, #2430, #2507 and #2543 (cycle 19: 9 of 17).
  - Two are reviewer exhaustion. Two are a merge of `main` after the cap. #2430's unread head is its
    round-12 fix.
  - Carry.
- **Cycle 19's claim 3 (checks keyed to a spelling or an intermediate shape): 0 instances.** Hold.
- **Cycle 18's claim 3 (a worker that cannot dispatch).** The bodies of #2400 and #2507, and a reply on
  #2377, say the docs agents could not be dispatched. Carry. Claim 2 is still not derivable.

## Claims to test next cycle

1. **Does the primitive trigger cut race tails?** Baseline: #2430 ran twelve rounds on one structure
   with the primitive's issue open from round 0. #2393 ran 16 waves and #2405 ran 10. For the next PR
   with two or more interleaving findings on one structure: is the primitive named by round 3, and is
   the PR's wave count under five?
2. **Reviewer exhaustion.** Count artifacts merged with no correctness-bot pass on any head. Baseline: 3
   (#2507, #2521 and #2543).
3. **Changeset length.** Baseline: 7 of the 15 implementation PRs drew the one-sentence P1. If a guard
   lands, the count should be zero.
4. **Cycle 19's claims 1 and 2, and cycle 18's claim 3,** carry forward unchanged.

## Finding map

`T`-numbers are positions in each PR's review-thread list, oldest first. `+` joins threads collapsed
into one finding. *vac* is *vacuous-assertion*. *SL* is an item of a second-look body. *mee* is
missed-edge-case.

- **#2360** over-engineered ×4: SL1+T1 · SL3 · T4 · T5. mee ×3: SL2 · T7 · T8. stale-restatement ×1: T6. docs-miss ×1: T9. spec-ambiguity ×1: T11. nit ×5: SL4 · SL5 · T2 · T3 · T10.
- **#2464** spec-ambiguity ×1: T6+SL3. stale-restatement ×2: T7 · SL2. over-engineered ×1: SL1. nit ×5: T1+SL4 · T2 · T3 · T4 · T5.
- **#2380** mee ×6: T2+SL2 · T3 · T4 (vac) · T5+SL1 · T6 · T7. spec-ambiguity ×2: T8 · SL3. design-off ×1: SL5. over-engineered ×1: T1. docs-miss ×1: T9. stale-restatement ×1: T10. nit ×1: SL4.
- **#2385** design-off ×1: T6+SL4. mee ×4: T2 · T5+T7 · SL1 · SL3 (vac). over-engineered ×2: T1 · SL5. spec-ambiguity ×1: SL2. nit ×2: T3 · T4.
- **#2415** mee ×2: T7 · T8. philosophy-drift ×1: T9. nit ×6: T1–T6.
- **#2521** over-engineered ×4: T1 · T3 · T5 · SL5. mee ×4: T6 · SL2 · SL3 · SL4. spec-ambiguity ×2: T2 · SL1. stale-restatement ×1: T4.
- **#2376** mee ×3: T5 · T6 (vac) · T7 (vac). over-engineered ×1: T1. nit ×3: T2–T4.
- **#2377** mee ×2: T1+T6 · T4. docs-miss ×1: T2. nit ×2: T3 · T5.
- **#2378** over-engineered ×2: T1 · the Code Snob review. mee ×1: T6 (vac). nit ×4: T2–T5.
- **#2381** docs-miss ×4: T5 · T6 · T8 · T9. nit ×5: T1–T4 · T7.
- **#2383** mee ×1: T1 (vac). nit ×2: T2 · T3.
- **#2384** mee ×4: T3+T4 · T5 · T6 · T7. over-engineered ×1: T1+T8. nit ×1: T2.
- **#2387** mee ×2: T2 · T3. docs-miss ×1: T1. nit ×3: T4–T6.
- **#2389** docs-miss ×4: T5 · T9 · T10 · T11. stale-restatement ×2: T6 · T8. mee ×2: T4 · T12. spec-ambiguity ×1: T7. over-engineered ×1: T1. nit ×2: T2 · T3.
- **#2393** mee ×32: T1 · T2 · T5–T7 · T9–T20 · T23 · T24 · T26–T29 · T32–T39 · the review-body P1 on `811f4a2` (runOnce sidecar prefix). docs-miss ×6: T8 · T21 · T25 · T30 · T31 · T41. stale-restatement ×2: T22 · T40. nit ×2: T3 · T4.
- **#2400** docs-miss ×2: T4 · T5. nit ×3: T1–T3.
- **#2405** mee ×19: T6–T10 · T13–T17 · T20–T23 · T27 · T29 · T30 · T32 · T33. stale-restatement ×6: T18 · T24 · T25 · T26 · T28 · T31. over-engineered ×3: T1 · T2 · T12. docs-miss ×2: T11 · T19. philosophy-drift ×1: T5. nit ×2: T3 · T4.
- **#2416** mee ×1: T1+T3. docs-miss ×1: T2. over-engineered ×1: T5. nit ×3: T4 · T6 · T7.
- **#2430** mee ×13: T5 · T6 · T8–T11 (T10 vac) · T13–T19. docs-miss ×3: T7 · T12 · T20. over-engineered ×1: T1. nit ×3: T2–T4.
- **#2507** mee ×2: T3 · T4. over-engineered ×1: T1. nit ×1: T2. The second look's items are not itemized.
- **#2543** over-engineered ×2: T2 · T4. nit ×3: T1 · T3 · T5.

**Implementation non-`nit`:** 4 + 3 + 3 + 4 + 1 + 5 + 3 + 10 + 40 + 2 + 31 + 3 + 17 + 3 + 2 =
**131** (in table order), of which *vacuous-assertion* 5. **Direction non-`nit`:** 10 + 4 + 12 + 8 +
3 + 11 = **48** (in table order), of which stale-restatement 5 and *vacuous-assertion* 2.
