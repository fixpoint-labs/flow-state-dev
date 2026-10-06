# Cycle 21 — Shift Manager lab shell epic wrap (FIX-1649) (2026-10-04)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**Review was cheap. The closure did the expensive work, and it did it on the path the rules give
it.** No direction artifact took a second round, and no implementation PR took more than two fix
waves (29 waves over 29 PRs; cycle 20: 57 over 15). The rework the epic is remembered for came from
closure runs, not from review:
- three controls that went WRONG on the closure's first run (FIX-1732, FIX-1733, FIX-1734);
- a re-run on 10-04 that found three child checks and one closure leg broken by merges to `main`;
- Codex's first read of the closure runner, which found that `GOAL_PART=bogus` printed PASS with 0
  verdicts.

Each one was found by the instrument that is meant to find it. Each one cost one fix wave or one
re-run. The three broken controls repeat cycle 19's three shapes one for one. That is the
finding this entry records. It is not yet a proposal, because the earliest point that can see each
one is the closure's own control run (see *Candidates considered and dropped*). **Proposal skipped.**

**Method — scope.** Forty-seven reviewed artifacts. They were found from FIX-1649's 35 Linear
children (read over GraphQL) and from a listing of every repository PR opened since 09-25, matched
on the epic id and each child id in the title or branch:
- the epic PR #2421 and three amendments: #2423, #2619, and #2648 (FIX-1737's spec, which also
  amends the epic);
- fourteen issue specs and spec amendments: #2424, #2425, #2426, #2428, #2434, #2436, #2437, #2438,
  #2439, #2440, #2525, #2592 (the closure plan's amendment), #2614 and #2616;
- twenty-nine implementation PRs, the closure #2709 among them.

**Out of the sample:**
- POCs #2442, #2446, #2452, #2534, #2542, #2545, #2642 and #2711. Each one is a Code Snob or
  simplify subtraction that its parent PR adopted or declined. None was reviewed on its own. #2642
  is still open.
- #2420, the project spec.
- #2498 (FIX-1682), #2549 and #2569 (FIX-1701), #2603 and #2611 (FIX-1717), #2613, #2652 and #2678
  (FIX-1719), #2625 and #2687 (FIX-1718), #2633, #2643, #2661, #2686, #2701 and #2702. These name a
  child in their body but belong to other issues. #2678 carries two FIX-1735 commits (`1f2dadd45`
  and `f23ae7c78`) after #2654 merged. They are recorded under *Filed*, not scored.
- FIX-1671, FIX-1673, FIX-1675 and FIX-1705, children with no PR (Backlog or Todo at wrap).

Every review, review thread, conversation comment, commit list and changed-file list was read
through the GitHub REST API. **Endpoints and rounds** follow cycle 20 unchanged:
- Direction artifacts end at the human direction approval, which is the owner's merge on all
  eighteen.
- Implementation rounds are spent fix waves: pushes that answer a review, counted once per batch.
- A second-look or Architect body is read as one review body. Its items are counted only where the
  author's reply names them as folded (`SL1`…), with the class of each folded item.
- A suggestion the author declined with a reason is a `nit`. A suggestion taken is classed by what
  it changed.

**Every act sits behind the shared `jhoffner` login**, and this entry does not guess who pressed
what.

| PR | Kind | Rounds | Endpoint | Feedback classes (deduped) | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#2421](https://github.com/fixpoint-labs/flow-state-dev/pull/2421) epic-spec FIX-1649 | epic | ~1 (+ the owner's D3 answer and design hand-back v1, not rounds) | approval = merge 09-30 01:33Z | design-off ×1 (SL1: ER-6 and D2 collided with how `@flow-state-dev/ui` ships, so D2 now names two shelves) · spec-ambiguity ×3 (SL2: "opens by configuration alone" while trees carry code · T1+T7: the plan assumed the open fork's answer · T4: leg c open-ended) · over-engineered ×1 (SL3: a second full theme whose only consumer was the proof) · nit ×4 — *5 from 9* | no | — |
| [#2423](https://github.com/fixpoint-labs/flow-state-dev/pull/2423) epic amendment (workstream ownership) | epic (amendment) | ~1 | approval = merge 09-30 16:53Z | stale-restatement ×1 (Codex P2: the boundary summary kept the old owner) · nit ×1 — *1 from 2* | no | — |
| [#2619](https://github.com/fixpoint-labs/flow-state-dev/pull/2619) epic amendment (design v2) | epic (amendment) | ~1 | approval = merge 10-01 19:31Z, 33 min after it opened | stale-restatement ×4 (the `labs/app-lab` path after the rename · EVOLUTION still said *blocking* · an open item already answered · the path figure) · nit ×2 — *4 from 6*. **No Codex: usage limit** | no | — |
| [#2648](https://github.com/fixpoint-labs/flow-state-dev/pull/2648) spec FIX-1737 (+ epic amendment) | spec | ~1 | approval = merge 10-02 20:38Z | missed-edge-case ×4 (Codex P2 ×4: require every expected row to render (*vacuous-assertion*) · keep the CoS look check provider-free · gate completion on all three slices · run both leg-d controls in the closure) · over-engineered ×1 (two hand-kept classifiers, now `scope.json`) · nit ×5 — *5 from 10* | no | — |
| [#2424](https://github.com/fixpoint-labs/flow-state-dev/pull/2424) spec FIX-1662 | spec | ~1 | approval = merge 09-30 16:55Z | missed-edge-case ×3 (Codex P1 ×2: an identity probe · an org-wide read for every seat's asks; P2: board grouping) · over-engineered ×1 (T4+SL: PR sizing) · stale-restatement ×1 (four PRs against a three-PR figure) · nit ×3 — *5 from 8* | no | — |
| [#2425](https://github.com/fixpoint-labs/flow-state-dev/pull/2425) spec FIX-1655 | spec | ~1 | approval = merge 09-30 16:52Z | missed-edge-case ×3 (Codex P1: register every component before token dependencies · P2 ×2: literal colours in the census, the shadow-free theme) · spec-ambiguity ×1 (the denied-state token) · nit ×9 (8 Cursor notes unanswered) — *4 from 13* | no | — |
| [#2426](https://github.com/fixpoint-labs/flow-state-dev/pull/2426) spec FIX-1663 (closure plan) | spec | ~1 | approval = merge 09-30 16:44Z | missed-edge-case ×2 (**Codex P1 T9: `optimistic-post` could not isolate a4; folded as a two-leg control**, see *The class* · SL: b0's writer isolated) · nit ×8 — *2 from 10* | no | — |
| [#2428](https://github.com/fixpoint-labs/flow-state-dev/pull/2428) spec FIX-1664 | spec | ~1 (folded through #2434 and FIX-1668) | approval = merge 09-30 16:42Z | design-off ×1 (Codex P1 T7 + Cursor T1: list-then-pick for the task's run; replaced by the task-run link, FIX-1668) · missed-edge-case ×1 (Codex P1: a readable source for harness metrics) · nit ×5 — *2 from 7* | no | — |
| [#2434](https://github.com/fixpoint-labs/flow-state-dev/pull/2434) spec amendment FIX-1664 | spec (amendment) | **0** | **merged 09-30 16:56Z, 5 min after it opened and 6 min before Codex** | spec-ambiguity ×2 (the composer's owner · the hold-resolved-run invariant, both carried into #2436) · missed-edge-case ×2 (Codex P1: clear stale links on a retry · P2: collection identity) · docs-miss ×1 (Codex P2: the evolution record) · nit ×4 — *5 from 9*. **The three Codex threads are unanswered** | — | merge-ready rule (filed) |
| [#2436](https://github.com/fixpoint-labs/flow-state-dev/pull/2436) spec amendment FIX-1664 | spec (amendment) | ~1 | approval = merge 09-30 18:34Z | stale-restatement ×1 (the README table showed one branch) · spec-ambiguity ×1 (Codex P2: the ownerless branch against the goal check) · nit ×3 — *2 from 5*. Two commits align it with FIX-1668's spec, not with review | no | — |
| [#2437](https://github.com/fixpoint-labs/flow-state-dev/pull/2437) spec FIX-1666 | spec | ~1 | approval = merge 09-30 18:33Z | missed-edge-case ×3 (Codex P1: put the approval in the workstream Stream · P2: keep a Deny · SL1: the durable-drain premise, **settled with an in-spec POC, premise held**) · nit ×3 — *3 from 6* | no | — |
| [#2438](https://github.com/fixpoint-labs/flow-state-dev/pull/2438) spec FIX-1667 | spec | ~1 | approval = merge 09-30 17:18Z | missed-edge-case ×3 (Codex P1: run identity across org members · P2 ×2: `.lock` names, case folding) · over-engineered ×1 (SL: use the channel id as is) · nit ×4 — *4 from 8* | no | — |
| [#2439](https://github.com/fixpoint-labs/flow-state-dev/pull/2439) spec amendment FIX-1662 | spec (amendment) | ~1 | approval = merge 09-30 18:32Z | missed-edge-case ×1 (Codex P1: load dispatch-run sessions) · docs-miss ×1 (Codex P2: qualify by visibility) · stale-restatement ×1 (BR-18 against BR-25) · nit ×5 — *3 from 8* | no | — |
| [#2440](https://github.com/fixpoint-labs/flow-state-dev/pull/2440) spec FIX-1668 | spec | ~1 | approval = merge 09-30 18:31Z | missed-edge-case ×3 (Codex P1: the run's owning flow in the link · P2 ×2: publish the change, a failed gate setup) · stale-restatement ×1 (FIX-1664's plan row) · spec-ambiguity ×1 · nit ×3 — *5 from 8* | no | — |
| [#2525](https://github.com/fixpoint-labs/flow-state-dev/pull/2525) spec FIX-1690 | spec | ~1 | approval = merge 10-01 00:24Z, 32 min after it opened | over-engineered ×1 (two durable forms of one line) · nit ×3 — *1 from 4*. **No Codex: usage limit** | no | — |
| [#2592](https://github.com/fixpoint-labs/flow-state-dev/pull/2592) closure plan amendment FIX-1663 | spec (amendment) | ~1 | approval = merge 10-01 18:06Z | stale-restatement ×2 (the body assumed FIX-1664 merged · the amendment told four times) · docs-miss ×1 (EVOLUTION incomplete) · nit ×5 (T5: *"inlining four goal paths will rot when another child goal lands"*) — *3 from 8*. **No Codex: usage limit** | no | — |
| [#2614](https://github.com/fixpoint-labs/flow-state-dev/pull/2614) spec FIX-1723 | spec | ~1 | approval = merge 10-01 19:35Z | spec-ambiguity ×2 (BR-12's waiting count · SL) · over-engineered ×2 (S1 extends `derive.ts` · SL: the switch is FIX-1725's) · missed-edge-case ×1 (SL: the goal Lab carries an org-level seat) · nit ×3 — *5 from 8*. **No Codex** | no | — |
| [#2616](https://github.com/fixpoint-labs/flow-state-dev/pull/2616) spec FIX-1722 | spec | ~1 | approval = merge 10-01 19:34Z | over-engineered ×2 (one copy of FIX-1719's contract · the CoS's tools are FIX-1726's) · docs-miss ×1 (Jump to) · nit ×5 — *3 from 8*. **No Codex** | no | — |
| [#2441](https://github.com/fixpoint-labs/flow-state-dev/pull/2441) impl FIX-1667 | impl | 1 | merge 09-30 18:53Z | missed-edge-case ×2 (Codex P2: filter ownership before the wrapped dispatcher · BR-1 matched any mention) · docs-miss ×2 (the changeset's bump · the draining-board rule) · over-engineered ×1 (POC #2442: the unused wrapper) · nit ×2 — *5 from 7*. Merged head `ae84b66` unread | no | — |
| [#2444](https://github.com/fixpoint-labs/flow-state-dev/pull/2444) impl FIX-1655 | impl | 2 | merge 09-30 20:32Z | missed-edge-case ×3 (**1 *vacuous-assertion***: Codex P1, the goal bypassed the `fsdev ui add` path users run · planning read as warning · the static title icon) · over-engineered ×2 (POC #2446's one token sheet · a second registry walk) · nit ×8 — *5 from 13*. Merged head `82ec64e` unread | no | — |
| [#2445](https://github.com/fixpoint-labs/flow-state-dev/pull/2445) impl FIX-1666 | impl | 2 | merge 09-30 20:04Z | missed-edge-case ×3 (Codex P1: an atomic once-per-feature claim · P2: retry an ask that never reached a person · store reads outside the step) · **design-off ×1 (T6: *"This feels like a core aspect of workforce, why is it in the lab"*; answered by the spec's fence, FIX-1673 filed)** · nit ×2 — *4 from 6*. Merged head `ea475db` unread | **yes** | — |
| [#2447](https://github.com/fixpoint-labs/flow-state-dev/pull/2447) impl FIX-1668 | impl | 1 | merge 09-30 19:59Z | missed-edge-case ×1 (*vacuous-assertion*: Codex P2, the commit-then-throw case threw before the claim-state write) · stale-restatement ×1 (Codex P2: the README API table and the channel-board guide) · over-engineered ×1 · nit ×3 — *3 from 6*. Merged head `20c96ad` unread | no | — |
| [#2449](https://github.com/fixpoint-labs/flow-state-dev/pull/2449) impl FIX-1662 | impl | 1 | merge 09-30 20:23Z | missed-edge-case ×7 (**2 *vacuous-assertion***: Codex P1, the answer leg passed with Approve disabled · Bugbot, the config spelled the held-out slug; and a bearer off loopback · Jump to's declared resources · bare assignee names · panel keys · Bugbot: a returned error left the claim) · over-engineered ×3 (the Lab assembled twice · the start script re-implementing `fsdev dev` · POC #2452's one `openLab`) · philosophy-drift ×1 (SL: a deny-list mirroring the engine's allow-list) · nit ×7 — *11 from 18*. Merged head `7e1afbd` unread | no | — |
| [#2465](https://github.com/fixpoint-labs/flow-state-dev/pull/2465) impl FIX-1664 | impl | 2 | merge 09-30 22:51Z | missed-edge-case ×7 (409 by message regex · a dead Retry · Codex P1: follow the session on a retry · P2 ×3: draw through the item renderers, keep a failed board read, Retry reads the board (+ Bugbot) · Bugbot: the header's seat resolver) · nit ×3 — *7 from 10*. Merged head `103bb9e` unread | no | — |
| [#2527](https://github.com/fixpoint-labs/flow-state-dev/pull/2527) impl FIX-1695, FIX-1684 | impl | 1 | merge 10-01 00:36Z | missed-edge-case ×1 (an exact JSON match on the refusal) · nit ×5 — *1 from 6*. **No Codex, no Bugbot** | no | reviewer exhaustion (filed) |
| [#2529](https://github.com/fixpoint-labs/flow-state-dev/pull/2529) impl FIX-1693, FIX-1694, FIX-1696 | impl | 1 | merge 10-01 00:35Z | missed-edge-case ×1 (any first-read error became a refusal) · nit ×5 — *1 from 6*. **No Codex, no Bugbot** | no | reviewer exhaustion (filed) |
| [#2531](https://github.com/fixpoint-labs/flow-state-dev/pull/2531) impl FIX-1691, FIX-1692 | impl | 1 | merge 10-01 01:24Z | docs-miss ×1 (*overclaim*: "parity with codex/cursor" stamping) · over-engineered ×1 (POC #2534's `itemFields`) · nit ×5 — *2 from 7*. **No Codex, no Bugbot** | no | reviewer exhaustion (filed) |
| [#2532](https://github.com/fixpoint-labs/flow-state-dev/pull/2532) impl FIX-1688, FIX-1689 | impl | 0 (folds on #2537) | merge 10-01 00:34Z, 9 min after it opened | docs-miss ×1 (the `chat-assistant` closure) · nit ×4 — *1 from 5*. **No Codex, no Bugbot** | no | reviewer exhaustion (filed) |
| [#2537](https://github.com/fixpoint-labs/flow-state-dev/pull/2537) impl FIX-1688 follow-up | impl | 0 | merge 10-01 01:57Z | nit ×1 — *0 from 1*. **No Codex, no Bugbot** | no | — |
| [#2538](https://github.com/fixpoint-labs/flow-state-dev/pull/2538) impl FIX-1690 (stop) | impl | 1 | merge 10-01 02:11Z | over-engineered ×1 (reuse `makeBlockingFlow`) · nit ×2 — *1 from 3*. **No Codex, no Bugbot.** Merged head `50f2510` unread | no | reviewer exhaustion (filed) |
| [#2544](https://github.com/fixpoint-labs/flow-state-dev/pull/2544) impl FIX-1690 (door) | impl | 2 | merge 10-01 15:25Z | missed-edge-case ×2 (SL1: a refused line could still be delivered later · a guard that could not fire) · over-engineered ×3 (three helper reuses) · nit ×3 — *5 from 8*. **No Codex (a manual `@codex review` hit the limit), no Bugbot** | no | reviewer exhaustion (filed) |
| [#2565](https://github.com/fixpoint-labs/flow-state-dev/pull/2565) impl FIX-1690 (lab) | impl | 1 | merge 10-01 15:53Z | missed-edge-case ×2 (SL1: Retry after a timeout could double-send · any throw read as not-sent) · over-engineered ×2 (a second send-state machine · three pagination variants) · nit ×3 — *4 from 7*. **No Codex, no Bugbot** | no | reviewer exhaustion (filed) |
| [#2588](https://github.com/fixpoint-labs/flow-state-dev/pull/2588) impl FIX-1649 (rename, boot shift, DevTeam) | impl | 0 | merge 10-01 17:41Z | nit ×5 (all kept, with reasons) — *0 from 5*. **No Codex, no Bugbot** | no | — |
| [#2605](https://github.com/fixpoint-labs/flow-state-dev/pull/2605) impl FIX-1697 | impl | 0 | merge 10-01 19:54Z | nit ×2 — *0 from 2*. **No Codex, no Bugbot** | no | — |
| [#2618](https://github.com/fixpoint-labs/flow-state-dev/pull/2618) impl FIX-1725 | impl | 0 | merge 10-01 19:33Z | nit ×5 — *0 from 5*. **No Codex, no Bugbot** | no | — |
| [#2621](https://github.com/fixpoint-labs/flow-state-dev/pull/2621) impl FIX-1722 | impl | 1 | merge 10-02 01:27Z | missed-edge-case ×6 (Codex P2 ×6: keep the first session id · ids off a secure origin · block the composer until history loads · per-stream failures · resolved suspensions as pending · adopt a newer session) · nit ×4 — *6 from 10*. Merged head `04d7c14` unread | no | — |
| [#2624](https://github.com/fixpoint-labs/flow-state-dev/pull/2624) impl FIX-1723 | impl | 1 | merge 10-02 01:50Z | missed-edge-case ×3 (Codex P1: logical ids for hired seats, the same finding as cycle 19's #2283 · P2 ×2: Retry when asks fail · stop the Lab when Chromium fails) · over-engineered ×1 · nit ×5 — *4 from 9*. Merged head `7781047` unread | no | — |
| [#2641](https://github.com/fixpoint-labs/flow-state-dev/pull/2641) impl FIX-1730–FIX-1734 (closure findings) | impl | 2 | merge 10-02 11:56Z | missed-edge-case ×2 (**both *vacuous-assertion***: a control stub whose signature could drift from `sendTurn` · a planted violation keyed to markers the fix removed) · over-engineered ×3 (POC #2642's one walk · the `--attention` case · `export *` from `send.ts`) · nit ×2 — *5 from 7*. Codex read `2008bbb` with no findings; merged head `bd05070` unread | no | — |
| [#2650](https://github.com/fixpoint-labs/flow-state-dev/pull/2650) impl FIX-1736 | impl | 1 | merge 10-02 17:13Z | missed-edge-case ×2 (weights compared as strings · Codex P2: the mono bold face) · over-engineered ×3 · nit ×1 — *5 from 6*. Merged head `a0ec9f3` unread | no | — |
| [#2654](https://github.com/fixpoint-labs/flow-state-dev/pull/2654) impl FIX-1735 | impl | 1 | merge 10-02 17:28Z | missed-edge-case ×1 (Codex P2: a record absent at the first read stayed cached) · over-engineered ×3 (three shared helpers) · nit ×2 — *4 from 6*. Merged head `bc16d39` unread; two more FIX-1735 fixes landed later on #2678 | no | — |
| [#2669](https://github.com/fixpoint-labs/flow-state-dev/pull/2669) impl FIX-1747 | impl | 1 | merge 10-03 01:54Z | over-engineered ×1 (a whole-page negative match) · *1 from 1*. Codex clean on `59dc49d` (manual); merged head `5fefdde`, a merge of `main`, unread | no | — |
| [#2671](https://github.com/fixpoint-labs/flow-state-dev/pull/2671) impl FIX-1749 | impl | 1 | merge 10-02 20:39Z | missed-edge-case ×1 (Codex P2: the setup-failure write) · docs-miss ×2 (the changeset, an *overclaim* · the ordering contract in `items.md`) — *3 from 3*. Merged head `0cc4206` unread | no | — |
| [#2675](https://github.com/fixpoint-labs/flow-state-dev/pull/2675) impl FIX-1737 A | impl | 1 | merge 10-04 00:01Z, 26 h after its round | missed-edge-case ×3 (a re-read that graded a different snapshot · Codex P2 ×2: duplicate short names in mentions · delivery state after a mention) · over-engineered ×2 (per-element styles · a second composer) · docs-miss ×1 (the `goals/lib` table) · nit ×1 — *6 from 7*. Merged head `839a5f5`, a merge of `main`, unread | no | — |
| [#2681](https://github.com/fixpoint-labs/flow-state-dev/pull/2681) impl FIX-1737 B | impl | 1 | merge 10-04 00:04Z | missed-edge-case ×4 (**1 *vacuous-assertion***: Codex P2, rows with `min: 0` never exercised · in-flight sends · asks from unrelated flows · an `endsWith` match) · over-engineered ×1 (one needs-then-running rule) · nit ×2 — *5 from 7*. Merged head `a557e97` unread | no | — |
| [#2682](https://github.com/fixpoint-labs/flow-state-dev/pull/2682) impl FIX-1737 C | impl | 1 | merge 10-04 00:32Z | missed-edge-case ×3 (an unfiltered walk of every session · Codex P2 ×2: refresh asks on suspend, Escape where advertised) · over-engineered ×1 · nit ×3 — *4 from 7*. Merged head `2c794e3` unread | no | — |
| [#2683](https://github.com/fixpoint-labs/flow-state-dev/pull/2683) impl FIX-1737 D | impl | 1 | merge 10-04 00:49Z | missed-edge-case ×4 (**1 *vacuous-assertion***: Codex P2, the expected wait id was built from the page under test · a span count · Codex P2 ×2: truncated reads, distinct running sessions) · over-engineered ×1 · nit ×8 — *5 from 13*. Merged head `c10339a` unread | no | — |
| [#2709](https://github.com/fixpoint-labs/flow-state-dev/pull/2709) closure FIX-1663 | impl (closure) | 1 | merge 10-04 10:56Z | missed-edge-case ×5 (**3 *vacuous-assertion***: Codex P1 T7, `GOAL_PART=bogus` printed PASS with 0 verdicts · P2 T9, b0 passed with no `GUESSED` line · P2 T10, `GOAL_PART=b` skipped DevForce's org check; and Queued rows (T4+T8) · P2 T11, a narrowed rerun graded the full list) · over-engineered ×1 (T1+T2: a second copy of `goals/lib/shift-manager.mts`, folded from POC #2711) · nit ×3 — *6 from 9*. **No Bugbot (usage limit)**; Codex read `49fd744`, merged head `5d5358b` unread | no | — |

**Load.** 29 fix waves across the 29 implementation artifacts (cycle 20: 57 across 15), and 104
non-`nit` findings, 3.6 each (cycle 20: 8.7). The busiest is #2449 at 11. No PR took more than
two waves, and five took none. Eleven of the 104 are *vacuous-assertion*, or 11% (cycle 20: 4%;
cycle 19: 10%). Three of the eleven are in the closure runner. The eighteen direction artifacts carry 62 non-`nit`
findings, 3.4 each (cycle 20: 8.0). None reached a second round. Stale-restatement is 11 of the 62
(cycle 20: 5 of 48), and #2619 carries 4 of them, all from the rename. Across all 166 non-`nit`
findings: missed-edge-case is 89 (54%), over-engineered 40, stale-restatement 12, docs-miss 11,
spec-ambiguity 10, design-off 3 and philosophy-drift 1.

**Claims (looped / settled / verdicts):** 0 / 0 on every artifact. No `settle-claim` ran. #2437's
durable-drain premise was settled by an in-spec POC (`poc/durable-drain/`) on the first round,
before anyone argued it. It is not a loop, so it is not counted.

## The closure's runs

| Run | On | What it found |
|---|---|---|
| First QA pass | `main`, 09-30 | FIX-1688 to FIX-1696 (nine), FIX-1697. FIX-1688: the theme swap that FIX-1662's stylesheet deferred to *"when FIX-1655's package lands"* never happened |
| Closure run 1 | `c29aafa4f` (10-02) | FIX-1730 (b0 guessed 3 steps), FIX-1731 (54 literal colours), **FIX-1732, FIX-1733 and FIX-1734 (three controls WRONG)**, FIX-1735 (observed) |
| Closure run 2 | `9bbc77b04` on `48c31cfa6` | a4 refused by the door while the harness started (FIX-1735). All six controls RIGHT, part 3 PASS |
| — | 10-02 12:16Z | FIX-1736 (the fonts never load) and FIX-1737 (v2's look), filed outside a run row. The look goal read the computed `font-family` string, which names the family whether or not it loaded |
| Closure run 3 | `3537738a7` on `a01a0b7bd` (10-04) | **Four findings from merges to `main`**: the project level FIX-1718 shipped, `stream-asks` renamed `feed-ask` (FIX-1737 C), eng.em's four channels, two writes ER-15 does not name. Part 3: three child checks broken by FIX-1737 B (`NavIcon` fill), FIX-1737 D (Queued rows hidden) and FIX-1718 (a hardcoded member list) |
| Runs 4 and 5 | `dd9054581`, `25d026528` | a1's open workstream case, decided; ER-15's room writes pinned. PASS on `25d026528` |
| Run 6 | `01444863c` | PASS after Codex's five findings and POC #2711. Negatives: `GOAL_PART=bogus` now exits 1 |

## The class: controls that break when the closure reuses them

Run 1 graded each control at the signal it names, and three came back WRONG:

| Control (owner) | What went wrong | Cause | Cycle 19's twin |
|---|---|---|---|
| `static-names` (FIX-1662) | reddened a4 as well as b:teams | it wrote seats in as `{ id, kind }`, which drops the `door` FIX-1690 added later | FIX-1624: *no-landing broke more legs than the landing* |
| `optimistic-post` (FIX-1662) | b:post red, a4 green | it swaps `transcript.ts`; since FIX-1690, an `@worker` line goes through `send.ts` | FIX-1625: *controls stopped failing once FIX-1609 added a live stream route* |
| `worker-session` (FIX-1664) | a2 green | with no other session on the seat's flow it fell back to the run session, and DevForce's coder has none | FIX-1623: *the scripted answer came too fast for no-live to fail* |

The three shapes are one for one: a control breaks **more than its signal**, a control **misses a
second path** to the outcome it removes, or the fixture leaves it **nothing to change**. Each
control was RIGHT at its owning check, on its owning Lab. Each one went WRONG when the closure
applied it to another Lab and to legs that the owning check never ran.

**Why nothing caught it before the closure.**
- **The closure plan said what each control would do on its legs, and could not run it yet.**
  On #2426, Codex T9 found that `optimistic-post` could not isolate a4. The fold answered *"it
  removes the send on both trees, so it's now graded as a pair"*. That was true on 09-30. FIX-1690's
  spec (#2525) opened that night, and its lab PR (#2565) added the `send.ts` path and the doors on
  10-01. That is after the plan, and both of those PRs had no correctness-bot pass.
- **The owning checks could not see it.** `it-opens-a-lab` grades `optimistic-post` at *"the post
  is in the stored transcript"*. That signal stayed red after FIX-1690. A run of the child check and
  its controls on #2565 would have shown RIGHT.
- **The closure is where reuse is graded.** Run 1 found all three, and run 2 confirmed all six
  controls RIGHT on the next `main`. That cost one fix PR (#2641, two waves) and one re-run.

## Proposal skipped

The epic's review cost was low on every measure the ledger tracks. The rework it is remembered for
was found by closure runs, on the path that `orchestration.md` → *The closure issue* gives them.
That path says the closure *"is the most expensive child and the only one that repeats. That cost
is the QA."* Each candidate below either has no home that is cheaper than the run that found it, or
is covered already and was caught on the first read.

## Candidates considered and dropped

- **Controls that break when reused (the class above).** The recurrence is real: two consecutive
  closures, three controls each, the same three shapes. But the earliest point that can see each
  one is the closure's first control run. Two of the three were caused by a sibling that merged
  *after* the closure plan was written. A rule that asks the plan's author to predict later
  siblings would add a checklist and catch nothing. Run 1 is the calibration run, and it worked.
  Carried as claim 1.
- **A selection that runs nothing reads as PASS** (#2709 T7, T9, T10; cycle 19's #2348 row 2). This
  is covered by BP-003 (*a command that never ran the check*) and by `issue-implement`'s *the unit
  is the assertion* rule (cycle 17's fix A). Codex found all three on the first head, and one wave
  fixed them. A guard in the verdict protocol is filed.
- **Parallel slices verified alone and broken together.** FIX-1737's four slices each ran the
  sibling checks they touched, on their own heads. They merged within 48 minutes, and the combined
  tree first ran at closure run 3, which found the three broken child checks. Closure item 3 exists
  for this: *"they catch a later merge breaking an earlier child"*. It caught all three. #2592 T5 had
  also predicted that the closure's inlined goal paths would rot.
- **A check that graded a proxy** (FIX-1736: the computed `font-family` string; the look goals that
  graded token values while v2's look was not drawn). This is *vacuous-assertion*. Tenet 7, BP-003
  and `goals/README.md` → *Proving a check can fail* already name it. It was found by eye and filed
  as two issues. That is the rule applied late, not a gap in the rule.
- **A stale DevTeam store across reruns** (`3537738a7`: each DevTeam start now gets a fresh store,
  never the checkout's `devteam.sqlite`). One instance, fixed in the goal.

## Filed, not proposed

- **Reviewer exhaustion grew from 3 artifacts to 16.** Codex hit its limit at 10-01 00:08Z. The
  first PR after that with a Codex review is #2621, opened at 19:56Z. Bugbot reports a usage limit on every PR from #2529
  (10-01 00:14Z) through #2709 (10-04). Eleven implementation PRs and five direction artifacts got no
  correctness-bot pass on any head. FIX-1690's three PRs are among them. Two closure findings sit in
  code from that window: FIX-1733's second path (#2565) and FIX-1735's door refusal (#2544). Whether
  a Codex pass would have found them is not derivable. **The owner's decision from cycle 20 is still
  open: buy capacity, or name which automation counts as a correctness pass.**
- **The closure fixed run 3's findings in its own branch.** `orchestration.md` says every finding
  becomes a child of the epic and that a run with findings opens no PR. Run 1 did this (FIX-1730 to
  FIX-1735). Ten commits in the closure branch answer runs 3 and 4 instead. One of them is a
  product fix (`1d1e1cb`, the sidebar icons' fill), and one closes a case the specs left open
  (a1's workstream set, `6c6030939`). The re-run discipline held, because each fix was re-run on one
  commit. The audit trail did not, because none of those findings has an issue.
- **#2434 merged 5 minutes after it opened**, before Codex. Codex posted three threads 6 minutes
  after the merge. One is a P1 (clear stale run links on a retry). None is answered. FIX-1668's spec
  later took the run link, so the P1 may be moot. The PR does not say so.
- **Four children never blocked the closure.** FIX-1671, FIX-1673 and FIX-1675 (features) and
  FIX-1705 (a bug: a coding run that outlasts a stop is charged an abandonment) are children of
  FIX-1649 with only `related` links to FIX-1663. The epic wrapped with all four open. The rule is
  that every child blocks the closure, including late ones.
- **Linear lags the merges.** FIX-1663, FIX-1722, FIX-1723, FIX-1737 and FIX-1749 read *In
  Development*. FIX-1697, FIX-1725 and FIX-1730 to FIX-1736 read *In Review*. Their PRs have
  merged.
- **POC #2642 is still open** after #2641 adopted it (`bd05070`).
- **FIX-1735 continued on another epic's PR.** `1f2dadd45` (*a mid-run request-state write keeps the
  persisted items*) and `f23ae7c78` landed on #2678 (FIX-1719) after #2654 merged.
- **A zero-check guard in `goals/lib/verdict.mts`.** `runGoal` passes when `failures` is empty, so a
  runner that selects nothing passes unless it adds its own check, as #2709 now does. A required
  count of checks run, with FAIL at zero, would make that the default for every runner. It would not
  catch T9 or T10, which ran some checks and skipped others.

## Scoring the previous cycles' fixes and claims

```
46b20ac (cycle 20's race-primitive trigger, on main 10-01 17:12Z):
  #2621 first head 6343623 CARRIES · #2654 first head 7c9e932 CARRIES
  every branch opened after 17:12Z carries it; #2445, #2449, #2465, #2544, #2565 forked before it
d50a3a6 (cycle 19's control-unit convergence, on main 09-29 12:00Z):
  #2426 (opened 09-30) CARRIES · #2709 first head 5446d09 CARRIES
```

- **Cycle 20's claim 1 (does the primitive trigger cut race tails?): no qualifying instance.** No
  PR that carries the trigger had two interleaving findings on one structure. The nearest is a
  pre-fix PR. #2445 drew three findings on `raiseAsk`'s once-per-feature claim (T3, T4 and #2449's
  Bugbot T16). Two waves closed them with the existing store operations (*"No new API was
  needed"*), which is the trigger's own carve-out. Hold.
- **Cycle 20's claim 2 (reviewer exhaustion): 16, up from 3.** See *Filed*.
- **Cycle 20's claim 3 (changeset length): 0, unexplained.** Eleven PRs added fragments. Seven of
  them got a Codex pass, and none drew the one-sentence P1 (cycle 20: 7 of 15). No guard landed.
  Carry once more.
- **Cycle 19's claim 1 (does converging the control unit move the plan and the first head?):
  yes, for one unconfounded instance.** Codex read #2709's first reviewed head (`49fd744`) and raised no
  control-unit finding (cycle 19's #2348: row 1). Its three *pass on an absence* findings are
  cycle 19's row 2 again, which is a different claim (see *Candidates considered and dropped*). The closure plan's control table
  names signals (*"a4 and b's post step fail together"*). The runner printed WRONG at the named
  signal on the first run, and that is how the three controls in *The class* became visible. Close.
- **Cycle 19's claim 2 (do folds after the last pass cost anything?): not derivable, and the count
  rose again.** 25 of 29 implementation PRs merged a head that no bot read (cycle 20: 10 of 15).
  Codex read the merged head of no implementation PR that had a fix wave. Carry.
- **Cycle 18's claim 3 (a worker that cannot dispatch): 0 instances.** Hold.

## Claims to test next cycle

1. **Do reused controls keep breaking in the same three shapes on the closure's first run?**
   Baseline: cycle 19 had 3, and cycle 21 had 3 of the 5 non-baseline closure controls. Record each
   WRONG control by shape (more than its signal · a missed second path · nothing to change), and say
   whether the change that broke it merged after the closure plan. A third closure with the same
   result, from controls whose breaking change merged *before* the plan, would mean the plan could
   have seen it. That would earn a line in the closure plan's control table.
2. **Reviewer exhaustion.** Count artifacts with no correctness-bot pass on any head. Baseline: 16.
3. **Unread merged heads.** Baseline: 25 of 29.
4. **Changeset length**, once more. Baseline: 0 of 7 fragments that Codex read.

## Finding map

`T`-numbers are positions in each PR's review-thread list, oldest first. `+` joins threads collapsed
into one finding. *vac* is *vacuous-assertion*. *SL* is an item of a second-look body. *mee* is
missed-edge-case.

- **#2421** design-off ×1: SL1. spec-ambiguity ×3: SL2 · T1+T7 · T4. over-engineered ×1: SL3. nit ×4: T2 · T3 · T5 · T6.
- **#2423** stale-restatement ×1: T2. nit ×1: T1.
- **#2619** stale-restatement ×4: T1 · T2 · T4 · T5. nit ×2: T3 · T6.
- **#2648** mee ×4: T7 (vac) · T8 · T9 · T10. over-engineered ×1: T2. nit ×5: T1 · T3–T6.
- **#2424** mee ×3: T1 · T2 · T3. over-engineered ×1: T4+SL. stale-restatement ×1: T7. nit ×3: T5 · T6 · T8.
- **#2425** mee ×3: T10 · T11 · T13. spec-ambiguity ×1: T12. nit ×9: T1–T9.
- **#2426** mee ×2: T9 · SL (D2). nit ×8: T1–T8.
- **#2428** design-off ×1: T1+T7. mee ×1: T8. nit ×5: T2–T6.
- **#2434** spec-ambiguity ×2: T1 · T5. mee ×2: T7 · T8. docs-miss ×1: T9. nit ×4: T2 · T3 · T4 · T6.
- **#2436** stale-restatement ×1: T4. spec-ambiguity ×1: T5. nit ×3: T1–T3.
- **#2437** mee ×3: T4 · T5 · SL1. nit ×3: T1–T3.
- **#2438** mee ×3: T5 · T6 · T7. over-engineered ×1: SL. nit ×4: T1–T4.
- **#2439** mee ×1: T7. docs-miss ×1: T8. stale-restatement ×1: T2. nit ×5: T1 · T3–T6.
- **#2440** mee ×3: T6 · T7 · T8. stale-restatement ×1: T3. spec-ambiguity ×1: T4. nit ×3: T1 · T2 · T5.
- **#2525** over-engineered ×1: T1. nit ×3: T2–T4.
- **#2592** stale-restatement ×2: T1 · T2. docs-miss ×1: T3. nit ×5: T4–T8.
- **#2614** spec-ambiguity ×2: T1 · SL. over-engineered ×2: T2 · SL. mee ×1: SL. nit ×3: T3–T5.
- **#2616** over-engineered ×2: T2 · the FIX-1726 scope fold. docs-miss ×1: T7. nit ×5: T1 · T3–T6.
- **#2441** mee ×2: T2 · T3. docs-miss ×2: T1 · T6. over-engineered ×1: T7. nit ×2: T4 · T5.
- **#2444** mee ×3: T10 (vac) · T11 · T12. over-engineered ×2: T7 · T13. nit ×8: T1–T6 · T8 · T9.
- **#2445** mee ×3: T3 · T4 · T5. design-off ×1: T6. nit ×2: T1 · T2.
- **#2447** mee ×1: T6 (vac). stale-restatement ×1: T5. over-engineered ×1: T4. nit ×3: T1–T3.
- **#2449** mee ×7: T11 (vac) · T12 · T13 · T14 · T15 · T16 · T17 (vac). over-engineered ×3: T2 · T4 · T18. philosophy-drift ×1: T1. nit ×7: T3 · T5–T10.
- **#2465** mee ×7: T1 · T3 · T6 · T7 · T8 · T9+T10 · T11. nit ×3: T2 · T4 · T5.
- **#2527** mee ×1: T1. nit ×5: T2–T6.
- **#2529** mee ×1: T2. nit ×5: T1 · T3–T6.
- **#2531** docs-miss ×1: T3. over-engineered ×1: T7. nit ×5: T1 · T2 · T4–T6.
- **#2532** docs-miss ×1: T4. nit ×4: T1–T3 · T5.
- **#2537** nit ×1: T1.
- **#2538** over-engineered ×1: T1. nit ×2: T2 · T3.
- **#2544** mee ×2: T1 · SL1. over-engineered ×3: T2 · T4 · T5. nit ×3: T3 · T6 · T7.
- **#2565** mee ×2: T3 · SL1. over-engineered ×2: T1 · T2. nit ×3: T4–T6.
- **#2588** nit ×5: T1–T5.
- **#2605** nit ×2: T1 · T2.
- **#2618** nit ×5: T1–T5.
- **#2621** mee ×6: T5–T10. nit ×4: T1–T4.
- **#2624** mee ×3: T7 · T8 · T9. over-engineered ×1: T3. nit ×5: T1 · T2 · T4–T6.
- **#2641** mee ×2: T1 (vac) · T4 (vac). over-engineered ×3: T5 · T6 · T7. nit ×2: T2 · T3.
- **#2650** mee ×2: T3 · T6. over-engineered ×3: T2 · T4 · T5. nit ×1: T1.
- **#2654** mee ×1: T1. over-engineered ×3: T2 · T3 · T5. nit ×2: T4 · T6.
- **#2669** over-engineered ×1: T1.
- **#2671** mee ×1: T1. docs-miss ×2: T2 · T3.
- **#2675** mee ×3: T2 · T6 · T7. over-engineered ×2: T1 · T4. docs-miss ×1: T5. nit ×1: T3.
- **#2681** mee ×4: T5 · T6 · T7 (vac) · T8. over-engineered ×1: T1+T2. nit ×2: T3 · T4.
- **#2682** mee ×3: T1 · T6 · T7. over-engineered ×1: T5. nit ×3: T2–T4.
- **#2683** mee ×4: T4 · T11 · T12 · T13 (vac). over-engineered ×1: T7. nit ×8: T1–T3 · T5 · T6 · T8–T10.
- **#2709** mee ×5: T4+T8 · T7 (vac) · T9 (vac) · T10 (vac) · T11. over-engineered ×1: T1+T2. nit ×3: T3 · T5 · T6.

**Implementation non-`nit`:** 5 + 5 + 4 + 3 + 11 + 7 + 1 + 1 + 2 + 1 + 0 + 1 + 5 + 4 + 0 + 0 + 0 + 6
+ 4 + 5 + 5 + 4 + 1 + 3 + 6 + 5 + 4 + 5 + 6 = **104** (in table order), of which *vacuous-assertion*
11. **Direction non-`nit`:** 5 + 1 + 4 + 5 + 5 + 4 + 2 + 2 + 5 + 2 + 3 + 4 + 3 + 5 + 1 + 3 + 5 + 3 =
**62** (in table order), of which stale-restatement 11 and *vacuous-assertion* 1.
