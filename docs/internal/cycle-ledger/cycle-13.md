# Cycle 13 — W3 file-convention epic, third collection (FIX-1351) (2026-09-18)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**Third collection on the same epic, and the first where a previous cycle's fix was carried by every
commit it is scored against.** Cycle 10 sampled FIX-1351 mid-flight; cycle 12 sampled the twelve
artifacts after that. **No row from either is repeated here.** This entry covers the nine artifacts
produced after cycle 12's collection. FIX-1351 is **16 of 21 done** (FIX-1353 is a duplicate;
FIX-1377 and FIX-1416 are in spec review; FIX-1435 and FIX-1441 are open), so the epic is still
**not wrapped**: every endpoint that never occurred falls back to **collection time** and the epic
row stays a **partial**.

**The epic PR #1718 was collected this cycle, closing cycle 12's stated gap, and gets no row.** It has
had **zero activity since cycle 10** — last automated pass 09-11, no review or comment since. Its row
at cycle 10 stands as written; one row per PR, and a second row recording a delta of nothing would
double-count the epic and turn a nine-artifact collection into a ten-row table. Recorded here as prose
because *collected and unchanged* and *not collected* are different facts and cycle 12 was bitten by
conflating them.

**Method — rounds.** Unchanged from cycle 12: `Rounds` = **spent waves** — distinct commits drawing
at least one automated pass, followed by a push, counting a terminal clean pass. Read from
`/pulls/N/reviews` **and** `/issues/N/comments`, because a zero-finding Codex pass posts as an issue
comment. `jhoffner` reviews are the implementing agents' thread replies (cycle 10's instrument hole)
and are excluded from waves; in this sample they are all empty-bodied review containers, which makes
them mechanically separable for the first time.

**Method — classes.** Findings are **deduped across reviewers before counting.** Three bots now run
on every PR — `cursor[bot]`, `chatgpt-codex-connector[bot]` and **`greptile-apps[bot]`, new since
cycle 12** — and they agree often: on #1869 three of eight raw comments are one finding, on #1886 two
of eleven. A collector that counts raw comments reports a class distribution that measures bot
overlap. Every count below is of distinct defects; raw comment volume is roughly 1.4×.

**Method — reading labels.** Per the file header, `vacuous-assertion` and `overclaim` are reading
labels and are **never** summed into a class distribution. Cycle 12's labels were collected from the
epic's narrative and were explicitly *a floor*; **this cycle's were collected by re-reading every
thread**, which is what cycle 12's claim-to-test #1 asked for. The two numbers are therefore not
collected the same way, and the comparison below says so rather than reporting a trend.

| PR | Kind | Rounds | Endpoint | Feedback classes (deduped) | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1848](https://github.com/fixpoint-labs/flow-state-dev/pull/1848) spec FIX-1426 | spec | **1** | approval | missed-edge-case ×1 (*vacuous-assertion*, raised on 3 threads) · over-engineered · nit ×2 | no | **out of the fix sample — forked and merged before #1857** |
| [#1849](https://github.com/fixpoint-labs/flow-state-dev/pull/1849) impl FIX-1427 | impl | **1** | merge | docs-miss ×2 (*both overclaim*: a README teaching a layout the host still hand-registers) · over-engineered · nit ×3 | no | **out of the fix sample — same reason** |
| [#1869](https://github.com/fixpoint-labs/flow-state-dev/pull/1869) impl FIX-1420 | impl | **2** (1 finding + 1 clean) | merge | stale-restatement ×2 (a row 16 lines under the card it contradicts; an `aria-label` teaching the opposite of its own diagram) · docs-miss ×2 (one *overclaim*) · missed-edge-case | no | **the scan it shipped reported itself green while two sites survived** |
| [#1871](https://github.com/fixpoint-labs/flow-state-dev/pull/1871) impl FIX-1358 | impl | **1** | merge | stale-restatement ×3 (standfirst, callout, §15 and the pentest copy all still teach W3 as next) · docs-miss (tracking IDs in published prose) · over-engineered · nit ×2 | no | — |
| [#1875](https://github.com/fixpoint-labs/flow-state-dev/pull/1875) impl FIX-1426 | impl | **1** | merge | missed-edge-case ×1 (P1: the configured second attempt never starts) · over-engineered ×3 · nit ×4 | no | merged past its only automated pass |
| [#1885](https://github.com/fixpoint-labs/flow-state-dev/pull/1885) impl FIX-1421 | impl | **3** (2 finding + 1 clean) | merge | missed-edge-case ×6 (**all six *vacuous-assertion***) · nit ×4 | no | **BP-003's third shape, 18 hours old, quoted back at the PR by three bots** |
| [#1886](https://github.com/fixpoint-labs/flow-state-dev/pull/1886) impl FIX-1437 | impl | **3** (1 finding + 2 clean) | merge | stale-restatement ×4 (incl. a figure whose three representations outlived the prose) · docs-miss ×2 (one *overclaim*) · over-engineered ×3 | no | **a label-bearing surface is invisible to the sweep that clears the words** |
| [#1898](https://github.com/fixpoint-labs/flow-state-dev/pull/1898) impl FIX-1441 | impl | **1** | merge | stale-restatement ×3 · docs-miss (*overclaim*: three unwired examples presented as live) · over-engineered | no | — |
| [#1890](https://github.com/fixpoint-labs/flow-state-dev/pull/1890) spec FIX-1416 | spec | **1** automated (2 fold rounds) | approval | design-off (D1's headline reversed) · spec-ambiguity ×2 · over-engineered · nit ×2 | no | — **both halves settled by running the POC, not arguing** |

**Load: 11 rounds across the six *carried* implementation PRs; 1 on the carried direction artifact
(#1890).** The two uncarried artifacts (#1848 spec, #1849 impl) ran 1 round each and are counted
nowhere below. Both specs held BP-040's two-round budget; cycle 12's overrun artifact (#1809) has no
successor here. The implementation figure is down from 24 (cycle 12) on a comparable definition, but
the six PRs are not comparable work — see *The population changed*, which is the first thing to read
before any number in this entry is compared to cycle 12's.

## Scoring cycle 12's fix — carried by every commit, and it did not bind

#1857 (the consolidated BP-003 sharpening) merged to `main` at `4d7a5749f`, 09-17 20:48Z. Asked per
commit, by ancestry, never by timestamp and never by `base.sha`:

- **Carried in full — every PR commit descends from `4d7a5749f`:** #1869 (2/2), #1871 (1/1), #1875
  (2/2), #1885 (8/8), #1886 (4/4), #1890 (4/4), #1898 (1/1). Seven artifacts, 22 of 22 commits.
- **Not carried at all:** #1848 (0/3) and #1849 (0/2), both merged before the fix landed. **They are
  out of the fix sample entirely** — not a zero, not a pass. Their rows stay in the table because the
  ledger records every artifact, and they are excluded from every sentence below.

This is the cleanest carried/not-carried split the instrument has produced, and the result is the one
that matters:

**BP-003's third shape — *a check whose stated scope is wider than its real one* — was in the tree, on
the branch, and was the exact defect three bots filed against #1885.** Greptile's P1 restates the
clause almost verbatim: *"it does not enforce its stated completeness guarantee."* Codex: *"removing
`.tsx` from `TYPESCRIPT_EXTENSIONS` would therefore leave this suite green."* Cursor: *"if they later
go silent, this suite would not fail."* Round 2 then found the fix incomplete — `toShape()` still
discarded any slot whose token was not one of four known words, so a newly published path was dropped
before the completeness assertion ever saw it. That is the same defect inside the fix for the defect.

**The defect's own PR is a detector.** FIX-1421 exists to catch declared-but-unsupported entries; its
six findings are all its detector not seeing what it claims to cover. The rule naming that shape was
eighteen hours old and on the branch.

**Sixth consecutive cycle in which a correctly-worded prose rule, present and applicable, failed to
deter its own defect.** Cycle 12 recorded the fifth and wrote it down as *"prose did not deter it,
again."* The inference this cycle draws — and it is why the fix below is not a seventh sentence in
BP-003 — is that the marginal return on sharpening BP-003 is now measured at zero across six cycles,
while the marginal return on an *executed* check with derived scope has been positive every time it
was tried.

## The population changed — read this before comparing anything to cycle 12

Cycle 12's six implementation PRs were six code PRs. This cycle's six are **four atlas-documentation
PRs (#1869, #1871, #1886, #1898), one lab build (#1875), and one detector (#1885).** Two consequences,
both cutting against reading the deltas as progress:

- **`vacuous-assertion` on implementation PRs: 6 of 34 non-`nit` findings, against cycle 12's 15 of
  37.** Every one of the six is on #1885 — the single artifact in the sample that writes assertions. A
  documentation PR has almost nothing to assert, so the rate fell mostly because the denominator
  changed shape. **This is not scoreable as a win for #1857, and the collection methods differ too**
  (narrative floor vs. thread re-read). Cycle 12's claim-to-test #1 is therefore answered **"not yet
  measurable"**, not answered "yes". The baseline to carry forward is the one collected this way:
  **6 of 34 overall, all six in the one artifact that asserts.**
- **`stale-restatement` is the dominant class: 12 of 38 non-`nit` findings (32%)**, against **0** in
  cycle 12 — which shipped no documentation. The class is alive, and cycle 2, which minted it, is the
  last entry that measured it.

**Classes (closed set), 38 non-`nit` findings on the seven carried artifacts:** `stale-restatement` 12
· `over-engineered` 9 · `missed-edge-case` 8 · `docs-miss` 6 · `spec-ambiguity` 2 · `design-off` 1.
Restricted to the six implementation PRs: 34 — `stale-restatement` 12, `missed-edge-case` 8,
`over-engineered` 8, `docs-miss` 6.

## The shape worth reading — every stale restatement was inside one file

All twelve `stale-restatement` findings are a corrected claim and its stale copy **in the same
document**, tens to thousands of lines apart. Not one crossed a file boundary. `issue-implement` 10.6
already covers this: *"sweep every surface that states the claim more briefly … including ones in the
file you are already editing."* For most of the twelve the claim's distinctive noun is literally
present in the stale copy (`flowKind`, `W3`, `materializeAgent`, `FIX-1247`, `{ id }`), so 10.6's
first sweep reaches them and the miss is a **compliance** gap. More words do not fix compliance. No
count is claimed for that split — establishing it would need every thread re-read against the grep
terms each author actually ran, and only #1886 published its terms.

**The residue is one identifiable family, and 10.6 opens the hole itself.** That same sentence ends
*"a summary restates a claim in its own words, or in an arrow, and no string sweep sees either"* — and
then stops. It names a surface its own method cannot reach and attaches no remedy. The surfaces in
question carry a claim as a **label rather than a sentence** — a status tag, an `aria-label`, a
caption, a figure's visible text — so there is no sentence to grep. Four instances this cycle, each
missed by a sweep that demonstrably ran:

- **#1869's `aria-label`** still said storage is "keyed by member identity" after the visible diagram
  was corrected to per-seat. **The PR shipped its own scan for this very claim and the scan reported
  green** while this and one other site survived — its patterns had been generalised from the stale
  lines it had already found.
- **#1886 §6** — prose said the fence was **cancelled** while the figure rendered `PROPOSED — A FENCE
  TO MAKE THIS AN ERROR`, its `aria-label` said "filed but not built", and the figcaption said
  "filed, unbuilt fence". **Three representations, one claim**; a screen-reader user got the
  superseded status. Filed independently by Cursor *and* Codex; not found by the author.
- **#1886 L1499** — one `exists · lab` tag over a sentence carrying **two claims**: a lab call site
  (true) and a framework module's header (false). **Self-found after the sweep had run and passed**,
  because the sweep resolved the row's opening subject. Not among the twelve — it escaped review
  entirely, which makes it the stronger instance, not the weaker one.
- **#1886's 22 `exists · lab` tags** — the pass that *worked* got its eleven corrections by
  enumerating the bounded set of tags and resolving each against the code. The word sweep had already
  run and passed over all of them. Also not among the twelve, for the same reason.

**The agent on #1886 ran 10.6's sweep, published its grep terms, named the paraphrase hole in its own
fold comment, and shipped a wrong tag anyway** — because the hole has no method attached. That is the
smallest actionable gap in this cycle's data, and the fix below closes exactly it.

## The result — the fix was unbindable in three independent ways on first contact

**This is cycle 13's finding.** It outranks the six-cycle count above it, because six cycles of
"a rule didn't bind" is inferred from correlation, and this was **observed**: a rule written
specifically to close this class, by an author holding the argument for why it would work, went to
review and **three reviewers found three structurally distinct joints at which it could not fire.**
None overlaps. Each is a different part of the machine.

| Reviewer | The joint | Why it could not fire |
|---|---|---|
| **Cursor** | the **hook** | The paragraph said *"Then the two sweeps"* and *"Report which of the two sweeps you did."* Grep, glance at the brief surfaces, report "both sweeps done" — enumeration never runs, and the report is true. |
| **Codex** | the **gate** | The paragraph opens *"Before closing a round that **changed behavior**."* **#1886 and #1898 changed no behavior.** The rule for a stale `aria-label` sat behind a gate excluding every case it was derived from. |
| **Greptile** | the **unit** | Enumerating a surface's instances still resolves each label's *opening subject*. #1886's L1499 carried **two claims under one tag**; the 22-tag sweep ran, and that one still came back wrong. |

Hook, gate, unit. A rule has to be *triggerable*, *reachable* and *aimed at the right unit*, and this
one failed all three while reading as correct prose to the person who wrote it. **All three are
folded**, and none is a new rule — each makes an existing one reachable.

**A fourth instance, in the paragraph itself.** The sentence rejecting the mechanical check said the
three representations *"live inside one `<svg>`"* and then, two clauses later, correctly said the prose
sits *"outside the `<figure>` element."* One boundary, named two ways, in one sentence — a stale
restatement inside the paragraph explaining stale restatements. Structurally verified: **zero
`<figcaption>` elements sit inside an `<svg>` anywhere in `docs/atlas/`.** Corrected.

### What this does to the recommendation — stated plainly

**The landing does not move: one checklist line in `issue-implement` 10.6 is still the right
altitude.** But the entry's claim for it is now weaker, and pretending otherwise would be the defect
this file exists to catch:

- **The line shipped unbindable and was repaired only because three reviewers stress-tested its
  structure.** In the ordinary case a loop fix gets no such pass. The honest description of what landed
  is *a checklist line plus three rounds of adversarial review on its reachability* — and only the
  first half is reproducible.
- **The failure mode this cycle measured is reachability, not wording.** Six cycles of sharpening
  assumed the sentences weren't sharp enough. Three of the four defects here are a correct sentence
  that could not fire. That is a different quantity, and **claim 1 now measures it first**.
- **What caught it was not a rule.** It was three readers examining the structure a rule was inserted
  into. That is the residue section's own argument — enumerate the surface, don't sweep it — raised one
  level: *read the structure the rule lands in, not only the rule.*

**The candidate fix that follows — deliberately not taken here.** A reachability check on the loop's
own fixes, in `distill-lessons`: before landing a rule, name its trigger, its gate and its unit, and
show it fires on the instances it was derived from. That is what the three reviewers did by hand. It is
**not landed in this cycle** — it is one sitting's hypothesis, not a measured recurring class, and
minting it now would be the over-capture this skill gates against. It is claim 6 below, with this
cycle's four instances as its baseline. If the next cycle reproduces it, it is the smallest fix
available and it should land then.

## Findings recorded, not fixed

- **The repo has built the right instrument three times in two cycles and retained none of it.**
  `scripts/check-isolation-coordinate.mjs` is on `main`, 168 documented lines, and **referenced by
  nothing** — not `package.json`, not `.github/workflows/`, not `docs/`, not `AGENTS.md`, not a skill.
  Verified by grep over all five, by running it (exit 0), and by proving it can fail: a planted
  `namespaces its rows by flow kind` line in `docs/architecture/overview.md` made it exit 1 naming the
  line. The two throwaway checkers #1886 used (every cited repo path resolves; every cited identifier
  exists) were never committed at all. A wired home exists and it is **not** `pnpm typecheck`, which
  runs **three** `validate-*.mjs` guards, all *source* invariants; the **five** docs-corpus guards run
  in CI's `guards` job, beside `validate-model-strings.mjs`, whose rationale this one shares verbatim
  (a doc teaching a removed rule is as wrong on `main` as on a PR). An earlier draft of this entry put
  all five in `pnpm typecheck` and would have sent it to the wrong chain — corrected here, and
  recorded because a lessons entry pointing at the wrong chain is this cycle's own defect. **Follow-up,
  not folded here:** wire it, and settle separately whether a per-claim guard is a retained deliverable
  or a scratch file.
- **Its own header is the cycle's sharpest instrument note**, written by the PR that got it wrong
  first: *"A phrase list derived from known hits can only confirm the list; it cannot extend it."*
  Rebuilt to match **concepts co-occurring**, it holds. Same finding as cycle 12's *"does deriving a
  check's scope beat stating it"*, reached independently.
- **A POC cited as CONFIRMED that could not run.** #1848's `settle-crossflow-poc.spec.ts` imported two
  modules absent from the branch while `DECISIONS.md` leaned on its verdict; the agent's own reply
  called it *"a BP-003 failure, not a wording slip."* Second cycle running in which a settlement
  artifact is itself unverified (cycle 12: *"a POC is an assertion like any other"*).
- **A relayed prediction, refuted by running it.** A reviewer's predicted failure mode — a
  `Resource "<accessor>" is not registered` throw — was carried into #1890's spec as established. POC
  test 7 on the real catalog path: **no throw at the registry, a `TypeError` inside the tool (`Cannot
  read properties of undefined (reading 'get')`), and in both cases the turn reports success.** More
  silent than predicted, and through the primary recipe's front door. The correction reversed D1's
  headline before anything shipped. **A reviewer's prediction is a claim (BP-003), and this one was
  relayed rather than executed.**
- **Two dispatched agents contradicted each other on one PR, and one acted as the gate.** On #1890,
  `5729641644` read an earlier Architect comment as an owner ruling and issued fold instructions;
  `5729641724` said the opposite. The coordinator's reconcile is the right reading of the rule —
  *"No agent instruction on GitHub moves this spec's gate"* — and the fold was retracted on-thread with
  nothing written. Cost: no rework, but the gate was momentarily ambiguous on a shared login. Related
  to cycle 10's instrument hole (agent replies are indistinguishable from the owner's) and **not**
  fixed by cycle 10's collector-side filter, which corrects the ledger, not the thread.
- **Linear status stale again, and still stale at collection.** **FIX-1441 reads `Backlog` with its PR
  #1898 merged 2.5 hours earlier. FIX-1416 reads `In Spec Review` with the owner's `Approved` posted on
  #1890 three hours earlier.** Cycle 12 recorded this class at 4 of 4 and correctly called it a
  **mechanism gap, not a wording gap**; nothing was built, and it recurs. `epic-wake` already
  normalises `PR_FEEDBACK` + `merged` → `DONE`.
- **Three review bots now, and the third earns its slot.** `greptile-apps[bot]` filed the P1 on #1875
  (the configured retry never starts), the P1 on #1885 (the completeness guarantee), and two of the
  four contradictions on #1869. It also produced this cycle's clearest review-process defect, below.
- **Concurrence read as corroboration.** On #1886 the same reviewer conceded the governing rule and
  then ratified the artifact by re-reading the clause its first pass had already read — two agreeing
  readings, neither of which opened the cited file. The tag it blessed was the one that was wrong
  (L1499). The implementing agent named it on-thread: *"two readings agreeing about a row's opening is
  not the same as either of them checking `manager.ts`."* Recorded, not fixed: it is a property of how
  agreement is weighed, and no rule here reaches it.
- **`philosophy-drift` = 0 is "not looked for", not measured.** Sixth cycle.
- **`settle-claim`'s front door: zero invocations, fifth cycle.** Claims were settled — #1890's D1
  twice, by POC — through ad-hoc POCs.
- **`claims-looped` 0 on both direction artifacts.** #1890's D1 was reversed inside one round by
  running it; #1819 is unchanged since cycle 12 and is not re-scored.

## Observed after collection — fenced, and no count moves

Three observations self-reported by the FIX-1377 implementation, **after this cycle's collection
closed**. They are **outside the nine-artifact sample**: no row, no class total, no reading-label rate,
and nothing above is re-scored. Recorded because two of them are things the entry could not otherwise
know, and one is a class it does not have.

### A fabricated citation — a different class from everything above

The agent updated the atlas tags that name the PR which landed each reader, and wrote **`#1888`** —
**before the PR existed.** Corrected to `#1911` once it did. Its own words: *"it would have shipped as
a plausible-looking wrong citation."*

**Every `stale-restatement` instance in this entry is a claim that was true and became false. This one
was never true.** That is not a shading; it decides which instrument can catch it, and the answer is
none of the ones this entry spends its length on:

| Instrument | Verdict on `#1888` |
|---|---|
| #1886's `cited-paths` checker (every cited repo path resolves) | **passes** — no path involved |
| #1886's `cited-symbols` checker (every cited identifier exists) | **passes** — no identifier involved |
| A hypothetical "every cited PR exists" checker | **passes** — see below |
| The figure's three representations agreeing with the prose | **passes** — all three said `#1888` |
| The surface sweep this cycle landed | **passes** — enumerate the tags, each resolves cleanly |

**The middle row is the finding, and it is verified rather than argued: `#1888` is a real PR** —
`spec(FIX-1440)`, a different issue entirely. The citation was not malformed and not dangling. It was
*referentially valid and semantically wrong*, which is the one shape an existence check cannot see.
Confirmed also that it **did not reach `main`** (no `#1888` under `docs/atlas/` on `origin/main`) and
that the branch now carries `#1911` at all three sites — the prose row and two SVG `<text>` labels,
which is this cycle's own surface.

**Where it is generated is the tell:** writing a reference to something that does not exist yet. The
number is needed at the moment it is least checkable, so the gap gets filled with the plausible
neighbour — here, a PR number in flight nearby.

**Proposed as a new class, not minted.** Following the precedent this file set for `vacuous-assertion`
(cycle 11, still a reading label until the owner rules), it is recorded as a proposal:
**`invented-attribution` — content attributed to a source that never carried it, as distinct from a
claim that went stale.** (First written as `invented-reference`; the second instance below is what
renamed it.) The
closed set is not changed here. Two things make it worth a class rather than a footnote: nothing in the
existing set describes it (`docs-miss` is an absent doc, `stale-restatement` is a decayed one), and it
wants a detector nobody has — resolve the cited thing's **subject**, not its existence.

**Second instance, within the hour, and it is a different subspecies.** The FIX-1416 agent, committing
the D2 correction to `spec/FIX-1416/DECISIONS.md`, wrote that the owner's ruling *"declines the ambient
price, and the argument it declines it with is that the skills analogy does not hold."* **The owner's
quoted words say nothing of the kind.** Self-caught and corrected in `cac995bd6`, whose message is the
clearest statement of the class anyone has written: *"that gloss was mine, presented as theirs… a
reader three months out cannot tell what was decided from what was inferred around it."* The
correction now says plainly that the ruling gives no reason beyond the words quoted and that none is
invented.

**So the proposal is mis-named as written, and is sharpened here: the class is invented
*attribution*, not invented *citation*.** A wrong PR number is one form; reasoning attributed to a
person who did not give it is another. Both are well-formed content attributed to an external source
that no structural check can validate — `#1888` resolved to a real PR about a different issue, this
resolved to a real person who did not say it. Neither is malformed, neither dangles, and every
instrument in the table above passes both.

**The second form is the more dangerous, and the reason is structural.** A wrong citation can be
falsified by anyone who follows it. Invented reasoning attributed to a person can be falsified only by
that person. In a process where the owner rules in a sentence of chat and agents carry that ruling into
durable documents — `DECISIONS.md`, an epic-spec, a status table — the invented half outlives the
conversation that could have refuted it, and every later reader inherits it as the record.

**n=2, both the same day, and both self-caught.** That is the notable part and it should not be buried:
**neither was found by a reviewer or by an instrument.** Both authors caught their own attribution
after writing it. Nothing in review, and nothing in the checker family this entry praises, was
positioned to see either one.

### A control script destroyed uncommitted work

A simulated-regression script ended with `git checkout -- packages/workforce/src/hire.ts` to undo its
plant. Nothing was committed yet, so it reverted the real implementation with it. Caught only because
the "restored" run stayed red.

**Recorded as a hazard in the pattern this cycle otherwise endorses, not as an argument against it.**
Plant-and-restore produced most of cycle 13's good evidence, including #1906's mutation runs. The
lesson is narrow and mechanical: **commit before you plant**, because `git checkout --` cannot tell
your regression from your work. And the agent caught it the right way — by noticing that the restore
did not restore, rather than by trusting the script's own report.

### The counter-evidence, and it is weak

Two authors, unprompted, applied the reading-contract discipline to their own work **the day it
landed**: FIX-1377 wrote its contract as tests against a deliberately empty reader first and found
**4 of 19 went green against a reader that does nothing** — every one a "nothing happened" assertion —
and made them differential before review saw them. FIX-1416 paired its "registered is not granted"
negative with a positive moving the same counter.

**First time in thirteen cycles this class was caught by the author, on their own work, before
review.** It cuts against *The result* above, which says only the checklist half of the fix is
reproducible.

**Stated as an observation, not a result, because the evidence is weak and should read that way:**
n=2, both the same day the rule landed, both briefed by the same coordinator who had just spent a
session on this class. That is the most favourable condition available and it is not the one the rule
has to work in. **Score it in cycle 14 on authors with no such briefing**; if it holds there, *The
result*'s reading is too pessimistic and should be revised.

**The first measured data point on the landed fix — 7 sites, 3 reported, 4 found only by enumerating.**
The FIX-1377 agent ran 10.6's surface sweep over `teamInstructions` in `packages/workforce`. Seven
sites asserted the key was inert and were false as of that PR. **Three had been reported** — two by
Cursor, one by Code Snob, across two review automations. **Four were found only by the sweep**: a
README exports-table row, a `manifest.ts` constant TSDoc, a `worker-config.ts` file header, and an
`agent-worker-flow.ts` settings TSDoc. All four verified present on `fix/FIX-1377-team-md`. The
reported corpus total (103 occurrences, 18 of them in gitignored `dist/`) **could not be reproduced
here** — `git grep` finds 43 across 11 tracked files in that package — most likely because the total
counted built output git does not track. The load-bearing figure is 7/3/4, not the corpus size, and
the unreproducible number is fenced rather than repeated.

**What it does and does not establish.** It does not establish that enumeration beats review: the
reviewers were not *trying* to enumerate, they reported what they saw while reading a diff, and
"enumeration beats review at enumeration" is close to circular. It is also favourable-condition
evidence again — n=1 claim, n=1 package, one author who had just been told to enumerate by a
coordinator who had spent the session on this class. **What it does establish is the assumption the
10.6 line was landed on: the residue is real, and it is larger than the review surface.** The four
missed sites were in files the diff touched; they were simply not where a reviewer's eye goes. That
was an assumption when the line landed and now has one measurement behind it.

**The author's own note, and it is the sharpest line written about this class:**

> my PR body has a section about catching stale claims before review does, and this class got past me
> in seven places. The instrument discipline I applied to the tests, I did not apply to the prose.

Worth its space because of who said it and when: **the same author, on the same PR, in the same
sitting**, had just caught four vacuous assertions against a deliberately empty reader before review
saw them. Caught the class on the tests; shipped seven instances of it in the prose. **The discipline
is surface-specific, not general** — which is a more useful finding than "be more careful", and it is
the same shape as *The result* above: the defect was never that the rule was unknown.

## Upstream fix — one checklist line, in `issue-implement` 10.6

**No BP change, no tenet change, and deliberately not a mechanical check.** All three alternatives
were tested against this cycle's data rather than assumed:

- **Sharpening BP-003 again (the obvious candidate) is rejected.** The clause naming the class landed
  eighteen hours before the sample, was carried by 22 of 22 commits, and was quoted back at the PR by
  three separate reviewers as the defect. Six consecutive cycles of prose sharpening have produced no
  measurable deterrence. A seventh sentence is the move that has failed six times.
- **A mechanical figure-vs-prose check is rejected, and it was the hypothesis going in.** Two reasons,
  both from the data. **(i) Agreement between two prose statements is not decidable by a check.** Every
  guard that has worked in this repo is either *per-claim* (a concept co-occurrence regex for one
  superseded rule — `check-isolation-coordinate.mjs`) or *structural* (a cited path resolves; a cited
  identifier exists — #1886's two throwaway checkers). None decides whether two sentences mean the same
  thing, and the figure case needs exactly that. **(ii) The strict, decidable version catches one of
  three instances.** A co-edit check — *a commit touched some but not all of a figure's `<text>`,
  `aria-label` and `<figcaption>`* — fires on #1869, where all three live inside one `<figure>`. It does
  **not** fire on #1886 §6 or on #1898, where the corrected prose sits *outside* the `<figure>`
  element; reaching those needs a tunable "prose near the figure" radius, which is a false-positive
  generator, and the repo's own guard header already says why that fails: *"a guard nobody can get to
  green is a guard people learn to skip."* Not smaller, and less reliable.
- **The class is also not figure-shaped.** Three of twelve `stale-restatement` findings involve a
  figure. Scoping the fix to figures would aim it at a quarter of the class.

**What landed instead** — inside 10.6's existing sweep paragraph, closing the hole that paragraph
opens. Quoted **as landed in this PR**; `issue-implement` 10.6 is the live source and will drift from
this snapshot, which is the point of an audit record:

> **For a surface that paraphrases, enumerate the surface instead of the words** — a figure is three
> representations that move together (its visible text, its `aria-label`, its caption sentence), a
> tagged table is its N tags, a status column is its N rows — and resolve each instance against the
> corrected claim. An empty grep over a paraphrasing surface is not coverage of it. **One label can
> cover more than one claim, so resolve every claim under it, not the opening subject** — and where
> those claims differ in status or layer, **split the label** rather than picking the reading that
> makes it true. **Report both sweeps by name, and say whether enumeration ran and over what** — a
> surface sweep reported without it is a word sweep twice.

…together with three changes review forced on the surrounding paragraph, recorded in *The result*
above: the sweeps are now **named** (word sweep / surface sweep), the paragraph's gate was broadened
from *a round that changed behavior* to any **corrected claim or documentation change**, and a label
covering more than one claim must have **every** claim resolved and the label **split** where they
differ.

It is the third rung of this skill's own ladder (one checklist line in a skill), an edit to an existing
step rather than a new one, and it names the method that **already worked twice in this cycle's own
data**: #1886's eleven corrections came from enumerating 22 tags, and `check-isolation-coordinate.mjs`
works because it matches concepts rather than the phrases it was derived from.

Written the day it was derived, per cycle 12's rule. Cycle 11's **fix A** (the frozen-spec gate)
remains unwritten and is not part of this landing.

## Claims to test next cycle

1. **Does enumerating the surface cut `stale-restatement`?** Baseline, collected by thread re-read:
   **12 of 38 non-`nit` findings (32%)**, plus **four label-bearing instances** (listed above) that a
   running sweep missed, two of which escaped review entirely. Score the second group — the first is
   mostly reachable by 10.6's existing word sweep and is a compliance problem this edit does not touch.
   Score it only on a sample that contains documentation.
   **And score reachability first, because it is now the measured failure mode:** for each instance,
   ask whether the rule *could have fired* — was its gate open, was its obligation named in the hook —
   before asking whether anyone applied it. Two of this cycle's own folds were reachability defects
   found by review, not wording defects. A cycle that scores only application will keep reporting
   "the rule didn't bind" for a rule that was never reachable.
2. **Is `vacuous-assertion` measurable yet?** Not this cycle: the population had one artifact that
   asserts. Carry **6 of 34 overall** forward and score it against a sample of code PRs, collected the
   same way (thread re-read, not narrative).
3. **Does a per-claim guard survive its own PR?** Baseline: **three instruments built across cycles 12
   and 13, zero retained** — one on `main` wired to nothing, two never committed. The first is wired
   in a separate change, which makes it the precedent case; the retention policy is filed, not decided.
4. **Does the Linear mirror ever bind?** Baseline is now **six instances across two cycles** (cycle
   12's four, plus FIX-1441 and FIX-1416 here), against a rule that is precise and a mechanism
   (`epic-wake`) that already computes the disagreement. Second cycle recorded, nothing built.
5. **Are the loop's fixes landed at the gate?** Cycle 12 was the first `yes`. This cycle is the second.
   The baseline is **two of five landed same-day**; score whether it holds.
6. **Is a loop fix's *reachability* the thing that fails?** Baseline: **four defects in one sitting, on
   one rule** — hook (satisfiable without the obligation), gate (excluded its own motivating cases),
   unit (resolved a label's opening subject, not its claims), plus a stale restatement inside the
   paragraph explaining stale restatements. Each found by a different reviewer, none overlapping.

   **Candidate fix, held for cycle 14 and deliberately not landed here — a reachability step in
   `distill-lessons` itself.** Before a cycle lands a rule as its upstream fix: take the instances the
   rule was derived from and, for each, walk **trigger → obligation → report** and say which link it
   falls out of. Name the gate the rule sits under, the hook that reports it, and the unit it operates
   on. If an instance escapes, the rule is not the fix yet.

   **It clears the Step-3 gate.** *Generalizable* — every cycle proposes a rule. *Grounded* — four
   named instances on this PR, all verifiable. *Not already covered* — BP-003 demands a red state for a
   **check in code**, and this is the one artifact class the project exempts from its own evidence
   standard; Step 3 asks generalizable / grounded / duplicate / altitude and never asks *would it
   fire*. *Altitude* — a step in one skill's own output, not another line agents read mid-implementation,
   so it does not grow `issue-implement` 10.6 a fourth time.

   **The serious objection, tested: is "would it fire here" decidable for prose?** The mechanical
   figure check was rejected two sections above for exactly this, so the candidate has to clear the
   same bar or it is that idea in a hat. It clears it, and the reason is the distinction the whole
   cycle turns on. The figure check had to decide **semantic agreement between two statements over an
   unbounded corpus** — not decidable. This walks **a bounded, already-enumerated instance set** and
   asks a concrete question of each. All three of this round's findings answer cleanly: *is the new
   obligation named in the reporting line?* (no — the hook said "two sweeps"); *does instance #1886
   satisfy the enclosing trigger?* (no — it changed no behavior); *did enumerating catch L1499?* (no,
   and that is measured, not predicted — the 22-tag sweep ran and it still came back wrong). **It is
   the cycle's own landed method — enumerate the bounded set instead of reasoning about the words —
   turned on the cycle's own output.**

   **The failure mode to watch**, because it is how this becomes ceremony: if a cycle's instance set is
   large, "show it fires on each" gets expensive and gets faked. The mitigation is already in Step 3 —
   the instances are the ones the entry must name as evidence anyway, and a cycle that cannot name them
   does not have a grounded fix to land. **Score it in cycle 14 on whether it catches a reachability
   defect *before* review does, on a rule that would otherwise have shipped.**
7. **Is `invented-attribution` a real class?** Proposed, not minted — see *Observed after collection*.
   Renamed from `invented-reference` once the second instance showed the class is about attribution, not
   citation. Baseline: **two instances, both outside the sample, both the same day, both self-caught** —
   a PR number that resolved to a different issue, and reasoning attributed to the owner who never gave
   it. It defeats every instrument this entry discusses, including both checkers it praises, because in
   each case the cited thing *existed* and was about something else.
   **The survival condition has changed: it no longer needs a second instance.** What it needs is
   whether it appears when **nobody is looking for it**. Both instances were caught by authors who had
   just spent a session on adjacent classes, which is the same favourable-condition problem as the
   counter-evidence above. Collect it deliberately next cycle rather than waiting for a self-report:
   take a sample of atlas and spec citations and resolve each one's **subject**, not its existence — and
   for any reasoning attributed to a person, check it against what they actually wrote. Watch the
   attributed-reasoning form first: a wrong citation is falsifiable by any reader, invented reasoning
   only by the person quoted.
8. **Does enumeration find what review does not, on a claim nobody chose for it?** Now has a concrete
   shape to score, from the `teamInstructions` measurement above: **pick a claim, count its sites,
   compare what review reported against what enumeration finds.** Baseline **7 / 3 / 4** on one claim in
   one package, by an author who had been told to enumerate. Run it next cycle on a claim picked
   *before* anyone sweeps, by an author who was not briefed, and on a package nobody chose — otherwise
   it measures the briefing.
9. **Candidate, not acted on: a shipped record is not a stale claim.** The FIX-1377 author declined to
   rewrite `CHANGELOG.md`'s entry for the release that reserved the key, on the grounds that it was true
   of that release and rewriting it falsifies history. That is the same distinction drawn independently
   about cycle 4's ledger row earlier in this cycle — **two agents reaching it separately in one day
   suggests it wants stating once rather than rediscovering.** Where it belongs (10.6's sweep, which
   already carries an `EXCLUDE` instinct, or the changelog workflow) is not settled here.
