# Cycle 31 — Clean SDK epic wrap (FIX-2447) (2026-11-15)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**One epic spec, two amendments, one spec-set PR carrying 17 issue specs, one late issue spec, two
direction POCs and 60 implementation PRs, over nine days (11-05 to 11-13). Review was cheap per PR:
93 passes and 138 inline findings over 60 PRs (cycle 30: 51 and 98 over 11), and one PR (#4840)
holds a fifth of the passes. The rework sat somewhere review does not look. The epic's own goal
check ran only on `main`, after merge, and 42 of its 163 completed `main` runs were red. 39 of those
would have shown on the PR that caused them. An owner question was still open when the spec set
merged. The answer arrived three hours later and was amended twice more.**

The classes, checked against the PRs and the Actions history:
- **(a) A goal check read only after merge** (`design-off`, found by measurement, not review). FIX-2564
  built the epic's goal legs on installed tarballs as rows expected to fail, judged by a workflow that
  runs on pushes to `main` and never on a PR. Its D3 gives the reason: *"inside the PR job, an
  expected fail blocks unrelated PRs"*, at the price of *"a second install per main push"*. The judge
  is red only on a **mismatch** (FIX-2564 *Decided, not asked*: *"red when an outcome differs from its
  expectation"*), so an expected fail is green on a PR. The premise mixed up fail and mismatch, and no
  review caught it. What it cost, from the workflow's `main` runs 11-06 14:04Z to 11-14:

  | Window | Cause | Red runs | Fixed by |
  |---|---|---|---|
  | 11-06 18:36–19:25Z | #4825 made `onepath.answer-task-stop` pass, line not flipped | 3 | #4845 |
  | 11-06 23:01Z–11-07 02:13Z | #4840 made `types.fresh-session-default` pass (and #4875 `surface.core-installed-dts`), lines not flipped | 15 | #4892, and #4874 for the second cell |
  | 11-08 02:26–14:43Z | #4913 (FIX-2479, outside this epic) renamed two moved names | 4 | #4937 |
  | 11-08 14:48–22:44Z | #4914 set `closure.j5` to `pass` while it failed | 6 | #4938 |
  | 11-12 22:53Z–11-13 01:48Z | #5139 and #5152 (outside this epic) removed two more root names; j5's exact count went stale | 11 | #5189, then #5205 |
  | 11-10, 11-11, 11-12 | npm served a just-published dependency late (`@ai-sdk/provider-utils` 5.0.79 404, `@ai-sdk/gateway` 4.0.143 and `provider-utils` 5.0.80 not found) | 3 | the next push |

  All 39 mismatch runs were caused by a PR the judge never ran on. The workflow header says a child
  should dispatch it on its own branch before it flips its line. Four branches did (FIX-2457, 2461,
  2562 and 2564's legs). The three whose merge moved a cell (#4825, #4840, #4875) did not, and #4845
  and #4892 are one-line follow-up PRs. FIX-2562's D1 already decided the
  fix for after the wrap: fold the passing legs into the PR-gating `CHECKS` and delete the manifest,
  because *"a red job on `main` is read after the merge"*. The closure closed on 11-15 with that
  fold not done. FIX-2739 (the docs revamp) carries j5 only. **Commented on FIX-2739 with these
  counts, asking whether it carries the rest of D1. Npm lag filed as FIX-2741.**
- **(b) An owner question open past the spec-set gate** (cycle 29 (d), cycle 30 (e): specs against
  a moving epic decision). #4772 merged at 11-06 12:43Z with the epic's DECISIONS reading
  **"Open: [Q1](#q1)"** (line 243 at the merge). The second look had asked on 11-05 for Q1 to be
  answered first, and said the deciding fact (0.4.0 adoption) could be checked then. The owner
  answered at 15:58Z, on child PR #4836: *"Remove the aliases, we don't need backward compat"*. In
  the three hours between, #4830 (FIX-2454) built D3's refusal helper (14:44–15:24Z), then removed
  it in two rewrites (16:01, 16:55Z). #4838, opened at 16:23Z, swept 45 files for the new D4. Eight
  minutes after #4830's second rewrite, Codex found a P1 on it: dropping the `dispatcher` refusal
  leaves a published option silently ignored (`design-off` on D4). The engine's refusal was held (92b9d4f), and four refusals were kept,
  recorded only on 11-10 (#5001). `orchestration.md` says *"a decision on any member parks every
  member, and the PR gets no gate until it's answered"*. `epic-wake` enforces that for a member's
  escalated blocker (`openSetsWithDecision`). It never reads the epic's own `**Open:**` line, which
  is where Q1 lived. **Proposed below as a check.**
- **(c) An interleaving tail on one structure, scored against the fourth-pass rule** (cycles 29 and 30
  (b)). Four PRs took four or more passes. Every branch carried the rule (5bec3f6c, checked by
  ancestry on #4840's and #4827's first commits).
  - #4827 (the export check, 7 passes, 11 findings): comment and string scanning, one case per pass.
    It moved to the syntax tree at pass 3 (9604186). The checker-based reader is filed as FIX-2586.
  - #4770 (FIX-2554, 4 passes): moved to *"fill by walking declared schemas, never a transform's
    output"* at pass 4 (8f9bf63).
  - #4896 (FIX-2455, 5 passes): two structures. Each `useAction` execution got its own controller at
    pass 3 (f987fc0), and `result()` returns the read that settled at pass 4 (cf8990d).
  - #4840 (FIX-2576, **19 passes**: 11 Codex, 7 Gitar, 1 code quality; **31 findings**): zod schema
    fingerprints and default factories. On `zodSchemaSignature` the class closed after eight passes,
    with an allowlist of the 22 modelled zod kinds (6019746, *"since this is the third fingerprint
    hole, I closed the class"*). On factory defaults it closed after five (d3484e0, *"changing course
    rather than patching the birth predicate a fourth time"*: a read never runs a default factory).
    Three more cases came after both. **Scored below as cycle 30's claim 1. Nothing new proposed.**
- **(d) The changeset as the migration record** (`docs-miss`). User docs are written at release from
  changesets, so when package roots have lost 1,084 exports since 0.4.0, the changeset is where an
  adopter's migration lives. Reviewers flagged it on 8 PRs: the wrong bump on 3 (#4891 `minor` for an
  additive API, Codex P1; #4929 `patch` for narrowing a public type, Codex P2; #5164 `patch` for
  1,078 removals, Codex P1), and a wrong statement on 5 (#4882's error classes, #4887's `runRescue`
  home (two reviewers), #4923's pre-rename type names, #4848's docs pages, #4907's tracker ids in the
  CHANGELOG body). All were fixed before merge. The bump class recurs (cycles 5, 15, 16, 18, 20, 22).
  **Rejected as a check below:** #5164's `patch` changed nothing in the release, because every one
  of its 17 packages already carried a `minor` fragment (release plan at de09b77, recomputed for this
  entry). A release-plan check would not have gone red on it.
- **(e) A committed number that other PRs move** (cycle 29 (a)). #5164 had j5 grade the changeset's
  *"N unused exports are removed"* line against the live count on every `main` push. Other epics kept
  removing root names, and `main` went red twice in one evening (#5189 set 1,080, #5205 set 1,084 and
  moved the exact check to the Version Packages PR). Cycle 29's inventory table was the same shape.
  So was (a)'s manifest, whose expectations other PRs made wrong. **Two epics now. Proposed below as
  one `issue-spec` line.**
- **(f) `main` red from a combination no CI ran** (cycles 24, 27, 29 and 30 (c)). #4900 (FIX-2457)
  and FIX-2578's claim-host block were each green, and together failed typecheck on an unused
  `@ts-expect-error` (#4904, closed when #4897 carried the fix). FIX-2340's registry file turned the
  drift test red (#4858). On 11-13 a rename in another epic broke `goals/realtime` (#5205's note).
  Seven PRs here carry a comment explaining a red check as not theirs (cycle 30: nine). **Owner ask,
  fifth cycle: require branches to be current, or a merge queue.**
- **(g) Review findings posted after merge** (cycle 30 (d)). Cursor's simplify pass posted after the
  merge on four PRs (#4997, #4998 and #5001 within two minutes of it, #5189 six minutes after): 14
  findings, none answered. On #5205 it posted 28 s before the merge. Two of the 14 are above the bar. #5001's *"must-fix (contradiction)"* pair is still on `main`: FIX-2562's
  DECISIONS says a retired value *"is not refused under D4"*, and FIX-2564's says *"nothing to
  assert"*, both contradicted by the kept refusals the same PR added. Codex posted twice after merge,
  both on automatic passes, not requested ones. #4830's P2 arrived 2 min after the merge, on a
  merge-from-`main` pushed 37 s before it, and was answered by #5001. #4998's P2 arrived 67 s after
  the merge: a helper-named line that also
  matches `EXCLUDED` skips the census check. It is still on `main`, in a spec POC script.
  **Recorded. Below the cost of a filing: two lines in retained specs and one POC script.**

**Proposals** (for the owner; neither is built in this PR): one check for (b), and one `issue-spec`
line for (a) and (e). No tenet or BP sharpening. (a) is owned by FIX-2562's D1 and now FIX-2739,
(c) and (f) are already encoded or a repository setting, and (d) does not reach a release.

**Method: scope.** FIX-2447's Linear children (GraphQL, read-only), their PR attachments, the epic's
own attachments, and a GitHub search for each child id. For each of 72 PRs: reviews, inline threads
with replies, conversation comments and commits, read through the REST API. The adopter-goal
workflow's `main` runs from 11-06 to 11-14 (229 runs, 163 completed), with each failure's cause read
from its log. Rounds on a direction artifact count a review pass a fold commit answered. Passes on an
implementation PR count distinct (reviewer, commit) pairs that carried an inline finding before the
PR closed. Findings after the close are counted apart. Spec endpoints are merge times. Times are UTC.

**Out of the sample:** #2367 (the project spec, never merged); #4841, #4858, #4890, #4904 and #4937
(other issues' fixes and one process line, read for (a) and (f) only); and PRs the id search matched
by number alone.

**Every act sits behind the shared `jhoffner` login**, so this entry doesn't say who merged what.

### Direction artifacts

| PR | Rounds | Endpoint | Shape of the review | Felt off? |
|---|---|---|---|---|
| [#4762](https://github.com/fixpoint-labs/flow-state-dev/pull/4762) epic | 1 | merge 11-05 00:35Z | Cursor ×8, second look, coherence lens (three calls for the owner), folded at 840e7f6 in 10 min. Cursor priced Q1's recommended alias (kept names on roots until a removal minor), and the owner later chose break. Cursor also asked for FIX-2455's read to be by request id, which the owner answered the same way (5853e91) | yes (Q1) |
| [#4772](https://github.com/fixpoint-labs/flow-state-dev/pull/4772) spec set, 17 members | **4** | merge 11-06 12:43Z | Set review folded per member before review (01:22–01:56Z). r1 the architect's six edits (289be42). r2 a type-or-default conflict, five `/internal` entries (3d96adc). r3 coherence lens: FIX-2452's D2 refused `blobs`, which FIX-2516's epic (#4787) makes real (cb9cce6, `design-off`). r4 Codex P2: the completion check must be an end-state census (2dd1d16). Gitar's census-control finding declined as POC evidence. **Merged with Q1 open** (b) | yes (blobs, Q1) |
| [#4800](https://github.com/fixpoint-labs/flow-state-dev/pull/4800) FIX-2576 | 1 (recorded) | merge 11-06 12:44Z | A late child, from FIX-2554's POC #4788. Second look: three findings above the line, recorded for the implementer. Codex clean | no |
| [#4838](https://github.com/fixpoint-labs/flow-state-dev/pull/4838) amend | 1 | merge 11-06 18:32Z | Q1 answered break, D4 no compat code, 45 files swept. Gitar: FIX-2454's goal is wider than its check (2d67490). Codex clean | no |
| [#5001](https://github.com/fixpoint-labs/flow-state-dev/pull/5001) amend | 2 + post-merge | merge 11-10 20:05Z | Records implementation-time decisions, the four kept refusals among them. r1 Gitar: a history entry split (6438bea). r2 Codex ×5 P2, all `stale-restatement` (`StoresConfig`'s entry, the Shims cells, wait-then-read, the retained helper, the diagram) (fe50b59). Cursor ×6 a minute after merge, two of them must-fix contradictions still on `main` (g) | no |
| [#4768](https://github.com/fixpoint-labs/flow-state-dev/pull/4768), [#4788](https://github.com/fixpoint-labs/flow-state-dev/pull/4788) POCs | 0 | closed | Direction POCs for FIX-2451 and FIX-2554. #4788's became FIX-2576 | — |

### Implementation

| PR | Passes (reviewer × commit) | Findings | Shape of the rework | Felt off? |
|---|---|---|---|---|
| [#4767](https://github.com/fixpoint-labs/flow-state-dev/pull/4767) 2451 | 3 (second look, Cursor, Gitar) | 8 | Second look: the `.ts`-extension rule taxed six first-hour pages, so the CLI now loads `fsdev.config.ts` through jiti (7871b26, `design-off`, folded). User-doc edits moved to the changeset. A config hint shown under `--no-config` | yes |
| [#4770](https://github.com/fixpoint-labs/flow-state-dev/pull/4770) 2554 | 4 (Cursor, 3 Codex) | 8 | Delta writes against defaults, arrays by index, nested objects. Primitive at pass 4 (c) | no |
| [#4825](https://github.com/fixpoint-labs/flow-state-dev/pull/4825) 2450 | 2 | 4 | User docs edited in a normal PR (Gitar, and Codex P1). A stop's reason matched by its request. Its merge started (a)'s first window | no |
| [#4827](https://github.com/fixpoint-labs/flow-state-dev/pull/4827) 2448 (1/4) | 7 (4 Gitar, 3 Codex) | 11 | (c): source scanning, then the syntax tree at pass 3 | no |
| [#4830](https://github.com/fixpoint-labs/flow-state-dev/pull/4830) 2454 | 3 + 1 after merge | 4 + 1 | (b): built against D3, rewritten twice for D4. Codex P1 on the silent `dispatcher` option (`design-off` on D4), held. Codex P2 after merge (g) | yes |
| [#4834](https://github.com/fixpoint-labs/flow-state-dev/pull/4834) 2564 leg a | 2 | 4 | Infrastructure errors read as expected fails; a `pnpm-workspace.yaml` that pnpm before 10.5 rejects | no |
| [#4839](https://github.com/fixpoint-labs/flow-state-dev/pull/4839) 2456 (2/3) | 3 | 4 | The line mark across an optimistic replacement; voice played twice from a doubled mount | no |
| [#4840](https://github.com/fixpoint-labs/flow-state-dev/pull/4840) 2576 | **19** (11 Codex, 7 Gitar, 1 code quality) | **31** | (c) | no |
| [#4896](https://github.com/fixpoint-labs/flow-state-dev/pull/4896) 2455 (2/2) | 5 | 6 | (c): `useAction`'s controller under StrictMode; the read that settled | no |
| [#4907](https://github.com/fixpoint-labs/flow-state-dev/pull/4907) 2453 | 4 | 6 | The changeset copied tracker ids into the published CHANGELOG (d). Template-literal scanning twice | no |
| [#4923](https://github.com/fixpoint-labs/flow-state-dev/pull/4923) 2604 | 3 (Gitar) | 3 | Tracker ids in two test JSDoc headers (BP-006, `philosophy-drift`); the changeset named pre-rename types (d) | no |
| [#4882](https://github.com/fixpoint-labs/flow-state-dev/pull/4882), [#4887](https://github.com/fixpoint-labs/flow-state-dev/pull/4887), [#4848](https://github.com/fixpoint-labs/flow-state-dev/pull/4848) | 2, 2, 1 | 2, 2, 1 | (d): the changeset's migration statement wrong | no |
| [#4891](https://github.com/fixpoint-labs/flow-state-dev/pull/4891), [#4929](https://github.com/fixpoint-labs/flow-state-dev/pull/4929), [#5164](https://github.com/fixpoint-labs/flow-state-dev/pull/5164) | 1, 1, 2 | 1, 1, 4 | (d): the bump level. #5164 also set (e) up | no |
| [#4914](https://github.com/fixpoint-labs/flow-state-dev/pull/4914) 2562 | 1 | 1 | The closure run. Set j5 to `pass` while it failed (a) | no |
| [#4998](https://github.com/fixpoint-labs/flow-state-dev/pull/4998) 2639 | 1 + 5 after merge | 1 + 5 | (g): Codex's P2 67 s after merge, open | no |
| [#5162](https://github.com/fixpoint-labs/flow-state-dev/pull/5162) 2610 (closed) | 2 | 2 | `--allow-build` needs pnpm 10.4 or later (both reviewers). Superseded by #5168 after the owner: *"This still feels like a hack"*, now FIX-2737 | yes |
| [#5189](https://github.com/fixpoint-labs/flow-state-dev/pull/5189), [#5205](https://github.com/fixpoint-labs/flow-state-dev/pull/5205) 2562 | 0, 1 | 0 + 1, 3 | (e)'s two fixes | no |
| The other 38 | 24 | 31 | None past two passes. 20 had no inline finding | no |

The coordinator reported two of its own dispatch briefs as wrong: a `patch` bump (#5164) and a
pnpm 9 claim for FIX-2610. The PR record shows both corrected after review. #5164's first commit
used `patch`, and Codex's P1 fixed it. #5162's first commit gave no pnpm floor, and both reviewers
flagged it. The briefs themselves are not in the PR record, so this entry cannot score cycle 16's
claim 3 (facts in briefs) from them.

**Load.** Direction: 9 rounds over 5 reviewed artifacts (1.8 each; cycle 30: 1.4). One past two
rounds: #4772, a 17-member set whose third round was a cross-epic collision. Implementation: 93 passes
over 60 PRs (1.6 each; cycle 30: 4.6), 138 inline findings before close and 10 after. #4840 holds 19
passes and 31 findings of it.

**Classes.** Direction (22 inline findings before merge and 6 after, plus second-look and coherence
comments): `nit` and `over-engineered` lead (Cursor's simplify notes). Then `stale-restatement`,
about 9 (#5001's five Codex P2s and two must-fixes, the restated legs on #4772, #4830's BP-034 line
against the specs). `design-off`: 2 (#4762's Q1, #4772's `blobs`). Implementation (148): `missed-edge-case`
about 93, `nit` and `over-engineered` about 30, `docs-miss` about 21 (d, and user docs in normal
PRs), `design-off` 2 (#4767's extension tax, #4830's silent option), `philosophy-drift` 2 (BP-006 on
#4923). Reading labels: `overclaim` on FIX-2564's D3 (a premise stated about its own judge that the
judge's rule contradicts).

**design-off: 5.** Two on direction artifacts, folded or answered by the owner. Two on implementation
PRs, folded. One found only by measuring `main` (a).

**Claims (looped / settled / verdicts):** 0 / 0 / —. Two direction POCs ran before the gate (#4768,
#4788), not settlements. Q1's deciding fact (0.4.0's adoption) was called checkable on 11-05 and was
never run. The owner decided it.

**Reviewer exhaustion:** none found. **Merged with a finding open:** #5001 (2 above the bar, after
merge, unfiled), #4998 (1, after merge, unfiled), #4772 (2 Cursor simplify notes, below the bar).

**Epic row:**
`ways per job: read an action's output 4→1 (request.result(); useAction's result option and testing's
run.answer read it) · answer a user's stop 2→1 (answer; testFlow answers through the same route) ·
fill a scope state's defaults ~25→1 (FIX-2554's count of fallbacks and helpers; applyScopeStateDefaults
over the merged scopeStateSchema) · hold a published root to what adopters use 1→2 (Fallow's unused
exports; the export check's ratchet, a different question by ER-4) · tell an upgrader which exports
were removed 0→1 (the one summary line j5 grades) · check the first hour on installed tarballs 1→2
(packed-install's CHECKS on PRs; the adopter-goal manifest on main; D1 folds it back, not yet done) ·
say who a published entry is for 1→1 (/internal on seven packages, /host on three, by D2) · type a
helper that takes a block's ctx 2→2 (BlockContext made assignable; LooseBlockContext kept and taught,
FIX-2740) · migrate across a rename 3→1 (break, four kept refusals) · tell whether a harness run was
stopped 3→1 · list a harness's models 3→1 · gate a harness on its SDK version 3→1 · order a board's
claims 2→1 · write a task collection's methods (one per constructor)→1 (the method table) · jump a
conversation to its latest message (one per app)→1 (the registry Conversation on useJumpToLatest) ·
keep tracker ids out of what ships 1→1 (one pattern read by the lint, its strict run and the tarball
scan) · read a status item's side-chain count 2→1 (sideChainTasks only) · name a worker's entry 2→1
(documented strings; the *_ENTRY constants off the root) · configure a store (several factories per
store root)→1 · load an app's runtime file in the CLI 1→1 (fsdev.config.*, now loaded through jiti) ·
count a debt pattern (one census script per spec, spec evidence only, unchanged)`

## (b) A check, not an ask

**Proposed (rung 1, architecture, for the owner):** `epic-wake` holds a spec-set PR's approval and
merge gate while the epic's DECISIONS `**Open:**` line names a fork, the same hold it gives a
member's escalated blocker (`openSetsWithDecision`). The rule is already written
(`orchestration.md` → *"the PR gets no gate until it's answered"*). Only the epic-level source is
missing.

- **It goes red on the real instance.** At #4772's merge (11-06 12:43Z) the epic's DECISIONS line 243
  read `**Open:** [Q1](#q1).` The hold would have kept the gate until #4838's text, and #4830
  would have been built once, against D4.
- **What it does not reach.** The epic PR itself: the template lets an epic merge with live forks
  named (`epic-spec-template.md`, *"Open: none, or the live forks named"*). So cycle 30's #4515 is
  out of reach, and that is deliberate. It also does not stop an owner from answering on a child PR,
  as here. It only keeps the set from merging first.
- **What it costs.** One more read in a wake, of a line every epic spec already carries. What being
  wrong costs: a set waits on an owner question the owner meant to answer later. They can mark it
  answered, or move it off the `Open` line.

## (a) and (e): one `issue-spec` line

Three instances in two epics of one shape: a committed expectation (a table, a count, a manifest
line) that other people's PRs make wrong, checked somewhere other than where the expectation is set.
Cycle 29's inventory table broke the next branch on every merge (29 commits and a deletion). Here,
j5's count turned `main` red twice in one evening, and the manifest 39 times in eight days. A lint
can't see the shape: whether a number is something other PRs move is a judgment about the domain.
So it lands at rung 5, altitude 4, as one line in `issue-spec`'s *how we verify* bullet:

> A goal check whose expected value other PRs move (a count, a table, a manifest line) is either
> derived when it runs, or checked where its value is set, on that PR or at release. Checked only
> on `main` after merge, it is red on other people's merges.

Proof it would have fired: FIX-2564's D3 (the manifest on `main` only) and FIX-2562's Nov 12 D1
amendment (an exact count on every push) are both spec decisions that a reader holding this line
would have had to answer. FIX-2562's own D1 reached the same conclusion for after the wrap.

## Enforcement, rung by rung

- **(a)** Rung 1 is D1's fold, owned by FIX-2562 and now FIX-2739 (commented). The npm half is FIX-2741.
- **(b)** Rung 1, proposed above.
- **(c)** Rung 5 written (`issue-implement`, the fourth-pass count). It fired on 5 of 6 structures by
  their fifth pass. Scored, nothing new.
- **(d)** Rung 5 written (BP-022, `release-notes-workflow.md`). Every instance was caught in review.
  A release-plan check would not have gone red on #5164, so it isn't proposed.
- **(e)** Fixed at rung 3 for j5 (#5205, exact count at release). The general shape gets the line above.
- **(f)** A repository setting. Owner ask, fifth cycle.
- **(g)** Cursor's simplify automation fires on merge by its configuration. Recorded.

## Accepted and Rejected

**Accepted:**
- (a): FIX-2741 filed (npm lag). FIX-2739 commented (D1's full fold). Job audit: FIX-2740 filed (the
  second helper context type).
- (b): the spec-set hold on the epic's `Open` line, proposed for the owner.
- (a) and (e): the `issue-spec` line, proposed for the owner.
- Owner ask: (f) branch currency or a merge queue.

**Rejected:**
- *A check that a package losing a root export bumps `minor`* (d). The release plan at de09b77 already
  had `minor` for all 17 packages, so it would not have gone red on #5164. A check that has never gone
  red on its class is decoration.
- *A BP or tenet for (b).* The rule is written in `orchestration.md`. What is missing is the read.
- *Sharpening BP-003 for D3's premise* (a). BP-003 already says to execute or parse a claim the change
  rests on. One instance, and D1 owns the fix.
- *Filing (g)'s three open findings.* Two lines in retained specs and one spec POC script. Recorded
  here, so the next reader of those specs can find them.
- *A rule for the coordinator's briefs.* Not derivable from PR data (above).

## Job audit

Run in this worker, once per job that two or more issues grew. A job one spec saw whole is listed as
cleared by that spec. Every addition considered, by job:

| Addition (PR) | Job |
|---|---|
| `request.result()`, the status route's read by request id (#4891, #4896) | read an action's output |
| `useAction({ result: true })`; `useReadFence` to `react/internal` (#4896) | read an action's output |
| `run.answer` and `run.resume` return the run's output and error (#4895) | read an action's output |
| React's `answer`; `resumedBy` removed (#4825) | answer a user's stop |
| `testFlow` answers a suspension through the engine's route (#4889) | answer a user's stop |
| `applyScopeStateDefaults` on every scope read (#4770) | fill a scope state's defaults |
| `scopeStateSchema`, the merge of block and capability declarations at `defineFlow` (#4840) | fill a scope state's defaults |
| `scripts/check-root-exports.mjs`, `import-census.mjs`, wired into the goal (#4827, #4887) | hold a published root to what adopters use |
| `packages/react/test/root-surface.test.ts` (#4923) | hold a published root to what adopters use |
| The one removed-exports changeset line and j5's grade of it (#4914, #5164, #5189, #5205) | tell an upgrader which exports were removed |
| `adopter-goal.yml`, `goal-manifest.json`, legs a to c, the closure row (#4826, #4832, #4833, #4834, #4914) | check the first hour on installed tarballs |
| `core/harness`, `core/internal` (#4855, #4875); `engine/host`, `engine/internal` (#4882); `orchestration/internal`, `orchestration/tasks` as the task names' home (#4837, #4856); `react/workforce` (#4836); `react/voice`, `react/internal` (#4923); testing's subpaths (#4885); patterns' kebab-case subpaths (#4848) | say who a published entry is for |
| `BlockContext` assignable from a typed `ctx` (#4900, #4929) | type a helper that takes a block's ctx |
| The never-published shims deleted; four refusals kept inline (#4830) | migrate across a rename |
| One stop kind, one model list and environment base, one SDK version gate across three harnesses (#4878, #4879, #4884, #4893) | tell whether a harness run was stopped; list a harness's models; gate a harness on its SDK version |
| `fifo` as the one claim order (#4850) | order a board's claims |
| The task collection's method table (#4865) | write a task collection's methods |
| The registry Conversation on `useJumpToLatest`, one jump button (#4839, #4854) | jump a conversation to its latest message |
| `fsd/no-tracker-ids`, `check-tracker-ids.mjs`, `scan-tracker-ids-in-tarballs.mjs` (#4907) | keep tracker ids out of what ships |
| Entry names as strings refused at hire; the `*_ENTRY` constants off the root (#4899, #4903) | name a worker's entry |
| One store factory per store root, no store line until data is kept (#4897) | configure a store |
| `fsdev.config.ts` loaded through jiti (#4767); the quick start's config step (#5168) | load an app's runtime file in the CLI |
| `sideChainTasks` only (#5159) | read a status item's side-chain count |
| Spec-time census scripts under `specs/issues/*/poc/` (FIX-2448, 2453, 2454, 2457, 2460; extended by FIX-2608 and FIX-2639) | count a debt pattern (spec evidence, not shipped) |
| `spec-implementer` searches `/internal` before writing a helper (#4890) | none (a process line) |

**Audits run:**
- **read an action's output** (FIX-2455, FIX-2460). Surface: `request.result()` in the client;
  `useAction`'s `result` option over it; the labs' adapters on `result()`; testing's `run.answer`
  returning the same output and error. `withListedResult` stays on the session list route, which
  lists requests and is not an adopter read (FIX-2455 rejected list-and-find). Coherent.
- **answer a user's stop** (FIX-2450, FIX-2460). One verb. `testFlow` reaches the engine's answer
  route, and FIX-2460's *not done if* forbids any other route. Coherent.
- **fill a scope state's defaults** (FIX-2554, FIX-2576). Surface: `applyScopeStateDefaults` over
  `scopeStateSchema`, at the load, the state routes, the session view, the session list and child
  adoption. Looks bad but is fine: `normalizeStateDefault` starts a block's own state container (a
  different scope), and `parseInitialSessionState` validates a write against the flow's own schema
  on purpose. Coherent.
- **hold a published root to what adopters use** (FIX-2448, FIX-2604, FIX-2641). Surface: Fallow
  (unused anywhere), the export check (unused outside the framework, a ratchet against the base),
  and react's `root-surface.test.ts`. The epic's ER-4 compared Fallow and the check and kept both. The
  react test pins three names the ratchet already holds. A small duplicate, not a second policy.
  Coherent.
- **check the first hour on installed tarballs** (FIX-2564, FIX-2562, FIX-2709). Two ways: the
  packed-install job's `CHECKS` gating PRs, and the manifest judged on `main`. D1 folds the second into
  the first. It was not done at the closure. **FIX-2739 commented.**
- **say who a published entry is for** (FIX-2448, 2449, 2456, 2458, 2459, 2460, 2604). One convention
  by D2: `/internal` on client, core, engine, orchestration, react, workforce and workspace; `/host`
  on engine and both stores. Looks bad but is fine: `engine/testing` and `scheduled/testing` serve
  store and transport authors' conformance tests, an audience `/host` would also fit. Coherent.
- **tell whether a harness run was stopped**, **list a harness's models**, **gate a harness on its SDK
  version** (FIX-2458, four PRs). One shape per job across claude-code, codex and cursor. Coherent.

**Cleared by a spec:** tell an upgrader which exports were removed (FIX-2562's D1, amended 11-12 and
11-13); type a helper that takes a block's ctx (FIX-2457's D3, which keeps `LooseBlockContext`
exported with no job. The audit's read: under D4 that is a second way kept for compatibility.
**Filed as FIX-2740**); migrate across a rename (epic D4); order a board's claims and write a task
collection's methods (FIX-2459, with FIX-2462's appendix); jump a conversation to its latest message
(FIX-2456); keep tracker ids out of what ships (FIX-2453: one pattern, three readers); name a worker's
entry (FIX-2463); configure a store (FIX-2452); load an app's runtime file (FIX-2451 and FIX-2709);
read a side-chain count (FIX-2707); count a debt pattern (the epic's *Notes from review*: a shared
census library is worth building only once a POC script becomes a default job).

## Scoring the previous cycle's claims

- **Claim 1 (merged before the requested Codex pass):** 0. Every requested pass had completed before
  its PR merged. Two automatic Codex passes posted after merge (#4830 on a merge-from-`main` pushed 37 s
  before the merge; #4998, 67 s after). Cycle 30's `codex-review` status was not built (no such
  workflow on `main`), and it would not have held either: both PRs' last requested pass was complete.
- **Claim 2 (two copies of one decision, poll and push):** out of sample. No PR here changed routing.
- **Claim 3 (open findings at merge, unfiled):** 3, all posted after merge (#5001 ×2, #4998). Baseline 2.
- **Claim 4 (merged past a completed pass's unreplied finding):** 0 above the bar.
- **Cycle 29's and 30's fourth-pass answer:** 5 of 6 structures named their primitive by their fifth
  pass (#4827 at 3, #4770 at 4, #4896's two at 3 and 4, #4840's factory defaults at 5). #4840's
  fingerprint took eight. Every branch carried the rule.

## Claims to test next cycle

1. **A spec set merged with the epic's `Open` line naming a fork.** Baseline: 1 (#4772). If the hold
   lands, it reads 0.
2. **Goal checks off the PR.** Count red `main` runs of any workflow that runs only on `main`, and how
   many a PR run would have caught. Baseline: 39 of 42 here.
3. **A committed expectation that other PRs move.** Count fix PRs whose only change is a count, table
   or expectation line that someone else's merge made stale. Baseline: 5 here (#4845, #4892, #4937,
   #5189, #5205).
4. **Findings posted after merge, above the bar, unanswered.** Baseline: 3 (#5001 ×2, #4998).
