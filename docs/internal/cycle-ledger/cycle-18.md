# Cycle 18 — kitchen-sink rebuild / Workforce reference epic wrap (FIX-1455) (2026-09-24)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**The most expensive thing in this epic happened after review, not in it.** Six artifacts merged
before their first automated review came back: four direction artifacts (#1991, #2131, #2164,
#2215) and two implementation PRs (#2115, #2184). A seventh, #2203, merged a final head that no
reviewer saw. Every one of the six left draft within 66 seconds of its merge, and leaving draft
is what starts both bots. Three of them left findings on `main` that nobody answered or filed.
One of them, #2184, went red on its own merged head six minutes after the merge. Together with
#2169, which merged green against a `main` that no longer existed, that kept `main` red for 43
minutes on 09-24. Four other PRs had to carry the repair.

**Method — scope.** Forty-two reviewed artifacts, found three ways: the Linear children of
FIX-1455 and their attachments (read over GraphQL), a GitHub search for the epic id and each
child id, and `specs/epics/FIX-1455/` and `specs/issues/FIX-{1475,1476,1477,1478,1500,1527,1551,1561}/`
on `main`. The artifacts are the epic PR #1978 and its amendments #1986, #1991 and #2131. The eight
issue specs are #1988, #1990, #1992, #1994, #2061, #2112, #2158 and #2173. The seven spec amendments
are #2010, #2029, #2063, #2111, #2137, #2164 and #2215. The rest are twenty-three implementation
PRs, listed in the table. **Out of the sample:** #2104 (FIX-1536), already scored in cycle 16 as
part of FIX-1528's wrap. The five restraint POCs #2005, #2008, #2110, #2124 and #2125 closed
unreviewed, and three were adopted (into #2104, #2123 and #2122). Search hits that belong to other
issues are also out: #2074 (FIX-1480), #2079 (FIX-1419), #2080 (FIX-1498), #2084 (FIX-1415), #2118
(FIX-1541), #2162 (FIX-1457) and #2183 (FIX-1543). FIX-1469 is in Backlog with no PR. Every review,
review thread, conversation comment, commit list and label/ready/merge event was read through the
GitHub REST API. Check runs were read for #2169's and #2184's heads. **Findings, endpoints and
rounds** follow cycle 17's rules unchanged. Direction artifacts end at the human direction approval,
which on every artifact but #1978, #2158 and #2173 is the owner's merge. A thread was classed from
its opening comment and replies. Where the class depended on the fold, the fold commit was read.
**Implementation merges, and every other act, sit behind the shared `jhoffner` login.** The
artifacts do not show whether the owner or an agent pressed a given merge or ready button, and
this entry does not guess.

| PR | Kind | Rounds | Endpoint | Feedback classes (deduped) | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#1978](https://github.com/fixpoint-labs/flow-state-dev/pull/1978) epic-spec FIX-1455 | epic | ~1 | approval 09-20 22:39Z on `5a147a3` (owner comment and `spec approved` label); merge 09-21 01:23Z after the owner-answer fold | spec-ambiguity ×4 (a `CHANNELS.md` convention nothing ships · runtime creation against ER-16 · two wide-screen homes for the roster · ER-24 missing from the wrap gate) · over-engineered ×1 (four shell figures at epic altitude) · missed-edge-case ×1 · nit ×4 — *6 from 12* | no | — |
| [#1986](https://github.com/fixpoint-labs/flow-state-dev/pull/1986) epic amendment (D8) | epic (amendment) | ~1 | approval = merge 09-21 13:18Z | stale-restatement ×2 ("seat list" beside D8 · "two steps" against three levels) · missed-edge-case ×1 (no org-scoped source) · spec-ambiguity ×1 (the FIX-1476/FIX-1477 cycle) · nit ×3 — *4 from 7* | no | — |
| [#1991](https://github.com/fixpoint-labs/flow-state-dev/pull/1991) epic status refresh | epic (amendment) | **0 before merge** | approval = merge 09-21 15:34:37Z, **16 s after leaving draft** | reviewed **after** merge by Cursor: stale-restatement ×1 (`path.svg`'s legend) · nit ×4 — *1 from 5* | no | **leave draft for review, not for merge** (the proposal) |
| [#2131](https://github.com/fixpoint-labs/flow-state-dev/pull/2131) epic amendment (set, D9) | epic (amendment) | **0 before merge** | approval = merge 09-24 16:32:45Z, **7 s after leaving draft** | reviewed **after** merge by Cursor: stale-restatement ×1 on five surfaces ("five issues" against the seven it adds) · docs-miss ×1 (a blank line splits EVOLUTION's amendment table) · nit ×2 — *2 from 8*. **Neither was folded. Both are on `main` today**: `DECISIONS.md:15,33`, `DOCS.md:5`, `SPEC.md:124`, and `EVOLUTION.md`'s blank line before row 25 | no | the proposal |
| [#1988](https://github.com/fixpoint-labs/flow-state-dev/pull/1988) spec FIX-1478 | spec | ~1 | approval = merge 09-21 13:20Z | missed-edge-case ×6 (1 *overclaim*: four "honest team paths" were hypothetical · 1 *vacuous-assertion*: V2 could not exercise a migration) · spec-ambiguity ×2 (SPEC against PLAN on `package.json` · four against five) · docs-miss ×1 · nit ×1 — *9 from 14* | no | — |
| [#1990](https://github.com/fixpoint-labs/flow-state-dev/pull/1990) spec FIX-1475 | spec | ~1 | approval = merge 09-21 13:16Z | missed-edge-case ×7 (six Codex P1/P2 on the fire and reload paths) · docs-miss ×2 · spec-ambiguity ×1 (inventory promised, roster written) · nit ×5 — *10 from 15* | no | — |
| [#1992](https://github.com/fixpoint-labs/flow-state-dev/pull/1992) spec FIX-1476 | spec | ~1 | approval = merge 09-21 17:58Z | spec-ambiguity ×2 · missed-edge-case ×1 (*vacuous-assertion*: a schema control `openChannels` cannot refuse; the fold commit re-aims "two checks that could not fail") · philosophy-drift ×1 (a test outbox in the shipped worker) · docs-miss ×1 · nit ×3 — *5 from 9* | no | — |
| [#1994](https://github.com/fixpoint-labs/flow-state-dev/pull/1994) spec FIX-1477 | spec | ~1 | approval = merge 09-21 16:45Z | missed-edge-case ×5 (Roster had no client-readable source; the fold called it a credential question, which #2029 later refuted) · spec-ambiguity ×2 · over-engineered ×1 · nit ×4 — *8 from 12* | **later** — #2029 corrected four of its premises | — |
| [#2061](https://github.com/fixpoint-labs/flow-state-dev/pull/2061) spec FIX-1500 | spec | **~3** | approval = merge 09-22 19:19Z, **4 min after the round-3 rework `d283432`**, which only the Architect had read | design-off ×1 (*"three of the seat detail's four sources do not exist"*) · missed-edge-case ×6 (1 *overclaim*: every assertion "has a negative control" when only C1 did · 2 *vacuous-assertion*: C2 looser than the story · a restart gate on a server that cannot restart) · spec-ambiguity ×2 · docs-miss ×1 · over-engineered ×1 · nit ×14 — *11 from 28* | **yes** — the third round was a rework, and FIX-1500 then took **five** follow-up amendments (#2063, #2111, #2137, #2164, #2215) | the round-3 rework merged before review; **#2063 retracted what it "only annotated" 81 min later** |
| [#2063](https://github.com/fixpoint-labs/flow-state-dev/pull/2063) spec amendment FIX-1500 | spec (amendment) | ~1 | approval = merge 09-22 20:40Z | stale-restatement ×3 (the retired Open 2 on three surfaces · the sketch against S5/V7 · the inventory-row carrier) · nit ×3 — *3 from 8*. The body diagnoses it: *"both sweeps searched for a spelling instead of a claim"* | no | — a pre-fix instance for cycle 15's fix B (this head does not carry `7c29203be`) |
| [#2111](https://github.com/fixpoint-labs/flow-state-dev/pull/2111) spec amendment FIX-1500 (option C) | spec (amendment) | ~1 | approval = merge 09-23 23:59Z | stale-restatement ×1 (an empty PR-B row against "three PRs") · spec-ambiguity ×1 (VG needs FIX-1477's open Seats fork) · nit ×7 (four on the cherry-picked #2094 fix, not this PR's change) — *2 from 9*. Self-caught: a reply about external anchors, withdrawn a minute later | no | **`main` was red** (#2091 × #2079), so five of this epic's PRs carried the same cherry-pick |
| [#2137](https://github.com/fixpoint-labs/flow-state-dev/pull/2137) spec amendment FIX-1500/FIX-1527 (named org) | spec (amendment) | ~1 | approval = merge 09-24 18:21Z | spec-ambiguity ×1 · missed-edge-case ×1 (legacy channels after boot) · docs-miss ×1 — *3 from 3* | **yes** — the owner replaced its upgrade path with a wipe on #2159 T1, 74 min after this merge | — owner direction |
| [#2164](https://github.com/fixpoint-labs/flow-state-dev/pull/2164) spec amendment FIX-1500 (wipe) | spec (amendment) | **0 before merge** | approval = merge 09-24 20:00:34Z, **5 s after leaving draft** | none; Codex completed clean at 20:01:35Z, after the merge | no | the proposal |
| [#2215](https://github.com/fixpoint-labs/flow-state-dev/pull/2215) spec amendment FIX-1500/FIX-1561 (`leafDetail`) | spec (amendment) | **0 before merge** | approval = merge 09-24 23:03:53Z, **14 s after leaving draft** | none; Codex completed clean at 23:05:27Z, after the merge | **yes** — records the owner's option B for the FIX-1500 × FIX-1561 conflict | the proposal; for the conflict, see *Coordinator observations* item 6 |
| [#2010](https://github.com/fixpoint-labs/flow-state-dev/pull/2010) spec amendment FIX-1476 | spec (amendment) | ~1 (+1 owner re-cut) | approval = merge 09-21 22:09Z | missed-edge-case ×3 (1 *vacuous-assertion*: V14's red state was *"a false non-vacuity claim"*) · docs-miss ×1 (BR-17 rendered as pipe text) · stale-restatement ×1 (`channels.md:27`) · spec-ambiguity ×1 · nit ×5 — *6 from 11* | **yes** — the owner reversed the DM; the coordinator pinned `principal`, then withdrew it for `author` after reading the schema | — |
| [#2029](https://github.com/fixpoint-labs/flow-state-dev/pull/2029) spec amendment FIX-1477 | spec (amendment) | **~12** | approval = merge 09-22 16:23Z, after Codex returned clean on `b8c8773` | stale-restatement ×8 · missed-edge-case ×15 (**5 *vacuous-assertion***: a probe that logged instead of asserting · a probe aimed at the wrong route · V15 never cleared the refusal it counted · captures read before completion · BR-19 cited a check that proves problem strings, not seat rows) · spec-ambiguity ×4 · docs-miss ×3 · philosophy-drift ×2 (live PR status in a retained plan, seeded by a coordinator instruction · review-cycle notes in EVOLUTION) · design-off ×1 (S8's viewer binding needs FIX-1503) · nit ×3 — *33 from 40*. **At least eight of the 33 were introduced by the amendment or a previous fold**, in the commits' and replies' own words | **yes** | — see *Filed, not proposed*. The Architect reviews record *"Jake asked for re-review"* at each fold |
| [#2112](https://github.com/fixpoint-labs/flow-state-dev/pull/2112) spec FIX-1527 | spec | ~1 | approval = merge 09-24 16:06Z | missed-edge-case ×2 (1 *vacuous-assertion*: `--capture` holds stream events, not store state, so an absent event proves no absent write) · stale-restatement ×1 (the epic spec did not list FIX-1500 or FIX-1527, against ER-21) · nit ×6 (four on the cherry-picked #2094 fix) — *3 from 9* | no | — |
| [#2158](https://github.com/fixpoint-labs/flow-state-dev/pull/2158) spec FIX-1551 | spec | ~1 | approval 09-24 18:49Z (owner comment on F1/F2); merge 19:32Z | missed-edge-case ×3 (2 P1s, each confirmed by extending the POC: P6 and P8 · 1 *vacuous-assertion*: P3 compared against a different route) · spec-ambiguity ×1 — *4 from 4* | no | — |
| [#2173](https://github.com/fixpoint-labs/flow-state-dev/pull/2173) spec FIX-1561 | spec | ~1 | approval 09-24 20:33Z (owner's hover answer, recorded in `f1cdb81`); merge 20:34Z | missed-edge-case ×1 (the narrow-label assertion BR-4 promised) · over-engineered ×1 · docs-miss ×1 — *3 from 3*. Plus the owner's two asks (one icon size, dashed tree lines), folded in `a15fe8e` | later — see item 6 | **no cross-spec pass covered it** (item 6) |
| [#1989](https://github.com/fixpoint-labs/flow-state-dev/pull/1989) impl FIX-1429 | impl | ~1 | merge 09-21 13:18Z | missed-edge-case ×3 (**2 *vacuous-assertion***: `portInUse` accepted any answering process · the anti-game probe matched a quoted token, not the wiring) · docs-miss ×1 · nit ×3 — *4 from 7* | no | — |
| [#1993](https://github.com/fixpoint-labs/flow-state-dev/pull/1993) impl FIX-1475 PR-A | impl | ~1 | merge 09-21 20:35Z | missed-edge-case ×3 · over-engineered ×1 · docs-miss ×1 · nit ×3 — *5 from 9* | no | — |
| [#1996](https://github.com/fixpoint-labs/flow-state-dev/pull/1996) impl FIX-1475 PR-B | impl | ~1 | merge 09-21 20:35Z | missed-edge-case ×4 · over-engineered ×2 · docs-miss ×1 · nit ×2 — *7 from 10*. **Docs isolation skipped: "this session has no sub-agent dispatch tool"** | no | item 4 |
| [#1995](https://github.com/fixpoint-labs/flow-state-dev/pull/1995) impl FIX-1478 | impl | ~1 | merge 09-21 20:35Z | over-engineered ×1 (Code Snob; POC #2005 deferred) · nit ×3 — *1 from 4* | no | — |
| [#2007](https://github.com/fixpoint-labs/flow-state-dev/pull/2007) impl FIX-1476 | impl | ~2 | merge 09-21 22:42Z | missed-edge-case ×5 (**2 *vacuous-assertion***: runtime subjects hard-coded, not read off the tree · V7 never waited for `completed`) · over-engineered ×1 (`digest.ts` a second copy of the channel) · design-off ×1 (owner: a DM channel is too noisy) · nit ×4 — *7 from 9 threads and two bodies*. Docs isolation skipped | **yes** | item 4 |
| [#2006](https://github.com/fixpoint-labs/flow-state-dev/pull/2006) impl FIX-1477 PR-A | impl | ~2 | merge 09-21 20:37Z | missed-edge-case ×2 · docs-miss ×2 (bump, length) · over-engineered ×1 · nit ×5 — *5 from 10*. Docs isolation skipped | no | item 4 |
| [#2011](https://github.com/fixpoint-labs/flow-state-dev/pull/2011) impl FIX-1477 PR-B | impl | ~1 | merge 09-21 22:41Z | missed-edge-case ×1 (a regression: the create fence) · over-engineered ×1 (FIX-1494 filed) · design-off ×1 (owner: take the actions out of the rail) · nit ×2 — *3 from 4 and the owner*. Prose written holding the diff; a cold docs-editor pass followed | **yes** | item 4 |
| [#2019](https://github.com/fixpoint-labs/flow-state-dev/pull/2019) impl FIX-1477 S9 | impl | ~2 | merge 09-22 00:47Z | missed-edge-case ×5 (Bugbot High: a dispatch map · two pre-existing gaps filed as FIX-1498 and FIX-1499) · over-engineered ×1 · nit ×3 — *6 from 10* | no | — |
| [#2036](https://github.com/fixpoint-labs/flow-state-dev/pull/2036) impl FIX-1477 PR-A2 | impl | ~1 | merge 09-22 16:53Z | design-off ×1 (panels cannot watch a collection; went to #2029) · missed-edge-case ×3 · over-engineered ×1 · docs-miss ×1 · nit ×2 — *6 from 8* | **yes** | — |
| [#2113](https://github.com/fixpoint-labs/flow-state-dev/pull/2113) impl FIX-1477 PR-C | impl | ~1 | merge 09-23 23:34Z | missed-edge-case ×2 · philosophy-drift ×1 (`lib/` importing from a flow module) · spec-ambiguity ×1 (the Seats fork) · docs-miss ×1 · nit ×3 — *5 from 8* | no | — |
| [#2115](https://github.com/fixpoint-labs/flow-state-dev/pull/2115) impl FIX-1477 PR-A3 | impl | **0 before merge** | merge 09-23 23:19:49Z, **52 s after leaving draft** | reviewed **after** merge: missed-edge-case ×1 (Cursor and Codex both: the page loop stops at `MAX_PAGES` with no error, *"another silent truncation"*) · nit ×3 — *1 from 5*. **Unanswered, unfiled, and on `main`**: `packages/react/src/components/panels/reads.ts:147-159` | no | the proposal |
| [#2122](https://github.com/fixpoint-labs/flow-state-dev/pull/2122) impl FIX-1500 PR-C | impl | ~1 | merge 09-24 16:01Z | missed-edge-case ×3 · over-engineered ×1 (adopted from POC #2125) · nit ×4 — *4 from 8* | no | — |
| [#2123](https://github.com/fixpoint-labs/flow-state-dev/pull/2123) impl FIX-1500 PR-A | impl | ~1 | merge 09-24 16:00Z | docs-miss ×1 · over-engineered ×1 (adopted from POC #2124) · nit ×4 — *2 from 6* | no | — |
| [#2159](https://github.com/fixpoint-labs/flow-state-dev/pull/2159) impl FIX-1500 PR-B | impl | ~1 | merge 09-24 20:18Z | design-off ×1 (owner: wipe the store, don't upgrade it) · missed-edge-case ×1 (mooted by the wipe) — *2 from 2* | **yes** | — owner direction |
| [#2193](https://github.com/fixpoint-labs/flow-state-dev/pull/2193) impl FIX-1500 PR-D | impl | ~1 | merge 09-24 22:04Z | missed-edge-case ×1 (the queued-dispatch handshake; Codex, and the Architect's blocking item) — *1 from 1*. Carried #2191's repair commits and posted a "`main` is red" note | no | item 1 |
| [#2132](https://github.com/fixpoint-labs/flow-state-dev/pull/2132) impl FIX-1527 | impl | 0 | merge 09-24 18:21Z | none. Codex clean; Bugbot did not run | no | — |
| [#2148](https://github.com/fixpoint-labs/flow-state-dev/pull/2148) impl FIX-1548 | impl | ~1 | merge 09-24 19:36Z | missed-edge-case ×1 (catalog identity, which became FIX-1552) · docs-miss ×1 (*overclaim*: any same-org token reaches the seat) — *2 from 2* | no | — |
| [#2169](https://github.com/fixpoint-labs/flow-state-dev/pull/2169) impl FIX-1563 | impl | ~1 | merge 09-24 20:32:59Z | missed-edge-case ×1 (*vacuous-assertion*: the test injected `resolveVisitor` instead of booting the app's resolver; #2191 re-keyed it) — *1 from 1*. **Merged green against a `main` without #2159** (its head `45a60e5` does not contain `5c57608`), so `hired-seat-visitor-auth.test.ts` went red on `main` | no | item 1 |
| [#2184](https://github.com/fixpoint-labs/flow-state-dev/pull/2184) impl FIX-1552 | impl | **0 before merge** | merge 09-24 20:39:01Z, **66 s after leaving draft and 44 s after its merge of `main`** | reviewed **after** merge: missed-edge-case ×1 (Codex P1: catalog resolutions memoised by resolver, not by instance). **Unanswered and unfiled**; the memo moved to `packages/engine/src/routes/instance-caller.ts:75-83` in #2192. **CI on the merged head `3442a56` started at 20:41:50Z and failed at 20:44:53Z** (`ACME`/`BRAVO`) | no | the proposal; item 1 |
| [#2191](https://github.com/fixpoint-labs/flow-state-dev/pull/2191) impl FIX-1563 (re-key) | impl | ~1 | merge 09-24 21:15:47Z | over-engineered ×1 (duplicated real-app boot scaffolding; declined for a follow-up) — *1 from 1*. **The repair of `main`** | no | — |
| [#2170](https://github.com/fixpoint-labs/flow-state-dev/pull/2170) impl FIX-1551 | impl | ~1 | merge 09-24 21:21Z | missed-edge-case ×1 (the HTTP body lost in CLI resolution) · docs-miss ×2 (1 *overclaim*) — *3 from 3*. Carried #2191's commits | no | item 1 |
| [#2192](https://github.com/fixpoint-labs/flow-state-dev/pull/2192) impl FIX-1566 | impl | ~1 | merge 09-24 21:57Z | missed-edge-case ×1 (tenant filter on per-instance active requests) — *1 from 1*. Carried #2191's commits | no | item 1 |
| [#2203](https://github.com/fixpoint-labs/flow-state-dev/pull/2203) impl FIX-1561 | impl | **0** | merge 09-24 23:40Z | none, because **nothing reviewed it**. Bugbot was at its usage limit. Codex reviewed `ed66090` when the PR left draft and found nothing. The final head `feeba41`, which adds the public `leafDetail` slot, came 46 min later and had no review. The body: *"no sub-agent tool was available in this session, so the `review` skill's parallel lenses did not run"* | **yes** — CI went red on the merge of #2193, and the owner chose option B | the proposal; items 4 and 6 |

**Load.** About 23 spent waves across the 23 implementation PRs, and 68 non-`nit` findings. Five of
the 68 are *vacuous-assertion* (7%), on #1989, #2007 and #2169. Cycle 17 had 35%. Cycle 17's claim 4
reads the difference: this epic's implementation PRs were app and UI code, and few of them graded a
claim. The 19 direction artifacts carry 113 non-`nit` findings. **#2029 alone carries 33 of them over
about 12 waves.** Without it, the other 18 average 4.4 findings and about 1 round each, and only
#2061 reached a third round. There, the round-3 finding was direction-level, as the rule requires.
Twelve direction findings are *vacuous-assertion*, five of them on #2029. **Eighteen are
stale-restatement, and eight of those are on #2029.**

**Claims (looped / settled / verdicts):**
- **#2010: 1 / 0 / —.** Which identity the poster-skip compares was argued twice inside one wave
  (`principal`, then `author`). Reading `channelNotifyInputSchema` settled it.
- **#2029: 1 / 0 / —.** The changeset bump went `minor` twice, and both shipped `patch`. It was
  settled by reading the blobs.
- **#2158: 0 / 0.** Both P1s were confirmed by extending the spec's own POC (P6, P8) inside the
  round. That is the POC doing its job, not a loop.
- Every other direction artifact: 0 / 0 / —.

## The class: a merged head the review never saw

| Artifact | Left draft → merged | First automated review | What the review found, and where it went |
|---|---|---|---|
| #1991 | 15:34:21 → 15:34:37Z | Cursor 15:37:04Z | 5 comments. A figure legend now mislabels its lanes |
| #2131 | 16:32:38 → 16:32:45Z | Cursor 16:35:09Z | 8 comments. "Five issues" on five surfaces, and a split table. **On `main`** |
| #2164 | 20:00:29 → 20:00:34Z | Codex 20:01:35Z | clean |
| #2215 | 23:03:39 → 23:03:53Z | Codex 23:05:27Z | clean |
| #2115 | 23:18:57 → 23:19:49Z | Cursor 23:20:57Z, Codex 23:21:57Z | silent truncation at the page ceiling. **On `main`, unfiled** |
| #2184 | 20:37:55 → 20:39:01Z | Codex 20:41:27Z; CI failed 20:44:53Z | a P1 on the catalog memo. **On `main`, unfiled.** `main` went red |
| #2203 | head `feeba41` pushed 22:59:43Z → merged 23:40:07Z | none on that head | the new `leafDetail` slot shipped with no reviewer |

**Both bots start when a PR is opened ready or leaves draft.** Each Codex summary names the trigger
*"Draft marked ready"*. Cursor's first review lands 2–3 minutes after the ready event on each of
the three rows it reviewed. So the draft habit sets the review window. On all six rows, the PR stayed in draft
until the moment of its merge, and the window closed before it opened. #2203 is the other shape:
its ready-triggered review ran on an earlier head, and the head that merged came later.

**This is not the first time.** Cycle 17 recorded #2033, which merged 71 s before its first
review, and filed it without a proposal. Cycles 15, 16 and 17 each recorded a merge over an open
P1 (#1391, #2091, #2073). #2184 is a fourth, with a difference: its P1 had not been posted yet when
it merged.

**Why nothing in the grounding catches it.**
- `issue-spec` Step 6.3 says to open a spec PR *"ready for review (not a draft)"*. That covers
  original spec PRs only. The Linear records here show #2061 and #2173 were opened as drafts all
  the same.
- Amendments and implementation PRs have no rule about draft state.
- `issue-implement` 10.6 governs a feedback batch, and there is no batch before the review arrives.
- MERGE-ONLY step 3 re-reads *"required repository checks"*, and neither bot is a required check.
- `epic-lifecycle` says to surface an issue that is *"ready to merge"* without saying what ready
  means.

## The recommended upstream fix — say what a merge-ready head is, in the gate that owns merging

In `orchestration.md` → *Gates*, after *"Merging the spec PR is approval."*:

> **A merge-ready head has been reviewed.** Automated review runs when a PR is opened ready or
> leaves draft, so a PR marked ready in the same breath as its merge merges a head no reviewer
> saw. Take a PR out of draft when its work is ready for review, not when it is ready to merge.
> Call it ready to merge — or merge it through MERGE-ONLY — only once that review and the
> required checks have returned on its current head.

And in `epic-lifecycle` step 4, one clause on the existing *"ready to merge"* line points at it.

**It clears the Step-3 gate.** *Generalizable*: any PR whose reviewers start on the ready event.
*Grounded*: the seven rows above and cycle 17's #2033. Three rows left findings on `main` that
nobody answered, and one turned `main` red. *Not already covered*: see the list above. *Altitude*:
the definition goes where merging is already governed, with a pointer in the skill that surfaces
merges. It adds no new BP and no checklist. **What would change my mind:** the shared login hides
who pressed ready and merge. If it was the owner each time, this paragraph binds nobody who did it,
and the fix is the repository setting asked about below, or nothing at all. **What being wrong
costs:** two to five minutes per merge, waiting for a review that comes back clean.

## Coordinator observations, checked against the artifacts

| # | Verdict |
|---|---|
| 1 · Parallel merges broke `main` twice | **CONFIRMED, with one correction.** #2169's CI passed at 20:00Z on a head without #2159 (merged 20:18Z), and it merged at 20:32:59Z. #2184 was **not** stale: its head `3442a56` had merged `main`, #2159 included, at 20:38:17Z. It merged 44 s later, **before CI on that head started** (20:41:50Z). That run failed at 20:44:53Z. #2191 repaired `main` at 21:15:47Z, 43 min after #2169. #2170, #2192 and #2193 each carried #2191's commits and a "`main` is red" note. **There was an earlier third instance, paid for by this epic:** `main` was red from `ffe2b6e` (#2091 × #2079, both outside the epic), so #2104, #2111, #2112, #2113 and #2115 each carried a cherry-pick of `db41f92` |
| 2 · Two agents on one branch name | **NOT DERIVABLE.** A near-miss leaves no commit. The one nearby trace is #2203's two same-titled docs commits three minutes apart (`021b913` +42/−7, `3ece711` +6/−8), which fits a redo but does not prove this |
| 3 · A shared scratchpad script overwritten | **NOT DERIVABLE.** The scratchpad is outside the repository |
| 4 · Sub-agents lack the Agent tool | **CONFIRMED on five artifacts.** #1996, #2006, #2007 and #2011 say no sub-agent dispatch was available. Docs isolation was skipped: prose was copied from `DOCS.md`, or written holding the diff. On #2203 the `review` lenses did not run. Later PRs (#2170, #2192) show the coordinator dispatching `docs-writer`/`docs-editor` itself. Cycle 16 recorded the same observation as not derivable |
| 5 · The PR-body write path puts image `src`s in backticks | **CONFIRMED, and already documented.** #2203's body carries `` `<img src="''https://raw.githubusercontent.com/…''"` `` in its table. #1994's comment of 09-21 records the same behaviour. `spec-figures.md` → *In the PR body* and `issue-spec` Step 6.3 already give the remedy: read the stored body back, leave a link, hand a person the clean line. Nothing to add |
| 6 · Two approved specs conflicted | **CONFIRMED, with one correction.** At FIX-1561's spec merge (`abad974`), `git grep leafToolbar` finds nothing in FIX-1500's spec or the epic's. FIX-1500 drew the seat's kind, instructions and hire form inside the rail under the seat row (its SPEC illustration and DOCS paragraph). **PR-D (#2193), opened 23 min after FIX-1561's spec merged, put them in `leafToolbar`.** FIX-1561 D1 made `leafToolbar` the one-line row and rejected a new slot. So the conflict was one spec's decision against a sibling's drawn intent as its in-flight PR built it. **The mechanism is visible:** `epic-wake.js:3017` sets `crossSpecHold = !input.crossSpecCleared && …`. Once the pass has cleared, a spec that joins the set later is never held for one. A pass ran for FIX-1500 and FIX-1527 when they joined (#2111's body: it caught the default-org refusal). No pass covered FIX-1561 |

## Candidates considered and dropped

- **A late-joining spec gets its own cross-spec pass** (item 6). The mechanism gap is real and
  sits in a workflow script, not in prose. One instance. It is recorded as claim 2 below, with the
  script line. If a second instance appears, the fix is a code change to `epic-wake.js` covered by
  `verify.mjs`, not a sentence.
- **What a worker does when it cannot dispatch** (item 4). Five artifacts, and a second epic that
  reports it. The loop has already adapted, because the coordinator dispatches the lenses and docs
  agents on the worker's behalf (#2170, #2192). One harmful outcome is measurable: #2203's
  unreviewed final head. The proposal already covers it, since a head the lenses never saw is not
  merge-ready. Carried as claim 3.
- **Branch freshness for sibling PRs** (item 1, #2169). The proposal covers #2184, whose checks had
  not returned. It does not cover #2169, whose checks were green on an old base. That half is a
  repository setting, not grounding. It is the owner's ask in the PR.
- **#2029's twelve waves.** The convergence rule allows two rounds plus a third for a spec-level
  finding. It also says *"never a re-review to satisfy one"*. Eighteen comments on #2029 ask
  *"re-review please, @cursor and @chatgpt-codex-connector"*, and the Architect reviews attribute
  the asks to the owner. The rule already says the right thing, and an owner's request overrides a
  budget. Recorded, not proposed.
- **Sharpening BP-003 for the overclaims** (#1988 T9, #2061 T11, #2148 T2, #2170 T2). Same reason
  as cycles 14–17.

## Filed, not proposed

- **#2184's P1 is unanswered and unfiled.** Codex, 20:41:27Z: two pinned instances that share a
  resolver function reuse the first instance's principal. The memo it names is on `main` at
  `packages/engine/src/routes/instance-caller.ts:75-83`, keyed `resolver → settings`. #2192 now
  shares it with the session listings. Three Linear searches found no issue. **This is a
  possible cross-instance exposure on the catalog. It needs an owner and a repro.**
- **#2115's page-ceiling truncation is unanswered and unfiled.** The `usePanelRows` loop exits at
  `MAX_PAGES` (1000) and returns what it collected, with no error. That is the silent truncation
  BR-19 and BR-21 exist to prevent, at 50,000 rows.
- **#2131's two findings are on `main`.** "Five issues" is at `DECISIONS.md:15,33`, `DOCS.md:5` and
  `SPEC.md:124`, and `EVOLUTION.md`'s amendment table is split by a blank line. This belongs to the
  wrap's docs-polish pass or a follow-up amendment.
- **FIX-1500 took five follow-up amendments after its spec merged** (#2063, #2111, #2137, #2164,
  #2215). One retracted claims the round-3 rework had only annotated. Four recorded owner decisions
  (option C, the named org, the wipe, option B). This is the highest amendment count on one spec in
  the ledger so far, and it comes from a spec whose rework merged four minutes after it was written.

## Scoring the previous cycles' fixes and claims

**Cycle 17's fixes A (`c7c409e`) and B (`1751f7f`) reached `main` in #2167 at 20:30:10Z on 09-24.
Asked by ancestry:**

```
fix A carried by the first reviewed head:
  #2193 f00ff13 CARRIES · #2191 4beaeb7 CARRIES · #2192 4383e0c CARRIES
  #2184 e4fb1f1 no      · #2170 b75c1ed no      · #2203 (no reviewed head carries it; feeba41 CARRIES, unreviewed)
every earlier implementation PR: no
```

- **Claim 1 (does the per-assertion unit move grading artifacts?): not measurable here.** Three
  carrying artifacts had one reviewer each, because Bugbot hit its usage limit from 18:39Z (first
  *"couldn't run"* on #2148). They produced three non-`nit` findings and no *vacuous-assertion*.
  The only post-fix grading artifact with a reviewer, #2193's VG, found none. Carry forward.
- **Claim 2 (fix B, facts in briefs): not derivable from PR data.** One coordinator claim could be
  checked against the artifacts: item 1's "#2184 merged stale". It turned out imprecise rather
  than stale.
- **Claim 3 (retained checks state a lifecycle): no shipped instance.** #2061's V15, a permanent
  check coupled to a throwaway POC checker, was caught and dropped in round 1. #2111 kept a POC
  check that fails on `main`, with the failure recorded in its README. Carry forward.
- **Claim 4 (does a named sweep miss a claim that uses none of the swept words?): a second
  instance, before the fix.** #2063's body: *"both sweeps searched for a spelling instead of a
  claim"*. #2063 does not carry `7c29203be`.
- **Claim 5 (cycle 16's 5C pointer, `9a72790`): first reading, and positive.** Eight implementation
  PRs had a reviewed head that carries it: #2148, #2159, #2169, #2184, #2193, #2191, #2170 and
  #2192. Review found **no stale-restatement of a narrowed rule on any of them**, against 2 of 8 in
  cycle 16. The same eight still drew two *overclaim* docs-misses (#2148 T2, #2170 T2). The sample
  is small and had one reviewer.

**Cycle 15's fix B (`7c29203`), on direction artifacts that carry it:** #2131 (one stale-restatement
on five surfaces, found after the merge, with no sweep named in the body) and #2137, #2158 and #2173
(none). #2164 and #2215 were never reviewed.

## Claims to test next cycle

1. **Does the merge-ready definition close the gap between draft and merge?** Baseline: 6 of 42
   artifacts merged before their first automated review, and 1 merged a head that no reviewer saw.
   Score the gap between leaving draft and merging, and whether any finding lands after the merge.
2. **Does a spec that joins after the cross-spec pass get one?** Baseline: FIX-1561 got none, and
   `epic-wake.js:3017` shows why. At a second instance, make the fix in the script.
3. **Is "the worker cannot dispatch" still costing reviews?** Baseline: five artifacts, one of them
   (#2203) merged with its final head unreviewed.
4. **Cycle 17's claim 1 is still unmeasured.** Score it on the next grading-heavy epic whose
   reviewed heads carry `c7c409e`, with more than one reviewer.

## Finding map

`T`-numbers are positions in each PR's review-thread list, oldest first. `+` joins threads collapsed
into one finding. *vac* is *vacuous-assertion*.

- **#1978** spec-ambiguity ×4: T1+T3 · T9 · T10 · T11. over-engineered ×1: T2+T12. mee ×1: T8. nit ×4: T4–T7.
- **#1986** stale-restatement ×2: T1 · T2. mee ×1: T6. spec-ambiguity ×1: T7. nit ×3: T3–T5.
- **#1991** (after merge) stale-restatement ×1: T5. nit ×4: T1–T4.
- **#2131** (after merge) stale-restatement ×1: T2+T3+T5+T6+T7. docs-miss ×1: T1. nit ×2: T4 · T8.
- **#1988** spec-ambiguity ×2: T1+T5 · T3+T4. mee ×6: T2+T14 · T6 · T7+T13 · T9 · T11 · T12 (vac). docs-miss ×1: T10. nit ×1: T8.
- **#1990** spec-ambiguity ×1: T1. mee ×7: T7 · T8 · T9 · T10 · T11 · T13 · T14. docs-miss ×2: T12 · T15. nit ×5: T2–T6.
- **#1992** spec-ambiguity ×2: T1 · T2+T4. mee ×1: T7 (vac). philosophy-drift ×1: T8. docs-miss ×1: T9. nit ×3: T3 · T5 · T6.
- **#1994** mee ×5: T3 · T7 · T9 · T10 · T12. spec-ambiguity ×2: T8 · T11. over-engineered ×1: T2. nit ×4: T1 · T4 · T5 · T6.
- **#2061** design-off ×1: T16+T20 (and the rework `d283432`). mee ×6: T11 · T12 (vac) · T17 · T18 · T19 · T21 (vac). spec-ambiguity ×2: T1+T2 · T13. docs-miss ×1: T22. over-engineered ×1: T8+T27. nit ×14: T3–T7 · T9 · T10 · T14 · T15 · T23–T26 · T28.
- **#2063** stale-restatement ×3: T1+T4+T7 · T6 · T8. nit ×3: T2 · T3 · T5.
- **#2111** stale-restatement ×1: T4. spec-ambiguity ×1: T9. nit ×7: T1–T3 · T5–T8.
- **#2137** spec-ambiguity ×1: T1. mee ×1: T2. docs-miss ×1: T3.
- **#2010** mee ×3: T8 · T9 · T11 (vac). docs-miss ×1: T1. stale-restatement ×1: T4. spec-ambiguity ×1: T10. nit ×5: T2 · T3 · T5 · T6 · T7.
- **#2029** stale-restatement ×8: T1 · T10 · T12 · T13+T17+T22+T25 · T15 · T18 · T29 · T34. mee ×15: T3 (vac) · T6 (vac) · T7 · T8 · T16 · T19 · T20 · T23 · T26 · T27 · T31 (vac) · T33 · T36 (vac) · T38 · T40 (vac). spec-ambiguity ×4: T21 · T30 · T35 · T37. docs-miss ×3: T9 · T11 · T28. philosophy-drift ×2: T14+T39 · T24. design-off ×1: T32. nit ×3: T2 · T4 · T5.
- **#2112** mee ×2: T7 · T8 (vac). stale-restatement ×1: T9. nit ×6: T1–T6.
- **#2158** mee ×3: T1 · T2 · T3 (vac). spec-ambiguity ×1: T4.
- **#2173** mee ×1: T1. over-engineered ×1: T2. docs-miss ×1: T3.
- **#1989** mee ×3: T3 (vac) · T6 · T7 (vac). docs-miss ×1: T1. nit ×3: T2 · T4 · T5.
- **#1993** mee ×3: T6 · T7 · T8. over-engineered ×1: T1+T2. docs-miss ×1: T9. nit ×3: T3–T5.
- **#1996** mee ×4: T3+T4 · T7 · T8 · T9. over-engineered ×2: T1 · T2. docs-miss ×1: T10. nit ×2: T5 · T6.
- **#1995** over-engineered ×1: T1 (+ the Code Snob body). nit ×3: T2–T4.
- **#2007** mee ×5: T2 · T4 · T5 · T6 (vac) · T7 (vac). over-engineered ×1: the Code Snob body. design-off ×1: the owner's DM comment. nit ×4: T1 · T3 · T8 · T9.
- **#2006** mee ×2: T1 · T8. docs-miss ×2: T9 · T10. over-engineered ×1: T2. nit ×5: T3–T7.
- **#2011** mee ×1: T4. over-engineered ×1: T1. design-off ×1: the owner's rail-actions comment. nit ×2: T2 · T3.
- **#2019** mee ×5: T1 · T3+T9 · T5 · T8 · T10. over-engineered ×1: T2. nit ×3: T4 · T6 · T7.
- **#2036** design-off ×1: T5. mee ×3: T3 · T7 · T8. over-engineered ×1: T1. docs-miss ×1: T6. nit ×2: T2 · T4.
- **#2113** mee ×2: T6 · T7. philosophy-drift ×1: T1. spec-ambiguity ×1: T5. docs-miss ×1: T8. nit ×3: T2–T4.
- **#2115** (after merge) mee ×1: T2+T5 (open). nit ×3: T1 · T3 · T4.
- **#2122** mee ×3: T5 · T6 · T7. over-engineered ×1: T8. nit ×4: T1–T4.
- **#2123** docs-miss ×1: T5. over-engineered ×1: T6. nit ×4: T1–T4.
- **#2159** design-off ×1: T1 (owner). mee ×1: T2.
- **#2193** mee ×1: T1 (and the Architect's blocking item).
- **#2148** mee ×1: T1. docs-miss ×1: T2.
- **#2169** mee ×1: T1 (vac).
- **#2191** over-engineered ×1: T1.
- **#2184** (after merge) mee ×1: T1 (open).
- **#2170** mee ×1: T1. docs-miss ×2: T2 · T3.
- **#2192** mee ×1: T1.
- **#2132**, **#2164**, **#2215**, **#2203**: no threads.

**Implementation non-`nit`:** 4 + 5 + 7 + 1 + 7 + 5 + 3 + 6 + 6 + 5 + 1 + 4 + 2 + 2 + 1 + 0 + 2 + 1 + 1
+ 1 + 3 + 1 + 0 = **68**, of which *vacuous-assertion* 5. **Direction non-`nit`:** 6 + 4 + 1 + 2 + 9 +
10 + 5 + 8 + 11 + 3 + 2 + 3 + 0 + 0 + 6 + 33 + 3 + 4 + 3 = **113** (in table order), of which
stale-restatement 18 and *vacuous-assertion* 12.
