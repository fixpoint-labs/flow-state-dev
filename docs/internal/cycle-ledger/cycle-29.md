# Cycle 29 — "Same pieces, different apps" epic wrap (FIX-2152) (2026-10-30)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

Numbered 29 because the open lessons draft #4245 (FIX-2071) already claims 28.

**A large epic: one epic spec, three amendments, sixteen issue specs and about fifty implementation
PRs over eight days. The rework had three shapes. A check over a file that every PR edits made each
merge break the next PR. A race was patched one Codex pass at a time again (cycle 27's class (a)),
and the fix cycle 27 proposed would not have reached it: this epic's work ran under the project
coordinator, not `epic-wake`. The specs drafted on 10-23 all moved with the epic's D2 for three
hours.**

The classes, checked against the PRs:
- **(a) A check that compares a committed copy of a generated table.** Epic ER-1 asked each lab's
  README to carry the inventory script's output, and `test/inventory.test.ts` failed when the table
  went stale. Every PR that touched a lab changed the count, so every merge made the next branch red.
  The tally: 29 distinct commits (42 counting copies carried by stacked PRs) in 21 of the epic's
  squash-merged PRs, two PRs that only refreshed the table (#4175, #4210), an edit straight on `main`
  (c7ee8292), and a restore-then-revert pair in each of #4229, #4230 and #4231. #4198's merge dropped
  the table and turned `main` red. #4235 deleted the scripts, tests and tables (281 lines), and the
  churn stopped. **Already fixed at rung 1 by deletion. Nothing new proposed (one epic, one instance).**
- **(b) An interleaving tail, one pass at a time** (cycle 27 (a); cycles 22, 23 and 25 before it).
  - #4124 carried #4085 (FIX-1613, the history summary) while #4085 was open. Seven of #4124's twelve
    Codex threads were the fold's mark against the turn list, each a new case: a tied timestamp, a
    retry, a failed turn, a continued turn, a fold that moves past its own request, a turn that
    settled after the window loaded. Ten passes in 2h10m (10-28 21:29Z to 23:39Z). The fixes landed
    on #4085, and no primitive was named or filed (a Linear search for follow-ups found none).
  - #4239 (FIX-2350, the same-work check) took five Codex passes in 28 minutes. Each opened a new
    hole in one check: a non-atomic read then write, a replayed filing, the default assignee, the
    workstream target, and the queue's scope. The first fix named a primitive (one filing at a time
    per board). Later passes widened its key and its match.
  - #4149 (FIX-2288, spend across a crash) continued cycle 27's #4013 tail for six fix commits. Its
    per-block form was filed as FIX-2323. #4163 (FIX-2310) closed "two crash windows", then made one
    send and one owed-entry reader.

  10.3's carve-out (*"a separate race on the same structure … is not [the trigger]; fix it here"*)
  fits every one of these findings, because each is a different case. So the judgment trigger never
  fires on a chain of different cases. **Proposed below: make the trigger a count from the fourth
  pass, in `issue-implement` 10.3.**
- **(c) `main` went red and every open branch carried the port** (cycle 24 (c), cycle 27 (c)). The
  rename of `human_input` to `user_input` (#4093) was ported into #4086, #4124, #4145 and #4150. #4204's
  bounded drain was ported into #4198, #4199, #4206 and #4211. The inventory table (a) added
  "stale on main" commits to #4174, #4206 and #4211. That makes eight PRs carrying a port of
  someone else's fix. **Owner ask, the third time: require branches to be current, or a merge queue.**
- **(d) Parallel specs drafted against a moving epic decision** (`stale-restatement`). The epic spec,
  three amendments and eight child specs were opened and merged between 10-23 21:12Z and 10-24 02:48Z.
  D2 (how a running turn hears a finished task) was decided four times in that window: the steer path
  (#3783 r1), a conversation turn that no task backs (#3783 r3), a lab loop-back with FIX-2159 as
  fallback (#3797), then FIX-2159 required, with the package's answer-again step running the loop (#3803).
  FIX-2153's spec followed each move (*"follow corrected epic D3"*, *"align the result-in-turn path
  to FIX-2159's answerAgain source"*, *"FIX-2159 is required again"*), and FIX-2157's spec carried
  seven alignment commits of its own. Recurs from cycle 2. One evening's cost, then quiet: the specs
  opened from 10-28 on show no alignment commits. **Recorded. No change (see Rejected).**
- **(e) Specs that state what `main` does without reading it.** Codex's spec findings were mostly
  *"checked on main"* refutations: `ownProjectIn` overrides a named project (#3788), `routedTaskId`
  keys one task per delegate (#3792), `local-host.ts` returns a worktree, not the mapped checkout
  (#3792), `fromProject` refuses a non-member (#3788), `noteSeen` is written before `clearNotice`
  (#3799). Each was folded the same pass. `design-off` in class, and cheap at spec time. It is the
  review working. **Recorded.**

**Proposal:** one sharpening for (b), a count-based trigger in `issue-implement` 10.3, carried as its
own commit in this draft so the owner can take or drop it. (c) is an owner ask. (a) is already fixed.

**Method: scope.** FIX-2152's Linear children (GraphQL, read-only) and their PR attachments, plus
GitHub searches for `FIX-2152` and *Teammates*. The squash-merge bodies on `main` list each branch's
commits. They are the primary source for every row, since PRs this size would cost too much to read
in full. Review threads were read in full for #3783, #3788, #3792, #3799, #3803, #4094 (reviews only),
#4124 and #4239. Rows for every other PR come from commit lists and comment counts, and say so.
Times are UTC unless a commit time is quoted.

**Out of the sample:** #4085 (FIX-1613; its findings are counted under (b) because #4124 carried
them), #4013 (cycle 27), POC drafts (#3800, #4082, #4154, #4208, #4213), and Backlog children with no
PR (FIX-2156 closure, FIX-2167, FIX-2323, FIX-2340). #3789 (FIX-2160) and #4151/#4164 (FIX-2173)
are linked from children but belong to other epics.

**Every act sits behind the shared `jhoffner` login**, so this entry doesn't say who merged what.

### Direction artifacts

| PR | Rounds | Endpoint | Threads read | Shape of the review | Felt off? |
|---|---|---|---|---|---|
| [#3783](https://github.com/fixpoint-labs/flow-state-dev/pull/3783) epic | 2 + a clean confirm | merge 10-23 21:45Z | yes | Second look: D2's steer reuse oversized, ER-1's check fails on the ER-5 adapter, "shared UI goes to the registry". Codex r1–r2 on D2 heard-once. r3 clean on a070af5 | D2, yes |
| [#3797](https://github.com/fixpoint-labs/flow-state-dev/pull/3797) amend D2 | ~2 (commits) | merge 22:29Z | no | D2 moved to a lab loop-back plus a public take; the steer mechanism dropped | yes (d) |
| [#3803](https://github.com/fixpoint-labs/flow-state-dev/pull/3803) amend ER-8/ER-9 | ~2 | merge 23:47Z | yes | Cursor ×5, `over-engineered` or `nit`, recorded. D2 moved again: the package's answer-again step runs the loop | yes (d) |
| [#3804](https://github.com/fixpoint-labs/flow-state-dev/pull/3804) amend 2154 | ~2 | merge 23:40Z | no | *"align the amendment with ER-9 and FIX-2161"* | no |
| [#3787](https://github.com/fixpoint-labs/flow-state-dev/pull/3787) spec 2154 | ~2 | merge 21:45Z | no | G1 sent to FIX-1613; the divider label | no |
| [#3788](https://github.com/fixpoint-labs/flow-state-dev/pull/3788) spec 2153 (+ #3792 merged into it) | **4** Codex passes with findings | merge 10-24 02:48Z | yes | P1 ×4: signal 4 bound to the first request, a post-settle model step, wiring gated on a fallback, a long task's timing. P2: membership, not readability (e). Last pass (23:50Z) was on 2157's files after #3792 merged in | yes |
| [#3792](https://github.com/fixpoint-labs/flow-state-dev/pull/3792) spec 2157 | 3 | merged into #3788's branch 23:47Z | yes | P1: reuse FIX-2131's review tool (folded, a gap dropped). P1/P2 ×3: the routed path keys one task per delegate, the worktree is not the mapped path (e) | yes |
| [#3796](https://github.com/fixpoint-labs/flow-state-dev/pull/3796) spec 2158 | ~2 | merge 23:35Z | no | 7 fold commits; *"take #3789's base-terms paragraph verbatim"* | no |
| [#3799](https://github.com/fixpoint-labs/flow-state-dev/pull/3799) spec 2159 | 2 + owner | merge 23:45Z | yes | A POC in the spec (`spec-poc`). Codex r1: the POC asserted two hearings where the claim said never twice. r2: `noteSeen` before `clearNotice`, so the boundary is the dedupe write. Owner: `answerAgain: true` takes a pre-built block | no |
| [#3805](https://github.com/fixpoint-labs/flow-state-dev/pull/3805) spec 2161 | ~2 | merge 23:47Z | no | Re-drafted as one server-written field (`setWorkProject`) | no |
| [#3819](https://github.com/fixpoint-labs/flow-state-dev/pull/3819) spec 2163 | ~1 | merge 10-24 00:34Z | no | single commit, 16 comments | no |
| #4080, #4081, #4119, #4156 | 1 | 10-28 | no | single-commit merges | no |
| #4118, #4120, #4123, #4198 | ~1–2 | 10-28 to 10-29 | no | 2–6 commits; #4198 folded the Architect's placement and a simplify pass | no |

### Implementation

| PR | Waves (source) | Shape of the rework | Felt off? |
|---|---|---|---|
| [#4124](https://github.com/fixpoint-labs/flow-state-dev/pull/4124) 2154 + FIX-1613 | **10** Codex passes (reviews) | (b): 7 of 12 threads were #4085's fold; 3 were code already on `main`, shown because the base lagged (filed as FIX-2302, FIX-2304 and FIX-2307). 2 on the divider. 58 branch commits, 6 inventory | yes |
| [#4239](https://github.com/fixpoint-labs/flow-state-dev/pull/4239) 2349/2350 | 5 Codex + Cursor (threads) | (b) on the same-work check. Cursor's 6 notes: 1 taken, 5 declined | yes |
| [#4149](https://github.com/fixpoint-labs/flow-state-dev/pull/4149) 2288 | ~6 (commits) | (b) continued from #4013: a crashed run's tokens, each admission's spend, a dead run's calls. FIX-2323 filed | yes |
| [#4073](https://github.com/fixpoint-labs/flow-state-dev/pull/4073) 2153 wiring | ~4 (commits) | Cancel cascade shown as a result; the harness read at resolve time; worker prompt lines from the goal run. Carried FIX-2287 and FIX-2289 | no |
| [#4094](https://github.com/fixpoint-labs/flow-state-dev/pull/4094) 2157 wiring | 2 (reviews) | Cursor: the adapter's inbox projection mirrors Shift Manager's `inboxItems` (job audit). Carried a FIX-2283 orchestration fix. Code Snob: no POC | no |
| [#4079](https://github.com/fixpoint-labs/flow-state-dev/pull/4079), [#4086](https://github.com/fixpoint-labs/flow-state-dev/pull/4086) 2154 / 2280 wiring | ~3 each | Snapshot reread while paging; only Codex's env for the lab's runs. #4086: 4 inventory recounts and a port (c) | no |
| [#4145](https://github.com/fixpoint-labs/flow-state-dev/pull/4145) 2285 | ~5 (commits) | Four passes on one grep: stream it, bound its time, keep only returned matches, ignore `grep.column` | no |
| [#4163](https://github.com/fixpoint-labs/flow-state-dev/pull/4163) 2310 | ~4 (commits) | Two crash windows, then one owed-reply send and one owed-entry reader | no |
| [#4228](https://github.com/fixpoint-labs/flow-state-dev/pull/4228) 2286 | ~4 (commits) | A read on a fresh session, request-end hooks, side-chain drain; inventory in and out | no |
| [#4211](https://github.com/fixpoint-labs/flow-state-dev/pull/4211) 2338 | ~3 (commits) | Stacked on 2332/2335/2336/2337. Reuse `looseDeepEqual`; a failed turn's half answer; 3 inventory, 1 port | no |
| #3793 + #3818, #3798, #3811, #3827, #3814, #3821, #3823, #3829, #4070 | 1–3 | Fixture front ends and the first gaps on 10-23/24. #3793: IME Enter, a draft carried to another session, cancelling a finished task. #3827 (2154) found the same IME bug again (ER-3 copies UI) | no |
| 23 more (#4084, #4091, #4127, #4133, #4139, #4150, #4158, #4159, #4174, #4176, #4183, #4199, #4200, #4206, #4207, #4209, #4212, #4216, #4222, #4223, #4226, #4227, #4229–#4233, #4240) | 0–3 | Mostly owner-found issues fixed in one pass. Their extra commits are inventory (a) and ports (c) | no |

**Where the bugs came from.** After wiring merged on 10-28 with its goal checks green, the owner's
own use of the two labs filed about twenty more children (FIX-2287 to FIX-2351). Seven were package bugs no
goal check or review had found: a reply that never reached the asker (FIX-2347), a result delivered
as a cut-off user turn (FIX-2345), a cancelled task shown failed with its harness still running
(FIX-2349), a task started twice (FIX-2350), a coding task filed with no project (FIX-2333), a silent
first minute (FIX-2351), and an asked reply never sent (FIX-2310). This is epic D1 working: building
an app is how the gaps surface. It is not review rework, and it is not scored as a class.

**Load.** Direction: about 35 rounds over 19 artifacts; #3788 took four, and #3792 three. Implementation:
#4124 (10) and #4239 (5) read; four more at about 4–6 from commits.

**Classes.** Direction (threads read on 5 artifacts, ~40 threads): `missed-edge-case` and `design-off`
lead (the (e) refutations), then `over-engineered` (Cursor's notes, recorded), then `stale-restatement`
in the commit record (d). Implementation (2 PRs read, ~23 threads): `missed-edge-case` leads, and (b)
is 12 of them. `nit` covers Cursor's declined notes. Reading labels: `vacuous-assertion` on 3 (#3799's
POC asserted the opposite of its claim; #3792's routed control could not reach the state it claimed
to test; #3788's signal 4 passed on a second request). `overclaim` on 1 (#3799's *Settled* read as
CI-run while resting on a manual control).

**Claims (looped / settled / verdicts):** 1 / 1 / narrowed. D2's "heard once" was argued on #3783
r1–r2 and settled by #3799's POC: CONFIRMED as *at most once*, REFUTED as *never lost before the
acknowledgement* (the boundary moved to the dedupe write).

**Reviewer exhaustion:** none found. **Merged with a finding open:** none found in the threads read.

**Epic row** (from the specs' *What's already here* and the PR titles; the job audit was not run, see
below):
`ways per job: list a person's sessions of one worker 0→1 · set the project a session works in 0→1 ·
hear a finished task mid-turn 1→2 (the steer take stays task-only, D2) · read a flow's state without
recording a request 1→2 (FIX-2286's reads) · a harness run reports progress 0→1 (onActivity) ·
refuse a duplicate task 0→1 · name feature work on a board 2→1 (FIX-2282) · hand a finished task's
result to its filer 2→1 (FIX-2345, getTask read) · read a board's inbox rows for a screen 1→2
(candidate) · open a session in an overlay 1→2 (FIX-2340 filed) · a lab's composer and draft 1→2
(ER-3 copies UI by design)`

## (b) A count, not a judgment

| PR | Structure | Passes on it | Fourth pass | Primitive named? |
|---|---|---|---|---|
| #4085 via #4124 | the fold's mark against the turn list | 7 | 21:45Z (by-id reads), 6 passes to go | no |
| #4239 | the same-work check | 5 | 13:05Z (the target), 1 to go | in part: one filing at a time per board, at pass 1 |
| #4149 | a request's spend across a crash | ~6 | from commits | yes: FIX-2323 |
| cycle 27 #4013 | the same | 12 | 10-28 17:13Z, 8 to go | in part, late |
| cycle 27 #3795 | the usage record | 4 | the last pass | no |
| #4145 | one grep | ~4 | from commits | none needed: a one-line answer |

Cycle 27 proposed the count for `epic-wake`'s PR-feedback dispatch. 145 PRs opened 10-23 to 10-30
carry the project coordinator's attribution, among them #4124, #4239, #4149, #4163 and cycle 27's
#4013. So the count belongs where every implementer reads it, `issue-implement` 10.3. It is still
prose (rung 5), because the dispatcher that could count is outside the repository. Putting the same
count in the project coordinator's PR-feedback brief is the owner's half.

## Enforcement, rung by rung

- **(a)** Rung 1, done: #4235 deleted the generated table and its test. A rule against README stats
  tables would be prose for a class seen once. Rejected.
- **(b)** Rung 1 is out of reach in-repo (above). Rung 3 fails as before: a "same file in N passes"
  scan misses #4239's later passes and fires on #4145. Rung 5: one sentence in 10.3, below. Owner
  ask: the same count in the coordinator's brief.
- **(c)** A repository setting. Owner ask, third cycle.
- **(d)** Rejected as text. `epic-wake`'s review budget and #3806's mechanism-creep guard landed
  after 10-23. The specs opened from 10-28 on show no alignment commits. Next cycle measures it.
- **(e)** Rejected. Review caught each one in its round.

## Accepted and Rejected

**Accepted:**
- (b): a count-based trigger in `issue-implement` 10.3 (this draft, its own commit).
- Owner asks: (c) branch currency or a merge queue; (b) the same count in the project coordinator's
  PR-feedback brief.

**Rejected:**
- *A rule against committed generated tables* (a). Fixed by deletion; one instance.
- *A spec rule against parallel drafting* (d). One evening, already quiet once the guards landed.
- *Scoring owner-found bugs as rework.* They are the epic's method (D1).
- *Building cycle 27's `epic-wake` step.* It would not have reached this epic's PRs.

## Job audit

Not run in this worker. It reads Linear and GitHub only and files nothing. Candidates for the
coordinator to audit and file through `issue-manager`:
- **read a board's inbox rows for a screen, 1→2.** `labs/claude-code-style/src/adapter.ts`'s
  projection beside `packages/shift-manager/src/lib/reads.ts`'s `inboxItems` and `inboxSection`
  (Cursor on #4094).
- **hear a finished task mid-turn, 1→2.** FIX-2159's take and answer-again step beside the steer
  take. Epic D2 (#3797) kept them apart on purpose, so this is likely cleared by that spec.
- **read a flow's state without recording a request, 1→2.** FIX-2286's spec approved reads beside
  actions. Cleared by that spec, if its question-7 answer says so.

## Scoring the previous cycle's claims

- **Claim 1 (interleaving tails named by round 4):** 1 of 3 chains named or filed by the fourth pass
  (#4239, at pass 1). #4149 filed FIX-2323 late; #4085's chain named none. Baseline 0 of 2.
- **Claim 2 (event read off a state, carried):** not scored in full. One seen: #4239's replayed
  filing read its own row as a duplicate (ff3758b).
- **Claim 3 (stale-head merges that turn `main` red):** up. At least three red windows (the
  `user_input` rename, #4204's drain, #4198's dropped table), ported into eight PRs.
- **Claim 4 (direction artifacts merged before their requested Codex pass):** none found in the
  five read.

## Claims to test next cycle

1. **The fourth-pass answer.** For each PR with four or more review passes on one structure: was the
   10.3 answer posted at pass 4? Baseline: 1 of 3 here.
2. **Ports of `main` fixes per epic.** Baseline: 8 PRs here.
3. **Alignment commits on parallel specs.** Baseline: about 20 on 10-23, 0 after 10-28.
