# Cycle 19 — kitchen-sink support desk epic wrap (FIX-1592) (2026-09-29)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**The closure check graded its controls by leg, and the grounding told it to.** Cycle 17's fix A
put *"the unit is the assertion, not the leg"* into `issue-implement`, and every reviewed head in
this epic carries it. The closure PR #2348 still opened with each control graded by leg. Its first
reviewed head reports *"each of the six controls failing exactly its legs"*. Review then found
seven *vacuous-assertion* findings in two waves, all in the check's own grading. The unit had been
set before any of that code existed. The closure plan (#2288) said each control *"must redden
exactly its leg set"*, and its amendment (#2317) kept a *Must fail* column of legs. The plan
followed the template. `spec-template.md` asks for *"the leg it must fail"*. `issue-spec`'s blind
goal reviewer asks about *"the leg that proves it"*. `goals/README.md` has a goal declare *"the
legs each must fail"*. Two of those three, and `issue-implement`'s own PR-body line *"the leg it
named"*, were written on 09-25 by #2267, a day after fix A reached `main`. Fix A went where
grading happens, while the unit gets set earlier, in the spec and the goal.

**Method — scope.** Thirty-six reviewed artifacts. They were found from the 21 Linear children of
FIX-1592 and their attachments (read over GraphQL), a listing of every repository PR opened since
09-25 matched on the epic id and each child id, and the `spec/FIX-<n>` branches. The artifacts are
the epic PR #2265 and its amendments #2269, #2289, #2294 and #2310, and ten issue specs: #2258,
#2277, #2278, #2280, #2288, #2296, #2313, #2314, #2318 and #2333. There are also two spec
amendments: #2300 (filed as FIX-1604, amending FIX-1601's plan) and #2317. The rest are nineteen
implementation PRs. Among them are the closure PR #2348 (FIX-1601) and the docs polish #2350
(FIX-1607 and FIX-1631). **Both were open and awaiting the owner's merge when their rows were
taken**, at heads `3c361b0` and `425cc4c`. The bug children (FIX-1603, FIX-1605, FIX-1606,
FIX-1612, FIX-1623 to FIX-1627) have no spec PR, by the bug route. **Out of the sample:** POCs
#2295 and #2342, which closed unreviewed and were adopted into #2293 and #2340. Also out:
agent-mailbox #26 (another repository), and #2291 (FIX-1598) and #2346, #2347 and #2349
(FIX-1629), which are not children. FIX-1607 is not a child either. Its PR is in the sample because
the epic wrap dispatched it. Every review, review thread, conversation comment, commit list,
ready/merge event and head check run was read through the GitHub REST API.
**Findings, endpoints and rounds** follow cycles 17 and 18 unchanged:
- Direction artifacts end at the human direction approval, which here is the owner's merge on all
  seventeen.
- Implementation rounds are spent waves (cycle 12).
- Fixes are scored by ancestry against the first reviewed head.
- A *"Second look + architecture pass"* conversation comment is read as one review body, like the
  Architect's in cycle 18.

**Every act sits behind the shared `jhoffner` login**, and this entry does not guess who pressed
what.

| PR | Kind | Rounds | Endpoint | Feedback classes (deduped) | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#2265](https://github.com/fixpoint-labs/flow-state-dev/pull/2265) epic-spec FIX-1592 | epic | ~1 | approval = merge 09-25 19:53Z | design-off ×1 (six threads on one gap: FIX-1590 could not be built inside the epic's fence) · spec-ambiguity ×2 · over-engineered ×1 · nit ×2 — *4 from 11* | **yes** — the owner re-scoped the epic 2 h 14 min later (#2269) | — owner direction |
| [#2269](https://github.com/fixpoint-labs/flow-state-dev/pull/2269) epic re-scope | epic (amendment) | ~1 (+ owner stamp) | approval = merge 09-25 22:07Z | spec-ambiguity ×3 (the FIX-1459 gate read four ways · two against three · ER-11) · stale-restatement ×2 · docs-miss ×1 (*overclaim*: the per-rule map) · philosophy-drift ×1 (ER-14 held the whole lifecycle, where a blocked-by gates only implementation) · nit ×1 — *7 from 10*. The owner's Prod/Eng stamp folded in `3c48488` | **yes** — it is the re-scope, and #2310 re-scoped again | — owner direction |
| [#2289](https://github.com/fixpoint-labs/flow-state-dev/pull/2289) epic amendment (closure issue) | epic (amendment) | ~1 | approval = merge 09-26 12:51Z | over-engineered ×3 · spec-ambiguity ×2 · stale-restatement ×1 · philosophy-drift ×1 (the wrap keyed to a clean run, not to the closure PR's merge) — *7 from 7* | no | — |
| [#2294](https://github.com/fixpoint-labs/flow-state-dev/pull/2294) epic amendment (FIX-1602) | epic (amendment) | ~2 | owner placement 13:23Z; approval = merge 09-26 14:23Z | **stale-restatement ×6** · spec-ambiguity ×3 · docs-miss ×1 (a citation) · nit ×1 — *10 from 12*. No sweep named in the body or the commits | no | cycle 15's fix B, carried and not used (see scoring) |
| [#2310](https://github.com/fixpoint-labs/flow-state-dev/pull/2310) epic amendment (routed desk) | epic (amendment) | ~2 | owner "approved" 09-27 17:37:21Z; merge 17:37:25Z | spec-ambiguity ×3 · over-engineered ×2 · missed-edge-case ×2 (a routing POC before the build · affinity before the classifier) · design-off ×1 (the owner's Prod/Eng lock: D5's who-hears is one core evaluator, not a generator; folded in `c1e8d91` and `cbd5394`) · nit ×1 — *8 from 9 and the owner* | **yes** — it exists because both failures the owner hit on a real model had passed every keyless check (its `EVOLUTION.md`) | — see *Candidates dropped* |
| [#2258](https://github.com/fixpoint-labs/flow-state-dev/pull/2258) spec FIX-1585 | spec | ~2 (+ the re-scope fold `f8784af`) | approval = merge 09-25 22:09Z | missed-edge-case ×3 (1 *vacuous-assertion*: P6's probe could not fail) · docs-miss ×2 (1 *overclaim*: the notify promise) · design-off ×1 (the owner's round-2 question: the transcript is the posts, not a copy in state; `4a9e0bc`) · nit ×7 — *6 from 13 and the owner* | **yes** — the re-scope fold reversed BR-14 | — owner direction |
| [#2277](https://github.com/fixpoint-labs/flow-state-dev/pull/2277) spec FIX-1590 | spec | ~1 | approval = merge 09-25 22:52Z | spec-ambiguity ×3 · missed-edge-case ×3 (1 *overclaim*) · over-engineered ×1 · docs-miss ×1 · nit ×1 — *8 from 9* | **later** — FIX-1602 replaced it as interim glue | — |
| [#2278](https://github.com/fixpoint-labs/flow-state-dev/pull/2278) spec FIX-1589 | spec | ~1 | approval = merge 09-25 23:00Z | missed-edge-case ×2 (a name collision · BullMQ dispatch) · spec-ambiguity ×2 · over-engineered ×1 · philosophy-drift ×1 (Codex P1: the seat id read by casting a private, which became D3's `seatId`) · nit ×1 — *6 from 8* | no | — |
| [#2280](https://github.com/fixpoint-labs/flow-state-dev/pull/2280) spec FIX-1594 | spec | ~1 | approval = merge 09-25 22:53Z | over-engineered ×2 · missed-edge-case ×2 (1 *vacuous-assertion*: P3's predicate passed with no line) · spec-ambiguity ×1 · docs-miss ×1 · nit ×4 — *6 from 10* | no | — |
| [#2288](https://github.com/fixpoint-labs/flow-state-dev/pull/2288) spec FIX-1601 (closure plan) | spec | ~1 | approval = merge 09-26 12:51Z | over-engineered ×5 · spec-ambiguity ×2 · missed-edge-case ×2 (the durable-hire carve-out · a gate on the epic amendment) · nit ×2 — *9 from 13*. **No review named the control unit.** S3: *"Each control must redden exactly its leg set, and nothing else"* | **later** — #2348 | **the proposal** |
| [#2296](https://github.com/fixpoint-labs/flow-state-dev/pull/2296) spec FIX-1602 | spec | ~1 | approval = merge 09-26 14:25Z | missed-edge-case ×2 (Codex P1: reloaded seats by logical id · a forged author reaches the effectful fallback) · docs-miss ×1 (*overclaim*: a type guarantee) · nit ×4 — *3 from 7* | no | — |
| [#2300](https://github.com/fixpoint-labs/flow-state-dev/pull/2300) spec amendment FIX-1604 → FIX-1601 plan | spec (amendment) | ~1 | approval = merge 09-26 19:09Z | stale-restatement ×1 (SPEC still restated the old criterion) · spec-ambiguity ×1 · docs-miss ×1 — *3 from 4*. It exists because FIX-1601's check named a spelling, `notifyFor`, that FIX-1602 had kept on purpose | no | — claim 3 |
| [#2313](https://github.com/fixpoint-labs/flow-state-dev/pull/2313) spec FIX-1609 | spec | ~1 | approval = merge 09-27 18:48Z | design-off ×1 (D2's "updated since" read had no store query, so D2 was rewritten) · missed-edge-case ×3 · spec-ambiguity ×2 · docs-miss ×2 · nit ×2 — *8 from 11* | no | — |
| [#2314](https://github.com/fixpoint-labs/flow-state-dev/pull/2314) spec FIX-1610 | spec | ~1 | approval = merge 09-27 19:15Z | missed-edge-case ×4 · spec-ambiguity ×1 · docs-miss ×1 · stale-restatement ×1 (the owner's Option A lock missing from the draft, now D4) · nit ×6 — *7 from 12 and a body* | no | — |
| [#2317](https://github.com/fixpoint-labs/flow-state-dev/pull/2317) spec amendment FIX-1601 (routed desk) | spec (amendment) | ~1 | approval = merge 09-27 19:21Z | spec-ambiguity ×4 · docs-miss ×1 (a wrong anchor) · missed-edge-case ×1 (Codex P1: the layer fence could not pass once FIX-1609 merged) · nit ×4 — *6 from 10*. **The body asked whether *"fail both, leave c green"* was the right bar. The second look said yes (T7) and named each control's own clause. The fold wrote *"at their own signal"* into the lead and kept the *Must fail* column in legs** | **later** — #2348 | **the proposal** |
| [#2318](https://github.com/fixpoint-labs/flow-state-dev/pull/2318) spec FIX-1611 | spec | ~1 | owner locks D1–D3 as written; approval = merge 09-27 20:24Z | missed-edge-case ×5 (Codex P1: the closure's stock-routing row would fail FIX-1611's escalate) · spec-ambiguity ×4 · over-engineered ×3 · docs-miss ×1 · nit ×1 — *13 from 16* | no | — claim 3 |
| [#2333](https://github.com/fixpoint-labs/flow-state-dev/pull/2333) spec FIX-1622 | spec | ~1 | owner lock 19:02Z; approval = merge 09-28 19:08Z | missed-edge-case ×2 (a read-to-stream race · replay dedupe; both handed to the implementer) · nit ×6 — *2 from 8*. The only direction artifact whose merged head a bot read | no | — |
| [#2282](https://github.com/fixpoint-labs/flow-state-dev/pull/2282) impl FIX-1585 | impl | 1 | merge 09-26 02:06Z | missed-edge-case ×3 · over-engineered ×3 · nit ×1 — *6 from 11*. Codex's run failed; Cursor, Bugbot and the second look reviewed. Merged head `b0f714f` is a fold no bot read | no | — see scoring |
| [#2283](https://github.com/fixpoint-labs/flow-state-dev/pull/2283) impl FIX-1589 | impl | 1 | merge 09-26 12:55Z | missed-edge-case ×2 (Codex P1: logical seat ids for runtime hires) · philosophy-drift ×1 (a flow imports from `test/`) · docs-miss ×1 · nit ×5 — *4 from 9*. Merged head `d5b7ad5` unread | no | — |
| [#2290](https://github.com/fixpoint-labs/flow-state-dev/pull/2290) impl FIX-1590 | impl | 1 | merge 09-26 15:15Z | missed-edge-case ×1 (routing on an unverified author; declined per spec, and FIX-1602's spec closed the effectful half) · nit ×6 — *1 from 7* | no | — |
| [#2293](https://github.com/fixpoint-labs/flow-state-dev/pull/2293) impl FIX-1594 | impl | 2 | merge 09-26 15:21Z | docs-miss ×1 (*overclaim*: the header says BR-9 goes red under a control the test never runs) · over-engineered ×1 · nit ×2 — *2 from 4*. Merged head `e8c33f3` unread | no | — |
| [#2297](https://github.com/fixpoint-labs/flow-state-dev/pull/2297) impl FIX-1602 | impl | 1 | merge 09-26 16:39Z | missed-edge-case ×1 (Codex P1: user-owned seats match on the full owner pin) · docs-miss ×1 · nit ×4 — *2 from 6*. Four commits after the last pass | no | — |
| [#2301](https://github.com/fixpoint-labs/flow-state-dev/pull/2301) impl FIX-1603 | impl | 1 | merge 09-26 19:10Z | nit ×2 — *0 from 2* | no | — |
| [#2305](https://github.com/fixpoint-labs/flow-state-dev/pull/2305) impl FIX-1606 (README) | impl | 1 | merge 09-27 17:47Z | nit ×2 (one deferred to FIX-1607) — *0 from 2* | no | — |
| [#2306](https://github.com/fixpoint-labs/flow-state-dev/pull/2306) impl FIX-1605 | impl | 1 | merge 09-27 17:43Z | missed-edge-case ×2 (**2 *vacuous-assertion***: the guard imported `src`, not the exports path · the import guard skipped client deps, and the old check passed on the same change) · docs-miss ×2 (1 *overclaim*) · over-engineered ×1 · nit ×3 — *5 from 10*. Merged head `387f95c` unread | no | — |
| [#2316](https://github.com/fixpoint-labs/flow-state-dev/pull/2316) impl FIX-1612 | impl | 1 | merge 09-27 19:23Z | docs-miss ×1 · nit ×3 — *1 from 4*. Merged head `592d59b` unread. Body: the docs agents could not be dispatched | no | — claim 5 |
| [#2319](https://github.com/fixpoint-labs/flow-state-dev/pull/2319) impl FIX-1610 | impl | **8** | merge 09-28 00:16Z, **31 min after three Codex P2s (T23–T25) landed on its head, unanswered** | missed-edge-case ×11 · over-engineered ×7 (T13, the owner: *"why safeParse here"*) · philosophy-drift ×2 (Codex P1: user-facing prose not through `docs-writer`/`docs-editor` · the owner: declare `seatId` in `flowConfigSchema`) · docs-miss ×1 · nit ×3 — *21 from 25* | **yes** — #2324 replaced the seat-side claim, which three races had hit (T10, T21, T23), with channel-side authority | — see *Candidates dropped* |
| [#2324](https://github.com/fixpoint-labs/flow-state-dev/pull/2324) impl FIX-1610 (one answer) | impl | 2 | merge 09-28 01:08Z | missed-edge-case ×1 · over-engineered ×1 · docs-miss ×1 · nit ×3 (one refuted) — *3 from 6*. Answered #2319's three open threads. Merged head `6a18861` is a docs commit after the clean pass | no | — |
| [#2320](https://github.com/fixpoint-labs/flow-state-dev/pull/2320) impl FIX-1609 | impl | **11** | merge 09-28 15:48Z | **missed-edge-case ×27** (the tenancy and identity edges T31, T32 and T37–T40 all at wave 8 or later · T11: the spec's BR-22 not built · T23 opened by an earlier fix) · docs-miss ×4 (1 *overclaim*) · stale-restatement ×2 · over-engineered ×2 · nit ×5 — *35 from 40*. `a77db05` (docs) and `bbd9f85` (test) came after the last pass | no | — see *Candidates dropped* |
| [#2322](https://github.com/fixpoint-labs/flow-state-dev/pull/2322) impl FIX-1611 | impl | 3 | merge 09-28 16:42Z | missed-edge-case ×3 (Codex P1: persisted sessions of removed channels) · nit ×5 (one filed as FIX-1614) — *3 from 8*. Terminal clean pass on the merged head | no | — |
| [#2339](https://github.com/fixpoint-labs/flow-state-dev/pull/2339) impl FIX-1627 | impl | 1 | merge 09-28 19:15Z | nit ×2 — *0 from 2* | no | — |
| [#2340](https://github.com/fixpoint-labs/flow-state-dev/pull/2340) impl FIX-1626 | impl | 2 | merge 09-28 19:14Z | docs-miss ×1 (Codex P1: the step-joining contract undocumented) · over-engineered ×1 (Code Snob; POC #2342 adopted) · nit ×3 — *2 from 5*. Merged head `d248729` unread | no | — |
| [#2343](https://github.com/fixpoint-labs/flow-state-dev/pull/2343) impl FIX-1623/1624/1625 | impl | 1 | merge 09-28 19:11Z | nit ×3 — *0 from 3*. Three closure controls that could not fail, found by the closure's run 1 and fixed here | no | **the proposal** |
| [#2344](https://github.com/fixpoint-labs/flow-state-dev/pull/2344) impl FIX-1622 | impl | 4 | merge 09-28 21:25Z | missed-edge-case ×5 (1 *vacuous-assertion*: T11, a new test with no red run · T9 opened by `a55b0b4`'s fix · T10, a goal PASS taken before its control) · docs-miss ×1 · nit ×5 — *6 from 11*. Terminal clean pass on the merged head | no | — |
| [#2348](https://github.com/fixpoint-labs/flow-state-dev/pull/2348) closure FIX-1601 | impl (closure) | 3 as of `3c361b0` | **open, awaiting the owner's merge when this row was taken.** Codex clean and Bugbot green on `3c361b0` | **missed-edge-case ×7, all *vacuous-assertion*** (controls graded by leg · a leg that never ran read as green · no `b:working` · `e:row-open` timed from the wrong reading · the docs smoke not blind (P1) · the smoke went on past an unfinished run · leg b tolerated a row that never cleared) · nit ×6 — *7 from 12 and a body*. Self-found in the same window: no-live's working-row reds depended on which read won (runs 3 and 4 differed; `984a07e`) | **yes** — the first head reported *"each of the six controls failing exactly its legs"* | **the proposal** |
| [#2350](https://github.com/fixpoint-labs/flow-state-dev/pull/2350) docs polish FIX-1607/FIX-1631 | impl (docs) | 2 as of `425cc4c` | **open, awaiting the owner's merge when this row was taken.** Opened draft, ready 09-28 23:18Z; Codex clean on `425cc4c` | nit ×5 (one accuracy nit acknowledged, four declined) — *0 from 5* | no | — |

**Load.** About 47 spent waves across the 19 implementation artifacts, and 98 non-`nit` findings.
**#2320 and #2319 carry 56 of the 98 and 19 of the 47 waves.** Without them the other seventeen
average 2.5 findings and 1.6 waves. Ten of the 98 are *vacuous-assertion* (10%). Cycle 18 had 7%
and cycle 17 had 35%. Seven of the ten are on the closure PR, the one artifact in this epic that
grades a claim end to end. The 17 direction artifacts carry 113 non-`nit` findings, about 6.6
each. Three reached a second round (#2258, #2294, #2310), and none reached a third.
Stale-restatement is 11 of the 113 (cycle 18: 18), and six of those are on #2294. Direction
*vacuous-assertion* is 2 (cycle 18: 12). Across all 211 non-`nit` findings, missed-edge-case is 94
(45%), over-engineered 34, spec-ambiguity 33, docs-miss 27, stale-restatement 13,
philosophy-drift 6 and design-off 4.

**Claims (looped / settled / verdicts):** 0 / 0 on every artifact. The owner's round-2 question
on #2258 was answered by a code trace inside the round. No `settle-claim` ran.

## The closure's runs

| Run | On | What it found |
|---|---|---|
| First QA run | `main` at `55de073` (09-26) | FIX-1603 (V14 still expected the old seat-wake rule) and FIX-1604 (a check keyed to the `notifyFor` spelling) |
| Blind docs smoke | `07d14ff` | FIX-1605 (the dev page returned 500) and FIX-1606 (the README named the wrong key). FIX-1607 took the non-blocking gaps |
| The owner's real-model run | 09-26 | FIX-1609 and the landing and fan-out failures, which led to #2310, then FIX-1610 and FIX-1611, then FIX-1612 |
| Run 1 | `9a55b79` (09-28) | FIX-1622 to FIX-1627. **Three were controls that could not fail as built:** FIX-1623 (the scripted answer came too fast for no-live to fail), FIX-1624 (no-landing broke more legs than the landing), FIX-1625 (FIX-1585's controls stopped failing once FIX-1609 added a live stream route their filter did not cover). FIX-1628 is outside the epic |
| Run 2 | `15087779b` | PASS, and #2348 opened on it. Runs 3 to 6 ran during review |
| Blind docs re-run | `15087779b` | nine doc gaps (FIX-1631, fixed on #2350), FIX-1632 and FIX-1633 |

The closure did its job. Its runs found every gap in the table before the epic closed. That
includes three controls that could not fail, found by running them.

## The class: a closure check whose controls and assertions could not fail as graded

| # | Finding on #2348 | Found by, on | What the grade let through | Folded in |
|---|---|---|---|---|
| 1 | Controls matched by leg, not by named assertion | Codex T8 and the second look, `a9723c8` | `no-live` could "fail a" through `a:kept` or `a:alone` instead of `a:working` | `4743d2b` |
| 2 | A leg that never ran read as green | the second look, `a9723c8` | a leg-c setup failure skipped `c2` and `seg`, and "no red" counted as green | `4743d2b` ("no leg fails at setup") |
| 3 | Leg b had no `b:working` | Codex T7, `a9723c8` | a post answered with no working row passed | `4743d2b` |
| 4 | `e:row-open` timed from when the clear wait ended | Codex T9, `a9723c8` | a row up to 20 s late passed a 15 s bound | `4743d2b` |
| 5 | The docs smoke was not blind (P1) | Codex T10 and the second look, `984a07e` | the verdict cited a smoke run by a reader who held the spec | `3c361b0` (the blind re-run) |
| 6 | The smoke went on past an unfinished run | Codex T11, `984a07e` | later posts ran while a specialist was still working | `a1add8e` |
| 7 | Leg b tolerated a row that never cleared | Codex T12, `984a07e` | a row left from an earlier post was subtracted from the next post's readings | `a1add8e` (`b:clears`) |

Six of the seven are what fix A names. Rows 3 and 7 are outcomes the leg claimed with no
assertion behind them. Rows 2 and 4 are assertions that pass on an absence or on a state they
never waited for. Row 1 is the unit itself. Row 5 is different: the plan required a blind reader,
and the run did not have one.

**Why nothing caught it before review.**
- **The per-assertion rule is where grading happens.** `issue-implement` line 24 carries it (cycle
  17's fix A, `c7c409e`), and so do its Step 6 gate and its reviewer prompts. Every first reviewed
  head in this epic carries it.
- **The unit is set earlier, and there it still says leg.**
  - `spec-template.md`'s *Control that must fail* row asks for *"the leg it must fail"*, and its
    worked example answers *"on the duplicates leg"*.
  - `issue-spec`'s blind goal reviewer asks whether the control degrades the behaviour *"on the
    leg that proves it"*.
  - `goals/README.md` has a goal declare *"the legs each must fail"*, and quotes *"must name legs
    (d)/(e) rather than leg 0"* as the model.
  - `issue-implement` Step 8 has the implementer confirm the control *"FAILS on the leg the spec
    says"*, and PR-body item 4 asks for the control's FAIL and *"the leg it named"*.
- **Most of them are newer than fix A.** #2267 (FIX-1593, `c5ba558`) wrote the template row, its
  example, the reviewer question, Step 8's line and the PR-body item. It merged at 09-25 21:27Z, 25 hours after
  fix A reached `main`. Only the `goals/README.md` lines are older. The first reviewed heads of
  #2288 (`fca6c59`), #2317 (`7adf86b`) and #2348 (`a9723c8`) all carry it.
- **The plan followed the template, and the build followed the plan's table.** #2288's S3 said
  each control *"must redden exactly its leg set"*. #2317's review named each control's own clause
  (leg a's *"nobody else works"*), and the fold put *"at their own signal"* into the lead sentence.
  But the *Must fail* column stayed in legs (`a · b`), which is the shape the template row asks
  for. #2348 built `CONTROLS[x].fail = ["a", "b"]` from that column.

So the grounding itself has a stale restatement. The decision moved in one paragraph, and six
other places still carry the old unit. Five of those six were added after the move.

## The recommended upstream fix — converge the control unit where it is set

This is not a new rule and not a BP. It changes eleven phrases in seven files so that the places
where a control is declared, run and reported name the same unit as the place where it is graded:

| File | Now | Proposed |
|---|---|---|
| `docs/contributing/spec-template.md` · *Control that must fail* | *"and the leg it must fail"* | *"and the signal it must fail, by name — not only its leg, which goes red on any of its assertions"* |
| `docs/contributing/spec-template.md` · the worked example's control row | *"Both must FAIL on the duplicates leg"* | "Both must FAIL on *zero duplicate items*", the example's own signal |
| `.agents/skills/issue-spec/SKILL.md` · the blind goal reviewer | *"on the leg that proves it?"* | *"on the signal that proves it, not merely on its leg?"* |
| `goals/README.md` · *Controls* field | *"and the legs each must fail"* | *"and the assertions each must fail, by name"* |
| `goals/README.md` · *Prefer a named control* | *"with the legs it must fail — "Must FAIL, and must name legs (d)/(e) rather than leg 0" — because a control that fails the wrong leg is itself a check that cannot fail"* | *"with the assertions it must fail, by name (`a:working`, not leg a) — a leg goes red on any of its assertions, so a control that fails the wrong one is itself a check that cannot fail"* |
| `.agents/skills/issue-implement/SKILL.md` · Step 8 | *"confirm it FAILS on the leg the spec says"* | *"confirm it FAILS on the signal the spec names, not just on its leg"* |
| `.agents/skills/issue-implement/SKILL.md` · PR body item 4 | *"the control's FAIL (command and the leg it named)"* | *"the control's FAIL (command and the assertions it named)"* |
| `.agents/skills/issue-spec/SKILL.md` · the blind goal reviewer's walk | *"For each leg:"* | *"For each leg's signal:"* |
| `goals/_template/goal.md` · *Controls* field | *"and the legs it must fail"* | *"and the assertions it must fail, by name"* |
| `.agents/skills/review/SKILL.md` · completeness lens | *"failed on the leg the spec says"* | *"failed on the signal the spec names, not just on its leg"* |
| `.agents/skills/agent-mailbox/SKILL.md` · the `fsd-qa` browser hand-off | *"the control's FAIL"* | *"the control's FAIL with the assertions it named"* |

The last four rows were found in this PR's review, on paths the first pass missed: the template a new goal is copied from, the reviewer that grades completeness, and the browser hand-off. The spec surfaces, and Step 8 and the completeness lens, which read the spec, say *signal*. That is the word the template
already uses for a check's pass condition, and a spec is written before the check's assertions
have names. The goal and PR-body surfaces say *assertion*, because by then they do.

**It clears the Step-3 gate.** *Generalizable*: every goal check with a named control, and every
spec, since the template shapes them all. *Grounded*: #2348's seven findings, #2288's S3 and
#2317's column; the three controls run 1 found could not fail (FIX-1623 to FIX-1625); and cycle
17's 35% *vacuous-assertion*, which fix A answered. *Not already covered*: it is covered, but at
the wrong altitude, and six restatements contradict it. This converges them, the
`stale-restatement` remedy, applied to the grounding. *Altitude*: the three places where a
control's unit is chosen (the spec row, the reviewer's question, the goal's declaration), and the
two where the implementer runs and reports it. `epic-spec-template.md` keeps its leg wording on
purpose: an epic names which leg its closure must break, and the closure's own spec, written from
`spec-template.md`, names the signal. **What would change my mind:** the next plan's control rows
name signals, and its implementation still grades by leg on the first head. Then the gap is at
grading, and the fix is a shared grading helper in `goals/lib`, not wording. **What being wrong costs:**
eleven phrases, easily reverted, and one more name per control row for a spec author to write.

**What it would not have caught:** row 5, the smoke that was not blind. The plan already required
a blind reader, so that was a run that missed its own requirement, not a gap in the grounding.

## Candidates considered and dropped

- **Keyless and reload checks hid real failures** (#2310's origin). `goals/README.md` already
  requires the real path and a real model for a model-backed goal. The epic corrected itself in
  #2310, and the closure ran a keyed smoke. The rule was there, and the epic applied it.
- **A control rots when a sibling adds a read path** (FIX-1625). The closure's part 3 re-runs the
  children's checks and caught it, as designed. One instance.
- **Checks keyed to a spelling or an intermediate shape:** FIX-1603 (V14 kept the old seat-wake
  rule), FIX-1604 and #2300 (`notifyFor`), #2317 T9 (a layer fence that fails once FIX-1609
  merges) and #2318 T11 (a stock-routing row that FIX-1611's escalate would fail). That is four
  instances, and each was caught by a review or a closure run before it shipped. Carried as claim 3.
- **#2319's and #2320's long tails.** Between them they ran 19 waves, and #2320 finished one short
  of the twelve-round cap. The cap was not hit. #2320's late findings were tenancy and identity
  edges, and #2319's tail ended in a redesign (#2324) that the review drove. There is one of each,
  and neither points at a spec-altitude miss.
- **Merged heads no bot read** (see scoring). The rule says the right thing for implementation
  PRs. For direction artifacts it collides with spec convergence, which is a coherence question,
  not a lesson.
- **Sharpening BP-003 for the seven *overclaim*s** (#2269 T1, #2258 T12, #2277 T8, #2296 T7, #2293
  T1, #2306 T9, #2320 T2). Same reason as cycles 14 to 18.

## Filed, not proposed

- **The merge-ready rule and spec convergence disagree about direction artifacts.**
  `orchestration.md` → *Gates* (line 454) says a PR is merge-ready only once review *"returned on
  its current head"*. Spec convergence folds round-2 findings and merges on the owner's approval
  without a re-review. 16 of this epic's 17 direction artifacts merged a fold no bot read, which is
  what convergence intends. One of the two needs to name the other. This is for `audit-coherence`.
- **#2319 merged over three open Codex P2s** (T23–T25), 31 minutes after they landed. #2324
  answered all three within the hour, and its body links them, so nothing is left open. It is
  recorded because merging over an open finding recurs. Cycles 15, 16 and 17 each recorded one
  (#1391, #2091, #2073), and cycle 18 recorded #2184, whose P1 arrived just after the merge.

## Scoring the previous cycles' fixes and claims

Every artifact's first reviewed head carries both fixes, asked by ancestry:

```
c7c409e (cycle 17 fix A) and 0939721 (#2250, the merge-ready enforcement):
  all 36 first reviewed heads CARRY both
c5ba558 (#2267, the leg wording):
  #2288 fca6c59 CARRIES · #2317 7adf86b CARRIES · #2348 a9723c8 CARRIES
```

- **Cycle 17's claim 1 and cycle 18's claim 4 (does the per-assertion unit move grading
  artifacts?): NO, on the first measurable instance.** #2348 is the first carrying grading artifact
  with more than one reviewer, and it had three: Cursor, Codex and the second look. Its first head
  graded by leg, and seven *vacuous-assertion* findings followed. The reading is that fix A landed
  at the wrong altitude. The proposal moves it up, where the ledger header says to.
- **Cycle 18's claim 1 (the merge-ready definition): the draft gap is closed.** 0 of the 34 merged
  artifacts merged before their first automated review. The baseline was 6 of 42. Every merged
  artifact was opened ready; #2350, opened draft, is unmerged. **The fold gap is open.** 9 of the
  17 merged implementation PRs merged a head no automated reviewer read, because a fold or a merge
  of `main` came after the last pass: #2282, #2283, #2293, #2297, #2306, #2316, #2320, #2324 and
  #2340. Cycle 18 named one such head (#2203) but did not test every row, so there is no
  like-for-like baseline. Whether any of the nine carried a defect is not derivable from review
  data. Carry forward, no proposal.
- **Cycle 18's claim 2 (a spec that joins after the cross-spec pass): not derivable.**
  `epic-wake.js:3109` is unchanged (`crossSpecHold = !input.crossSpecCleared && …`). The one
  inter-spec conflict here, #2318 T11, was caught by Codex on the later spec, not by a cross-spec
  pass. Whether a pass ran for FIX-1609, FIX-1610 and FIX-1611 is not in the PR data.
- **Cycle 18's claim 3 (a worker that cannot dispatch): three artifacts.** The bodies of #2316,
  #2319 and #2320 say the docs agents could not be dispatched. #2319 drew a Codex P1 for exactly
  that (T8), and its later commits went through the agents. Carry forward.
- **Cycle 15's fix B (`7c29203`, name the sweeps): carried and not used on #2294.** Six
  stale-restatements, with no sweep named in the body or the commits. Stale-restatement fell
  overall, from 18 to 13 (11 on direction artifacts), so this is one artifact, not a trend.

## Claims to test next cycle

1. **Does converging the control unit move the plan and the first head?** Baseline: #2288 and
   #2317 declared controls by leg, and #2348's first head graded by leg and drew seven
   *vacuous-assertion* findings. Score the next goal check with named controls. Do its spec rows
   name signals, and does its first head grade by named assertion?
2. **Do folds after the last pass cost anything?** Baseline: 9 of 17 merged implementation PRs.
   Score whether any later finding, follow-up issue or red `main` traces to a commit that no bot
   read.
3. **Checks keyed to a spelling or an intermediate shape.** Baseline: four instances, all caught
   before shipping. If the next epic shows two or more, propose.
4. **Cycle 18's claims 2 and 3 carry forward** unchanged.

## Finding map

`T`-numbers are positions in each PR's review-thread list, oldest first. `+` joins threads collapsed
into one finding. *vac* is *vacuous-assertion*. *SL* is an item of a second-look body.

- **#2265** design-off ×1: T1+T4+T6+T8+T9+T11. spec-ambiguity ×2: T3 · T10. over-engineered ×1: T5. nit ×2: T2 · T7.
- **#2269** spec-ambiguity ×3: T2+T3+T8 · T5 · T7. stale-restatement ×2: T4 · T10. docs-miss ×1: T1. philosophy-drift ×1: T9. nit ×1: T6.
- **#2289** over-engineered ×3: T1 · T4 · T6. spec-ambiguity ×2: T3 · T5. stale-restatement ×1: T2. philosophy-drift ×1: T7.
- **#2294** stale-restatement ×6: T1 · T2 · T4 · T6 · T9 · T10. spec-ambiguity ×3: T3 · T5 · T7+T8. docs-miss ×1: T12. nit ×1: T11.
- **#2310** spec-ambiguity ×3: T1 · T4 · T7. over-engineered ×2: T2+T8 · T5. mee ×2: T3 · T9. design-off ×1: the owner's Prod/Eng lock. nit ×1: T6.
- **#2258** mee ×3: T2 · T8+T13 (vac) · T11. docs-miss ×2: T10 · T12. design-off ×1: the owner's round-2 question. nit ×7: T1 · T3–T7 · T9.
- **#2277** spec-ambiguity ×3: T1 · T2 · T3. mee ×3: T6 · T7 · T8. over-engineered ×1: T5. docs-miss ×1: T9. nit ×1: T4.
- **#2278** mee ×2: T1+T5 · T8. spec-ambiguity ×2: T4 · T6. over-engineered ×1: T2. philosophy-drift ×1: T7. nit ×1: T3.
- **#2280** over-engineered ×2: T4 · T5. mee ×2: T8 · T10 (vac). spec-ambiguity ×1: T6. docs-miss ×1: T9. nit ×4: T1–T3 · T7.
- **#2288** over-engineered ×5: T3 · T4 · T5 · T6+T9 · T7. spec-ambiguity ×2: T1+T2 · T10. mee ×2: T12 · T13. nit ×2: T8 · T11.
- **#2296** mee ×2: T5 · T6. docs-miss ×1: T7. nit ×4: T1–T4.
- **#2300** stale-restatement ×1: T1+T4. spec-ambiguity ×1: T2. docs-miss ×1: T3.
- **#2313** design-off ×1: T2+T8. mee ×3: T6 · T7 · T9. spec-ambiguity ×2: T4 · T5. docs-miss ×2: T10 · T11. nit ×2: T1 · T3.
- **#2314** mee ×4: T8 · T9 · T10 · T12. spec-ambiguity ×1: T3. docs-miss ×1: T11. stale-restatement ×1: the Architect's conversation comment. nit ×6: T1 · T2 · T4–T7.
- **#2317** spec-ambiguity ×4: T1 · T4 · T6 · T10. docs-miss ×1: T2. mee ×1: T9. nit ×4: T3 · T5 · T7 · T8.
- **#2318** mee ×5: T3+T10 · T6 · T11 · T12 · T13. spec-ambiguity ×4: T1+T2 · T5 · T9 · T16. over-engineered ×3: T7 · T14 · T15. docs-miss ×1: T8. nit ×1: T4.
- **#2333** mee ×2: T7 · T8. nit ×6: T1–T6.
- **#2282** mee ×3: T3+T8+T11 · T4+T9+T10 · T7. over-engineered ×3: T1 · T2 · T5. nit ×1: T6.
- **#2283** mee ×2: T7 · T9. philosophy-drift ×1: T1. docs-miss ×1: T8. nit ×5: T2–T6.
- **#2290** mee ×1: T7. nit ×6: T1–T6.
- **#2293** docs-miss ×1: T1. over-engineered ×1: T4. nit ×2: T2 · T3.
- **#2297** mee ×1: T5. docs-miss ×1: T6. nit ×4: T1–T4.
- **#2301** nit ×2: T1 · T2.
- **#2305** nit ×2: T1 · T2.
- **#2306** mee ×2: T4 (vac) · T10 (vac). docs-miss ×2: T8 · T9. over-engineered ×1: T1+T3. nit ×3: T2+T7 · T5 · T6.
- **#2316** docs-miss ×1: T4. nit ×3: T1–T3.
- **#2319** mee ×11: T9 · T10 · T12 · T15 · T18 · T19 · T20 · T21 · T22 · T23 · T24. over-engineered ×7: T1 · T2 · T3 · T4 · T5+T11 · T6 · T13. philosophy-drift ×2: T8 · T14. docs-miss ×1: T16. nit ×3: T7 · T17 · T25.
- **#2324** mee ×1: T1. over-engineered ×1: T4. docs-miss ×1: T6. nit ×3: T2 · T3 · T5.
- **#2320** mee ×27: T1 · T9–T12 · T14 · T16 · T19–T27 · T29–T32 · T34–T40. docs-miss ×4: T2 · T13 · T18 · T33. stale-restatement ×2: T17 · T28. over-engineered ×2: T3 · T15. nit ×5: T4–T8.
- **#2322** mee ×3: T6 · T7 · T8. nit ×5: T1–T5.
- **#2339** nit ×2: T1 · T2.
- **#2340** docs-miss ×1: T4. over-engineered ×1: T5. nit ×3: T1–T3.
- **#2343** nit ×3: T1–T3.
- **#2344** mee ×5: T6 · T7 · T9 · T10 · T11 (vac). docs-miss ×1: T8. nit ×5: T1–T5.
- **#2348** mee ×7: T7 (vac) · T8+SL1 (vac) · SL2 (vac) · T9 (vac) · T10+SL4 (vac) · T11 (vac) · T12 (vac). nit ×6: T1–T6. The second look's other items (an affirmation of `drop-user-message`, a helper consolidation offered as a follow-up, optional notes) are `nit` and not itemized.
- **#2350** nit ×5: T1–T5.

**Implementation non-`nit`:** 6 + 4 + 1 + 2 + 2 + 0 + 0 + 5 + 1 + 21 + 3 + 35 + 3 + 0 + 2 + 0 + 6 + 7
+ 0 = **98** (in table order), of which *vacuous-assertion* 10. **Direction non-`nit`:** 4 + 7 + 7 +
10 + 8 + 6 + 8 + 6 + 6 + 9 + 3 + 3 + 8 + 7 + 6 + 13 + 2 = **113** (in table order), of which
stale-restatement 11 and *vacuous-assertion* 2.
