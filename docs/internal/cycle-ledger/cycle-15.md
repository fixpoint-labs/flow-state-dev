# Cycle 15 — remove-superseded-leftovers epic wrap (FIX-1208) (2026-09-22)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**The epic whose whole product is a promise to consumers, and the surface that carries that promise
is where the defects concentrated.** Sixteen of the 61 non-`nit` findings on the nine implementation
PRs are defects in a `.changeset/*.md` fragment — **about a quarter of the implementation PRs' review
load on one file type**. The epic-spec on #1376 took about nine automated waves and 46 review threads,
and **seven of its findings are defects that an earlier round's own correction created or left
behind**, each self-attributed by the author in the thread that closed it.

**This entry was recounted after review, and the recount changed its numbers.** A Codex pass on #2059
found the class column declared "(deduped)" while one row counted a single defect four times.
Re-reading every thread showed it was not one row: the first draft counted threads, collapsing some
duplicates and not others, under no written rule. Every row below is now derived under the rule in
*Method — findings*, and the **finding map** at the end of this entry lists the threads behind every
count, so each number can be rebuilt. Where the recount moved a figure, the entry says so where the
figure lands.

**Method — scope, declared first.** Thirteen artifacts: the epic PR #1376, the nine implementation PRs
its running index names, both FIX-1440 artifacts (spec #1888, implementation #2028), and the wrap's
docs-polish PR #2058, which merged after the first twelve were collected (2026-09-22T21:40Z,
`8d1a25370`, final head `4a0afc5`) and was first recorded here as an open partial. All thirteen were
**thread re-read** in full, bot and human, with the author's replies; #1888's conversation comments
were read as well, because its direction amendments live there. Two satellites — #1388 (FIX-1155) and
#1393 (FIX-1214) — are **out of the sample** and are not zeros. Every artifact reached its own
endpoint; **there are no partials in this entry.**

**Method — findings.** One finding is one distinct defect — a false claim, a missing case, a surplus
surface or a stale restatement — identified by what had to change. **Threads naming the same defect
collapse to one:** across reviewers, an umbrella and its instances, or a re-filing on a later head.
On an implementation or docs PR a finding is `nit` when it affirms the diff, was refuted on evidence,
or every thread naming it carries its reviewer's own low-severity marker (*nit, minor, optional,
cosmetic, soft, heads-up, taste, unsure, should-discuss, not blocking, no change needed,
acceptable*); a Codex P1 or P2 badge, "definite", or no marker at all is not low. On the epic PR, a
direction artifact, BP-040's bar applies instead: a finding the author declined, or that a later head
had already fixed, is `nit`, and everything held or folded counts. Every other finding takes exactly
one class from the closed set, by substance. `T`-numbers in the finding map are positions in each PR's
review-thread list, oldest first, as the reviews API returns them.

**Method — rounds.** `Rounds` = **spent waves**, per cycle 12's definition: a commit drawing at least
one automated pass, followed by a push. **Read** from the complete `/pulls/N/reviews` list for #1390,
#2028 and #2058. **Derived**, and marked `~`, for the other ten: #1376's reviews list was read only
to its first page (30 entries, ending 20:16Z, on a review that ran to 22:09Z), so its waves come from
review-thread timestamps, like the nine cleanup PRs'; #1888's come from the author's own
round-labelled comments plus the owner's two amendments. A derived count is weaker and is not to be
compared against a read one. *An earlier draft of this block listed #1376 as read and left #1888
unmarked; both were wrong.*

**Method — endpoints.** Per the endpoint table: implementation and docs PRs end at merge; the epic PR
ends at **epic-PR close** (#1376 closed unmerged 2026-08-23T02:08Z); the spec PR ends at
**revision-bound direction approval** (#1888, "Approved", 2026-09-18T17:17Z, closed unmerged the same
minute).

| PR | Kind | Rounds | Endpoint | Feedback classes (deduped) | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1376](https://github.com/fixpoint-labs/flow-state-dev/pull/1376) epic-spec FIX-1208 | epic | **~9** | epic-PR close | **missed-edge-case ×11** · spec-ambiguity ×6 · design-off ×4 · stale-restatement ×4 · docs-miss ×4 · nit ×8 — *37 findings from 46 threads* | **yes** — **seven findings are defects an earlier round's own correction created or left behind**, author-attributed | four were echoes, which a restatement sweep after each correction finds; three were defects in the new text itself, which only verifying the replacement as hard as the original finds |
| [#1390](https://github.com/fixpoint-labs/flow-state-dev/pull/1390) impl FIX-1209 | impl | **4** | merge | **docs-miss ×7** (six *overclaim*) · missed-edge-case ×2 · nit ×2 — *11 from 13* | no | **the release note was derived from the `@deprecated` comments, one of which was wrong at the source** |
| [#1387](https://github.com/fixpoint-labs/flow-state-dev/pull/1387) impl FIX-1210 | impl | ~3 | merge | missed-edge-case ×3 (1 *vacuous-assertion*) · stale-restatement ×1 · docs-miss ×1 · nit ×4 — *9 from 11* | no | **the new `@ts-expect-error` assertion was in no compiled project — it could not fail** |
| [#1392](https://github.com/fixpoint-labs/flow-state-dev/pull/1392) impl FIX-1211 | impl | ~2 | merge | **over-engineered ×6** (two BP-030 dual-reads dropped inside a PR whose stated contract is "behaviour-preserving") · docs-miss ×2 · nit ×4 — *12 from 14* | no | a cut whose evidence is real still needs its own review question |
| [#1389](https://github.com/fixpoint-labs/flow-state-dev/pull/1389) impl FIX-1212 | impl | ~1 | merge | docs-miss ×2 · nit ×1 — *3 from 3* | no | — **the quietest artifact in the epic** |
| [#1394](https://github.com/fixpoint-labs/flow-state-dev/pull/1394) impl FIX-1213 (docs) | impl | ~6 | merge | **missed-edge-case ×16** (all *overclaim*) · stale-restatement ×3 · docs-miss ×1 · nit ×4 — *24 from 25* | no | **a docs rewrite asserted framework behaviour it had not run** |
| [#1391](https://github.com/fixpoint-labs/flow-state-dev/pull/1391) impl FIX-1215 | impl | ~3 | merge | missed-edge-case ×3 · docs-miss ×2 · stale-restatement ×2 · over-engineered ×2 · nit ×2 — *11 from 16; the wrong issue ref is **one** finding across four threads* | no | **one P1 thread was still open at merge** |
| [#1395](https://github.com/fixpoint-labs/flow-state-dev/pull/1395) impl FIX-1216 | impl | ~2 | merge | **docs-miss ×2** (six packages bumped that publish nothing, one defect across three threads; `core` *under*-bumped) · nit ×5 — *7 from 10* | no | **the bump was classified from the PR's own description, not from the emitted `.d.ts`** |
| [#1396](https://github.com/fixpoint-labs/flow-state-dev/pull/1396) impl FIX-1217 | impl | ~3 | merge | docs-miss ×4 · missed-edge-case ×1 · nit ×2 — *7 from 8* | no | the note said "error responses"; the helper it changed serves every JSON response |
| [#1406](https://github.com/fixpoint-labs/flow-state-dev/pull/1406) impl FIX-1220 | impl | ~2 | merge | docs-miss ×1 · nit ×5 — *6 from 6* | no | — |
| [#1888](https://github.com/fixpoint-labs/flow-state-dev/pull/1888) spec FIX-1440 | spec | **~4** | direction approval | missed-edge-case ×3 · docs-miss ×2 · stale-restatement ×1 · nit ×2 — *8: six threads and two from the conversation* | **yes** — **an approved direction was superseded by the owner 21 minutes later**, then amended again on presentation | not a review-rework row; see below |
| [#2028](https://github.com/fixpoint-labs/flow-state-dev/pull/2028) impl FIX-1440 | impl | **2** | merge | **missed-edge-case ×7** · docs-miss ×2 · over-engineered ×2 · nit ×5 — *16 from 18* | no | **round 1's own fix opened round 2's race; round 1's own org fix was inert in production** |
| [#2058](https://github.com/fixpoint-labs/flow-state-dev/pull/2058) docs-polish (wrap) | docs | **1** — *plus 4 self-driven revision rounds before it left draft; not comparable to this column* | merge | **stale-restatement ×4** (three factual, one vocabulary — every fixed review finding was a surface still saying what the PR had corrected elsewhere) · nit ×3 — *7 from 7*. The owner merged the vocabulary call as drawn | no | **it fact-checked its new claims and never swept for the old ones** |

**Load: ~28 spent waves across the ten implementation artifacts (4+3+2+1+6+3+2+3+2 on the nine
cleanup PRs, 2 on #2028), plus ~9 on the epic PR, ~4 on the spec PR and 1 on the docs-polish PR.** Both
direction artifacts blew the two-round budget, and **for opposite reasons** — which is the distinction
the rest of this entry turns on.

**Claims (looped / settled / verdicts): 0 / 0 / —, on every direction artifact.** No POC settlement
fired anywhere in this epic, and none should have. Two claims that had the shape of a loop were closed
in a single exchange by an author who **built the artifact and read it** rather than arguing: on #1390
the `FSDEV_DEBUG_ITEMS` provenance ("landed 13 days ago in #1110") was REFUTED against
`git log -S` — it landed four months earlier in `01a2897`, and #1110 never touched `packages/core`;
on #1395 two reviewers argued from the `@internal` + underscore convention that the removal was a
`patch`, and the author settled it by building `core` and grepping the output
(`dist/types/block.d.ts:557: _outputTracker?: {`). That is `issue-spec` 6.5.3's first cheap out —
*the answer is in the repo* — working exactly as written, twice, before a loop could form.

## The largest class — and why it gets no proposal

**16 of the 61 non-`nit` findings on the nine implementation PRs are defects in a `.changeset/*.md`
fragment — 26%.** "In the fragment" means the defect is in the release note itself, wherever its
thread happened to be anchored: #1390's false successor rows were filed partly on the fragment and
partly on the source lines they described, and each counts once. *The first draft said 20 of 61, 33%.
It counted threads by file path, so it counted #1391's one wrong issue ref four times and #1395's
over-bump three times, included two threads that are `nit` under the rule (#1390's no-change
affirmation, #1395's knip note), and counted #1390's umbrella thread once where it names four distinct
false rows.* The finding map marks the sixteen. Six shapes, and one root under most of them:

| Shape | Findings | The root |
|---|---|---|
| **Claimed an equivalence the code does not support** | #1390 ×6 (`AgentType`→`ItemVisibility`, `reviewOutputSchema`→`reviewerVerdictSchema`, `PRE_RANK_CAP`→`PRE_RANK_EPISODIC_CAP`, the `BasePlan*` set, `CollectionItem` as a rename when it is a package move, a `scores` field that has never existed) · #1396 ×1 (the note said error responses; every JSON response changed) | the fragment was written from the **old `@deprecated` comments and the PR's own narrative** |
| **Classified the release from the change's self-description** | #1395 ×2 (six packages bumped that publish nothing; `core` under-bumped because `@internal` was read as a filter when `stripInternal` is set in no tsconfig) · #1396 ×1 (`orchestration` bumped for an internal extraction) · #1406 ×1 (a non-empty fragment for an unreachable cleanup) | the fragment asked *what did I do?* instead of *what does the consumer get?* |
| Understated what a consumer loses | #1390 ×1 (`ContextItem` also left `@flow-state-dev/core/items`) | the blast radius was read off the package the name lived in, not every entry that re-exports it |
| Internal inventory copied into the published changelog | #1396 ×1 (P1) · #1391 ×1 (P1, **still open at merge**) | the body was written for the reviewer |
| A second fragment for one change | #1392 ×1 | two fragments describing one `toError` move |
| One wrong issue ref | #1391 ×1 (four threads: three reviewers and the author) | `validate-changeset-refs.mjs` asserts a `TEAM-123`-shaped id is *present*, never that it is the right one |

Every fold was the same operation, and it worked every time: the author **resolved the artifact the
consumer actually receives**. Export-map resolution through ts-morph with a known-public control per
package. Building the package and grepping `dist/`. Compiling a probe per removed option. On #1395
the control earned its keep out loud — *"My first pass had `thought-fabric` and `orchestration`
reporting everything as unreachable because I'd listed their entry files wrong; the controls caught
that, which is why they're there."*

**No proposal, and the reason is cycle 14's.** BP-022 and `release-notes-workflow.md` already say
this, unambiguously, and reviewers **quoted them correctly at the defect** — Codex cited `AGENTS.md`'s
release-note lines on five separate fragments (#1390, #1391, #1395, #1396, #1406), and the author's
own replies quote `release-notes-workflow.md` back verbatim. A seventh sentence on a rule that was
being recited at the defect is the intervention cycle 14 measured and rejected. Two further reasons to
hold: this is a **removal epic**, where the release note *is* the deliverable, so the concentration is
partly a property of the sample; and the one mechanical gap here is not a rule at all — the
changeset-ref validator cannot fail on a well-formed wrong id, which is a **guard**, filed below, not a
lesson.

## The class that earns the proposal — the second-order defect of a correction

Across the epic, **seventeen findings are defects that an earlier correction in the same artifact
created or left behind** — counted only where the author's reply or the fixing commit says so, so the
set can be rebuilt from the text alone. *The first draft said thirteen. It missed #1376's T41, #1394's
T22, #1387's T10 and #1390's T11, and its reachability walk used #1376's T44, which the author never
attributed to an earlier fix, in place of T33, which he did.*

| Artifact | Findings | Which, in the author's own words |
|---|---|---|
| **#1376 epic-spec** | **7** | T33 *"The fix you asked for produced the defect you're now reporting"* · T38 *"this is a hole my own fix opened"* · T39 *"I put it there by fixing §5's label and leaving the summary that quotes it"* · T40 *"You identified the root the last three rounds were patching around"* · T41 *"An earlier draft of this line said 'successor or migration evidence', and that `or` was the same shape of bug §1 had already fixed two rounds earlier"* · T42 *"The previous round's fix — mine — reached for a criterion above all six cut kinds"* · T43 *"The fault was scoping the exception to a label"* |
| #1394 docs | 2 | T18 *"my own fix last round introduced it… I verified two of the three and generalised to the third"* · T22 *"my previous wording was wrong"* |
| #2028 impl | 1 | T15 *"you are right that this PR introduced it… the earlier cross-flow fix traded one defect for a narrower one"* |
| #1888 spec | 1 | D3 *"Both cancellations were decided by asking 'does this describe the surface we are deleting?' rather than 'is this defect real in the code we will ship'"* |
| #1387 impl | 1 | T10 *"I under-called this when I flagged it myself — 'matches the existing convention' was not a good enough answer for an assertion this PR adds"* |
| #1390 impl | 1 | T11 *"This also supersedes my reply on the (now resolved) changeset thread above, which listed `CollectionItem` among 'exact aliases, change the import and move on.' That was the same error, and it was mine."* |
| #2058 docs-polish | **4** | `c6d6e54` *"the cross-flow case biting a third time, in the definition itself"* · T4 / `da770b3` *"the claim task-board.md already corrected"* · T6 / `4a0afc5` *"its example took only an id and the conversation's flowKind, so copying it dropped the owner address"* · T7 / `4a0afc5` *"still promised shared rows serialise with no such limit"* |

**#2058's review row and its fix-induced count are both four, and they are different sets.** The row
counts review findings {T4 guide, T5 DevTool page, T6 React example, T7 concurrency}. The fix-induced
count is {`c6d6e54`, T4, T6, T7}: T5 is a *vocabulary* echo and the population here is factual, and
`c6d6e54` is fix-induced but was found by the author's own fact-check before review, so it is not a
review finding. The first head's half-carried term (`8f07918`) is the same shape, also vocabulary,
also uncounted. #2028's inert org fix is **not** counted either: it was plainly a round-1 fix that did
not work, but the round-2 reply attributes the miss to fixture asymmetry rather than to the fix, and
the rule counts only what the author says. That makes seventeen a floor.

**Two mechanisms, and only one of them is reconciliation.**

- **Echoes — 8.** A correction landed, and a surface that restated the old claim went on saying it:
  #1376 T33, T38, T39, T40; #1888's inherited dispositions; #2058 T4, T6, T7.
- **Defects in the fix itself — 9.** The new text or code was wrong on its own: #1376 T41, T42, T43;
  #1394 T18, T22; #2028 T15; #1387 T10; #1390 T11; #2058 `c6d6e54`.

No reconciliation rule reaches the second group. It is BP-003's population — verify the replacement as
hard as the claim it replaced — and cycle 14 measured what one more sentence there buys. The proposal
below is about the first group.

**The tell is that the author named the class himself, mid-epic, and self-remedied — and it kept
happening.** On #1376 thread 39: *"I swept rather than fixing the one line, because every round lately
has been a fix creating the next finding."* T40 and T41 were filed the same minute that reply went up,
and T42 and T43 eleven minutes later. A class that survives the person in it noticing it is a class
that needs a structural obligation, not more attention.

### Where the echoes come in — three doors, and the rule already exists

The obvious diagnosis is that the epic-spec cannot reach the rule that owns this. **That diagnosis is
wrong, and this entry's first draft made it** — on a case-sensitive grep that missed `Redraft`. The
re-draft obligation *is* reachable from the epic-spec path:

- `orchestration.md:445`, the canonical spec-review triage table, **Fold in — spec-level**:
  *"Re-draft the affected repository document and figures, reply on the thread."* This governs epic
  specs as well as issue specs.
- `epic-spec-template.md:627`: *"Direction changes or a POC refutes a premise | Redraft and obtain
  fresh human approval."*

Both are about a **fold**, and neither names a sweep or a report. The sentence immediately under the
triage table, and the identical one in `issue-spec` 6.5.1, exempts the other kind of change:

> **Genuine factual corrections and broken references are the one cheap exception: fix them inline
> without ceremony (they don't move the design, so they don't cost a round).**

The eight echoes came through three doors:

| Door | Echoes | What governs it today |
|---|---|---|
| An inline factual correction on a spec — the cheap exception | **3** — #1376 T33, T38, T39 | exempted from the re-draft |
| A fold or a direction change on a spec | **2** — #1376 T40; #1888's dispositions | *"re-draft the affected document"*, and for an issue spec `issue-spec` 6.5.2 — reachable, and the echo happened anyway |
| A docs-polish pass | **3** — #2058 T4, T6, T7 | nothing: `polish-docs` has no sweep and, by case-insensitive grep, no pointer to one |

The three through the exemption each followed a correct factual fix that moved no design: the
remainder enumerated by name instead of counted (T33), the seed flags reclassified against what they
actually do (T38), the "evidenced" label withdrawn (T39). Each left a restating surface — the
objective, the gate's category list, the summary that quoted the label — and none was re-derived,
because the exemption that spared the correction a round also spared it the re-draft. T40 is an echo
of folds: the gate gained categories over several rounds, and the criteria written for one bar were
never re-derived, under a re-draft instruction that was reachable the whole time. *The first draft
said five of #1376's six came through the exemption. It counted T43 and T44 as echoes — T43 is a
defect in the fix and T44 is not author-attributed — and it left out T33.*

**And the obligation all three doors need is already written, word for word.** `issue-implement`
10.6's **word sweep** and **surface sweep**, with its instruction to report both by name, is the
canonical rule for a correction whose echoes survive it. It is heavier and more precise than anything
this entry would write fresh.

## The recommended upstream fix — revised by the recount

**What was first proposed.** Scope the cheap exception to the round count, not to the
reconciliation: one clause in `orchestration.md`'s spec-review section, mirrored in `issue-spec`
6.5.1.

> …fix them inline without ceremony — they don't move the design, so they don't cost a round. **They
> do owe the reconciliation: before the push, re-derive every surface that restates what you
> corrected — the criteria, the index, the sign-off, the category and route lists, the summary that
> quotes it — and say which moved.**

**What the recount does to it.** It reaches three of the eight echoes and three of the class's
seventeen. And it is, in effect, a paraphrase of 10.6 — a new restatement of a canonical rule, which is
the exact thing this entry spends its length showing goes stale.

**Two options, and the choice is the owner's.**

- **A — the clause as first proposed.** New words on the cheap exception. Reaches **3 of 8** echoes.
- **B — point, don't paraphrase.** Two pointers and no new rule text. The spec-review triage section,
  covering both the Fold-in row and the cheap exception beneath it, and `polish-docs`' Verify step each
  say: *before the push, run `issue-implement` 10.6's word and surface sweeps over every claim you
  corrected, and report both.* Reaches **7 of 8**; the eighth, #1888's, sits on an issue-spec direction
  change that 6.5.2 already governs.

**Recommendation: B.** It is the lighter rung — a pointer to the canonical rule rather than a second
copy of it — and its evidence is one mechanism across three artifacts, not one evening on one.
**What would change my mind:** if 10.6's sweeps, written for implementation-PR feedback, prove too
heavy for a spec correction that moves one sentence. Then A is the right weight for the cheap
exception, and B should keep only the fold row and `polish-docs`. **What being wrong costs:** a
pointer that leads a spec author into a heavier procedure than the correction needed — reversible in a
commit. **The caveat B does not escape:** two of the eight echoes happened where a re-draft instruction
was already reachable. That is cycle 14's pattern, a rule available and not applied. A pointer adds
reach, not compliance. What B carries that A does not is 10.6's requirement to **report both sweeps by
name** — the visible output that cycles 13 and 14 found to be the part with measured yield.

**This reverses a call this entry made twice before the recount.** A `polish-docs` pointer was
declined, in the widening bullet and in claim 4, as "one artifact". That reasoning was about the door. The recount shows one mechanism across three
artifacts, and the pointer is the same pointer either way.

**Reachability walk — trigger → obligation → report**, cycle 13's method, on the seven B reaches.

- **Trigger:** a correction on a spec, inline or folded, or a correction made by a docs-polish pass.
  Observable, and not gated on whether the direction moved.
- **Obligation:** 10.6's word sweep (the superseded claim's distinctive noun, repo-wide) and surface
  sweep (every surface that states the claim more briefly than where it was corrected).
- **Report:** both sweeps by name, and what each found.

Walked: T33 — the surface sweep reaches §1's objective, which states the scope the new list
contradicted. T38 — it reaches the gate's category list. T39 — the word sweep on "evidenced" finds the
summary. T40 — the surface sweep reaches the success criteria, which paraphrase the gate. #2058 T4 —
the word sweep on "session of its own" finds the guide. T6 — the surface sweep reaches the React
example, which states in code the usage the advice had just corrected. T7 — the word sweep on
serialisation finds the architecture doc and both READMEs. **Seven of seven.** Under A, the trigger
fires on T33, T38 and T39 only. Neither option reaches any of the nine defects in the fix itself — which
is stated, not stretched.

**It clears the Step-3 gate.** *Generalizable* — every correction on a spec and every docs-polish
pass. *Grounded* — seven named, author-attributed echoes across three artifacts, every one linkable.
*Not already covered* — the Fold-in row says "re-draft" without naming a sweep or a report, the cheap
exception is exempt, and `polish-docs` has no pointer. *Altitude* — two pointers to an existing
canonical rule, no new rule text: the lightest rung on the ladder that fits.

**The docs-polish PR is the clearest evidence for the mechanism.** #2058 ran a code fact-check that
confirmed its new claims true, and still left their predecessors standing on five surfaces — the
guide, the React example, the architecture doc and two READMEs, with
`advanced/concurrency-policies.md:132` alone already right. **Verifying the new claim and reconciling
the old one are separate obligations**; #2058 did the first unprompted, and nothing asked it for the
second. One detail points the same way. Cursor's Best-Approach pass saw the guide's stale sentence and
filed it as a vocabulary nit, and the author, who had made the correction, knew it was factual. A
reviewer sees words; the corrector knows what moved. That is why the obligation belongs to the
corrector.

**So the proposal closes doors, not the class** — seven of seventeen under B, three under A. The other
ten are the nine defects in the fix, and one echo on a path that already has a rule.

## Scoring cycle 14's fix — first measurement, and it is mixed

Cycle 14's fix (*"a check with no before-state owes a blast radius"*) **landed on `main`** in
`fa21574d` and `4e03bde0`, both 2026-09-20, and is live in `issue-implement` at lines 22, 24, 336 and
367.

**Carried / not carried, asked of the branch heads.** The nine cleanup PRs (2026-08-22) and the spec
#1888 (2026-09-18) **predate the fix and are out of the sample entirely** — not zeros, not a pass.
**#2028 is the only artifact in this epic authored against it**, and both of its reviewed heads carry it:

```
$ git merge-base --is-ancestor 4e03bde0 4de4e367   # round-1 head → CARRIES
$ git merge-base --is-ancestor 4e03bde0 5f63dd5f   # round-2 head → CARRIES
```

**The practice is visibly present.** Five verbatim blast-radius reports on #2028, in the shape the rule
asks for: *"Removing the record-level check turns that one test red and nothing else"* · *"Red
observed first: with an intervening selection the test failed `expected 'sess_absent' to be
'sess_talk'`"* · *"Two tests, so the warning cannot be satisfied by always rendering it"* · *"Tests
assert the **warning**, not merely that rows draw, since a version that rendered rows and swallowed the
warning passes a row-only assertion"* · *"Red first — `shows the run's own status…` and `says a run has
not started…` both failed before the change."*

**And the class it was written for shipped anyway, in its fourth shape.** Round 1 folded Codex's
missing-`orgId` finding, observed red (`{ req_other_org: true }`), and reported it. The feature was
still **inert in production**: `principal.orgId` was never forwarded at the call site, and
`matchesOrgFilter` treats the key as *present* whenever the literal carries it — so
`{ orgId: undefined }` did not disable the filter, it compared every entry against `undefined` and
passed only for an entry carrying **no org at all**. Registration requires one. So the D4 liveness arm
**refused every genuine dispatch run**, and eight tests were green over it. The author's own
diagnosis: *"the `register` fixture omitted `orgId` while the `seedSession` fixture already defaulted
it — the tests were exercising a shape production never produces."* Caught in round 2 by a reviewer's
follow-up, not by the blast-radius report. The fixture asymmetry is now written into the test itself
(`packages/engine/test/context/liveness-dispatch-run-arm.test.ts:133-141`).

**The reading, and it is a real limit rather than a failure.** Breaking *the property the check claims*
went red — correctly — **on a fixture that was itself the wrong shape**. The blast radius proves the
check moves with its claim; it does not prove the fixture reaches the shape production produces. That
is shape 4 ("fixture too clean to contain the failure") surviving the rule written to catch it, by one
step. **One instance. Recorded as a claim to test, not minted** — a second sentence on a fix whose
first measurement is two days old would be exactly the reflex cycle 14 identified.

**The one place in this cycle where the operation was applied to a *guard*, and it paid.** Everything
above scores the blast radius against tests. The docs-polish agent ran it against a **check** instead:
it planted a broken anchor, watched the build warn and **exit 0**, and reverted. Two results from one
perturbation — the guard cannot fail, *and* the guard reaches the edited pages. That second half is
cycle 14's parity clause ("where none exists, show the check reaches the code it covers") satisfied
cleanly, and it is the only instance of it in this sample.

**Read it beside #2028 rather than added to it.** Both produced a red state on purpose; they came out
opposite ways, and the difference is *what was perturbed*. The anchor experiment perturbed **the guard
itself** and learned the guard was toothless. #2028's round 1 perturbed **the property the check
claims** and learned nothing, because the fixture it perturbed was the wrong shape. So the sample
carries one defect instance and one success instance of the same operation, and the discriminator is
whether the perturbation reaches the thing that would actually differ in production.

**It is not evidence for this entry's proposal, and filing it there would be this entry's own
subject.** The proposal is about a corrected claim's stale echoes in a document; this is about whether
a check fails when the thing it checks is broken. That is BP-003 and the blast radius, a different
population. Counting it toward the proposal would be "aimed at a neighbour" in the entry that spends a
section on neighbours. Recorded here, and as a guard below.

**The thirteenth artifact says the same thing about instruments, and it is the sharper statement of it.**
Three of #2058's four factual corrections were found by a **code** check; the fourth was surfaced by
the editorial passes as a contradiction between two pages, which they then resolved the wrong way round
until a code read inverted it. On the prose, the blind reads were right throughout. The docs agent's own generalisation is worth keeping verbatim: *"a
corpus pass which reconciles vocabulary will surface factual defects as a side effect, because making
two pages agree forces someone to decide which one is right — and a `docs-editor` is structurally the
wrong instrument for the half it uncovers."* Same discriminator as the two instances above: the
perturbation has to reach the thing that would actually differ. Making two pages agree perturbs the
**corpus** and reveals a disagreement; only a code read perturbs the **claim** and decides it.

**And `polish-docs` does not ask for the code check.** Grepped: the skill's only instrument line is
*"Run `docs-editor` over the pages you rewrote before opening the PR"* (`polish-docs/SKILL.md:86`).
There is no fact-check step. **No proposal, and the reason is cycle 14's, again** — this pass ran the
code check anyway, unprompted, and cycle 14 declined to mint claim 6's method on exactly that ground:
*"a cycle that applies a step and finds it useful has not yet shown the step is needed by anyone who
was not already going to do it."* What would carry a proposal is a docs-polish pass that **skipped**
the check and shipped a factual defect. That sample does not exist yet, so this is a claim below, not
a rule.

**One correction to how this was reported to me.** The brief said every round found a defect in the
round before it. Read against the commits, **two** are confirmed fix-induced — `c6d6e54` explicitly
fixes `9a5c148`'s replacement definition (*"the cross-flow case biting a third time, in the definition
itself"*), and `8f07918` fixes the first head's own half-carried term (*"the term introduced and
abandoned inside one page"*). Round 1 (`dc7a75b`) corrected a **pre-existing corpus defect the
reconciliation surfaced**, which is a different and better thing. The fourth I could not attribute
from the commit messages and have not counted. The part that survives intact is the part hardest to
dismiss: **one fact — cross-flow ownership — wrong in three files, by three authors, across two
rounds.**

**Claim 2 — the 30–40% band — is not comparable on this sample.** Three `vacuous-assertion` instances
across thirteen artifacts (#1387's uncompiled `.test-d.ts`; #1395's first export-graph pass, caught by
its own control; #2028's org fixture) against a denominator dominated by deletions and prose. A
removal epic asserts very little. Not a dip; a different population.

**Claim 4 — the zero on non-grading artifacts — weakly supported.** #1389, #1396 and #1406 are ordinary
code changes and carry zero vacuous findings between them.

**Claim 3 — retained guards — not measured here.** Out of this sample's reach; carry forward.

**Cycle 13's claim 6 — "is a loop fix's reachability the thing that fails?" — gets a population and the
answer is no.** This entry's first draft diagnosed the class as unreachable grounding, on a
case-sensitive grep. The rule was reachable; the defect arrived through an exemption written beside it.
That is worth more than a confirmation: reachability is the *attractive* diagnosis, it was wrong here,
and the only thing that caught it was re-running the command case-insensitively. Carry claim 6 forward
with that caveat attached.

## The coordinator's observations, checked against the artifacts

The wrap brief supplied eight field observations. Treating them as claims rather than findings, per
BP-003:

| # | Verdict |
|---|---|
| 2 — a coordinator instruction nearly shipped a dead feature | **CONFIRMED, and sharper than reported.** The behaviour the instruction forbade changing *was* the defect: the org filter was refusing every genuine run. A literal-compliant worker documents the layering and ships nothing. The worker deviated, flagged it, and fixed both layers. |
| 3 — fixture asymmetry | **CONFIRMED**, mechanism and count. Eight tests; the suite is ten now. BP-003's three bullets do **not** name it — the nearest is "aimed at a neighbour," and this is not a neighbour, it is the right target in the wrong shape. Recorded, not minted. |
| 6 — second-order defects of a fix round | **CONFIRMED and widened.** Seventeen instances, not three, across four artifact kinds (by the Kind column: epic, impl, spec, docs). This is the entry's proposal — though the mechanism is not the one the observation guessed: they are not under-reviewed. Eight are echoes of a correction, under-*reconciled*; nine are defects in the fix itself, under-*verified*. Only three of the echoes came through the spec cheap exception. |
| 7 — two reviewers said "already tight" | **CONFIRMED with one correction.** Cursor's Code Snob returned *"outcome 3: already tight. No POC"* on **both** rounds and Cursor's Simplify pass **APPROVED** on round 2, while Codex filed four P2s on that same head. But the four are not four capability regressions: **three** are (read-failure surfacing, truncation disclosure, run status — all capability the removed Children tab had, and all three made the new surface state something false), and the fourth is the fence race that round 1's own fix introduced. The org-filter bug was found by **Cursor's** follow-up, not Codex. Different lens, different blind spot — in both directions. **Recurred in shape on #2058:** Code Snob *"too small to rewrite"*, Best-Approach approved, Codex filed both P2s — and Best-Approach saw the third echo but filed it as a vocabulary nit. Two PRs now; still one composition, and still a row. |
| 8 — spec-review rounds are ledger signal | **CONFIRMED, and it inverts.** #1888's four rounds were **not** review rework: round 1 was six findings folded in one pass, and rounds 2–4 were the **owner** superseding his own D1 sign-off 21 minutes after giving it, then specifying DevTool presentation, then asking for wireframes. Scoring that as spec-authoring cost would blame the author for direction that arrived late. #1376's roughly nine waves *are* rework, and seven of its findings are self-inflicted. **The two direction artifacts overran the same budget for opposite reasons, and a rounds column alone cannot tell them apart.** |
| 5 — `onBrokenAnchors` | **CONFIRMED by experiment — run by the docs-polish agent, not re-run here.** The config half is read off the file: `apps/docs/docusaurus.config.ts` sets `onBrokenLinks: "throw"` (line 16) and `onBrokenMarkdownLinks: "warn"` (line 20) and **does not set `onBrokenAnchors` at all**. The behavioural half was *produced* rather than inferred: a bogus anchor inserted into an edited page made the build print `[WARNING] Docusaurus found broken anchors!` naming it and **exit 0**; reverting it went clean. That also shows the check reached the edited pages, which is the other half — a green result from a check that never opened your files proves nothing either. Docusaurus's own upstream default is still unverified and is now beside the point. `@docusaurus/core` is not installed in this worktree (there is no `node_modules` at all), so this entry records another agent's observation with its negative control, not a re-run. Filed as a one-line config change, like cycle 1's C0/NUL gate — not a lesson. |
| 4 — blind review's bounded competence | **DERIVABLE after all — from the thirteenth artifact, not the twelve.** This row first read *not derivable*, correctly scoped to the twelve I had sampled and wrong about the useful claim. #2058's own PR body records the measurement: two cold `docs-editor` reads *"caught the term being introduced and abandoned, and surfaced the run-versus-session contradiction"* — then **"That contradiction was settled against the code, which inverted four of the second read's findings — they were not applied."** Both halves of your observation, on the record: the blind read found a real class no code-holder would have seen, and got the factual resolution wrong. **Isolation buys prose judgement, not factual arbitration** — which is close to your wording, now with a countable four behind it. |
| 1 — four CI completion signals pointing at stale state | **NOT DERIVABLE from these artifacts.** Webhook-delivery timing against a workflow run's `head_sha` leaves no trace in PR review data. Recorded as coordinator-reported; it is a harness shape, not a code-review rework class, and would need its own instrument. **Read the scoping literally** — observation 4 carried this same verdict and a sibling artifact overturned it, so "not derivable from what I sampled" is all this says, and it is not a claim that no artifact carries it. |

## Candidates considered and dropped

- **A BP, or a BP-022 sentence, for the release-note derivation class.** Dropped — 16 findings in the
  fragment itself and still the wrong move. The rules are correct, were cited by line at eight
  separate defects across five fragments, and cycle 14 measured what that is worth.
- **Sharpening BP-003 to name fixture asymmetry.** Dropped at one instance. It is a genuinely
  uncovered sub-shape and it is a **claim to test**, not a rule. If a second cycle produces it, the
  home is `issue-implement`'s blast-radius paragraph — "and the fixture reaches the shape production
  produces" — not a fourth BP-003 bullet.
- **"Give the epic-spec a pointer to `issue-spec` 6.5.2."** Dropped, and it was this entry's own first
  proposal. The grep it rested on was case-sensitive; `orchestration.md:445` and
  `epic-spec-template.md:627` both carry a re-draft instruction that reaches the epic-spec. Kept in the
  record rather than deleted, because a loop-measuring instrument that quietly corrects its own
  diagnosis is the least trustworthy thing in this file.
- **"Every fold re-derives its blast radius," code included.** Dropped as bloat. Nine of the
  seventeen are defects in the fix itself, which no reconciliation rule reaches, and implementation PRs
  already have 10.6. An earlier draft of this bullet also declined a `polish-docs` pointer as "one
  artifact"; the recount reversed that part — see the revised fix — because the echo mechanism turned
  out to span three artifacts, and the pointer is the same pointer either way.
- **A rule about reviewers filing the same finding three times** (#1391's issue ref, #1376's T7/T11
  convergence). Dropped — independent convergence is *corroboration*, and the author read it that way
  in both places (*"you and the parallel reviewer converged on this independently, which is fair
  evidence it was the real problem"*). Deduping it away would cost more than the repeated reply does. The ledger counts such a defect
  once regardless: corroboration is a property of the review, not a second finding.
- **A rule about merge-order-dependent doc claims** (#1394's three findings shared with #1387, and
  #1376's retracted hard constraint). Dropped as a property of ten PRs open at once against one tree —
  which the epic PR itself already names as its open question (*"whether ten PRs open at once was the
  right call"*). A coordination question for `epic-lifecycle`, not a lesson.

## Filed, not proposed

- **`scripts/validate-changeset-refs.mjs` cannot fail on a well-formed wrong id.** #1391 carried
  `(FIX-1209)` on a FIX-1215 changeset **past a green guard** — three reviewers caught it by eye and it
  was corrected in `4da4feb` before merge, so nothing shipped wrong; the guard simply cannot be the
  thing that catches it. The
  validator asserts a `TEAM-123`-shaped id is *present*; checking it against the PR's own issue is a
  small, decidable change. A guard, not a lesson.
- **This repo's docs build exits 0 on a broken anchor, so a green docs build does not prove renamed
  headings safe.** Observed, not inferred: a planted anchor produced
  `[WARNING] Docusaurus found broken anchors!` and a **zero exit**, and reverting it went clean.
  `onBrokenAnchors` is unset in `apps/docs/docusaurus.config.ts`; setting it to `"throw"` is one line.
  `polish-docs`' own Verify step warns that a zero exit does not prove **markdown links** safe and says
  nothing about anchors — a partial restatement of the same gap, which #2058's agent closed by planting
  an anchor rather than by following the skill.
  Stated as the build's behaviour rather than as Docusaurus's default, because the default is
  version-dependent and unverified while the behaviour is what a future reader has to act on.
- **#1391 merged with an open P1 review thread** (changeset length, filed 2026-08-23T01:37Z, never
  answered; the PR merged at 02:04Z). `issue-implement` 10.6 forbids exactly this. One instance, and
  the rule that owns it is already correct and already on that path — recorded so a second instance has
  something to be a second of.

## Claims to test next cycle

1. **Do the sweeps, once pointed at, close the echoes?** Baseline: **eight echoes across three
   doors** — three through the spec cheap exception, two where a re-draft rule was already reachable,
   three on a docs-polish pass. Score the next two direction artifacts and the next docs-polish pass for
   echoes, and check the sweep report actually appears — an obligation with no visible output is the
   one that quietly stops happening. The nine defects in the fix itself are not this claim's
   population, and neither option in the revised fix reaches them.
2. **Does the blast radius catch a fixture that never reaches production's shape?** One instance says
   no: on #2028 the report was written, the red state observed, and the D4 arm was still inert. A
   second code-heavy sample decides whether that is a limit of the rule or an accident of one PR.
3. **Are direction-artifact rounds separable by cause?** #1888 (~4 rounds, owner-initiated) and #1376
   (~9 waves, self-inflicted) are opposite phenomena in the same column. Record the split on the next
   two direction artifacts and decide whether the ledger needs the distinction as a column rather than
   as prose.
4. **Does a docs-polish pass that skips the code fact-check ship a factual defect?** #2058 ran one
   unprompted and it found three of the four corrections, including a fact two editorial rounds had
   already walked past; `polish-docs` asks only for `docs-editor`. **The measurement this needs is a
   pass that did not run it** — until one exists, a fact-check step would be minted on a sample where
   it was never absent, which is the shape cycle 14 declined.
   **The sweep half is no longer a claim to wait on.** It moved into the revised fix once the recount
   found the same echo mechanism on two other artifacts. What stays here is the fact-check half.
5. **Does a vocabulary reconciliation keep surfacing factual defects?** #2058's claim is that it does
   so *structurally* — agreeing two pages forces someone to pick which is right. One artifact, four
   corrections. If a second corpus pass reproduces the ratio, the finding is about corpus passes, not
   about this corpus.
6. **Does the release-note class fall on a non-removal epic?** 16 of 61 (26%) sat in one file type,
   on an epic whose deliverable *is* the release note. If it stays above
   20% on an epic that ships features, the "property of the sample" reading is wrong and the class
   needs an instrument rather than another sentence.

## Finding map — every count above, rebuildable

`T`-numbers are positions in each PR's review-thread list, oldest first. `+` joins threads collapsed
into one finding. **F** marks a finding counted in the changeset figure. Rules: *Method — findings*.

**#1376** — 37 findings from 46 threads, under BP-040's bar.
- missed-edge-case ×11: T3 · T17 · T34 · T35 · T38 · T40 · T41 · T42 · T43 · T44 · T46
- spec-ambiguity ×6: T4 · T6+T13+T19 (the split's rationale) · T10 · T23 · T31 · T36
- design-off ×4: T2+T5+T8+T9+T12 (an open-ended hunt inside a bounded set) · T7+T11 (tap fixes in the
  dedupe slice) · T8+T18+T21+T24 (behaviour-changing members in the completion set) · T27
- stale-restatement ×4: T28 · T33 · T39 · T45
- docs-miss ×4: T1 · T14 · T20 · T32
- nit ×8: T15 · T16 · T22 · T25 · T26 · T29 · T30 · T37
- T8 names two defects and appears in two groups. T45 and T46 were unanswered when the PR closed.
- Fix-induced 7: T33 · T38 · T39 · T40 · T41 · T42 · T43.

**#1390** — 11 from 13. docs-miss ×7: T2+T3 `AgentType` **F** · T2+T4+T9 `reviewOutputSchema` **F** ·
T2+T5 `PRE_RANK_CAP` **F** · T2+T9 `BasePlan*` **F** · T5+T8 stage-1 comment · T11 `CollectionItem`
**F** · T13 `scores` **F**. missed-edge-case ×2: T1+T6 `FSDEV_DEBUG_ITEMS` · T12 `ContextItem` **F**.
nit ×2: T7 · T10. **F = 7.** Fix-induced: T11.

**#1387** — 9 from 11. missed-edge-case ×3: T1+T3 · T9 · T10 (*vacuous-assertion*).
stale-restatement ×1: T2. docs-miss ×1: T11. nit ×4: T4+T7 · T5 · T6 · T8. **F = 0.** Fix-induced: T10.

**#1392** — 12 from 14. over-engineered ×6: T1+T10 · T2+T10 · T3+T9 · T4 · T5 · T7 **F**.
docs-miss ×2: T8 · T14. nit ×4: T6 · T11 · T12 · T13. **F = 1.**

**#1389** — 3 from 3. docs-miss ×2: T1 · T3. nit ×1: T2. **F = 0.**

**#1394** — 24 from 25. missed-edge-case ×16: T1 · T2 · T3 · T4 · T5 · T14 · T15 · T16 · T18 · T19 ·
T20 · T21 · T22 · T23 · T24 · T25. stale-restatement ×3: T6+T10 · T7 · T8. docs-miss ×1: T11.
nit ×4: T9 · T12 · T13 · T17. **F = 0.** Fix-induced: T18, T22.

**#1391** — 11 from 16. docs-miss ×2: T5+T7+T8+T13 (the issue ref) **F** · T16 **F**.
missed-edge-case ×3: T6+T10 · T9 · T14. stale-restatement ×2: T11 · T15. over-engineered ×2: T1+T12 ·
T2. nit ×2: T3 · T4. **F = 2.**

**#1395** — 7 from 10. docs-miss ×2: T1 **F** · T2+T7+T10 **F**. nit ×5: T3 · T4 · T5+T8 · T6 · T9.
**F = 2.** The internal inventory left this fragment after #1396's P1; no thread on #1395 flagged it,
so it is not a #1395 finding.

**#1396** — 7 from 8. docs-miss ×4: T3 · T6 **F** · T7 **F** · T8 **F**. missed-edge-case ×1: T4.
nit ×2: T1+T5 · T2. **F = 3.**

**#1406** — 6 from 6. docs-miss ×1: T6 **F**. nit ×5: T1 · T2 · T3 · T4 · T5. **F = 1.**

**The nine implementation PRs:** non-`nit` 9 + 5 + 8 + 2 + 20 + 9 + 2 + 5 + 1 = **61**; in the fragment
7 + 0 + 1 + 0 + 0 + 2 + 2 + 3 + 1 = **16**.

**#1888** — 8: six threads and two from the conversation. missed-edge-case ×3: T3 · T6 · FIX-1097's
cancellation reason (conversation). docs-miss ×2: T1 · T5. stale-restatement ×1: T2. nit ×2: T4 ·
FIX-1045's cancellation reason, whose verdict stood (conversation). Fix-induced: FIX-1097's.

**#2028** — 16 from 18. missed-edge-case ×7: T7 · T8 · T10 · T15 · T16 · T17 · T18. docs-miss ×2: T2 ·
T5+T9. over-engineered ×2: T6 · T12. nit ×5: T1 · T3+T14 · T4 · T11 · T13. Fix-induced: T15.

**#2058** — 7 from 7. stale-restatement ×4: T4 guide · T5 DevTool page (vocabulary) · T6 React example ·
T7 concurrency. nit ×3: T1 · T2 · T3. Fix-induced 4, a different set: `c6d6e54` · T4 · T6 · T7.

**The seventeen:** #1376 7 + #1394 2 + #2028 1 + #1888 1 + #1387 1 + #1390 1 + #2058 4. **Echoes, 8:**
#1376 T33, T38, T39, T40 · #1888 FIX-1097 · #2058 T4, T6, T7. **Defects in the fix, 9:** #1376 T41,
T42, T43 · #1394 T18, T22 · #2028 T15 · #1387 T10 · #1390 T11 · #2058 `c6d6e54`.
