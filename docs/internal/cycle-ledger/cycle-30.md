# Cycle 30 — Webhook routing epic wrap (FIX-2471) (2026-11-11)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**One epic spec, four amendments, nine issue specs (one amended), eleven implementation PRs, over
nine days (11-02 to 11-11). Direction review was cheap: 19 rounds over 14 artifacts, and one of them
(FIX-2536's spec) took a third and fourth. The rework sat in three implementation PRs, and two
shapes explain most of it. Polling re-derives push's routing in a second copy, and the review found
the drift one case at a time (21 findings on #4973, three still open at merge). The subscription
row's transitions raced under concurrency (#4970, 19 findings), and there the fourth-pass rule from
cycle 29 worked: the primitive was named at pass 3. A spec merged 12 seconds after its first Codex
pass was requested, and that pass found a design-level gap that took an amendment.**

The classes, checked against the PRs:
- **(a) Two copies of one decision, found one case at a time** (`missed-edge-case`, felt off).
  FIX-2536's poll does not run push's routing. `pollSettle` re-decides who hears an event (ordinary
  against unmatched, the unheard read, the owner-run cap, the forward mark) beside routing's
  `finish`, with comments that say *"as routing decides it"*. #4973 took eight review passes (six
  Codex, two Gitar) and 21 findings (17 Codex, 4 Gitar), nearly all a way the poll and the webhook disagree: paging,
  a 304 on page one, ordering, whole-second timestamps, closers, check runs, repo-wide reviews,
  the cap. It merged with three open (the cap, repo-wide reviews, a second provider), filed at wrap
  as FIX-2647, FIX-2648 and FIX-2649. The first two then needed their own PR (#5070, four more
  passes). The parity harness (FIX-2650) is the test rung. The rung above it is one decision both
  paths call. **Filed as a fold: FIX-2690.** Recurs from LAB-116 (08-15, poll and webhook diverge
  on a reopen).
- **(b) An interleaving tail on one structure** (cycle 29 (b)). #4970 (FIX-2614, routines) took
  five Codex passes, three Gitar and one Cursor security pass, and 19 findings. About a dozen were the
  subscription row's transitions under concurrency: a pause against a delete, a resume against a
  reseed, an end landing between a write and its index entry. Pass 3 (7a9ccda, 11-09 04:52Z) named
  the primitive in its `@codex review` request: *"every subscription transition goes through one
  transition function applied with `updateStateWith` against the committed row"*. Two more cases
  came after it (a38c525), each fixed against that function. #4969's mention scanner (four passes on
  one code-span parser) moved to *"CommonMark's fence and span rules"* at its third pass on that
  structure. **Scored below as cycle 29's claim 1. Nothing new proposed.**
- **(c) `main` went red, and every open branch paid for it** (cycles 24, 27, 29 (c)). #5087 merged
  a test that passed `createFlowState` a keyed record. FIX-2626 had removed that form while #5087
  was in review, *"and the two merged without a CI run on the combination"* (#5110's body). #5110
  fixed it and #5108 carried the port. Nine PRs of this epic carry a comment explaining a red check
  as not theirs (shift-manager's registry copy and snapshot tests, a filesystem timing test,
  `coordinator-rounds` near its timeout (FIX-2652), the coordination sweep, Vercel's builder).
  **Owner ask, the fourth time: require branches to be current, or a merge queue.**
- **(d) A direction artifact merged before its first Codex pass** (cycles 18, 19, 24, 26, 27).
  #4968 (FIX-2630's spec) was open 43 hours with one Gitar pass. Codex's review started at 22:38:36Z
  (its summary comment) and the PR merged at 22:38:48Z. Codex posted at 22:41: publishing with only `hop` loses the shared
  message budget, so a fan-out spends past it (`design-off`). That took an amendment PR the next
  day (#5062, chain on the event). Two implementation PRs did the same with follow-up passes:
  #4971 merged at 23:14:34Z and Codex posted two P2s at 23:16, neither replied to, and both still
  hold on `main` (the worker's `saveRoutine` description omits the app's custom screens; a delivery
  doesn't check that the interest it was judged on is still the subscription's). #4970 merged seven
  minutes after a P2 with no reply. The code on `main` now includes the field it named. **Proposed below as a check,
  not text: this class has been an owner ask for five cycles.**
- **(e) Parallel specs against a moving epic decision** (`stale-restatement`, cycle 29 (d)). The
  four child specs drafted on 11-05 (FIX-2535 to FIX-2538) waited on the owner until 11-09. The
  routines amendment (#4945, 11-08) landed while they waited, and each took an alignment commit
  (*"routine vocabulary from FIX-2614"*, *"coordinator call is saveRoutine"*). FIX-2536's spec took
  a new decision (D3, config-seeded subscriptions) in its third round, and the owner rewrote its
  D1 and D2, and epic D10, eleven minutes after it merged (#4966). About eight alignment commits,
  one per spec. Cheap per spec. **Recorded. No change.**
- **(f) User-doc edits planned or made in a normal PR** (`docs-miss`). The rule and its CI check
  landed 11-05 17:39Z (0cc8e69f). Codex flagged FIX-2535's spec at 20:48Z for planning guide edits
  in its debt table, and all four 11-05 specs took a *"user docs follow at release"* commit within
  five minutes. #4970 edited a guide and a README on 11-09. Gitar flagged it and CI checks it.
  **The check is working. Recorded.**

**Proposal:** one check, for (d), described below for the owner. It is not built in this PR. No
tenet or BP sharpening: every class here is either already encoded (b, f), filed as a fold (a), a
repository setting (c), or below the bar (e).

**Method: scope.** FIX-2471's Linear children (GraphQL, read-only) and their PR attachments, plus a
GitHub search for `FIX-2471`. For each of 25 PRs: reviews, inline threads with their replies,
conversation comments and commits, all read through the REST API. Rounds on a direction artifact
count a review pass that a fold commit answered. Passes on an implementation PR count distinct
(reviewer, commit) pairs that carried a finding. Spec endpoints are merge times. Direction approval
is recorded on each spec's *How it got here*, not separately timed here. Times are UTC.

**Out of the sample:** #4814 (FIX-2578, another epic), #4976, #4979, #4981 (FIX-2631, vocabulary),
and Backlog children with no PR (FIX-2649, FIX-2650, FIX-2652 to FIX-2655, FIX-2670). FIX-2670's
work shipped inside #5108.

**Every act sits behind the shared `jhoffner` login**, so this entry doesn't say who merged what.

### Direction artifacts

| PR | Rounds | Endpoint | Shape of the review | Felt off? |
|---|---|---|---|---|
| [#4515](https://github.com/fixpoint-labs/flow-state-dev/pull/4515) epic | 1 | merge 11-04 01:48Z | Second look, Codex and Cursor. Two findings reached by two reviewers each: the dedupe key collides under fan-out (D4 + D9), and the 5× bar is circular on a mock model. Also: credentials across users, Q1 open past the gate. Cursor's seven notes recorded | yes (dedupe) |
| [#4662](https://github.com/fixpoint-labs/flow-state-dev/pull/4662) amend | 1 | merge 11-04 02:08Z | Owner's four answers recorded. Cursor: *Open: none* above cards still in open-gate shape, a stale `aria-label` | no |
| [#4675](https://github.com/fixpoint-labs/flow-state-dev/pull/4675) amend | 1 | merge 11-04 14:37Z | ER-7 opened, cursor placed. Cursor ×6: the fork restated three times, a recommended horn read as signed | no |
| [#4945](https://github.com/fixpoint-labs/flow-state-dev/pull/4945) amend | 1 | merge 11-09 02:37Z | Routines (D12). Codex and Gitar: coins "routine" with no glossary entry (`docs-miss`); added in the PR | no |
| [#4966](https://github.com/fixpoint-labs/flow-state-dev/pull/4966) amend | 1 | merge 11-09 14:27Z | Owner: one poll per user and thread. Gitar: epic D10 still lists per-repo batching | yes (e) |
| [#4673](https://github.com/fixpoint-labs/flow-state-dev/pull/4673) 2534 | 1 | merge 11-04 18:26Z | Second look and Cursor ×7: the screening part undefined, the cursor row against the epic's seam (led to #4675), `sender` against `senders` | no |
| [#4810](https://github.com/fixpoint-labs/flow-state-dev/pull/4810) 2535 | 2 + alignment | merge 11-09 02:40Z | r1 Codex: user-doc edits in the debt table (f). r2 Codex: occurrence ids collide across repositories. Gitar: the id's prefix | no |
| [#4811](https://github.com/fixpoint-labs/flow-state-dev/pull/4811) 2536 | **4** | merge 11-09 02:40Z, then #4966 | r1 Codex: retain accepted deliveries; second look: two places build more than the case needs. r2 Gitar: the held mark has no bound; Codex: a 304 drops pending retries. r3, after D3 joined: D3's poll ends `cfg_` entries, against ER-5. r4: names a `saveRoutine` that doesn't exist yet | yes |
| [#4809](https://github.com/fixpoint-labs/flow-state-dev/pull/4809) 2537 | 1 + alignment | merge 11-09 02:41Z | Codex clean. Second look, restraint and reuse folded | no |
| [#4808](https://github.com/fixpoint-labs/flow-state-dev/pull/4808) 2538 | 2 | merge 11-09 02:42Z | Second look: two premises to run before the gate. A POC (REFUTED: no tool swap; D2 holds on the board's write). r2 Gitar: the POC README still said "adopt C" | no |
| [#4946](https://github.com/fixpoint-labs/flow-state-dev/pull/4946) 2614 | 1 | merge 11-09 02:39Z | Gitar: D1 assumed `subscribe` could run off-session (bound to its caller); reseeding through today's writers undoes a pause | yes |
| [#4968](https://github.com/fixpoint-labs/flow-state-dev/pull/4968) 2630 | 1 + post-merge | merge 11-10 22:38:48Z | Gitar: wrong file for the budget. **Codex's first pass posted 2 min after merge**: hop alone loses the shared budget (d) | yes |
| [#5062](https://github.com/fixpoint-labs/flow-state-dev/pull/5062) 2630 amend | 1 | merge 11-11 02:15Z | Chain on the event. Cursor ×6: the D2 title, the footer and the Adds table still said one field | no |
| [#5072](https://github.com/fixpoint-labs/flow-state-dev/pull/5072) 2539 | 1 | merge 11-11 02:17Z | Second look and Cursor ×8: an invented `operatorTokenFor`, the host matrix, two database files must be two files | no |

### Implementation

| PR | Passes (reviewer × commit) | Findings | Shape of the rework | Felt off? |
|---|---|---|---|---|
| [#4687](https://github.com/fixpoint-labs/flow-state-dev/pull/4687) 2534 | 4 (Codex) | 7 | Delivery reservation: dedupe in flight, reserve atomically; closure past filters; every listed screen; an accepted, untaken delivery; tenant in the keys | no |
| [#4969](https://github.com/fixpoint-labs/flow-state-dev/pull/4969) 2535 | 5 (3 Codex, 2 Gitar) | 6 | 4 on the mention scanner's code spans (b); an interrupted routing answers 503; a PR closed before it is followed | no |
| [#4973](https://github.com/fixpoint-labs/flow-state-dev/pull/4973) 2536 | **8** (6 Codex, 2 Gitar) | 21 | (a). Three open at merge, filed at wrap (FIX-2647, FIX-2648, FIX-2649). A paging helper named at pass 3, the close invariant at pass 5 | yes |
| [#4971](https://github.com/fixpoint-labs/flow-state-dev/pull/4971) 2537 | 6 (3 Codex, 2 Gitar, 1 code scanning) | 7 | Nested fence tags in a quoted interest; a refusal read from a reason's words; a rejected async screen. **2 P2s after merge, open on `main`** (d) | no |
| [#4972](https://github.com/fixpoint-labs/flow-state-dev/pull/4972) 2538 | 4 (2 Codex, 1 Gitar, 1 code scanning) | 6 | An `observe` confirm must not expire into a yes; the inferred marker safe from caller metadata; retry after a yes. 2 unused variables | no |
| [#4970](https://github.com/fixpoint-labs/flow-state-dev/pull/4970) 2614 | **9** (5 Codex, 3 Gitar, 1 Cursor security) | 19 | (b): about 12 on transitions, primitive at pass 3. Security High: two users' copies of a declared routine shared one index key (fixed, test first). User docs edited (f). One P2 at merge minus 7 min | no |
| [#5087](https://github.com/fixpoint-labs/flow-state-dev/pull/5087) 2630 | 5 (2 Codex, 1 Cursor, 2 Gitar) | 11 | 6 on one structure: a service routing's lifecycle at dispose (three fixes in 8 min). Cursor ×4 recorded. Merged red against FIX-2626 (c) | no |
| [#5108](https://github.com/fixpoint-labs/flow-state-dev/pull/5108) 2539 | 5 (1 Codex, 2 Cursor, 2 Gitar) | 13 | Gitar: the operator's token gated on a userId the caller supplies (BP-031, `philosophy-drift`), fixed. Cursor security ×2 High filed by the owner's call (FIX-2686, FIX-2687). The Engineering Manager lacked the routine tools | no |
| [#5070](https://github.com/fixpoint-labs/flow-state-dev/pull/5070) 2647/2648/2651 | 4 (Gitar ×2, Codex, Cursor) | 6 | A rate-limited 403 read as nothing new; issues kept when pulls are forbidden. 3 declined | no |
| [#5093](https://github.com/fixpoint-labs/flow-state-dev/pull/5093) 2674 | 1 (Cursor) | 2 nits | One line, found by the closure's wiring | no |
| [#5110](https://github.com/fixpoint-labs/flow-state-dev/pull/5110) 2630 | 0 | 0 | (c)'s fix | no |

**Where the bugs came from.** FIX-2674 (clock routines never fired under `serve()`) was found by
FIX-2539's closure wiring, not by review: the closure is doing its job. The two High security
findings on #5108 are a class the labs exposed (a turn woken by outside text holds the worker's
whole tool set) and are owned by FIX-2686 and FIX-2687.

**Load.** Direction: 19 rounds over 14 artifacts (1.4 each; cycle 29: about 35 over 19, 1.8). One
artifact past two rounds (cycle 29: two). Implementation: 51 passes over 11 PRs, 98 inline findings; #4973
and #4970 are 17 passes and 40 findings of it. A pass is a distinct (reviewer, commit) pair
that carried an inline finding, code scanning and Cursor's security pass included.

**Classes.** Direction (63 inline findings, plus the second-look comments): `nit` and
`over-engineered` lead (Cursor's simplify notes, recorded below the bar). Then `stale-restatement`,
10 findings (#4662 ×3, #4675, #4673's cursor row, #4966, #5062 ×3, #4808's README) plus (e)'s
alignment commits; `missed-edge-case`, about 7; `spec-ambiguity`, about 6; `design-off`, 6 (the
epic's dedupe key, credentials and circular bar; #4811's ER-5 break; #4946's off-session
`subscribe`; #4968's budget); `docs-miss`, 2 (the glossary entry; (f) on #4810). Implementation (98):
`missed-edge-case` about 77, the 8 security findings included; `nit` and `over-engineered` about 18
(Cursor's simplify notes, code scanning, one BP-006 label); `docs-miss` 2 (#4970's guide edit and its
release note); `philosophy-drift` 1 (BP-031 on #5108). Reading labels: `overclaim` on 1 (#5072's
`operatorTokenFor` read as an existing helper).

**design-off: 6, all on direction artifacts, all folded in their round except #4968's, which
arrived after merge.**

**Claims (looped / settled / verdicts):** 0 / 1 / REFUTED. FIX-2538's spec ran its tool-swap
premise as a POC in round 1, before anyone argued it. REFUTED is the win case: the spec dropped
the swap.

**Reviewer exhaustion:** none found. **Merged with a finding open:** #4973 (3, filed at wrap), #4971
(2, unfiled, open on `main`), #4970 (1, since fixed), #4968 (1, amended by #5062).

**Epic row:**
`ways per job: bring an outside event to a session 1→2 (a binding's sessionId, kept for Stripe,
Slack and custom by Q5; subscriptions, which take push, poll and publishEvent) · start an internal
entry host-side as a principal 1→2 (fireWakeThrough; fireOwnerRunThrough, which routeServiceEvent
fires; one dispatchInternalAs body) · name the index a flow's schedules are ticked from 1→2 (the
collection's mirror; the flow's schedules.index, read by serve(); FIX-2691) · walk a due index on
a host 2→2 (Vercel's handler now runs scheduled's runScheduleTick, which node serve() also runs;
BullMQ's own) · see and stop what runs as you 1→1 (listSchedules → listRoutines) · write a
standing instruction 2→1 (saveSchedule and the subscribe tool → saveRoutine) · decide whether an
event reaches a subscriber 0→1 (one screen chain: config, custom, interest) · route a webhook
delivery 1→2 (on, service; Q5) · forward an unheard event to a coordinator 0→1 · act on a pull
request a run records 0→1 (whenPullRequestRecorded) · send a message into a session 1→1 (the
service sender on sendMessage's exempt path)`

## (d) A check, not an ask

| Cycle | Instance | Gap | Cost |
|---|---|---|---|
| 18, 19 | 6 of 42 artifacts merged before their first automated review | — | baseline |
| 24, 26 | a direction artifact each | — | recorded |
| 27 | #3771 | merged 4 min before its requested third pass; three P1s | fixed in #3795 within the hour |
| 30 | #4968 | merged 12 s after its first Codex request | `design-off`, an amendment PR |
| 30 | #4971, #4970 | merged 2 min and 7 min around follow-up passes | 2 findings open on `main`, unfiled |

Five cycles of the same answer (*"an owner ask, not text"*) is the signal that the answer sits at
the wrong rung. The merge is the owner's act, so no agent rule reaches it; a required status does.
Codex's own summary comment carries the state: `codex-review-state:v1 {"code_review":{"commit_sha":
…,"status":"completed"}}`. **Proposed (rung 3, for the owner):** a workflow on `issue_comment` and
`pull_request` that sets a status `codex-review` to pending while that state is anything but
`completed`, and to success when it is, plus branch protection requiring it. That gives three
results:

- It would have held #4968, but only just: the review started 12 seconds before the merge, so the
  status has to go pending within that window. #4968 is the case to measure it on.
- It does not ask for a pass per push. A PR whose last requested pass completed stays green, which
  keeps `orchestration.md`'s *"Ask Codex again only when you have a concern"*.
- It does not catch #4971 or #4970 if the follow-up request had not yet produced a state change
  when the merge happened. Those were seconds to minutes. A pending state set on the `@codex review`
  comment itself, before Codex answers, closes that. The workflow should set pending on the request
  comment, not wait for Codex's reply.

What it costs: one workflow file and one protection rule. What being wrong costs: a merge blocked
until Codex answers, which on a busy day is minutes.

## Enforcement, rung by rung

- **(a)** Rung 1: one decision for push and poll, FIX-2690. Rung 4 is FIX-2650, already filed.
  Both stay: the harness checks normalization too, which one decision doesn't cover.
- **(b)** Rung 5 already written (`issue-implement` 10.3, the fourth-pass count, 5bec3f6c, 10-30).
  Every branch here forked after it (checked by ancestry on #4687, #4973 and #4970's heads). It fired
  early on both chains. Scored, nothing new.
- **(c)** A repository setting. Owner ask, fourth cycle.
- **(d)** Rung 3, proposed above.
- **(e)** Rejected as text, as in cycle 29. One commit per spec.
- **(f)** Rung 3 exists (`user-docs-scope.yml`). It caught #4970.

## Accepted and Rejected

**Accepted:**
- (a): FIX-2690 filed (the who-hears decision, once). Job audit: FIX-2691 filed (the index, once).
- (d): the `codex-review` status, proposed here for the owner; not built in this draft.
- Owner asks: (c) branch currency or a merge queue. Unfiled open findings from (d): #4971's two P2s
  (the worker's routine tool omits custom screens; a delivery doesn't check the interest it was
  judged on).

**Rejected:**
- *A tenet or BP for (a).* The fold encodes it. A sentence saying "share the decision" is the rule
  that already exists as question 7, and it can't fail.
- *A BP for (d).* Five cycles of prose and asks; it moves up a rung instead.
- *A spec rule against drafting during an owner wait* (e). One commit per spec.
- *Scoring the closure's finds as rework.* FIX-2674 is the closure working.

## Job audit

Run in this worker, once per job that two or more issues grew; a job one spec saw whole is listed
as cleared by that spec. Every addition considered, by job:

| Addition (PR) | Job |
|---|---|
| `subscribe`, `unsubscribe`, `defineSubscriptionServiceFlow`, the normalized `SubscriptionEvent` (#4687) | bring an outside event to a session |
| `githubServiceFlow`, the webhook transport's `service` route, `isWebhookServiceConfig` (#4969) | bring an outside event to a session; route a webhook delivery |
| `followPullRequest`, `whenPullRequestRecorded`, `pullRequestRecordedOf`, `followRecordedPullRequests` (#4969) | act on a pull request a run records; write a standing instruction |
| Polling: `SubscriptionPolling`, the poll schedules, `pollSettle` (#4973) | bring an outside event to a session |
| `startScheduleTick`, `runScheduleTick` in `scheduled`; `serve()`'s tick; Vercel's handler on it (#4973) | walk a due index on a host |
| `ScheduleDueEntry`, `ScheduleDueSource` in core (#4973) | walk a due index on a host |
| The `interest` and `custom` screens, `refusedOnContent` (#4971) | decide whether an event reaches a subscriber |
| `unmatched`, `forwards`, `inferredWork` (#4972) | forward an unheard event to a coordinator |
| `listRoutines`, `saveRoutine`, `pauseRoutine`, `deleteRoutine`, `createRoutinesCapability`, `declaredRoutineKey`; `listSchedules` and `LIST_SCHEDULES_ACTION` removed (#4970) | see and stop what runs as you; write a standing instruction |
| `publishEvent`, `internalServiceFlow`, declared topics, the seam's `InternalServiceRoute` (#5087) | bring an outside event to a session |
| `fireOwnerRunThrough`, `routeServiceEvent`, `dispatchInternalAs` (#4687) | start an internal entry host-side as a principal |
| `serviceSender`, `deliveryMessageId` (#4687) | send a message into a session |
| The routines index on the roster flow's `schedules` (#5093) | name the index a flow's schedules are ticked from |
| The lab hosts' wiring, three copies (#5108) | name the index a flow's schedules are ticked from (glue; FIX-2539 keeps it until a fourth copy) |
| Service-flow code moved to `src/service-flows/` (#5070) | none (a move) |

**Audits run:**
- **bring an outside event to a session** (four issues). Surface: a binding's `sessionId`, and
  subscriptions with three ingestions (push through the webhook's service route, poll, and
  `publishEvent` through the dispatch seam), all into `routeServiceEvent`. One way per provider by
  Q5. Finding: push's `finish` and poll's `pollSettle` each keep the who-hears decision. **Fold,
  FIX-2690.** Looks bad but is fine: `publishEvent` beside `sendMessage`. One names a recipient and
  the other names none, and FIX-2630's spec compared them.
- **start an internal entry host-side as a principal** (FIX-2534, FIX-2630). Surface:
  `fireWakeThrough`, `fireOwnerRunThrough`, `routeServiceEvent`, all over `dispatchInternalAs`
  (`engine/src/durability/dispatch-internal.ts`). Coherent: one body, three callers that differ in
  what they check first.
- **name the index a flow's schedules are ticked from** (FIX-2536, FIX-2614, FIX-2674, FIX-2539).
  Surface: `defineScheduleCollection({ index })` mirrors writes; the flow's `schedules.index` is what
  `serve()` ticks; `hireWorkforce`'s `routines.index` and `routines.poll.index` feed both. The first
  two are kept by hand at `scheduled-work.ts` ~140 and ~216, and again for polls. FIX-2674 was the
  pair disagreeing. **Fold, FIX-2691** (FIX-2649 is a separate case of an index serving one flow).
- **write a standing instruction** (FIX-2535, FIX-2536, FIX-2614, FIX-2538). Surface: `saveRoutine`
  (roster action and worker tool), `followPullRequest` (a coding task, automatic), the declared seed,
  all writing through `subscribe`, the one writer (ER-5). Coherent. Looks bad but is fine: the roster
  and worker verb sets are one `verbBlocks` with two descriptions. #4971's open P2 (custom screens on
  the roster's description only) is a bug in one description, not a second way.
- **decide whether an event reaches a subscriber** (FIX-2534, FIX-2537). One chain; FIX-2537 extended
  FIX-2534's and reused `fitCallFailed`, fencing off `fit-check`'s generator fallback. Coherent.
- **walk a due index on a host** (FIX-2536). FIX-2536 moved Vercel's tick body into `scheduled`'s
  `runScheduleTick` and ran `serve()` on it: a fold done, 2→2.

**Cleared by a spec:** route a webhook delivery (FIX-2535, Q5, two ways on purpose); forward an
unheard event to a coordinator (FIX-2538); act on a pull request a run records (FIX-2535 D2); see
and stop what runs as you (FIX-2614); send a message into a session (FIX-2534, the exempt path).

## Scoring the previous cycle's claims

- **Claim 1 (the fourth-pass answer):** 2 of 2 chains with four or more passes named their primitive
  by the fourth (#4970 at pass 3, #4969's scanner at its third). #4973's chain is two structures: the
  paging helper at pass 3 and the close invariant at pass 5; the parity primitive was named only at
  wrap (FIX-2650). Up from 1 of 3. All branches carried the rule.
- **Claim 2 (ports of `main` fixes per epic):** 1 port (#5110 into #5108), 9 PRs with a red check
  explained as `main`'s. Down from 8 ports, and the red windows did not stop.
- **Claim 3 (alignment commits on parallel specs):** about 8, all from one amendment landing on four
  specs that were waiting on the owner. Baseline about 20, then 0.

## Claims to test next cycle

1. **Merged before the requested Codex pass.** Baseline: 1 direction artifact and 2 implementation
   PRs here. If the status lands, it should read 0.
2. **Two copies of one decision.** After FIX-2690, a change to a routing rule touches one function.
   Count review findings on poll/push divergence in the next PR that changes routing. Baseline: 21
   on #4973.
3. **Open findings at merge, unfiled.** Baseline: 2 (#4971).
