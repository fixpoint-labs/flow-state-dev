# Epic-spec — The harness manager

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Nothing has yet driven one real issue end to end through the Conductor seam.
Every piece under that seam works on its own — the board claims and routes, `claudeCodeAgent`
runs, `startDetached` spawns, and a detached run settles its own task row — and no one has put a
real issue through the join between them. This epic does exactly that, once, on real work, and
treats the join as the thing under test rather than the parts. The hardest case is **a run that
asks something on its first turn**, before anything has been observed about it; this set is
designed against that case, not against the happy one.

> **Outcome** — A real issue in this repo goes from a task row to an open PR driven by
> Conductor rather than by a person in a Claude session, including at least one point where
> the run needed a decision and got one without anybody opening a terminal.
>
> **Proof** — LAB-139's goal check: one real Linear issue —
> **[FIX-1166](https://linear.app/fixpoint-labs/issue/FIX-1166)**, *CLAUDE.md says skills live in
> `agents/skills/` and the real path is `.agents/skills/`* — driven from a conductor task row to
> an open PR, where the run posted a question to the inbox, the answer went back in, and the run
> finished on it. Readable off the run's own `runs/*` row (which carries the
> `{requestId, suspensionId}` pair the resume action addresses — theme 5), the inbox row, and the
> PR. One file, one line, zero blast radius, and outside every package this epic touches: a join
> proof wants a fix small enough that nothing about the fix can explain a failure. *(It replaces
> FIX-1177, which is stale — that describes a defect on PR #1297's branch, which closed unmerged;
> `packages/claude-code/src/sdk/headless.ts` does not exist and `maxTurns` is forwarded straight
> into the query options at `agent.ts:443`.)*
>
> **What the Proof does not show** — two limits, both deliberate, stated so it is not oversold:
> - **The ask is forced, not spontaneous.** LAB-139's implement prompt *requires* the run to
>   confirm one named decision through the inbox before it opens the PR. That is a chosen
>   experimental design: it isolates the variable under test — the channel, not the model's
>   judgment about when to reach for it. Whether a run asks unprompted is the *next* epic's
>   evidence, not this one's. FIX-1166 makes this weigh **more**, not less: the fix is one line,
>   so almost none of this run's value is the fix — the ask *is* the experiment, and it is staged.
> - **The question can be open, but not for long.** Parking is now **durable**: the run suspends
>   and its `SuspensionRecord` survives a restart, which is more than the design this epic opened
>   with offered. What goes untested is a *long*-open question — a parked task row stays
>   `in_progress` and **holds a board slot** for as long as the person takes, and nothing here
>   runs that against the board's lease and reclaim timers. **LAB-139's spec answers that**; a
>   green Proof is not evidence that an overnight question survives.
>
> **Lead measure** — the set's goal-proven issues, named: FIX-150 · LAB-138 · LAB-139.
>
> **Not doing** — the mail/relay layer (FIX-1197 owns it; questions ride the hot path here, a run
> parking itself and being woken in-process, theme 5 — **the relay is not on this round trip's
> critical path**, and stays out of scope for its own reasons rather than as a blocker) · the
> parked-task cold path (`pending feedback` + a settle-time watch) · resume-with-continuity for a
> steered run (FIX-1179 — a steer restarts the coding agent with a re-stated prompt, and that is
> accepted) · the spec and review phase records and the durable approval gate between phases · the
> coordinator's classify-and-route generator (an answer names its inbox row explicitly) · the
> manager and architect roles · more than one issue on the board at a time · any inbox UI ·
> the measurement instrument · the workforce-layer question.
>
> **Kill line** — if the join does not hold — a detached worker cannot post an inbox row and
> be continued from it, or the board cannot settle a run the manager watched — then the bet
> that the coordinator stays small because the open questions live in a resource has failed at
> its first real test, and the design goes back to shape rather than forward to the phase
> machine.

**Holistic necessity.** Three issues, and the honest question is whether it is two. LAB-138
(dispatch-and-settle) and LAB-139 (ask-and-answer) are separable on paper, and they are two
Linear rows today. But they share **one manager loop**, and LAB-139's goal check is the only
end-to-end evidence *either* of them produces — LAB-138 finishing alone proves a run can be
watched and settled, which is a part, and this epic exists because parts are what we already
have. So the split buys two review surfaces over one body of work, and the case for keeping it
is that the ask-and-answer path is where the design bet actually gets tested and deserves its
own spec rather than a section in someone else's. **Kept as two, with the seam named**: if
LAB-139's spec finds it cannot describe its own loop without restating LAB-138's, that is the
signal they should have been one issue, and merging them then is cheaper than discovering it
at implementation. *(Re-raised by both automated reviews and ruled on by the product owner —
§5, decided.)* FIX-150 is not in question and is **not on the Proof's critical path** (theme 4).
It buys this epic one line: a run's files come back as state and the agent is fenced into its
workspace — which is *not* what LAB-134 delivered, since `claudeCodeAgent({ recordWork: true })`
shipped the *index* of a run's file writes and left the **contents** out of scope.

**Which project objective this serves.** `docs/objectives.md` Goal 1, *validate through real
usage*. This is the framework driving its own development on real models — the most demanding
real workload we have, exercising the task board, detached child sessions, shared-lineage
resources and durable state on a multi-turn run rather than a synthetic one. It also closes a
named gap in the corpus: **no goal check today runs a development process end to end**; every
green check certifies a part.

**Context.** The design this epic implements is the **Conductor Atlas**, a living design
artifact: <https://claude.ai/code/artifact/f926ff40-e96d-4fd1-87f5-5c7ca05ab3ae>. This epic is
its **open thread 1** — *"nothing has driven one real issue end to end through this seam"* —
and sections 4, 5, 6 and 7 are the substance. The Atlas's per-element status tables say which
APIs exist today and which are proposed; **treat that as a starting inventory, not as
verified.** [LAB-68](https://linear.app/fixpoint-labs/issue/LAB-68/conductor-the-development-orchestration-system-epic)
(Done) is the previous generation of this work and delivered layer zero: a coding run is an FSD
session, and its file writes and todos are readable as state.

**Two inventory corrections, checked in source rather than assumed.** First, a detached run's row
is **not** settled through `RequestHost.settleParentTask`. That verb refuses by name
(`no-parent-task`) unless a host wires `inputs.parentTask`, and `createFlowState.ts` leaves it
unwired on purpose. The real path is `packages/orchestration/src/task-board/detached-runner.ts`,
where the Workstream settles its own task through the same ticket-fenced recorders the inline
drain uses — *"not a second settlement path."* **LAB-138 builds against the runner's fenced
write-back** — wanting the verb instead means budgeting the `parentTask` wiring as framework
work, not assuming a seam. Second — and this is the same correction seen from the failure side —
**the fenced write-back is the settlement path, but it is not a failure detector.** A terminal
SDK error subtype (`error_max_turns`, budget exhaustion) is an *outcome*, not a throw:
`claudeCodeAgent` returns normally with `status: "errored"` (`sdk/agent.ts:353-362` docblock;
`agent.ts:553-556` constructs and returns it), the runner takes its success path, and the task
and the Workstream request both settle **`completed`** for a run that produced no PR — with
normal task retry never firing. So **a handle-status check must precede settlement** (theme 5).
Without it the manager's "settle, retry, or wait" decision can never observe a failure, which is
the one job that step exists to do.

## 2. Themes & long-horizon direction

1. **The coordinator stays small on purpose.** The bet under test is that the session a person
   talks to holds only the *currently-open questions*, because the run's memory lives in
   resources rather than in a conversation. Every design call in this set is judged against
   whether it keeps that true. An issue that finds itself wanting to hold run history in the
   coordinator has hit this theme, not a local design problem — comment up on the epic PR.

2. **One manager, one record — a constraint this epic honours, not a claim it tests.** The
   Atlas's §7 argument is that phases differ in a *prompt builder*, a *done-condition predicate*
   and a *readable set*, not in three block sequences. This epic writes the manager and
   **exactly one record (implement)** — and writing one record **cannot falsify** "a fourth
   phase costs a record, not an adapter." At best it yields a non-regression constraint; at
   worst an implement-shaped manager that nothing here would catch. So the theme binds as a
   constraint: **a manager that cannot be pointed at a different record without editing the
   manager has broken it.** The claim itself is the *next* epic's to test, and no evidence from
   this one should be cited for it.

3. **Gaps go in the framework, never in conductor** — LAB-68's standing rule, carried forward.
   The tell that this has gone wrong is **a capability only conductor can call**. When an issue
   needs something the framework doesn't have, the work is to add it to the framework layer,
   not to grow a conductor-shaped shortcut. This is why the inbox is built as an ordinary
   user-scoped resource collection rather than as a new capability (§5, decided).

4. **Sequencing — and FIX-150 is not a dependency.** LAB-138 lands before LAB-139: the
   ask-and-answer path needs a run that is already watched and settled. They can be *specced*
   in parallel; they cannot merge out of order. **FIX-150 runs on its own track, and the Proof
   does not wait on it.** LAB-138 provisions the run's working directory with a plain
   `git worktree add` and hands it down — a seam named on purpose — until FIX-150's PR (c)
   subsumes it, at which point the manager adopts the workspace projection with no reshaping.
   Nothing in this set is *blocked by* FIX-150: an accepted deferral and a blocking dependency
   read identically in a dependency column and mean opposite things, so the distinction is
   stated here rather than left to be inferred. **Handing that directory down needs a per-run
   `cwd` seam, and it is framework work inside LAB-138** — a sibling of FIX-1179's resume-id
   input, not a reason to re-couple FIX-150. It is a choice of surface, not a missing capability:
   the SDK surface — the one carrying detached dispatch, `recordWork` and the session handle —
   forwards no `cwd` (`sdk/work-recorder.ts:109-112` says so outright), while the CLI dispatch
   path *does* take one per dispatch (`cli/dispatch.ts:39-40,84` → `pty-exec.ts:134`). LAB-138
   picks the surface on that evidence. Left unstated, the Proof run edits the conductor's own
   checkout instead of the run's workspace.

5. **A normal return always settles the task `completed` — so park by suspending, and check the
   handle before settling.** `buildDetachedRunner`'s body is unconditionally
   `.step(worker).tap(recordSuccess)`, so any successful return calls `collection.complete()`.
   Three consequences, all settled against the real path (§1, §5), and every issue here builds
   against them. **To park:** a worker calls `ctx.suspend({ reason: "human_input", … })` rather
   than returning — `SuspensionError` propagates past the `.tap()`, `recordSuccess` never runs,
   the task row stays `in_progress`, and the suspension record is durable. Holding the task in
   `awaiting_review` and returning does **not** work: the row is stomped to `completed` in the
   same request that parked it. **To wake:** a purpose-built **server-side** action reads
   `{requestId, suspensionId}` off the run row and calls `continueRequest()` in-process;
   `runs/*` carries that pair beside the `requestId` it already holds. **To settle:** check the
   run handle's status first — a terminal SDK error returns normally as `status: "errored"`, so
   settling on a normal return alone reports a failed run as completed.

6. **The operator's answer never travels the public caller-addressed route, and the allow-list is
   never widened.** `packages/engine/src/routes/public-reentry.ts` places `WORKSTREAM_SOURCE` in
   `NEVER_PUBLIC_REENTRY_SOURCES`, no host option overrides it, and
   `test/public-reentry-opt-in.test.ts` covers it. The reason is in the source and it is
   deliberate: a detached dispatch is not caller-addressed at all, so re-entering it from a public
   route would run it with caller-supplied input — BP-031, exactly. An implementer meets this as a
   **404** from `/api/flows/:kind/requests/:id/resume` on a request that is provably live and
   resumable in-process. That 404 is the guard doing its job. **An issue that reaches for the
   allow-list has hit this theme, not a bug** — theme 5's in-process resume action is the route.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [LAB-138](https://linear.app/fixpoint-labs/issue/LAB-138/the-harness-manager-a-task-row-becomes-a-watched-settled-coding-run) | The manager loop — a task row becomes a watched, settled coding run. Provisions the run's working directory and owns the **per-run `cwd` seam** that makes handing it down possible (theme 4). Settles on a **handle-status check**, not on a normal return (theme 5) | spec | — | — | Needs spec |
| [LAB-139](https://linear.app/fixpoint-labs/issue/LAB-139/a-run-that-needs-a-decision-can-ask-for-one-and-be-answered) | A run that needs a decision can ask for one, and be answered. **Carries the epic's Proof** (FIX-1166). Blocked by LAB-138. Builds theme 5's park-and-wake — `ctx.suspend()` plus an in-process resume action — and answers what a parked row's held board slot does against the board's lease and reclaim timers | spec | — | — | Needs spec |
| [FIX-150](https://linear.app/fixpoint-labs/issue/FIX-150/workspaces-if-validated-workspacerunner-block-and-virtual-filesystem) | Workspaces — the file-projection component. Large, three PRs (a component · b shell-tool migration · c coding-agent path). Subsumes FIX-998. **Own track — carries no dependency edge into the Proof** (theme 4) | spec | [#1345](https://github.com/fixpoint-labs/flow-state-dev/pull/1345) — **approved** | — | Needs implementation |

*FIX-150 is on team **flow-state**, not Labs; it is a sub-issue of LAB-140 across teams. Its
spec gate is already passed (`spec approved` on #1345), so it enters at implementation. It is a
member of this set because the manager will adopt its projection — not because anything here
waits on it (theme 4).*

## 5. Open cross-cutting questions

- **~~Can a detached worker's task be parked in `awaiting_review` and continued by a later
  request?~~** *Resolved: **no** — and there is a path that works.* Raised by review on this PR
  (#1362), settled by POCs on the real path — real `taskBoard()`, durable user-scoped collection,
  real SQLite, and the real HTTP surface — rather than by a third round of argument.
  - **The claim is confirmed, for a blunter reason than the one given.** `awaitReview` succeeds
    (`in_progress → awaiting_review` is legal), but `recordSuccess` then calls
    `collection.complete()` and `awaiting_review → completed` is also legal, so **the row is
    stomped to `completed` in the same request that parked it**; a later `resumeFromReview` threw
    *"illegal status transition for task 'question-1': completed → pending"*. **The blocker is
    auto-completion, not visibility** — the request-scoped task mirror was the reviewer's
    reasoning and it is not the problem: a second request's fresh resolution read the terminal
    row correctly. Nor is it a framework bug; `recordSuccess` is unconditional by design and the
    design recorded here did not fit that contract.
  - **`ctx.suspend()` parks properly.** Child request `status=suspended, source=workstream`, task
    row afterwards `in_progress`, `recordSuccess` never reached.
  - **The shipped public resume route refuses it, and that guard stays** (theme 6). The same
    requestId that 404s is proven live and resumable via `continueRequest()`, so the 404 is the
    guard, not a missing record. `continueRequest` carries no source gating — the check lives only
    in the HTTP handler — so an in-process action wakes the run.
  - **What changed:** themes 5 and 6, the hot-path entry below, LAB-138's and LAB-139's index
    rows, and §1. **The objective did not.** A mechanism was replaced, not an outcome, so this
    does not return to the gate.
  - **Routed, not answered here:** a parked row holds a board slot for as long as the question is
    open, and an open question can outlive the board's lease and reclaim timers. That is
    **LAB-139's spec** to answer.

- **Where conductor's own code lives.** Both LAB-138 and LAB-139 write into the same place and
  neither can settle it alone, so it is the epic's to answer. Raised at epic drafting. **Blocks
  nothing yet** — it blocks LAB-138's spec at the point where that spec has to name a package.
  **The product owner's call, live on the epic PR ([#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362))**,
  where the fork is put in full: a published `@flow-state-dev/conductor` with a release story,
  or an unpublished home nothing outside this repo can depend on. Recommendation: **unpublished,
  concretely `labs/conductor/`** — an existing pattern rather than an invention, since `labs/`
  already holds `knowledge-hub` and `trading-desk`, and `labs/knowledge-hub/src/inbox.ts`
  already implements the inbox as a plain user-scoped collection.

- **~~Do LAB-138 and LAB-139 merge into one issue?~~** *Decided: no — two, as composed.* Both
  automated reviews on this PR pushed to fold them (one "definite", one "lean fold"); **the
  product owner ruled against**, because §1's necessity check already interrogates the split and
  names a concrete reconsideration trigger. That trigger is the only route back to this.

- **~~Do questions ride the hot path, or wait for the relay layer?~~** *Decided: the hot path* —
  but by **parking the run**, not by holding its task in `awaiting_review`; the premise that
  phrasing rested on was refuted (entry above) and the replacement is theme 5. The cost is
  unchanged in kind: a parked run holds a worker slot for as long as the person takes. FIX-1197's
  relay is adopted when it lands and is **not required for this round trip**; no issue here builds
  a cold path.

- **~~Does a steer resume the coding agent, or restart it?~~** *Decided: it restarts it.* Nothing
  can hand a prior SDK session id into a detached run today (FIX-1179), so an answer re-states
  the prompt and pays again for context already read. Expensive and accepted — an issue building
  continuity machinery has left scope. Theme 5 does not soften this: `continueRequest` resumes the
  **FSD request**, and the coding agent inside it still starts over.

- **~~Is the inbox a new framework capability?~~** *Decided: no — a plain user-scoped resource
  collection.* FIX-1075 asks the right scoping question and the answer here is *nothing this
  epic needs*; a plain collection keeps theme 3 intact and gives FIX-1075 its evidence.
  FIX-1056 is the same gap from the steering side.

---

**Epic issue:** [LAB-140](https://linear.app/fixpoint-labs/issue/LAB-140/the-harness-manager-drive-one-real-issue-through-a-conductor-phase) ·
**Branch:** `epic/harness-manager` ·
**Epic PR:** [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362) (never merged) ·
**Project:** Development Workflow Orchestration (Labs)

## Epic evolution

- **Epic drafted** — three issues under one outcome: a real issue driven from a task row to an
  open PR without a person in a terminal, with at least one decision asked and answered on the
  way. Kept LAB-138 and LAB-139 as two issues with the seam named, recorded the three settled
  cross-cutting decisions (hot-path questions · steer restarts · the inbox is a plain
  collection), and opened the package-location fork to the product owner.
- **After epic review, round 1** — moved this document's metadata below the objective so the
  problem leads; corrected the FIX-150 story, which had been stated two ways: it is a member of
  the set on its own track, **not** a dependency of the Proof, and the sequencing theme now names
  LAB-138's interim working-directory seam explicitly. Recorded the reviewer's `awaiting_review`
  / wake-seam claim in §5 as an open claim under settlement rather than folding either side of it.
- **After epic review, round 2** — cut §2 from eight themes to four and §5's embedded fork to a
  pointer, because a coordination artifact longer than the specs it coordinates has stopped
  coordinating; the hot-path, steer and inbox decisions were restating §1 and are now §5 entries
  carrying their answers. Reframed theme 2 as a constraint this epic *honours* rather than
  evidence it *produces*, because one record cannot falsify the phase-machine claim. Corrected
  the seam inventory in source — settlement runs through the detached runner's fenced recorders,
  not `settleParentTask`, which `createFlowState` leaves unwired — against a review assertion to
  the contrary. Swapped the Proof issue to FIX-1177 (FIX-1196 is a CLI-wide policy call by its
  own description) and named the forced ask and the operator-present limit, so the Proof is not
  read as more than it is.
- **After epic review, round 3 — the mechanism changed, the objective did not.** Both settlements
  returned and refuted the mechanism §1 described: a detached worker cannot park by holding its
  task in `awaiting_review`, because `recordSuccess` is unconditional and stomps the row to
  `completed` in the same request. Theme 5 replaces it with `ctx.suspend()` plus an in-process
  resume action calling `continueRequest`, and `runs/*` gains `suspensionId`. **One finding, two
  faces:** the same unconditional `recordSuccess` also settles a *failed* run as completed, since
  a terminal SDK error returns `status: "errored"` rather than throwing — so §1 and theme 5 now
  require a handle-status check before settlement, without which the manager's settle/retry/wait
  step can never see a failure. Promoted the never-widen-the-public-route guard to theme 6,
  because the failure mode is a 404 that invites exactly the wrong fix. Relaxed §1's durability
  limit (parking survives a restart) and hardened the one replacing it (a parked row holds a board
  slot; LAB-139 owns the lease-and-reclaim question). Swapped the Proof issue again — FIX-1177 is
  stale, describing a defect that lived on unmerged PR #1297's branch — to FIX-1166, one line in
  CLAUDE.md, verified on `main`. Named LAB-138's per-run `cwd` seam as framework work in theme 4.
  The epic-spec is directionally settled: what remains is carried as implementer notes, not
  further rounds.
