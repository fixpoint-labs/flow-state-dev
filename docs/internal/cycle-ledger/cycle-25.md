# Cycle 25 — "One task primitive" epic wrap (FIX-2056) (2026-10-24)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**Every direction artifact converged in one or two rounds. The rework was in implementation fix
rounds: nine PRs took four or more review passes, and in eleven PRs a fix round's own change was what
the next pass found wrong.**

The classes the coordinator named, checked against the PRs:
- **(a) A fix round's own change opens the next finding.** At least 17 instances across 11 PRs
  (table below). The change was often wider than the finding needed: a move made for timing, a refactor
  an optional nit invited, the wider of two options a reviewer offered, or a narrowing of an owner's
  rule in answer to a note that said *"I'm not asking for a change"*. The reviewer's next pass caught each
  one, several in minutes. #3624's arrived six minutes after merge and became FIX-2096. This is the
  costliest class this cycle. **Proposed below.**
- **(b) The closure's checks were graded by loose output or shape**, for the sixth closure running
  (cycles 19, 21–25). #3692 drew 12 Codex findings over three passes: a control read by substring, a
  `.call`/`.apply` inside a forwarder, `tags.some` accepting a partial signal, a control that stayed
  green passing, and a live lookup that failed open to a static list. The stand-in reviewer found two
  more, including *"reopens a hole the previous commit had closed"*. FIX-1183 landed on 10-20 as a CI
  step for empty-list guards. It doesn't reach control grading, and no shared verdict reader exists in
  `goals/lib`. **An owner ask, not text.**
- **(c) Retired vocabulary caught after the push.** Verified: 10 commits on the epic's branches between 10-20 and 10-24
  only rename a retired word (`askAtStop`, a retired ask word, "user" for a retired term, and so on).
  CI runs `scripts/check-retired-terms.mjs` and the one-word-per-thing sweep. `.husky/pre-push` runs
  only `pnpm lint`. The two scripts take about 1.4 s each on this tree. **Proposed below** as a second,
  separate commit.
- **(d) A reading that maps "can't tell" onto a positive answer.** #3835: `requestStates` read another
  session's request, or an unreadable one, as parked, so a running parent's wait slot was released.
  #3834: a registry lookup that threw read as stopped, and a missing heartbeat compared as `NaN`.
  #3653: an interrupted request read as over while the sweeper would still drive it. All four were the
  PR's own new code, caught on the first pass. Three readers of request liveness each pick their own
  default for the unknown. **Filed as a fold (FIX-2179)**, not text.
- **(e) Flaky tests.** Three: FIX-2155 (#3801, a wall-clock bound replaced by park time), FIX-2166
  (#3834: the assertion raced the sweep against the heartbeat arm, 4 of 26 runs; fixed by waiting
  for the status *and* adding a case that pins the heartbeat arm, which had been covered only by that
  race), and #3663 (the harness installed its stub after the router copied the request host; root cause
  found, the assertion kept). Each was fixed at its cause, none by loosening. **Dropped** as a
  grounding candidate.

**Proposal:** one sentence in `issue-implement` 10.4, which already asks for a red state for a test
added in a fix round, extending it to the fix itself. Plus two lines in `.husky/pre-push`.

**Method: scope.** 69 reviewed artifacts. The epic's Linear children (48, plus closure FIX-2087) and
their PR attachments were read over GraphQL, and matched against `main`'s first-parent log from 10-20 to
10-24.
- **Direction artifacts (17):** the epic PR #3588 and its amendment #3590; the concept amendment #3607;
  the issue specs #3592 (FIX-2077), #3593 (2076), #3594 (2078), #3595 (2080), #3596 (2081), #3597 (2082),
  #3598 (2083), #3599 (2084), #3601 (2085), #3602 (2088), #3603 (2086), #3604 (2087); the post-merge
  amendments #3608 and #3619 (FIX-2077).
- **Feature implementation (17):** #3620, #3622, #3623, #3624, #3631, #3638, #3639, #3640, #3645, #3648,
  #3650, #3653, #3654, #3660, #3663, #3670, and the closure #3692.
- **Bugs and goal fixes the epic filed (35):** #3658, #3659, #3661, #3666, #3671, #3672, #3674, #3675,
  #3693, #3694, #3696–#3699, #3701–#3704, #3706–#3708, #3712, #3714, #3717, #3722, #3733, #3737, #3744,
  #3746, #3764, #3767, #3777, #3801, #3834, #3835.

**Out of the sample:** #3606 (closed, superseded by #3608); the Code Snob POCs #3673, #3725, #3739 and
#3790, folded by hand and closed unmerged; FIX-2058's and FIX-2152's PRs, which belong to their own
epics' ledgers.

**Endpoints and rounds.** Direction artifacts end at the owner's merge, as in cycles 21–24. **The
implementation count changes this cycle, fenced here.** Bugbot reported itself out of usage, and Codex
reviewed 11 of the 52 implementation PRs. The review of record was the stand-in second look (an
in-repo Claude review posting under the shared login, findings marked 🔴/🟡/🟣) plus Cursor's
automations. So a **wave** here is a distinct review pass, by any reviewer, that drew at least one
thread, clustered by timestamp. That is not comparable to cycles 22–24's count of Codex-reviewed heads.
Thread totals and acted/declined come from each thread's last reply, classed by its first word as cycle
23 did. Classes are one per thread, read from the first comment. Where a thread bundles points, the
lead point decides. Implementation class counts are approximate (about ±10%).

**Every act sits behind the shared `jhoffner` login**, so this entry doesn't say who merged what.

### Direction artifacts

| PR | Rounds | Endpoint | Threads | Classes (threads) | Shape of the review | Felt off? |
|---|---|---|---|---|---|---|
| [#3588](https://github.com/fixpoint-labs/flow-state-dev/pull/3588) epic FIX-2056 | 1 | merge 10-21 01:38Z | 7 | over-engineered 5 · spec-ambiguity 1 · design-off 1 | Cursor only. Adopted: FIX-2079 merged into 2078, one collection-layer read map, six rules. The claim-gate POC ran before the seams froze | no |
| [#3590](https://github.com/fixpoint-labs/flow-state-dev/pull/3590) amend: remove old APIs | 1 | merge 01:53Z | 5 | spec-ambiguity 2 · over-engineered 2 · docs-miss 1 | Codex P1 = Greptile P2: blanket removal would decide the open question (f). Resolved by the owner's answer | no |
| [#3592](https://github.com/fixpoint-labs/flow-state-dev/pull/3592) spec 2077 | 1 | merge 11:37Z | 10 | over-engineered 4 · nit 3 · spec-ambiguity 2 · design-off 1 | Codex P1: settle must follow the post-`onFinished` drain. Checked in `runAction.ts`, moved to an engine seam | no |
| [#3593](https://github.com/fixpoint-labs/flow-state-dev/pull/3593) spec 2076 | 1 | merge 17:59Z | 12 | missed-edge-case 5 · over-engineered 3 · spec-ambiguity 2 · nit 2 | Codex P2 ×2: **the goal check passes on ordering, not on data**, and its control misses one refusal | no |
| [#3594](https://github.com/fixpoint-labs/flow-state-dev/pull/3594) spec 2078 | 1 | merge 13:55Z | 14 | missed-edge-case 7 · spec-ambiguity 4 · over-engineered 2 · nit 1 | Codex and Greptile agree on two P1s (wake fence, upgrade report markers). Codex P2: **no goal leg covers lease expiry** | no |
| [#3595](https://github.com/fixpoint-labs/flow-state-dev/pull/3595) spec 2080 | 1 | merge 13:55Z | 12 | over-engineered 5 · missed-edge-case 4 · nit 2 · spec-ambiguity 1 | Codex P1 ×4: a retry reopens edits, dependency cycles, a non-durable cascade, a timed promise the spec can't keep (`overclaim`) | no |
| [#3596](https://github.com/fixpoint-labs/flow-state-dev/pull/3596) spec 2081 | 1 | merge 13:45Z | 8 | over-engineered 6 · missed-edge-case 1 · nit 1 | Cursor's seven weight notes were all recorded for the implementer. Codex P2: the migration row loses record-then-dispatch | no |
| [#3597](https://github.com/fixpoint-labs/flow-state-dev/pull/3597) spec 2082 | 1 (+ owner on D2) | merge 14:07Z | 11 | missed-edge-case 6 · over-engineered 4 · spec-ambiguity 1 | late-wait depth (Codex and Greptile), filing-session provenance (BP-031), concurrent waits. Codex P2: **no goal leg for the deadline-versus-ending race** | no |
| [#3598](https://github.com/fixpoint-labs/flow-state-dev/pull/3598) spec 2083 | 1 | merge 14:15Z | 9 | over-engineered 4 · nit 3 · missed-edge-case 1 · spec-ambiguity 1 | Codex P1: attempts 1 must be server-stamped; the first fold took two pushes | no |
| [#3599](https://github.com/fixpoint-labs/flow-state-dev/pull/3599) spec 2084 | 1 | merge 14:13Z | 7 | over-engineered 3 · spec-ambiguity 2 · missed-edge-case 1 · nit 1 | Codex P1: **a paired omission passes the hire, and the goal lacks that case** | no |
| [#3601](https://github.com/fixpoint-labs/flow-state-dev/pull/3601) spec 2085 | 1 | merge 14:36Z | 11 | over-engineered 4 · missed-edge-case 3 · spec-ambiguity 2 · nit 2 | the filesystem store isn't cross-process CAS (Codex and Greptile); rollback of a refused claim | no |
| [#3602](https://github.com/fixpoint-labs/flow-state-dev/pull/3602) spec 2088 | **2** (Codex re-pass 7 h later) | merge 14:18Z | 9 | over-engineered 5 · missed-edge-case 2 · spec-ambiguity 1 · nit 1 | Codex P1: **the goal legs don't exercise every admitted request**. D3 went to the owner | no |
| [#3603](https://github.com/fixpoint-labs/flow-state-dev/pull/3603) spec 2086 | **2** | merge 14:23Z | 13 | over-engineered 5 · missed-edge-case 4 · spec-ambiguity 3 · nit 1 | Greptile P1: harness processes overlap (confirmed in code). Codex: untaken turns lost at upgrade, unbounded list output (BP-042) | no |
| [#3604](https://github.com/fixpoint-labs/flow-state-dev/pull/3604) spec 2087 closure | **2** | merge 14:01Z | 10 | over-engineered 4 · missed-edge-case 3 · spec-ambiguity 3 | Codex P2: the sweep's removed-name rule misses migration rows, and an allowlisted helper hides a second ending path. These are (b)'s shape, at spec time | no |
| [#3607](https://github.com/fixpoint-labs/flow-state-dev/pull/3607) concept amend | 1 | merge 18:09Z | 12 | stale-restatement 7 · missed-edge-case 3 · spec-ambiguity 1 · over-engineered 1 | a story id reused (three reviewers), "four tools" restated; Codex P1: a queued receive could change the output | no |
| [#3608](https://github.com/fixpoint-labs/flow-state-dev/pull/3608) amend 2077 | 1 | merge 13:13Z | 4 | spec-ambiguity 2 · stale-restatement 1 · over-engineered 1 | leg c's check restated the old rule | no |
| [#3619](https://github.com/fixpoint-labs/flow-state-dev/pull/3619) amend 2077 | 1 | merge 18:37Z | 5 | spec-ambiguity 3 · over-engineered 2 | one phrase for "filed work still holding the parent" | no |

### Feature implementation

| PR | Waves | Threads | Shape of the rework | Felt off? |
|---|---|---|---|---|
| [#3620](https://github.com/fixpoint-labs/flow-state-dev/pull/3620) FIX-2076 | 2 | 10 | cross-ledger deps never resolve; a step files steps without a cap; the docs example's steps never run | no |
| [#3622](https://github.com/fixpoint-labs/flow-state-dev/pull/3622) FIX-2085 | 4 | 20 | six-field crons fire every second; a fixed `nominalFireTime` stops silently; **r4 found the fix 838a9600b left `saveSchedule` accepting a zone dispatch refuses** ((a), FIX-2180) | no |
| [#3623](https://github.com/fixpoint-labs/flow-state-dev/pull/3623) FIX-2090 | 2 | 8 | the cancel arm lacks containment; the marker leaks through nested boards | no |
| [#3624](https://github.com/fixpoint-labs/flow-state-dev/pull/3624) FIX-2080 | 4 | 23 | 15 missed edges. **(a): b194f86 moved the cascade payment for timing, and the post-merge pass (6 min after merge) found `onIdle: "complete"` spinning 15.6 s** → FIX-2096, #3639 | no |
| [#3631](https://github.com/fixpoint-labs/flow-state-dev/pull/3631) FIX-2081 | 4 | 22 | the field table isn't the guard. **(a): 4b38f9240 narrowed D3 as an "engineering call"; must-fix, the owner's rule reversed (BP-002), reverted** (`philosophy-drift`) | no |
| [#3638](https://github.com/fixpoint-labs/flow-state-dev/pull/3638) FIX-2078 | 4 | 20 | 13 missed edges (forged notice markers (BP-031), no resend backoff, reopen owes no wake…). **(a): a fix-round optimization skipped the lease-end owe; must-fix, reverted** | no |
| [#3639](https://github.com/fixpoint-labs/flow-state-dev/pull/3639) FIX-2096 | 3 | 13 | #3624's post-merge findings: partial batches, the gate and the payer disagreeing (one predicate now) | no |
| [#3640](https://github.com/fixpoint-labs/flow-state-dev/pull/3640) FIX-2077 | **7** | 19 | **(a) tail: the terminal status on the stream. Must-fixes r3–r6, each on the previous fix** (hold → attach gap → heartbeats off → synthetic seq collides → continuation seq) | no |
| [#3645](https://github.com/fixpoint-labs/flow-state-dev/pull/3645) 2081×2085 | 0 | 2 | positive notes only | no |
| [#3648](https://github.com/fixpoint-labs/flow-state-dev/pull/3648) FIX-2088 | 2 | 5 | durable-only abort; late failure after a timed-out strict wait; docs said "always" (`overclaim`) | no |
| [#3650](https://github.com/fixpoint-labs/flow-state-dev/pull/3650) FIX-2086 | 2 | 12 | edit plus steer not atomic (now refused together); a late steer before settle on fixed boards | no |
| [#3653](https://github.com/fixpoint-labs/flow-state-dev/pull/3653) FIX-2082 | 5 | 27 | 🔴 lapsed-slot recheck never ends. **(a): a shared `logicalBlockIdOf`, done for an optional nit, changed the fallback key; "this round makes that path more likely"** | no |
| [#3654](https://github.com/fixpoint-labs/flow-state-dev/pull/3654) FIX-2083 | 3 | 12 | **merged 4 min after three 🟡. (a): the merge resolution weakened the replay check** → #3660, #3663 | no |
| [#3660](https://github.com/fixpoint-labs/flow-state-dev/pull/3660) 2083 D3 | 2 | 9 | optional notes only | no |
| [#3663](https://github.com/fixpoint-labs/flow-state-dev/pull/3663) 2083 follow-ups | 3 | 11 | 🔴 the replay fix covered only the accepted call; 🔴 a flaky test, root cause found in the harness. FIX-2107 fixed with a `WORKER.md` line (see scoring) | no |
| [#3670](https://github.com/fixpoint-labs/flow-state-dev/pull/3670) FIX-2084 | 3 | 14 | 🔴 `roles: []` wipes a built-in's roles; the upgrade ran after the sweeper started. **(a): 2099f42's registry rename is a blind upsert racing the startup sweep** | no |
| [#3692](https://github.com/fixpoint-labs/flow-state-dev/pull/3692) closure FIX-2087 | 6 | 27 | **(b)**, sixth closure: see the class list. Rounds 1–4 of the plan; round 1 filed 13 findings | no |

### Bugs and goal fixes the epic filed

| PR | Issue | Waves | Threads | Shape |
|---|---|---|---|---|
| #3658 | 2102 | 2 | 3 | strip every seam-owned provenance key |
| #3659 | 2103 | 2 | 6 | the ordering promise wrong in five places; `vacuous-assertion` (tap restored, both cases green) |
| #3661 | 2104 | 3 | 12 | the seam-throw claim checked on the real path; a stack-sniffing fault was fragile |
| #3666 | 2101 | 5 | 15 | **(a) chain: 🔴 r2 on e3a096439, 🔴 r3 on c24fc95a4 ("the previous commit kept this record"), r4 CI red on 735a89104**; `vacuous-assertion` (237/237 green under mutation) |
| #3671 | 2105 | 2 | 4 | `vacuous-assertion` (1146/1146 green with a clause dropped) |
| #3672 | 2106 | 4 | 11 | **(a): r2 on c68ac2da9; the author took option (b), a new counter, over the reviewer's recommended docs fix; r3 found the counter loses a line under CAS retry** |
| #3674 | 2108 | 2 | 3 | a resolved-status fence can't see a re-drive (probe-reproduced) |
| #3675 | 2109 | 2 | 6 | "lands together" checked on real Postgres 16 (an orphan item); adapter docs |
| #3693 | 2111 | 2 | 6 | a `target` beside `followUpOf` silently dropped |
| #3694 | 2110 | 2 | 4 | BP-030: a tap moved replay paths (an accepted gap, stated) |
| #3696 | 2113 | 2 | 7 | a new step moved replay paths; a one-slot mark; `vacuous-assertion` (the gate set to `false`, still green) |
| #3697 | 2112 | 2 | 6 | exactly-once promised unconditionally (`overclaim`) → FIX-2123 |
| #3698 | 2122 | 1 | 3 | notes |
| #3699 | 2114 | 2 | 8 | `vacuous-assertion` (both new calls commented out, 1550/1550 and 844/844 green) |
| #3701 | 2115 | 2 | 5 | Codex: best fit also files from the coordinator's own turn |
| #3702–#3722 (10) | 2116–2127 | 1 each | 33 | goal checks out of date with the epic's own merges (Cursor notes only) |
| #3733, #3737, #3744 | 2123, 2135, 2136 | 1 each, after merge | 11 | **#3733's Cursor P-note (a repeat wait reads `arrivesAsNotice`) has no reply** |
| #3746 | 2138 | 0 | 0 | — |
| #3764 | 2147 | 1 | 5 | a guard made to fail closed |
| #3767 | 2149 | 2 | 8 | **Cursor, after merge: `passPlanDue` is never cleared. No reply** |
| #3777 | 2150 | 2 | 5 | the re-park lease window, red shown with a local delay; an engine-level test added |
| #3801 | 2155 | 1 | 5 | (e), the deterministic park time |
| #3834 | 2166 | 2 | 6 | (e) and (d): a registry error read as stopped |
| #3835 | 2170 | 2 | 8 | (d): another session's request read as parked; `vacuous-assertion` (51/51 green) |

**Load.** 114 waves over 52 implementation PRs: 50 over the 16 feature PRs, 6 on the closure, 58 over
the 35 bugs and goal fixes. Nine PRs took four or more: #3622, #3624, #3631, #3638, #3640, #3653,
#3666, #3672, #3692. In direction artifacts, 3 of 17 took a second round (a Codex re-pass about seven
hours later) and none a third.

**Classes.** Direction (159 threads): `over-engineered` 60 · `missed-edge-case` 40 · `spec-ambiguity` 31 ·
`nit` 17 · `stale-restatement` 8 · `design-off` 2 · `docs-miss` 1. Nearly all the `over-engineered`
threads are Cursor's simplify notes, recorded for the implementer and not folded, as BP-040 asks.
Implementation (436 threads, approximate): `missed-edge-case` ~165 · `nit` ~150 · `over-engineered`
~70 · `docs-miss` ~30 · `spec-ambiguity` ~10 · `design-off` ~5 · `stale-restatement` ~5 ·
`philosophy-drift` 1 (#3631). Reading labels: `vacuous-assertion` on 9 PRs, each found by a reviewer
deleting or reverting a line with the suite still green. `overclaim` on at least 5 (#3595, #3599, #3648,
#3675, #3697).

**Claims (looped / settled / verdicts):** 0 / 0. Two spec-phase POCs ran before any review asked: the
epic's claim-gate seam (#3588) and FIX-2087's surface sweep.

**Reviewer exhaustion:** Bugbot was out of usage for the span. Codex reviewed 11 of 52 implementation
PRs and 15 of 17 direction artifacts. #3817 (10-23) now requests Codex once per PR. **Merged with findings still
open:** #3624 (the post-merge must-fix) and #3654 (four minutes after three 🟡). Both were routed to
follow-up PRs, so nothing was lost, and this is the sixth cycle running. Two post-merge Cursor findings
have no reply (#3733, #3767). They are listed for the coordinator here, not filed.

**Carried / not carried.** Cycle 24's fix (`b4be0414f`, 10-19, tenet 5's prompt sentence) is an ancestor
of the earliest sampled branch heads (`a55daee18^2`, `6e8c5d6f8^2`, `dc912bffe^2`), checked with
`git merge-base --is-ancestor`. Every later head forked after them, so the whole sample carries it.

**Epic row:**
`ways per job: decide whether a drain waits 1→1 · decide a task is done 3→1 · fail an attempt 3→1 ·
end what depends on a dead task 2→1 · hear an ending 5→3 · run something later 4→4 · change a task
(task tools) 7→1 · wait on another session's work 3→3 · hand a user's message to a delegate 2→1 ·
check a worker fits 2→1 · refuse a broken worker before it runs 3→3 · fire a time at most once 4→4 ·
file a task from outside a worker turn 2→1 · send words into a task 3→1 · grade the assembled set 0→1 ·
bring stored work forward to this version 1→4 · read whether a request still runs 1→3 · check a
schedule is valid 1→2 · derive a block call's logical id 3→1 · pick a sole delegate 4→1 · check a gate
can hold a wait 3→1`

## (a) A fix round's own change, found by the next pass

| PR | Fix-round change | Wider than the finding needed? | What the next pass found |
|---|---|---|---|
| #3624 | b194f86 moved the cascade payment after the workers | yes: a start-up timing concern | a crash-owed debt never paid before the exit check; `complete` drains spin 15.6 s (FIX-2096) |
| #3631 | 4b38f9240 checkpoint rule per attempt | yes: the note said *"I'm not asking for a change here"* | the owner's D3 sign-off reversed; must-fix, reverted |
| #3638 | skip the lease-end owe in the filer's own session | yes: an optimization | a claim between a pass's read and its settle loses its lease end; reverted |
| #3640 | 1aefd398a, 39f2fcbc5, 763314317, 9cca4ff6a | each re-shaped how the terminal status is held | four must-fixes in a row, each on the previous fix |
| #3653 | `logicalBlockIdOf`, shared for an optional nit | yes | the fallback became the block's name, so keys collide; an unbounded re-owe made more likely |
| #3654 | a merge resolution | — | a second call's follow-up reads as filed and its goal is dropped; #3663's fix covered only the accepted call (🔴 again) |
| #3666 | e3a096439, c24fc95a4, 735a89104 | the second replaced a read rather than adding to it | 🔴 "parked" misses owes-redrive; 🔴 an unlogged pending gate is deleted; CI red |
| #3672 | c68ac2da9, then 6436fc5da | yes: option (b), where the reviewer recommended (a) | a rule wider than its docs; a counter that loses a line under CAS retry |
| #3692 | f6d06f135, a forwarder's whole body exempted | — | *"reopens a hole the previous commit had closed"* |
| #3622 | 838a9600b, dispatch's zone check made stricter | — | `saveSchedule` still accepts `UTC+5`, so a dead schedule shows a next run |
| #3670 | 2099f42, registry entries renamed by upsert | — | the upsert races the startup sweep; only the default export was wrapped |

The 10.4 rule already asks that a test added in a fix round be shown red before the fix. Two things in
these rows fall outside it. First, the fix's own code: on nine PRs a reviewer deleted or reverted a fix's
line and the suite stayed green (#3659, #3663, #3666, #3670, #3671, #3672, #3696, #3699, #3835), so a
regression in that code reached the next pass rather than the author's own run. Tenet 7 says it already:
*"break it on purpose and confirm the signal changes."* It was applied to the headline and not to the fix
round. Second, five of the rows took more than the finding needed. That is tenet 3's *earn every
addition*, applied inside a round where the next reviewer is the only check.

## The proposed upstream fix: one sentence in 10.4, two lines in the pre-push hook

| File | Now | Proposed |
|---|---|---|
| `.agents/skills/issue-implement/SKILL.md` · 10.4, *Actionable code feedback*, step 1 | *"…Only then make it pass. Capture both the failing output and the passing output; you need both for the reply."* | *"…Only then make it pass. Capture both the failing output and the passing output; you need both for the reply. Hold the fix's own change to the same bar: revert each hunk that changes existing behaviour and a test must go red, and close the finding with the smallest change it needs. A refactor, an optimization, or the wider of two options a reviewer offered goes in a change of its own."* |
| `.husky/pre-push` | `pnpm lint` | `pnpm lint`, then `node scripts/check-retired-terms.mjs` and `node goals/vocabulary/one-word-per-thing/sweep.mjs` |

The sentence adds no rule. It points the red-state check the step already holds at the fix's own diff,
and it brings tenet 3 into the round. A worker following it on #3672 would have taken the docs fix the
reviewer recommended. On #3666 it would have found that c24fc95a4 dropped the unlogged-pending case,
because reverting that hunk turns nothing red. The hook lines are separate, in their own commit, and can
be dropped on their own. CI keeps both steps, since `--no-verify` skips the hook.

## (b) The sixth closure graded by shape

| Cycle | Closure | First finding |
|---|---|---|
| 19 | #2348 | controls matched by leg |
| 21 | #2709 | `GOAL_PART=bogus` printed PASS |
| 22 | #2781 | a child control accepted on any nonzero exit |
| 23 | #3045 → #3048 | any red passed; `alsoRed` optional |
| 24 | #3367 | the store restored outside `finally`; commits graded from a stale `main` |
| 25 | #3692 | a control read by substring; `tags.some` takes a partial signal; a green control passes; the live lookup fails open |

FIX-1183 landed (10-20) as a CI step for empty-list guards, so cycle 24's claim 3 has its answer: it
doesn't reach this shape. Every closure still writes its own reader of a child's verdict. #3692's ended
up parsing `goals/lib/verdict.mts`'s printed form, because no child goal has a `--json` mode. A shared
verdict reader in `goals/lib` is code and scheduling, **an owner ask**, as in cycles 23 and 24.

## Candidates considered and dropped

- **(c) as text** ("run the guards before pushing" in a skill). A hook line is cheaper and can't be
  skipped by forgetting, so it's in the proposal instead.
- **(d) as text** (a sentence about failing closed). It names a class but doesn't stop the next reader
  from picking its own default. The fold (FIX-2179) gives the job one reader. Filed.
- **(e) as text.** All three flakes were fixed at their cause.
- **Cursor's post-merge passes** (#3672, #3693, #3733, #3737, #3744, #3767). These are mostly notes. Two
  unanswered findings are listed above. The automation runs after a fast merge, which is a setting, so
  it goes to the owner if anywhere.
- **Spec-time "the goal can't fail" findings** (#3593 ×2, #3594, #3597, #3599, #3602, #3604 ×2). Codex
  caught every one in round 1, and each was folded before approval. That is the spec review working, not
  a gap.
- **Merged with findings open** (#3624, #3654). Sixth cycle running. Both went to follow-up PRs. Hold.

## Job audit

The PR body lists every addition the batch made and the job it does. Fifteen jobs came from the merged
specs' *What's already here* tables. Each spec compared its one addition against the closest entry, so
those are cleared by their specs and their counts are the specs'. The impl diffs added six jobs no spec
recorded. The worker ran `audit-coherence` inline on each, scoped to the job across packages: there was
no sub-agent dispatch in this session. Three were coherent: the wake primitive, the
caller-metadata strippers layered on one base, and the logical-id, sole-delegate and gate-wait helpers
the batch folded down. Three folds were **filed, not proposed**:

- **FIX-2178** (bring stored work forward, 1→4): three host-start calls in two packages
  (`backfillBoardWakes`, `upgradeWorkerEntryNames`, `upgradeKeptTurns`), each with its own options and a
  shared before-the-sweeper order rule that review found broken in Shift Manager and missing in Kitchen
  Sink.
- **FIX-2179** (read whether a request still runs, 1→3): `requestStates` plus two direct `waits.ended`
  readers, each with its own answer for "can't tell". This is class (d). Related to FIX-2169.
- **FIX-2180** (check a schedule is valid, 1→2): `saveSchedule` assembles its own check from the atoms
  `validateScheduleConfig` uses, and they drifted inside #3622.

## Scoring the previous cycles' fixes and claims

- **Cycle 24's claim 1 (is a model-backed failure fixed at what the model was handed?): 1 instance, fixed
  at the prompt.** FIX-2107 (*"asks which project instead of opening a workstream"*) was closed by a
  `WORKER.md` line in #3663 (*"never asks which project the user means"*). Tenet 5's sentence had been in
  the tree since 10-19 and is an ancestor of #3663's head. It hasn't come back: the privacy goal's leg
  passed 11 of 12 runs after it and 5 of 5 at the closure's round 4. Whether a prompt-only fix holds is
  next cycle's to see. Baseline: 1 of 1 fixed at the prompt, 0 back.
- **Cycle 24's claim 2 (direction artifacts merged before a requested Codex pass): 0 of 17**, down from
  2 of 6. Every Codex finding on a direction artifact predates its merge.
- **Cycle 24's claim 3 ((b) on the next closure): yes, the sixth.** FIX-1183 landed and doesn't cover it.
- **Cycle 24's claim 4 (closure finds caused by sibling merges): the largest share yet.** Eight of the
  closure's findings (FIX-2116, 2117, 2118, 2120, 2121, 2124, 2126, 2127) were goal checks out of date
  with the epic's own merged children, and the closure's final run fixed five more controls that had
  drifted. Model-free
  goals still don't run in CI. **The owner ask from cycle 24 stands, with more evidence.**
- **Cycle 23's crash-window trigger.** #3666's r3 is #2964's shape again: a gate written before its log
  entry. A primitive (one `parkedInterruptedIds` rule shared by stop, history and retention) was named
  at r3, and the tail closed at r4. #3640's terminal-status tail named its shape at r5 (*"I took your
  simpler shape"*) and closed at r6. That is inside the trigger's class, and it fired late.

## Claims to test next cycle

1. **Do fix rounds stop opening the next finding?** Count fix-round commits whose next pass found a
   defect in that commit's own change, and those that took more than the finding needed. Baseline: at
   least 17 in 11 PRs; 5 wider than needed.
2. **Do reviewers stop finding fix code no test can see?** Count findings where a reviewer deleted or
   reverted a line and the suite stayed green. Baseline: 9 PRs.
3. **Retired-word commits on an epic's branches.** Baseline: 10. If the hook lands, expect about 0.
4. **(b) on the next closure,** and whether `goals/lib` gains a shared verdict reader. Baseline: six
   closures running.
5. **Closure findings that are goals out of date with the epic's own merges.** Baseline: 8, plus 5
   controls.
