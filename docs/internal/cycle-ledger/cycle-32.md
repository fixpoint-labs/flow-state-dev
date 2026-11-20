# Cycle 32 — push-channel epic wrap (FIX-2367) (2026-11-20)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**One epic spec, two epic amendments, seven issue specs, two spec amendments, two POCs and 14
implementation PRs, over 21 days (10-31 to 11-20). Spec review was cheap: 16 rounds over 12 direction
artifacts, one past two. The build was done by 11-04 and the closure merged on 11-17. Most of the
cost came after that, in two places review doesn't reach until something is run. One was the goal
checks, which nobody had re-run on `main`. The other was a reversal of the epic's own default,
which came in as a bug two days after the specs merged. The specs and the goal lines that stated
the old default were not amended until 15 days later.**

The classes, checked against the PRs, the goals' verdict logs and Linear:

- **(a) Goal checks stale or red on `main`, found only by the closure re-run** (`missed-edge-case`
  found by running, not by review; cycles 21, 24, 25 and 26's class). The children's goals run by
  hand, so nothing re-ran them after the next PR that broke them. The 11-19 re-run found:
  - **FIX-2842.** FIX-2429's `task-board/a-settled-task-reaches-the-board` was red on `main` from
    11-13 (2.4 board reads a second, `a:crossing`), and its three controls could not apply their
    patches, because their regex anchors were gone once views replaced reads. FIX-2695 and FIX-2750
    (another epic) fixed the product on 11-16. The closure filed FIX-2842 on 11-19 from its 11-15
    logs, and #5471 recorded that it was already fixed.
  - **FIX-2846.** FIX-2776 (another epic, merged 11-18) moved the task screen's read to a view, a
    POST. The goal's counter saw only GETs and `/reads/`, so `c:fallback-reads` failed and
    `a:idle-0-reads` passed while it measured nothing (`vacuous-assertion`). Fixed by #5482.
  - **FIX-2427's `no-bus` control** still said it must fail `2:idle` with 80 statements. Since
    FIX-2545 it reads 0, which comes out as CAN'T TELL. Its line was rewritten by #5480.
  - Out of the epic, the same folder: FIX-2723 (FIX-2624 left two realtime goals unable to start, 11-13).

  The encoding is already filed. **FIX-2225** (CI runs the model-free goals and each documented
  control, and requires each control to fail its named assertion) has been Backlog since 10-27, at
  priority 3. Each instance above is a FAIL that step would have shown on the PR that caused it.
  FIX-2776's merge left the goal red (verdict row 2026-11-19, `0e6c1fc3f2`), and so did
  FIX-2624's for FIX-2723. Also, a control that can't apply its patch already exits as a FAIL. What
  blocks a plain sweep is that `main` is not green: FIX-2803 counts 57 FAIL rows. **Proposed below
  as a pass-list ratchet. FIX-2225 commented.**
- **(b) A bug-route reversal of the epic's default, then 15 days of stale restatements** (`design-off`
  ×1 and `stale-restatement` about 12). FIX-2426 D1 and FIX-2428 D3 locked in *"the in-memory bus never
  reports crossing"*, so the default dev host polls on its timer even on one process. Cursor named
  the shape on #4511 (11-02), predicting *"goal passed but my app still polls"*. The reply folded it
  as one sentence in FIX-2428's SPEC. Every child goal graded on `goals/lib/crossing-bus.mts`, an
  in-memory bus that says it crosses, so no goal graded the host an adopter runs first. Two days
  later the owner hit it in his own apps. FIX-2545 (11-04, filed on its own, not a child, no spec)
  flipped the default in #4704 and edited four user-doc pages. It amended no retained spec and no
  goal line. The restatements were converged only when the closure was amended: #5469 (11-19) took
  2 rounds and 6 findings (Gitar ×3, Codex ×3), all `stale-restatement`, and #5480 took 3 more from
  Codex. One is still on `main`. Cursor's post-merge finding on #5469 says FIX-2428 D3's
  **Locks in** row still says *"on the in-memory bus is always, even on one process"*, under its
  own Nov 19 blockquote. `issue-implement` already says that a change which **narrows** a rule
  stated elsewhere must sweep the old statement (Step 5). FIX-2545 **reversed** one. **Recorded,
  not proposed:** (a)'s ratchet catches the goal half, because a control that no longer fails as
  named goes red. `orchestration.md` says retained specs are *"historical intent"*, with *"no
  mandatory backlink updates"*, so the spec half is a choice the owner already made (see
  *Coherence* below).
- **(c) A selection that runs nothing grades PASS** (`vacuous-assertion` reading, under
  `missed-edge-case`; cycles 19 and 21's class). #5280, the closure goal, took 8 passes and 20
  findings. Four of them were guards that passed for the wrong reason: `c:refused` satisfied by the page's
  own load mint (Gitar at eaf121a, again at 6233ac3); an empty or unknown `GOAL_SCENES` graded PASS
  (Codex at 0307c8a); `GOAL_SCENES=j4` under `main-before` ran nothing and graded PASS (Gitar at
  035aa1b); and server-side idle reads were printed, not graded (Greptile at 0307c8a). Cycle 21
  recorded #2709 T7, T9 and T10 as the same shape, and said a verdict-protocol guard was filed.
  Linear has no such issue. 37 goals read `process.env.GOAL_LEGS` or `GOAL_SCENES` themselves, and
  `goals/lib` has no selector. **Proposed below as one helper and a ratchet.**
- **(d) Harness fidelity in the closure's own check.** `j2:message` failed on 11-15 (530–1140 ms
  against a 1 s bound). #5280 merged on 11-17 with that FAIL logged. FIX-2841 found on 11-19 that
  the goal had opened the conversation first in one browser context, so it was timing a background
  tab polled at 2 frames a second. Fixed in #5475 (the conversation is fronted, and a frame-rate
  probe refuses a background page). One instance. **Recorded.**
- **(e) Spec PRs merged before their review fold.** #4445 (FIX-2426), #4443 (FIX-2428) and #4488
  (FIX-2429) each merged as their single first commit. Their review folds and the owner's
  keep-the-bus decision landed in the epic amendments #4477 and #4511. #4476 (FIX-2427) was drafted
  against the unfolded FIX-2426 in the 26 minutes between, and refolded once (78109d1: *"built on
  FIX-2426's crossing event (#4477)"*). Cost: one refold. **Recorded.**
- **(f) A red check from `main`, not the PR** (cycles 24, 27, 29, 30 and 31 (f)). Six PRs carry a
  comment explaining a red check as not theirs: #4594, #4597, #4598 and #4581 (three kitchen-sink
  E2E specs red on `main`), #4597 and #4598 (Typecheck, two shift-manager PRs collided), #4664
  (registry-copy drift), and #4704 (`@/` alias break). **Owner ask, sixth cycle: require branches
  to be current, or a merge queue.**

**Proposals** (for the owner; neither is built in this PR): build FIX-2225 as a pass-list ratchet
for (a), and add one shared leg selector for (c). No tenet or BP sharpening.

**Method: scope.** FIX-2367's ten Linear children (GraphQL, read-only), their PR attachments, the
epic's own attachments, and a GitHub search for each child id and for FIX-2545. For each of 30 PRs
we read the reviews, inline threads with replies, conversation comments and commits, through the
REST API. We also read the verdict logs of the six realtime and task-board goals on `main` at
`372f30fa95`. Rounds on a direction artifact count review passes that a fold commit answered,
on that PR or in the amendment that carried the fold. Passes on an implementation PR count distinct
(bot reviewer, commit) pairs with an inline finding before the PR closed. Findings after the close
are counted apart. Spec endpoints are merge times. Times are UTC.

**Read, not sampled:** #4704 (FIX-2545, in the project but not a child; read for (b)) and the POCs
#4605 (taken into #4598 as 073cbda) and #4707 (taken into #4704 as 5321913). **Out of the sample:**
#2367 (a project spec, never merged), #4486 (FIX-380, Ably, open), and PRs the id search matched by
number alone. **Not scored:** the fourth-pass rule's carry (cycle 31 (c)). This checkout is
shallow, so ancestry can't be asked, and a timestamp is the wrong question.

**Every act sits behind the shared `jhoffner` login**, so this entry doesn't say who merged what.

### Direction artifacts

| PR | Rounds | Endpoint | Shape of the review | Felt off? |
|---|---|---|---|---|
| [#4294](https://github.com/fixpoint-labs/flow-state-dev/pull/4294) epic | 2 | merge 10-31 20:47Z | r1 Cursor ×5 and Codex P2 (`ctx.user`/`ctx.org` writes have no publisher), owner D1/D6 at the gate (7363256, 474bab3, 1237533). r2 Codex P2: session lifecycle wakes before polls go off (ca6835f). 54 minutes open | no |
| [#4445](https://github.com/fixpoint-labs/flow-state-dev/pull/4445) FIX-2426 | 1 | merge 11-01 20:32Z | Second look, Codex P2 (the POC's timer counted queue waits), Cursor ×5. Architect: *"Not approving yet: one epic call for Jake"*. Owner: keep the bus. Merged as its first commit; folds in #4477 (e) | no |
| [#4443](https://github.com/fixpoint-labs/flow-state-dev/pull/4443) FIX-2428 | 1 | merge 11-01 20:31Z | Second look, coherence pass, Cursor ×4 (polling *"only while there is no push"* contradicts D3). Merged as its first commit; folds in #4477 (e) | no |
| [#4477](https://github.com/fixpoint-labs/flow-state-dev/pull/4477) epic amend | 1 | merge 11-01 20:58Z | Keep the bus, D1/D6 flips in queries a second, both specs' folds, FIX-1506's seams (5504f93). Codex clean | no |
| [#4476](https://github.com/fixpoint-labs/flow-state-dev/pull/4476) FIX-2427 | 1 | merge 11-01 21:35Z | Codex P2 (wake parked waits when crossing drops), Cursor ×5, architect. Refolded on #4477 (78109d1) (e) | no |
| [#4478](https://github.com/fixpoint-labs/flow-state-dev/pull/4478) FIX-1506 | 1 | merge 11-01 21:49Z | Codex P2: `client.derived` reads resources the engine can't see, so every resource of such a scope publishes (93c0945) | no |
| [#4488](https://github.com/fixpoint-labs/flow-state-dev/pull/4488) FIX-2429 | 1 | merge 11-02 00:20Z | Codex P2: merged task lists need plan-ledger notices too. Merged as its first commit; fold in #4511 (e) | no |
| [#4511](https://github.com/fixpoint-labs/flow-state-dev/pull/4511) epic amend | 2 | merge 11-02 00:51Z | Cross-spec fixes. r1 Cursor ×5, architect ×4 on FIX-380's seam (8624dca). Cursor's *"goal passed but my app still polls"* folded as a sentence (b). r2 Codex P2: keep the 30 s after-a-move window (0abf79a) | yes, unseen (b) |
| [#4512](https://github.com/fixpoint-labs/flow-state-dev/pull/4512) FIX-2368 closure | **3** | merge 11-02 22:45Z | r1 Cursor ×4 and architect (4918e75). r2 second look (c5b43e7). r3 Codex P2: j3's zero-statement count included the reply's own read (a90cb06), a `missed-edge-case` in a goal assertion, not a direction finding. The owner decided D3 (no Ably) (cc4de57) | no |
| [#4513](https://github.com/fixpoint-labs/flow-state-dev/pull/4513) FIX-2466 | 1 + post-merge | merge 11-02 22:47Z | r1 Cursor ×3, architect (FIX-2429's D1 flip retired) (4ff6bbd). Codex P2 2 min after merge: the checker's inventory is stale against the merged sources, answered by #4581 | no |
| [#4581](https://github.com/fixpoint-labs/flow-state-dev/pull/4581) FIX-2466 amend | 0 | merge 11-03 02:04Z | Reclassify the checker. Cursor approve, 3 notes | no |
| [#5469](https://github.com/fixpoint-labs/flow-state-dev/pull/5469) FIX-2368 amend | 2 + post-merge | merge 11-19 20:56Z | (b). r1 Gitar ×3 (5f6b737). r2 Codex ×3: supersede FIX-2426's contract and FIX-2428's control (968aaa0). Cursor ×4 a minute after merge, one still on `main` | no |
| [#4605](https://github.com/fixpoint-labs/flow-state-dev/pull/4605), [#4707](https://github.com/fixpoint-labs/flow-state-dev/pull/4707) POCs | 0 | closed | Each taken into its implementation PR | — |

### Implementation

| PR | Passes (reviewer × commit) | Findings | Shape of the rework | Felt off? |
|---|---|---|---|---|
| [#4594](https://github.com/fixpoint-labs/flow-state-dev/pull/4594) 2426 | 2 | 9 | Codex P1: a background flush swallowed a persistence error for explicit flush callers. Codex: stop the ping loop on a cancelled response. Cursor ×7 simplify | no |
| [#4598](https://github.com/fixpoint-labs/flow-state-dev/pull/4598) 2427 | 3 | 9 | Resync on the first LISTEN; listener lost as it opens; widened notices reach narrowed subscribers. One registry build, from POC #4605 | no |
| [#4597](https://github.com/fixpoint-labs/flow-state-dev/pull/4597) 2428 | 6 | 17 | One structure, the push hub's lifecycle: session recheck at mint, read after the ticket is heard, mints scoped by connection generation, chunked mints, teardown after the last close, pending grants. 12 Codex | no |
| [#4613](https://github.com/fixpoint-labs/flow-state-dev/pull/4613) 1506 | 5 | 12 | Writer-skip while the stream is lost; one storage-path rule for collection aliases (round 3); owner-private rows publish no path (round 5) | no |
| [#4616](https://github.com/fixpoint-labs/flow-state-dev/pull/4616) 2429 | **8** | 12 | Stale board reads after unsubscribe and unmount, then which copy of a Teammates row wins: four rewrites to *"newest updatedAt wins"* (4453c0a) and *"a row is the board read's"* (a600d3a). Five merges of `main` | no |
| [#4647](https://github.com/fixpoint-labs/flow-state-dev/pull/4647) 2466 (1/4) | 4 | 10 | Recovery wakes for views that no longer poll; the empty-history read; two labs' `onNotice` copies (Cursor, later folded by FIX-2551's `client.live`) | no |
| [#4664](https://github.com/fixpoint-labs/flow-state-dev/pull/4664) 2466 (2/4) | 1 | 5 | A read that fell back is a failure to retry. Cursor: the test passes without proving the cache was dropped | no |
| [#5170](https://github.com/fixpoint-labs/flow-state-dev/pull/5170), [#5171](https://github.com/fixpoint-labs/flow-state-dev/pull/5171) 2466 (3–4/4) | 3, 6 | 7, 8 | The missing-task deadline (Gitar ⚠️ *"waits forever"*), the quiet clock's early fire and 32-bit cap, double polling while missing | no |
| [#5280](https://github.com/fixpoint-labs/flow-state-dev/pull/5280) 2368 closure | **8** | **20** | (c): guards that pass for the wrong reason, a selection that runs nothing, leaked servers on a failed setup. Merged with `j2:message` FAIL logged (d) | no |
| [#5471](https://github.com/fixpoint-labs/flow-state-dev/pull/5471) 2842, [#5475](https://github.com/fixpoint-labs/flow-state-dev/pull/5475) 2841, [#5482](https://github.com/fixpoint-labs/flow-state-dev/pull/5482) 2846 | 0, 1, 3 | 0 + 3, 1 + 2, 3 | (a) and (d). #5482: Codex and Greptile both flagged that `goal.md` still promised 2 s + 1 s after `run.mts` moved to 3 s (`stale-restatement`, fixed at 7b59a7c on #5480) | no |
| [#5480](https://github.com/fixpoint-labs/flow-state-dev/pull/5480) closure re-run | 2 | 5 | Codex ×3 `stale-restatement` on the control lines (b); hold the record until FIX-2846 re-ran | no |
| *Read: [#4704](https://github.com/fixpoint-labs/flow-state-dev/pull/4704) FIX-2545* | 1 | 7 | (b): the flip. Cursor: *"`crossesProcesses: true` here now means 'this deployment model treats every writer as in-process'"*, and that the crossing double has three copies | yes (b) |

**Load.** Direction: 16 rounds over 12 reviewed artifacts (1.3 each; cycle 31: 1.8). One went past two
rounds, #4512, and its third round was a goal-assertion edge case. Implementation: 52 passes over
14 PRs (3.7 each; cycle 31: 1.6), with 118 inline findings before close and 5 after. #4597, #4616,
#5171 and #5280 hold 28 of the passes.

**Classes.** Direction (45 inline findings before merge and 8 after, plus second-look and architect
comments): `nit` and `over-engineered` lead (Cursor's simplify notes, about 25), then
`missed-edge-case` about 10, `stale-restatement` about 10 (#5469 ×6 and ×1 after merge, #4511's ER-7
line, #4443's *"only while there is no push"*), and `spec-ambiguity` 2. Implementation (123):
`missed-edge-case` about 75, `nit` and `over-engineered` about 38, `stale-restatement` 5 (#5480 ×3,
#5482 ×2), `design-off` 0 on the children. Reading labels: `vacuous-assertion` on #5280 ×4 (c), #4664 ×2
(tests passing without proving the fix), and the FIX-2846 counter (a).

**design-off: 1.** FIX-2428 D3's default on the in-memory bus (b). A reviewer named it on #4511.
It was folded as documentation and reversed by the owner after use.

**Claims (looped / settled / verdicts):** 0 / 0 / —. Two POCs ran (#4605, #4707). Both were design
spikes taken into their implementation PRs, not settlements.

**Reviewer exhaustion:** none found. **Merged with a finding open:** #5469 (1 above the bar, after
merge, unfiled: FIX-2428 D3's **Locks in** row), #4513 (1 after merge, answered by #4581).

**Epic row:**
`ways per job: carry a change notice from a write to its listeners 3→4 (flow_events LISTEN and
StreamBridge, per request, kept by D5; the change bus; the session stream's timed read, now only a
fallback where no bus crosses) · publish a change from a write 0→1 (one bus; a publish point per
write kind: the request and session store wrapper, the scope-state and resource seam, the board
seam) · say whether push covers a host 0→1 (crossesProcesses, carried as the socket's crossing frame;
FIX-2545 changed the in-memory answer, not the count) · tell a screen that what it shows changed
(4 + 12 view timers)→2 (the session stream for items; client.subscribe for any topic, with
useSubscription and the panel drivers over it; client.stream() removed, the 12 timers moved;
useSubscription now has no consumer, FIX-2854) · name what a screen watches 0→1 (topic() in
contracts) · deliver notices to a browser 0→1 (the socket with its mint, on the user-stream route
that answered 501) · authorize the topics a caller hears 0→1 (the mint, built from the existing
route checks) · listen on a Postgres channel with reconnect 1→1 (listen.ts; the request tail moved
onto it) · resolve a collection's storage prefix 1→1 (getPatternPrefix moved to contracts/helpers) ·
fake a bus that crosses, in a check 0→2 (goals/lib/crossing-bus.mts and engine's conformance
crossingBus, plus two inline test doubles, FIX-2855) · start a two-process Postgres check 1→1
(goals/lib/postgres.mts, moved out of FIX-2427's goal)`

## (a) FIX-2225 as a pass-list ratchet

**Proposed (rung 3, CI, for the owner):** build FIX-2225 so it gates on goals that pass on `main`
today, instead of waiting for FIX-2803 to turn the whole folder green. A list file names the
model-free goals that pass, with their controls. CI runs each one and each control, and requires a
control to fail the assertion its `goal.md` line names. A PR may add a goal to the list. It may
remove one only by recording a FAIL row in that goal's verdict log.

- **It goes red on the real instances.** FIX-2776's merge left `realtime/app-views-read-on-notice`
  FAILing `c:fallback-reads` (row 2026-11-19, `0e6c1fc3f2`). That goal's last PASS row was 11-12.
  On the task-board goal, the controls that couldn't apply their patches already exit as a FAIL
  (rows 2026-11-13). The `no-bus` control's CAN'T TELL exits 3, not 1, which is not the FAIL its
  line names. All three would have shown on the PR that caused them. They were not run here: each
  needs Postgres, and two need Playwright. The evidence is the verdict rows.
- **What it does not reach.** Model-backed goals, and the 57 that FAIL on `main` now. Those stay
  FIX-2803's.
- **What it costs.** CI minutes and a Postgres and Chromium setup in one job. Being wrong costs a
  flaky timing goal blocking unrelated PRs. #5475's probe shows a 1 s bound can be made to hold on
  a loaded runner.
- **Commented on FIX-2225** with these counts. It is the fourth cycle to carry this class (21, 24
  and 25 before cycle 26 filed it, then this one).

## (c) One leg selector in `goals/lib`

**Proposed (rung 1, then rung 3, for the owner):** `goals/lib` gets `selectLegs(known)`. It reads
`GOAL_LEGS` / `GOAL_SCENES` and throws on an empty selection or an unknown name. A CI check like
`check-tell-suppress.mjs` refuses a new raw `process.env.GOAL_LEGS` or `GOAL_SCENES` read outside
it, and fails only on added reads, since 37 goals have their own today.

- **It goes red on the real instances.** #5280's 0307c8a (an unknown scene ran no checks and
  graded PASS) and 035aa1b (`j4` alone under `main-before`). Cycle 21's #2709 T7, T9 and T10 had the
  same shape. `runGoal` can't catch it: a body that grades nothing and returns no failures is a
  PASS (`goals/lib/verdict.mts`).
- **What it does not reach.** A guard satisfied by the wrong event (#5280's `c:refused`). That is
  `vacuous-assertion` in the assertion itself, and `goals/README.md` → *Proving a check can fail*
  already names it.

## Enforcement, rung by rung

- **(a)** Rung 3, filed as FIX-2225. Proposed as a ratchet, and FIX-2225 commented.
- **(b)** The goal half is caught by (a). The spec half is a choice the owner made in `orchestration.md`.
- **(c)** Rung 1 and rung 3, proposed above.
- **(d)** One instance, fixed in the goal (#5475).
- **(e)** One refold. Recorded.
- **(f)** A repository setting. Owner ask, sixth cycle.

## Accepted and Rejected

**Accepted:**
- (a): the ratchet shape, proposed for the owner. FIX-2225 commented.
- (c): the selector and its ratchet, proposed for the owner.
- Job audit: FIX-2854 filed (`useSubscription` has no consumer, and the hand-off that would decide
  it was dropped). FIX-2855 filed (two crossing-bus doubles).
- Owner ask: (f) branch currency or a merge queue.

**Rejected:**
- *Sharpening `issue-implement` Step 5 from "narrows" to "narrows or reverses"* (b). The goal half
  is caught by (a)'s ratchet. The retained-spec half conflicts with `orchestration.md`'s *"no
  mandatory backlink updates"*, and one instance doesn't earn reopening that.
- *A goals rule to grade the default host, not only a double* (b). `goals/README.md` technique 1
  already says to assert on the user-visible surface. A reviewer named this instance at spec time.
  The rule was there, and it was applied as a sentence.
- *A check that `goal.md`'s control lines match `run.mts`* (a, #5482). Names drifted in no instance.
  Meanings drifted (`2:idle`'s 80 statements, the 2 s + 1 s pace), and only running the control sees that.
- *Filing #5469's open finding.* It's one row in a retained spec, under a blockquote that already
  corrects it. Recorded here.
- *A rule that a closure re-runs before it files* (d, FIX-2842). It did re-run, on 11-19, and found
  the fix. Cost: one log-only PR.

## Coherence

`orchestration.md` → *Repository content is canonical* says retained specs are *"historical intent,
not proof of shipped behavior"*, with *"no mandatory backlink updates"*. Codex asked on #5469 to
*"Supersede FIX-2426's timed-read contract"*, and #5469 added dated supersession notes to three
retained specs. The two conflict. The notes were cheap, and they sat in a PR that was amending the
closure spec, which is a live contract. Recorded for `audit-coherence`, not resolved here.

## Job audit

Run in this worker, once for each job that two or more issues grew. A job that one spec saw whole
is listed as cleared by that spec. Every addition considered, by job:

| Addition (PR) | Job |
|---|---|
| `ChangeBus`, `createInMemoryBus`, `withChangeBus` on the request and session stores, the `bus` stores slot (#4594) | carry a change notice from a write to its listeners; publish a change from a write |
| `createPostgresBus` / `PostgresBus` (#4598); `vercelPostgresStores` backs the bus slot (#4704) | carry a change notice from a write to its listeners |
| `listen.ts`, the listen-with-reconnect the request tail moved onto (#4598) | listen on a Postgres channel with reconnect |
| `crossesProcesses` and `onCrossingChange` (#4594); the Postgres ping (#4598); the socket's `crossing` frame and `/capabilities` `push` (#4597); the in-memory bus says it crosses (#4704) | say whether push covers a host |
| `topic()`, `WireTopic`, `ChangeKind`, `wireTopicKey` in contracts, re-exported by core, engine and client (#4594, #4597) | name what a screen watches |
| `enablePushDelivery`, the socket session, `PUSH_CLOSE_CODES`, `serve()`'s upgrade (#4597) | deliver notices to a browser |
| The mint, `POST /users/:userId/stream` (#4597) | authorize the topics a caller hears |
| `client.subscribe`, `useSubscription`; `client.stream()` and `UserSSECallbacks` removed (#4597) | tell a screen that what it shows changed |
| Resource and scope-state publish at `createExecutionContext` (#4613) | publish a change from a write |
| `useSession({ live })` hears scope notices; the live panels' scope driver (#4613) | tell a screen that what it shows changed |
| `getPatternPrefix` moved to `contracts/helpers` (#4613) | resolve a collection's storage prefix |
| `publishBoardChange` and `BOARD_NOTICE_SEAM` (#4616) | publish a change from a write |
| Shift Manager's `TasksPanel` and the labs' board watches (#4616); twelve app views on a notice, the read retry (#4647, #4664, #5170, #5171) | tell a screen that what it shows changed |
| `goals/lib/crossing-bus.mts` (#4594); engine conformance's `crossingBus` (#4594, changed in #4704) | fake a bus that crosses, in a check |
| `goals/lib/postgres.mts`, the two-process bootstrap (#4598, moved by #5280) | start a two-process Postgres check |

**Audits run:**
- **carry a change notice from a write to its listeners** (FIX-2426, 2427, 2545). Surface: the
  per-request `subscribeToEvents` on each store (with `flow_events` LISTEN on Postgres), the BullMQ
  `StreamBridge`, the `ChangeBus` (in-memory and Postgres), and the session stream's timed read. The
  first two end with one request and a topic outlives every request, so they are kept by epic D5.
  The timed read stays only where no bus crosses (D6, as amended by FIX-2545). Up by one, as the
  epic's debt line approved. Coherent.
- **publish a change from a write** (FIX-2426, 1506, 2429). One bus, with three publish points, one
  per write kind. Looks bad but is fine: each publisher names the kind its subscribers narrow on,
  and the board seam sits behind a symbol, so app code can't invent a topic. Coherent.
- **say whether push covers a host** (FIX-2426, 2427, 2428, 2545). One predicate, owned by epic ER-5:
  the bus's `crossesProcesses`, carried by the frame and read by the push hub's `covered`.
  `/capabilities` says whether push exists at all, which is a different question. Coherent.
  FIX-2545 widened what *crosses* means for the in-memory bus (Cursor on #4704), and D3's
  **Locks in** row still says the old answer (b).
- **tell a screen that what it shows changed** (FIX-2428, 1506, 2429, 2466). Surface on `main`: the
  session stream for items (`sessions.stream`, `followSession`, `useSession`), and `client.subscribe`
  for any topic. Over `client.subscribe` sit `useSubscription`, the workforce panels' internal
  drivers, and, from later epics, `client.live` and `useView` (FIX-2551, FIX-2623). Finding:
  `useSubscription` has no caller in the repo outside a goal comment. FIX-2551's DECISIONS says
  *"Whether `useView` retires it is FIX-2623's call"*, and FIX-2623's retained spec never mentions
  it. **Filed as FIX-2854.**
- **fake a bus that crosses, in a check** (FIX-2426, 2368, 2545). Two definitions,
  `goals/lib/crossing-bus.mts` and `crossingBus` in `engine/src/stores/testing/session-stream-conformance.ts`,
  plus inline doubles in `push-delivery.test.ts` and `change-bus-release.test.ts`. FIX-2545 had to
  change both definitions, and Cursor flagged the copies on #4594 and #4704. `engine/testing` doesn't
  export the conformance double, so goals can't share it. **Filed as FIX-2855.**

**Cleared by a spec:** name what a screen watches, deliver notices to a browser, and authorize the
topics a caller hears (FIX-2428's *Adds* table: composed from the user-stream route and its route
checks); listen on a Postgres channel with reconnect (FIX-2427: *"Extends, not a copy"*); resolve a
collection's storage prefix (FIX-1506; one function, now a subpath re-export for the zero-dependency
layer); start a two-process Postgres check (FIX-2368: *"Extended. Moved into `goals/lib`"*).

## Scoring the previous cycle's claims

This epic's specs and most of its build predate cycle 31 (11-15). Only #5469, #5471, #5475, #5480
and #5482 come after it.
- **Claim 1 (a spec set merged with the epic's `Open` line naming a fork):** out of sample. There
  was no spec-set PR, and the epic's DECISIONS reads *"Open: none."*
- **Claim 2 (goal checks off the PR):** 3 found stale on `main` (a), plus FIX-2723 in the same folder.
  None was a workflow red on `main`. All were hand-run goals nobody ran.
- **Claim 3 (a committed expectation that other PRs move):** 2. #5482 updated the counter and pace
  after FIX-2776, and #5480 rewrote `no-bus`'s line after FIX-2545. Baseline 5.
- **Claim 4 (findings posted after merge, above the bar, unanswered):** 1 (#5469's **Locks in**
  row). Baseline 3.

## Claims to test next cycle

1. **Goal checks stale on `main` when a closure re-runs them.** Baseline: 3 here. If the FIX-2225
   ratchet lands, it reads 0 for listed goals.
2. **A selection that runs nothing graded PASS.** Baseline: 2 (#5280). If the selector lands,
   it reads 0 for goals that use it.
3. **A bug-route change that reverses a retained decision, with no amendment in the same PR.**
   Baseline: 1 (FIX-2545). Read it next to the restatement findings that follow it.
