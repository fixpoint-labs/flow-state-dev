# Cycle 22 — Org primitives epic wrap (FIX-1650) (2026-10-06)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**Seven implementation PRs took four fifths of the epic's fix waves, and three of them were cycle
20's race class with cycle 20's fix in their tree.** #2649, #2651 and #2702 patched one
interleaving per round for 12, 13 and 10 rounds. All three branches carry `46b20ac`, the trigger
that says the second race on one structure is a missing primitive. In each, the author answered
round after round that the fix "closes the class", and the next round found the next window. The
trigger's condition is the author's own judgement that a fix only *narrows* the gap, and nobody
judged their own fix that way until rounds 10 to 13.

The four classes the coordinator named, checked against the ledger:
- **(a) A goal check that graded the model's prose instead of the data.** New to the ledger, and
  the costliest single incident: it hid a product bug (FIX-1785) behind a misdiagnosis.
- **(b) Controls accepted on any failure, or a missing step read as a pass** (#2781 Codex P1 ×2).
  The third closure in a row (cycles 19, 21, 22), but found on the first read each time, fixed in
  one wave, and its structural fix is already filed (FIX-1183, Backlog since 08-18).
- **(c) A goal prompt that left the model a fork** (J4's unnamed hire kind). One instance. It is
  (a)'s principle from the input side, and is folded into (a)'s fix.
- **(d) Stacked PRs merged onto a dead base** (#2651, #2655). The second instance (the first was
  #2222 on 09-25). A team memory already holds it, and the owner's 10-02 direction changed the
  stacking mechanism. Dropped, with one coherence gap flagged below.

**Proposal:** two sharpened sentences in existing text, no new rule. One closes the race
trigger's escape clause in `issue-implement` 10.3, and one tells `goals/README.md` technique 1
to grade the data, not the retelling.

**Method — scope.** Thirty-one reviewed artifacts. They were found from FIX-1650's 20 Linear
children and the epic's own attachments (read over GraphQL), and from a listing of the 400 newest
repository PRs, matched on the epic id, `org-primitives`, and each child id in the title or branch:
- the epic PR #2602 and four amendments: #2609 (Q2), #2622 (Q1), #2633 (cross-spec alignment)
  and #2634 (its follow-up);
- five issue specs: #2612 (FIX-1621), #2613 (FIX-1719), #2625 (FIX-1718), #2643 (FIX-1720, the
  closure plan) and #2777 (FIX-1785, **open, in flight**);
- twenty-one implementation PRs, the closure #2781 among them. #2657 (FIX-1718 PR 4) and #2700
  (FIX-1755) closed unmerged; their endpoint is the close.

**Out of the sample:**
- the spikes and POCs #2626–#2632 (FIX-1728, FIX-1729) and #2782 (folded into #2781 by hand).
  They settled Q1's direction before the specs were rewritten. None was reviewed on its own.
- #2423, FIX-1649's amendment that split workstream ownership with FIX-1650. Cycle 21 scored it.
- FIX-1726 and FIX-1745 (Backlog) and FIX-1727 (Todo), children with no PR at wrap. #2620, #2623
  and #2663 are their GitHub issue mirrors, not PRs.

**Endpoints and rounds.** Direction artifacts end at the owner's merge, as in cycle 21.
**This cycle changes the implementation axis, and the change is declared here.** Cycles 20 and 21
hand-classed each finding. This one counts mechanically, from the REST data:
- **Waves** are distinct Codex-reviewed heads that drew at least one thread. Codex reviews every
  push, so this approximates "pushes that answered a review". It reads zero on a PR Codex never
  reviewed (#2685, #2699, #2701), where Cursor's one pass was the only round.
- **Acted** threads are those whose last author reply starts *Fixed / Done / Folded / Applied /
  Agreed / Real / Confirmed / Taken* (and close variants). **Declined** replies start *Stays /
  Keeping / Leaving / Not changing / Moot / Intended*; they are `nit`. *Tracked in / Carried into*
  is a deferral. Second-look and Architect bodies are not threads and are not counted.
- Classes are named only for the shapes this entry argues from (the tails and (a)–(d)). The
  totals below are thread counts, so they are **not** comparable to cycle 21's per-finding
  totals. Waves are comparable in kind, but not exactly.

**Every act sits behind the shared `jhoffner` login**, and this entry does not guess who pressed
what.

| PR | Kind | Rounds / waves | Endpoint | Acted · declined (· deferred) | Shape of the rework | Felt off? |
|---|---|---|---|---|---|---|
| [#2602](https://github.com/fixpoint-labs/flow-state-dev/pull/2602) epic FIX-1650 | epic | 1 | merge 10-01 18:33Z | 4 · 0 | Q2 placement (second look), stale-restatement. **No Codex: usage limit** | no |
| [#2609](https://github.com/fixpoint-labs/flow-state-dev/pull/2609) epic amend Q2 | epic (amend) | 1 + owner rewrite | merge 10-01 19:56Z | 4 · 0 | the owner dropped Ops on #2613; the amend was rewritten CoS-only. **No Codex** | yes (owner) |
| [#2622](https://github.com/fixpoint-labs/flow-state-dev/pull/2622) epic amend Q1 | epic (amend) | 2 + owner HOLD | merge 10-02 01:09Z | 12 · 1 | owner HOLD: a project is an org resource, not a channel; rewritten on the FIX-1728/1729 spikes. Codex P1 ×3 on the rewrite (recoverable bind, keyed join, create path) | yes (owner) |
| [#2633](https://github.com/fixpoint-labs/flow-state-dev/pull/2633) epic alignment | epic (amend) | 1 | merge 10-02 01:57Z, 4 min after opening, 13 s after Codex | 6 · 2 | stale-restatement across three child specs; Codex's three P2s landed 13 s before the merge and were folded on #2634 | no |
| [#2634](https://github.com/fixpoint-labs/flow-state-dev/pull/2634) alignment follow-up | epic (amend) | 1 | merge 10-02 11:43Z | 2 · 1 | stale-restatement (the template's member key) | no |
| [#2612](https://github.com/fixpoint-labs/flow-state-dev/pull/2612) spec FIX-1621 | spec | 1 | merge 10-01 19:35Z | 2 · 3 | nit-heavy. **No Codex** | no |
| [#2613](https://github.com/fixpoint-labs/flow-state-dev/pull/2613) spec FIX-1719 | spec | 1 + owner rewrite | merge 10-01 19:55Z | 4 · 0 | owner: drop Ops, CoS alone holds hire. **No Codex** | yes (owner) |
| [#2625](https://github.com/fixpoint-labs/flow-state-dev/pull/2625) spec FIX-1718 | spec | 2 + owner HOLD | merge 10-02 01:45Z | 18 · 2 | the Q1 HOLD rewrote it onto the resource model; Codex P1 ×3 (cursor skip, claim race, recoverable bind) | yes (owner) |
| [#2643](https://github.com/fixpoint-labs/flow-state-dev/pull/2643) spec FIX-1720 (closure plan) | spec | 1 | merge 10-02 20:24Z | 9 · 0 | Codex P1 ×3 (sibling failures must block, crash contract, exclude itself from P3.3) | no |
| [#2777](https://github.com/fixpoint-labs/flow-state-dev/pull/2777) spec FIX-1785 | spec | 1 (in flight) | collection, 10-06 | 4 · 3 | the product fix (a) uncovered | no |
| [#2645](https://github.com/fixpoint-labs/flow-state-dev/pull/2645) impl FIX-1719 PR 1 | impl | **11** | merge 10-02 20:26Z | 17 · 2 · 1 | **restatement one surface per round**: the org-seat id contract re-stated in docs/JSDoc/README, one page a round (T6, T8–T11, T13, T14, T17, T18), then a revert (T19) | no |
| [#2652](https://github.com/fixpoint-labs/flow-state-dev/pull/2652) impl FIX-1719 PR 2 | impl | **13** | merge 10-02 21:10Z | 47 · 5 | races on approval binding (P1 ×6), changeset length P1 ×3, and **eight goal-check tightenings**, two of which made the discover leg grade the model's answer (T42, T48: see (a)) | no |
| [#2678](https://github.com/fixpoint-labs/flow-state-dev/pull/2678) impl FIX-1719 follow-ups | impl | 2 | merge 10-02 22:45Z | 6 · 3 | bump level, a local request record | no |
| [#2647](https://github.com/fixpoint-labs/flow-state-dev/pull/2647) impl FIX-1718 PR 1 | impl | 2 | merge 10-02 19:03Z | 5 · 5 · 1 | Codex P1 ×4 on claims and the gap clock | no |
| [#2651](https://github.com/fixpoint-labs/flow-state-dev/pull/2651) impl FIX-1718 PR 2 | impl | **13 (cap)** | merge 10-03 01:53Z **into its stacked base, after that base reached main** | 30 · 1 · 2 | **race tail** on talk fan-out and channel retirement (T10, T14, T25–T34); deferral to FIX-1745 at the cap; **(d)** | no |
| [#2655](https://github.com/fixpoint-labs/flow-state-dev/pull/2655) impl FIX-1718 PR 3 | impl | **11** | merge 10-03 01:53Z **into its stacked base** | 24 · 3 | room-read polling and paging edge cases; **(d)** | no |
| [#2657](https://github.com/fixpoint-labs/flow-state-dev/pull/2657) impl FIX-1718 PR 4 | impl | 9 | **closed** (re-landed as #2687) | 18 · 4 | mostly answered by merging #2649/#2652 heads | no |
| [#2687](https://github.com/fixpoint-labs/flow-state-dev/pull/2687) impl FIX-1718 PRs 2–4 onto `main` | impl | 1 | merge 10-03 12:48Z | 1 · 9 | the re-landing of (d): 79 commits, one Codex pass, nine threads declined as already decided | no |
| [#2685](https://github.com/fixpoint-labs/flow-state-dev/pull/2685) impl FIX-1718 follow-ups | impl | 1 (Cursor only) | merge 10-03 22:31Z | 3 · 3 | #2655's three post-cap Codex threads | no |
| [#2649](https://github.com/fixpoint-labs/flow-state-dev/pull/2649) impl FIX-1621 | impl | **12** | merge 10-02 20:36Z | 33 · 2 | **race tail** on seat rows vs a replacement hire (T12, T15, T17, T21, T22, T24, T30, T31, T34); the incarnation was minted at round 4 and then applied one write site a round; deferral to FIX-1743 at round 11 | no |
| [#2699](https://github.com/fixpoint-labs/flow-state-dev/pull/2699) impl FIX-1756 | impl | 0 (Cursor only) | merge 10-04 21:11Z | 0 · 2 | — | no |
| [#2700](https://github.com/fixpoint-labs/flow-state-dev/pull/2700) impl FIX-1755 | impl | 1 | **closed** (FIX-1755 dropped) | 1 · 0 | — | no |
| [#2701](https://github.com/fixpoint-labs/flow-state-dev/pull/2701) impl FIX-1754 | impl | 0 (Cursor only) | merge 10-04 00:35Z | 1 · 1 | — | no |
| [#2702](https://github.com/fixpoint-labs/flow-state-dev/pull/2702) impl FIX-1753 | impl | **10** | merge 10-04 12:19Z | 13 · 1 | **race tail** on `stopOf` (T4–T14): status and suspension reads interleaving with a resume; *"I changed the structure"* (T8), *"This closes the class"* (T11); the missing field named at T14 | no |
| [#2703](https://github.com/fixpoint-labs/flow-state-dev/pull/2703) impl FIX-1752 | impl | 2 | merge 10-04 00:44Z | 3 · 2 | idempotent first visit; T6 unanswered | no |
| [#2706](https://github.com/fixpoint-labs/flow-state-dev/pull/2706) impl FIX-1757 | impl | **11** | merge 10-04 21:10Z | 25 · 0 | **restatement one surface per round**: the org-id contract in docs (T5, T8, T10, T13, T14, T21–T23, T26) and the changeset's bump level one package a round (T7, T12, T24, T25), until *"one sweep rather than per page"* (T22) and *"for the whole class. I grepped"* (T25) | no |
| [#2707](https://github.com/fixpoint-labs/flow-state-dev/pull/2707) impl FIX-1758 | impl | 2 | merge 10-04 12:21Z | 5 · 1 | the hire tool told the model too little (found by the closure) | no |
| [#2767](https://github.com/fixpoint-labs/flow-state-dev/pull/2767) impl FIX-1782 | impl | 1 | merge 10-05 16:49Z | 1 · 3 | docs-only writer gaps | no |
| [#2768](https://github.com/fixpoint-labs/flow-state-dev/pull/2768) impl FIX-1781 | impl | 1 + owner redirect | merge 10-05 23:33Z | 2 · 1 | **(a)**: the first two heads prompted the model to list itself; the owner called that a smell, and the third head grades `discover`'s output | yes (owner) |
| [#2772](https://github.com/fixpoint-labs/flow-state-dev/pull/2772) impl FIX-1783 | impl | 1 | merge 10-05 23:34Z | 2 · 4 | docs-only writer gaps | no |
| [#2781](https://github.com/fixpoint-labs/flow-state-dev/pull/2781) closure FIX-1720 | impl (closure) | 1 | merge 10-06 17:43Z | 6 · 3 | **(b)**: Codex P1 T1 (a child control accepted on any nonzero exit), P1 T2 (a step that never ran was not a leak), P2 T5 and T6 (J4 skipped its assertion when a value was absent), P2 T3 (b4 passed on an undelivered post); **(c)** in commit `b7ce4e11f` | no |

**Load.** 104 waves over the 21 implementation artifacts (cycle 21: 29 over 29; cycle 20: 57 over
15). **Seven PRs carry 81 of them**: #2651 13, #2652 13, #2649 12, #2645 11, #2655 11, #2706 11,
#2702 10. About 237 acted
threads in implementation, 65 in direction artifacts. No direction artifact took a third round.
Four direction artifacts were rewritten on the owner's direction call (#2609, #2613, #2622,
#2625), which this entry records as `design-off` from the owner, not as rounds.

**Claims (looped / settled / verdicts):** 0 / 0. Q1's direction was settled by the FIX-1728 and
FIX-1729 spikes before the specs were rewritten, on the first HOLD, before anyone argued it.

**Reviewer exhaustion:** 4 artifacts with no Codex pass on any head (#2602, #2609, #2612, #2613,
all on 10-01 under the usage limit; cycle 21: 16). Bugbot reported its usage limit throughout.
**Unread merged heads:** at least 9 of 19 merged implementation PRs (cycle 21: 25 of 29),
read from Codex's reviewed commit against the PR's final head.

## The class: a race fixed one window at a time, with the trigger in the tree

| PR | Waves | Interleaving rounds on one structure | When the primitive was named or the class deferred | Author's own claim mid-tail |
|---|---|---|---|---|
| #2649 FIX-1621 | 12 | about 8 (seat rows vs a replacement hire) | incarnation minted in answer to round 4 (`02c3664`); FIX-1743 filed 15:26Z during round 7; deferral at T36, round 11 | T12 *"I reworked the retry instead of patching it"* · T31 *"Fixed for every row the boot writes"* |
| #2651 FIX-1718 PR 2 | 13 (cap) | about 9 (talk fan-out, channel retirement) | FIX-1745 filed 16:25Z after round 12; deferral at the cap | T26 *"at the root cause"* · T31 *"for the whole class rather than just this action"* |
| #2702 FIX-1753 | 10 | 9 (`stopOf`'s reads vs a resume) | T14, round 10: *"nothing to compare without adding a store API. We accept this window"* | T8 *"I changed the structure"* · T11 *"This closes the class rather than this path"* |

```
46b20ac (cycle 20's race-primitive trigger, on main 10-01 17:12Z):
  #2649 first head bb87fae CARRIES · #2651 first head 00a9347 CARRIES · #2702 first head fb959de CARRIES
  (also #2645 02019e2, #2652 4817fbb, #2655 a9725aa, #2706 dedc1df: all carry it)
```

**Why the trigger didn't fire.** It fires when *"the fix you can make narrows the gap rather than
closing it"*, on the second such finding. Every author in the table judged each fix a closing
one, often a structural one, and said so in the reply. So the condition never held in their own
reading, and the second, fourth and eighth finding each looked like the first. The evidence that a
fix did not close the class is the next interleaving finding on the same structure. The trigger
asks the author to predict that instead of counting it. Cycle 20's baseline tails were 16, 11 and
10 rounds. This cycle's are 12, 13 and 10. The fix landed, and the rate did not move.

**The sibling shape, restatements one surface per round** (#2645, #2706: 22 waves between them),
is the same loop on documents: a changed contract re-stated on one page each round. `issue-implement`
10.6 already carries the word sweep and the surface sweep, and #2706's author reached for them at
rounds 9 and 10. That is the rule applied late, not a gap in it. Not proposed.

## (a) A goal that graded the model's retelling of data the system holds

The chain, in order:
1. **#2652 rounds 10–12** (Codex T42, T48): *"require exact seat IDs in the discovery check"*,
   then *"require declared-seat kinds"*. Both were folded by tightening what the chief of staff's
   **answer** must say, and the goal's question was reworded until it passed: *"With the first
   wording … one run FAILED at discover, the model declining to give kinds … the question now says
   to look up each seat."* That is item 2's third failure.
2. **The goal's verdict log on 10-02** records three discover-leg failures. Two were closed by a
   rerun (*"the model answering without naming the members; the rerun reached seat gone"*), and
   the third by rewording the question.
3. **Closure runs 1, 2 and 4** fail on it. FIX-1781 is filed with the diagnosis *"the data path and
   the check are both right"* and the fix *"tell it to list every member it gets back, itself
   included"*.
4. **#2768's first two heads** do exactly that, in `WORKER.md` and the docs page. The second look
   says ship, and Cursor approves. Cursor's review names the alternative and declines it: *"Grade tool-call JSON instead
   of prose … changes what the goal proves."*
5. **The owner** (on FIX-1785): *"prompting the chief of staff to list itself is a smell; this
   should be deterministic."* The third head grades `discover`'s `tool_output` items. Of its 12
   runs, the one failure shows the real cause: a thin `discover` returns no members and no kinds,
   so the model was guessing. That is FIX-1785, a product bug the prose grade had hidden for
   three days.

**Why nothing caught it.** `goals/README.md` technique 1 lists *"the returned answer"* among the
surfaces a check may assert on, beside emitted items and side effects. It is the right surface
when the claim is about the model's behaviour. Here the claim was about data, and the README gives
no way to tell the two apart. The *Signal* field's *"checkable without reading the model's mind"*
is the right instinct, and each fold above stayed within its letter.

**(c) is the same principle from the input side.** J4 asked the chief of staff to hire *"with only
an id"* on a Lab whose writer allowed two kinds. The model asked which, correctly, and the run read
FAIL (`b7ce4e11f`: *"a chief of staff that may hire more than one kind rightly asks which"*). One
instance, folded into (a)'s sentence rather than given its own.

## (b) Controls and steps that pass on an absence — the third closure

| Cycle | Closure | Findings | Found | Cost |
|---|---|---|---|---|
| 19 | #2348 | rows 1–2: controls matched by leg; a leg that never ran read green | Codex and second look, first head | one wave |
| 21 | #2709 | T7, T9, T10: `GOAL_PART=bogus` printed PASS; b0 passed with no `GUESSED` line | Codex, first head | one wave |
| 22 | #2781 | T1: a child control counted as `FAIL (expected)` on any nonzero exit; T2: a `staysGreen` step that never ran was not a leak; T5, T6: J4 skipped its store assertion when a value was absent; T3: b4 passed on an undelivered post | Codex, first head | one wave (`f78908961`) |

The recurrence is real. Every instance was found on the closure's first reviewed head and fixed in
one wave. T1 even quotes the rule it broke (*"`goals/README.md` requires each control to fail its
specifically named assertion"*), which cycle 19's fix put there. A prose rule cannot make this
cheaper than one wave. The structural fix has been filed since 08-18 as FIX-1183, *"A goal check
can report PASS while asserting over zero evidence"* (Backlog), and cycle 21 recommended the same
guard in `goals/lib/verdict.mts`, which is still not built. **Not proposed as text.** Whether
FIX-1183 is worth scheduling is the owner's call; this entry records three closures of evidence
for it.

## (d) Stacked PRs merged onto a dead base

#2647 (FIX-1718 PR 1) merged to `main` at 10-02 19:03Z. #2651 and #2655, stacked on its branch and
the next, merged into those branches at 10-03 01:53Z, so neither reached `main`. #2657 was closed,
and #2687 re-landed PRs 2–4 from the top branch: 79 commits, one Codex pass, nine of ten threads
declined as already decided. The same thing happened to #2222 on 09-25.

The team memory `retarget-stacked-prs-before-jake-merges` records both, with the check that
catches it (each layer's head on `origin/main`). On 10-02 the owner moved dependent PRs to GitHub
stacks and asked for no *"DO NOT MERGE"* titles, and GitHub refuses to retarget a PR inside a
stack. **Not proposed.** But that direction lives only in memory. `issue-implement` Step 9 and
`issue-multi-pr.js`'s `stackedOpenNote` still tell a worker to open the *"DO NOT MERGE until #N is
on main"* PR and retarget it. That conflict is the owner's to settle, and a skill edit that does
it touches `issue-multi-pr.js`, which `verify.mjs` covers. Flagged, not changed.

## The proposed upstream fix — two sentences, both in existing text

| File | Now | Proposed |
|---|---|---|
| `.agents/skills/issue-implement/SKILL.md` · 10.3, the race trigger | *"…the next round will find the next gap. On the second such finding against the same structure, name the atomic operation…"* | *"…the next round will find the next gap. Whether your last fix closed the class is the next review's call, not yours: a second interleaving finding against a structure an earlier round already fixed is the trigger, even when that fix was a restructure you said closed the class. Then name the atomic operation…"* |
| `goals/README.md` · technique 1 | ends after the `useSession` example | adds: grade data the system holds or a tool returns where the run left it (the tool's output item, the stored row), not the model's retelling; grade the answer only when the claim is about what the model does; a failing retelling is a lead, not a verdict, and prompting the model to recite never turns it green; a prompt names every input the claim isn't about, so a correct model's question can't read as a failure |

The first re-aims cycle 20's fix rather than adding one. It removes the self-judgement the three
tails show, and keeps everything else the trigger says. The second sharpens the line that licensed
(a), and folds (c) in.

## Candidates considered and dropped

- **A coordinator-side counter for interleaving findings** (issue-lifecycle counts them per
  structure and forces the deferral). It is heavier, and it moves a judgement into a workflow that
  cannot read code. Try the one-sentence version first; if the next cycle's tails don't shorten,
  this is the next altitude.
- **(b) as text.** See above: covered, caught on first read, and its fix is FIX-1183.
- **(d) as text.** See above: memory and a mechanism exist; the open item is a conflict for the owner.
- **Restatement one surface per round** (#2645, #2706). Covered by 10.6's sweeps, applied late.
- **Changeset length** (cycle 20's claim 3). Back: Codex's *"condense to one sentence"* P1 six times
  on four PRs (#2649, #2651, #2652 ×3, #2706), after zero in cycle 21. No guard landed. Carry.
- **Merging a direction artifact seconds after Codex posts** (#2633, 4 minutes after opening, 13 s
  after Codex). Its three findings went to #2634 the next minute; nothing was lost. Cycle 21's #2434 was the same. One per cycle; hold.

## Scoring the previous cycles' fixes and claims

- **Cycle 20's claim 1 (does the race trigger cut tails?): no, on three qualifying instances.** See
  the class above. All carry `46b20ac`. Tails 12, 13 and 10 against a baseline of 16, 11 and 10.
  This cycle's proposal re-aims it.
- **Cycle 20's claim 3 (changeset length): 6 instances, up from 0.** Carry.
- **Cycle 21's claim 1 (reused controls breaking on the closure's first run): 0 WRONG, but
  confounded.** Run 1 reported every control *"red as they must"*. #2781 T1 then showed the
  closure graded child controls by exit code alone, so a control that broke more than its signal
  would also have read red. Not scored; re-measure on the next closure.
- **Cycle 21's claim 2 (reviewer exhaustion): 4, down from 16.**
- **Cycle 21's claim 3 (unread merged heads): at least 9 of 19, down from 25 of 29.**
- **Cycle 19's control-unit convergence (`d50a3a6`):** carried by #2781's first head, and T1 quotes
  it. The rule was in the tree and still broken once in the closure's own orchestrator. See (b).

## Claims to test next cycle

1. **Does the re-aimed race trigger fire by round 3?** For each implementation PR with two or more
   interleaving findings on one structure, record the round of the first deferral or named
   primitive. Baseline: rounds 10, 13 and 11 (#2702, #2651, #2649).
2. **Does a model-backed goal grade data or prose?** For each new or changed model-backed goal, note
   whether any leg that states a fact the system holds is graded on the answer text. Baseline: one
   goal, four days, one hidden product bug (FIX-1785).
3. **(b) on the next closure.** Count first-head findings that pass on an absence. Baseline: 19, 21
   and 22 all had them. Note whether FIX-1183 has landed.
4. **Changeset length**, once more. Baseline: 6.
