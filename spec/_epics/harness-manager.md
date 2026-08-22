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
> - **The question stays open only as long as the board's lease allows — and that is now a
>   setting we build.** Parking's *record* is durable: the `SuspensionRecord` survives a restart.
>   The task's *ownership* is not. Suspending **stops lease renewal by design**
>   (`task-board/index.ts:958-965` states the consequence outright), so on the 120 s default
>   (`DEFAULT_LEASE_DURATION_MS`, `tasks/collection/internal.ts:640`) the row lapses and becomes
>   claimable — any drain still working the board then recovers it, and the resumed worker's own
>   write-back is refused by the fence. Two minutes is shorter than any real human answer, so as
>   previously written this epic promised something it could not do. **LAB-139 therefore builds a
>   board-level lease setting** (§5, decided): `leaseDurationMs` is already accepted per claim, but
>   `taskBoard` exposes no claim options at all.
> - **A parked run is recovered by nothing in this epic.** The honest cost of the fix above, and
>   larger than "a longer wait": **lease expiry makes a row *claimable*; it does not *invoke* a
>   claim.** `boardQuiescence` returns `"drained"` the moment nothing is in flight, and its own
>   comment says a row handed to a Workstream counts as drained
>   (`task-board/quiescence.ts:95-110`), so in this set's one-task flow the launching drain has
>   already declared itself drained and exited before the lease ever lapses. So a parked run whose
>   harness dies — or one resumed after its attempt is stale — leaves its row `in_progress`
>   indefinitely, until a human intervenes or some later drain claims it. **The configured lease
>   bounds when the row becomes claimable, not when it is reclaimed.** Closing this needs a later
>   drain trigger, the settle-time watch, or the cold re-entry path — all three deliberately out of
>   scope here, and none of them attributed to an issue in this set. **It does not touch the
>   Proof:** that run is one issue with an operator present, so a death is visible and recoverable
>   by hand. But the design is **not unattended-safe**, and a reader should not have to infer that.
>   What still goes untested is a *long*-open question end to end: a green Proof is not evidence
>   that an overnight question survives. *(Parking also costs no board worker slot — an earlier
>   claim, checked in source and withdrawn; §5. The cost is the task row and its lease.)*
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

*Altitude rule for this document, learned the hard way: **the epic-spec names constraints and
the reference implementation to mirror; the issue specs name the calls.** Three separate reviews
have now caught this document naming a specific API as "the mechanism" — `settleParentTask`,
then a bare `continueRequest` — and each time the named API was incomplete, because an epic-spec
specifies mechanism without the source open. A theme that reads like a call sequence has drifted
down an altitude; push it into the issue spec that will write it.*

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
   input, not a reason to re-couple FIX-150. **It is a missing capability on the one surface that
   can host it — not a choice between two surfaces.** The SDK surface — the one carrying detached
   dispatch, `recordWork` and the session handle — forwards no `cwd`
   (`sdk/work-recorder.ts:109-112` says so outright), and the CLI dispatch path is **not** the
   alternative it looks like: it dispatches a `claude --remote` **cloud task**, fire-and-forget,
   with no headless way to poll or stream progress (`cli/dispatch.ts:1-11`), so it cannot host a
   watched local run at all. **So LAB-138 adds `cwd` to the SDK path**; theme 7 carries the check.
   *(An earlier revision read this as an open fork between two surfaces, on the strength of a `cwd`
   the CLI path takes for an unrelated purpose. Corrected — left open, it sends LAB-138's spec to
   evaluate an option that cannot work.)* Left unstated, the Proof run edits the conductor's own
   checkout instead of the run's workspace.

5. **A normal return always settles the task `completed` — so park by suspending, hold the claim
   with a configured lease, and check the handle before settling.** `buildDetachedRunner`'s body
   is unconditionally `.step(worker).tap(recordSuccess)`, so any successful return calls
   `collection.complete()`. Four moves follow, each settled against the real path rather than
   argued (§5), and every issue here builds against all four:

   - **Park** with `ctx.suspend({ reason: "human_input", … })` **alone**. `SuspensionError`
     propagates past the `.tap()`, `recordSuccess` never runs, the row stays `in_progress`, and
     the `SuspensionRecord` is durable.
   - **Hold** the claim with a long lease configured on the board — framework work inside LAB-139
     (§1, §5). Suspending stops lease renewal, so at the default a parked row is claimable by any
     running drain two minutes in. The lease governs *claimability only*: nothing in this set
     invokes a claim after it lapses, so a parked run whose harness dies is recovered by nothing
     here (§1's limits).
   - **Wake** with a purpose-built **server-side** action reading `{requestId, suspensionId}` off
     the `runs/*` row. Never the public resume route — theme 6 says why, and it stands. **The
     constraint on that action: it must perform the whole resolution transaction the public route
     performs — resolve the `SuspensionRecord`, take the continuation lease, and enforce the
     suspension's own guards (still pending · not expired · action allowed · payload valid) —
     and only then continue the request. Calling `continueRequest()` alone is not resuming; it is
     replay without the guards.** Two answers to one question then start concurrent replays of the
     same request, and the record stays `pending` forever, so a run that suspends again finds the
     original gate still open — both silent. Every guard is a `provider.*` call available
     server-side, so none of this is new framework surface. **Mirror
     `packages/engine/src/routes/resume-routes.ts:136-227`**, which is the reference
     implementation; LAB-139's spec names the calls with that file open.
   - **Settle** only after checking the run handle's status: a terminal SDK error subtype returns
     normally as `status: "errored"`, so settling on a normal return alone reports a failed run
     as completed.

   **The three ways to park a detached worker, all measured — this table is the space, don't
   re-derive it:**

   | Park via | Result |
   |---|---|
   | `awaitReview` + normal return | row stomped to `completed` in the same request — the question is lost |
   | `ctx.suspend` **alone** | parks correctly, but lease renewal stops (120 s default), so a running drain can reclaim → duplicate run |
   | `awaitReview` **+** `ctx.suspend` | attempt **permanently stranded**, and the outer request still resolves `error: undefined` |

   The third is the trap, because it is exactly what the lease's own docblock suggests
   (`task-board/index.ts:958-965` — *"a board that wants a long human pause … should park the
   TASK (`awaitReview`), which the lease deliberately does not govern"*). The exemption is real
   (a forced `reclaim(now + 10min)` returned `reclaimedCount 0`); the combination still fails,
   for a reason worth carrying past this epic. **The runner's pre-worker gate is a `.tap()`, and
   a tap has no replay-injectable output, so it re-executes on every re-entry — including the
   `continueRequest` resume of its own suspended dispatch.** That gate asserts
   `status === "in_progress"` unconditionally (`detached-runner.ts:361-366`); `awaitReview` has
   already moved the row off it, so the gate throws before the worker is reached, and
   `recordError`'s `fail()` write is then declined too (`awaiting_review → failed` is not a legal
   transition). Nothing writes at all. **Generalised, and an implementer will meet this outside
   conductor: a `.tap()`-based gate that reads live mutable state and asserts on it is unsafe
   ahead of a suspend point whose resume it will also see.** Filed as
   [FIX-1200](https://linear.app/fixpoint-labs/issue/FIX-1200) (Orchestration Primitives);
   nothing in this set waits on it, because the four moves above avoid it.

6. **The operator's answer never travels the public caller-addressed route, and the allow-list is
   never widened.** `packages/engine/src/routes/public-reentry.ts` places `WORKSTREAM_SOURCE` in
   `NEVER_PUBLIC_REENTRY_SOURCES`, no host option overrides it, and
   `test/public-reentry-opt-in.test.ts` covers it. The reason is in the source and it is
   deliberate: a detached dispatch is not caller-addressed at all, so re-entering it from a public
   route would run it with caller-supplied input — BP-031, exactly. An implementer meets this as a
   **404** from `/api/flows/:kind/requests/:id/resume` on a request that is provably live and
   resumable in-process. That 404 is the guard doing its job. **An issue that reaches for the
   allow-list has hit this theme, not a bug** — theme 5's in-process resume action is the route.

7. **The runner is a named seam, and its contract must be satisfiable by a harness that is not
   Claude Code.** This epic drives Claude Code only, and **proving a second harness is explicitly
   not in scope** — nothing here builds one, tests one, or waits on one. But the Atlas frames
   Conductor as a *meta-harness* whose harness is swappable, and the runner is where that lives,
   so a contract only Claude Code can satisfy forecloses it silently. A **documented-not-executed**
   check of OpenAI's Codex CLI and Cursor's agent CLI (docs only — neither is installed here) found
   the seam drawn almost right, with one clause that is not:

   - **The bound is the caller's, not the harness's.** `maxTurns` is a Claude Code notion; neither
     other CLI exposes a turn or time cap (one closed the request as *not planned*). So the runner
     must be **cancellable, under a caller-enforced wall-clock deadline** — and *how* it cancels is
     the adapter's business: a process kill for a CLI adapter, an abort signal for an in-process
     one. The SDK path already satisfies this (`sdk/agent.ts:434` forwards `ctx.signal` into the
     query's `abortController`). `maxTurns` is demoted to an optional, adapter-specific knob — not
     part of the shared contract. **Stated as a capability rather than a mechanism, deliberately:**
     an earlier draft said "a killable subprocess," which would have mandated discarding the only
     watched coding-agent path we have. That is §2's altitude rule one level down — a constraint
     that names a mechanism smuggles in an implementation.
   - **A machine-readable result is an exit code plus a final JSON object, not a JSON *stream*.**
     One CLI returns a single terminal object; the other returns an event stream the caller must
     scan for the terminal event. The adapter normalises; the manager sees one shape.
   - **Token usage is adapter-optional.** One reports it, the other's is undocumented. The manager
     must work without it.
   - **The unattended/permission posture lives in each adapter's config**, not in the shared
     contract — a graded sandbox and a binary force flag are not one knob, and modelling them as
     one misrepresents both.

   **What this does *not* say is that the seam must be process-spawn.** An earlier draft concluded
   exactly that, and it was wrong on its own premise: the alternative surface it implied — the CLI
   dispatch path — is not a runner candidate at all. `cli/dispatch.ts:1-11` says so in its own
   header: it shells out to `claude --remote`, a **cloud task**, and *"v0 is fire-and-forget … the
   CLI exposes no headless way to poll or stream cloud-task progress."* Its `cwd` is the host repo
   for the dispatch, not a workspace for a run we supervise. So **the in-process SDK path is the
   only watched local coding-agent path that exists**, and theme 4's per-run `cwd` gap is closed
   *there* rather than sidestepped by picking another surface. Portability is served by the
   adapter boundary, not by the seam's transport.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [LAB-138](https://linear.app/fixpoint-labs/issue/LAB-138/the-harness-manager-a-task-row-becomes-a-watched-settled-coding-run) | The manager loop — a task row becomes a watched, settled coding run. Provisions the run's working directory and owns the **per-run `cwd` seam** that makes handing it down possible (theme 4). Settles on a **handle-status check**, not on a normal return (theme 5). The runner contract it defines must hold for a harness that is not Claude Code, and its bound is a caller-enforced deadline over a cancellable run (theme 7). Adds the per-run `cwd` to the **SDK path** — the only surface that can host a watched run (theme 4) | spec | — | — | Needs spec |
| [LAB-139](https://linear.app/fixpoint-labs/issue/LAB-139/a-run-that-needs-a-decision-can-ask-for-one-and-be-answered) | A run that needs a decision can ask for one, and be answered. **Carries the epic's Proof** (FIX-1166). Blocked by LAB-138. Builds theme 5's park-and-wake — `ctx.suspend()` plus an in-process resume action — and the **board-level claim/lease option on `taskBoard`** that lets a parked run keep its claim for a human-scale window (framework work; §5) | spec | — | — | Needs spec |
| [FIX-150](https://linear.app/fixpoint-labs/issue/FIX-150/workspaces-if-validated-workspacerunner-block-and-virtual-filesystem) | Workspaces — the file-projection component. Large, three PRs (a component · b shell-tool migration · c coding-agent path). Subsumes FIX-998. **Own track — carries no dependency edge into the Proof** (theme 4) | spec | [#1345](https://github.com/fixpoint-labs/flow-state-dev/pull/1345) — **approved** | — | Needs implementation |

*FIX-150 is on team **flow-state**, not Labs; it is a sub-issue of LAB-140 across teams. Its
spec gate is already passed (`spec approved` on #1345), so it enters at implementation. It is a
member of this set because the manager will adopt its projection — not because anything here
waits on it (theme 4).*

## 5. Open cross-cutting questions

- **~~Can a detached worker's task be parked in `awaiting_review` and continued by a later
  request?~~** *Resolved: **no**, in every combination — and there is a path that works.* Raised
  by review on this PR (#1362), settled by three POCs on the real path — real `taskBoard()`,
  durable user-scoped collection, real SQLite, the real HTTP surface, asserting on observable
  behaviour only — rather than by a third round of argument. **Theme 5 carries the settled table
  of all three park mechanisms and the four moves that work; it is the reference, and this entry
  records only what the settlements additionally establish.**
  - **The blocker is auto-completion, not visibility.** `awaitReview` succeeds
    (`in_progress → awaiting_review` is legal), but `recordSuccess` then calls
    `collection.complete()` and stomps the row in the same request; a later `resumeFromReview`
    threw *"illegal status transition for task 'question-1': completed → pending"*. The
    request-scoped task mirror was the reviewer's reasoning and it is **not** the problem — a
    second request's fresh resolution read the terminal row correctly.
  - **One of the three combinations *is* a framework defect, and it is filed rather than fixed
    here.** `awaitReview` + `ctx.suspend` strands the attempt permanently while the outer request
    reports success — [FIX-1200](https://linear.app/fixpoint-labs/issue/FIX-1200), evidence on
    draft PR [#1363](https://github.com/fixpoint-labs/flow-state-dev/pull/1363)
    (`poc/LAB-139-awaitreview-suspend-lease`). Plain `recordSuccess` is *not* a defect: it is
    unconditional by design, and the design this epic opened with did not fit that contract.
  - **The shipped public resume route refuses it, and that guard stays** (theme 6). The same
    requestId that 404s is proven live and resumable via `continueRequest()`, so the 404 is the
    guard, not a missing record. `continueRequest` carries no source gating — the check lives only
    in the HTTP handler, so an in-process action can wake the run. **So does the rest of the
    resolution transaction**, which the in-process action must therefore perform itself rather
    than inherit (theme 5).
  - **The lease, not the task status, is the real limit on how long a question can stay open.**
    Routed to LAB-139 by the round-3 fold; now decided in the entry below.
  - **What changed:** themes 5 and 6, the hot-path entry below, LAB-138's and LAB-139's index
    rows, and §1. **The objective did not.** A mechanism was replaced, not an outcome, so this
    does not return to the gate.

- **~~How long can a question stay open before the board takes the row back?~~** *Decided: as
  long as the board is configured to allow — and configuring it is new scope inside LAB-139.*
  Suspending stops lease renewal by design (`task-board/index.ts:958-965`), so on the 120 s
  default (`DEFAULT_LEASE_DURATION_MS`, `tasks/collection/internal.ts:640`) a parked run's row
  becomes claimable about two minutes in: the lease lapses, any drain still working the board
  recovers the task, and the resumed worker's write-back is then refused by the fence. Two minutes
  is shorter than any real human answer, so without this the Proof's round trip is a race it can
  lose whenever a drain is there to take the row.
  **The claim path already takes the number** — `leaseDurationMs` is accepted per claim and
  validated between `MIN_LEASE_DURATION_MS = 1_000` and `MAX_LEASE_DURATION_MS` (~74.5 days)
  (`tasks/collection/internal.ts:649,660`) — but **`taskBoard` exposes no claim options at all**
  (a grep over `packages/orchestration/src/task-board/` returns nothing). That gap is the whole
  difference between a two-minute window and a usable one.
  **Scope:** LAB-139 gains an explicit piece of **framework work** — expose a claim/lease option
  on `taskBoard`, threaded through to the claim — so a board hosting human-in-the-loop work
  configures a window measured in hours. Symmetric with the per-run `cwd` seam already named
  inside LAB-138 (theme 4). **Kept inside LAB-139 rather than filed as a fourth member of the
  set**: a fourth member buys a fourth dependency chain for one option. **Sequencing, so it isn't
  read as a new edge:** LAB-138 stands the board up and LAB-139 amends its configuration — that is
  the existing land-order (theme 4), not an additional dependency, and LAB-138 does not wait on
  the option to be correct at its own default.
  **The cost, named beside the limit it replaces (§1):** a genuinely *dead* worker's task is not
  claimable for the configured window instead of for two minutes — and **claimable is as far as
  the lease reaches.** Nothing in this epic invokes a claim once the window passes (the launching
  drain has already exited — §1's limits, and the hot-path entry below), so the row stays
  `in_progress` until a human or some later drain picks it up. The window is the trade a board
  hosting human pauses should make, and it is **per-board**, so nothing else inherits it; the
  non-recovery beyond it is a limitation of the set, not of this option. *(The product owner's
  call.)*

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
  phrasing rested on was refuted (entry above) and the replacement is theme 5. **The cost is one
  thing, not two: the task row and its long lease.** A parked run holds **no board worker slot** —
  a claim this document carried through three rounds, now checked in source and withdrawn. The
  suspended request *settles and lets go*: on `SuspensionError`,
  `packages/engine/src/execution/runAction.ts:1503-1520` patches the record to `suspended`,
  deregisters the abort controller and the registry entry, clears its intervals and returns. And
  the launching board never counted the row anyway — `countWaitable` skips every row where
  `isHandedOff` is true (`packages/orchestration/src/task-board/shared.ts:184-198`, predicate at
  `111-119`). So the only cost is the one the lease entry above already prices: the task row and
  its lease.
  **The interlock this document previously claimed here is inert, and correcting it is what §1's
  new limit states.** `isHandedOff` does require `!leaseLapsed`, so the predicate flips at lease
  expiry — but `countWaitable` decides anything only **while a drain is running**, and
  `boardQuiescence` returns `"drained"` as soon as `inFlightCount === 0`, counting a row handed to
  a Workstream as drained (`task-board/quiescence.ts:95-110`). In this set's one-task flow the
  launching drain has therefore exited long before the lease lapses. The row does not re-enter the
  board's wait count when the human's window closes; there is no wait count left to re-enter.
  Expiry makes the row claimable and invokes nothing — so **a parked run whose harness dies is
  recovered by nothing in this epic**, and §1's limits carry that statement in full along with what
  would close it (a later drain trigger, the settle-time watch, or the cold re-entry path, all
  deliberately out of scope).
  **FIX-1197's relay is therefore justified differently than this document said before.** There is
  no held slot for it to free. What it would buy is a durable ask channel that does not depend on
  suspension at all — and therefore no long lease on a task row. That is the whole claim; it should
  not be stated as more. **In particular it is not credited with the recovery limit above**:
  whether a relay also gets a dead parked run's row settled is not something this document has
  checked, and an unchecked benefit is how the two claims corrected in this fold got in. It is
  adopted when it lands and is **not required for this round trip**; no issue here builds a cold
  path.

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
- **Correction fold — the third settlement, and a lease setting the owner scoped in.** Not a
  review round; the spec had already converged. Two things forced it. **The last settlement
  returned REFUTED** (evidence on draft PR #1363): `awaitReview` *followed by* `ctx.suspend` does
  not merely cost a re-acquire, it **strands the attempt permanently** while the outer request
  still resolves `error: undefined` — because the runner's pre-worker gate is a `.tap()`, which
  re-executes on the resume of its own suspended dispatch. Theme 5 now carries all three park
  mechanisms as one settled table so nobody re-derives them, plus the general framework fact an
  implementer will meet outside conductor, filed as FIX-1200. And **round 3 overstated
  durability**: the `SuspensionRecord` survives a restart but the task's *ownership* does not,
  because suspending stops lease renewal and the default lease is two minutes — shorter than any
  human answer. The product owner's fix is scoped in as framework work inside LAB-139: a
  board-level claim/lease option on `taskBoard`, which today exposes none, priced honestly in §1
  (a dead worker's row waits out the configured window). **Every correction in this fold was to a
  mechanism. §1's five lines — Outcome, Proof, Lead measure, Not doing, Kill line — are unchanged,
  as they have been through all three rounds. The epic still means exactly what it said.**
- **Correction fold — the wake mechanism was under-specified, and the altitude rule that caused
  it.** Not a review round; the budget is spent and the spec has converged. Theme 5 said the
  operator's answer is delivered by a server-side action calling `continueRequest()`. Checked in
  source (`packages/engine/src/routes/resume-routes.ts:136-227`), that is not sufficient: the
  public route resolves the `SuspensionRecord` and takes a continuation lease *before* it
  continues, and an action skipping those lets two answers start concurrent replays of one
  request while the record stays `pending` forever — both silent, and both exactly the class of
  bug this epic exists to catch. Theme 5 now states the **constraint** (perform the whole
  resolution transaction; mirror that file) instead of naming a call, and LAB-139 carries an
  implementer note to name the calls with the source open. **The reason it is stated as a
  constraint is the pattern**: this is the third review to find this document naming a specific
  API as the mechanism and the third time the named API was incomplete — so §2 now opens with an
  explicit altitude rule, which is the durable fix. **The objective is untouched. §1's five
  lines — Outcome, Proof, Lead measure, Not doing, Kill line — are unchanged; this was a
  completeness correction to a mechanism the epic-spec should not have specified at this
  altitude in the first place.**
- **Constraint fold — the runner contract was not portable, and one clause said so.** Not a review
  round; the budget is spent and the spec has converged. The product owner asked whether a second
  harness should be proven alongside Claude Code. The answer is **no** — that is unchanged and now
  stated in theme 7 in the same breath as the constraint, so nobody reads the constraint as a
  commitment. But the paper check behind the answer (Codex CLI and Cursor's agent CLI, **documented
  not executed**) found the runner seam drawn almost right with one Claude-Code-only clause: a
  turn/time bound. Neither other CLI exposes one, so **theme 7** makes the bound the caller's — a
  killable subprocess and a wall-clock kill — and demotes `maxTurns` to an adapter knob, with the
  result shape, token usage and permission posture named as adapter-normalised rather than shared.
  Its second-order consequence is the part worth having: **the seam is process-spawn, not an
  in-process SDK call**, which is new evidence on one side of LAB-138's `cwd` surface fork (theme
  4) and is **routed there rather than resolved here** — the SDK surface still uniquely carries
  `detached`, `recordWork` and the session handle. **§1's five lines are unchanged.** This epic
  still drives Claude Code only.
- **Correction fold — two clauses of that constraint were wrong, and a cost we priced does not
  exist.** Not a review round. A Codex review of `92028c5`, verified against the source, overturned
  three things the entry above and its predecessors asserted. **The bound was over-drawn:** "a
  killable subprocess" mandates discarding the only watched coding-agent path we have, and is
  unnecessary — `sdk/agent.ts:434` already forwards `ctx.signal` into the query's
  `abortController`. Theme 7 now requires the runner to be **cancellable under a caller-enforced
  wall-clock deadline**, leaving *how* to each adapter. **The "process-spawn seam" conclusion is
  withdrawn entirely**, because the alternative surface it rested on does not exist: the CLI
  dispatch path shells out to `claude --remote`, a fire-and-forget **cloud task** with no headless
  way to poll or stream progress (`cli/dispatch.ts:1-11`). So the in-process SDK path is the only
  watched local path, theme 4 no longer reads as a surface fork, and **LAB-138 adds `cwd` there** —
  an open fork would have sent its spec to evaluate an option that cannot work. **And the
  held-board-slot cost is deleted, not reduced**: a suspended request settles and lets go
  (`execution/runAction.ts:1503-1520`) and the board never counted the row
  (`task-board/shared.ts:184-198`). The real cost is the task row and its lease, which §5 already
  prices — and the two interlock, since `isHandedOff` goes false exactly when the lease lapses, so
  the row returns to the board's wait count at the moment the human's window closes. FIX-1197's
  relay is re-justified accordingly: not freeing a slot, but removing the dependency on suspension
  and so the long lease. **Both corrections are the same lesson at two altitudes** — a constraint
  that names a mechanism (`subprocess`) smuggles in an implementation, and a cost asserted without
  the source open outlived three rounds of review. **§1's five lines are still unchanged; this fold
  makes the epic cheaper than advertised, not different.**
- **Correction fold — the interlock the last fold was pleased with is inert, and it is the third
  instance of one class.** Not a review round. The entry above closed by claiming the lease and the
  wait count interlock: `isHandedOff` goes false exactly at lease expiry, so the row re-enters the
  board's wait count precisely when the human's window closes. True of the predicate, **inert in
  practice.** `boardQuiescence` returns `"drained"` the moment `inFlightCount === 0` and counts a
  row handed to a Workstream as drained (`task-board/quiescence.ts:95-110`), so in this set's
  one-task flow the launching drain has already exited before the lease lapses; `countWaitable`
  only decides anything while a drain is running. **The consequence is a real limitation, now
  stated in §1 rather than budgeted away:** lease expiry makes a row *claimable* and invokes no
  claim, so a parked run whose harness dies leaves its row `in_progress` indefinitely — until a
  human intervenes or some later drain claims it. What would close it (a later drain trigger, the
  settle-time watch, or the cold re-entry path) is named and all of it is out of scope; **no
  recovery machinery is scoped in, and none of it is attributed to FIX-1197**, whose relay is not
  credited with a benefit nobody has checked. The Proof is untouched — one issue, operator present,
  a death is visible — but the design is **not unattended-safe**, and that is now said rather than
  left to be inferred. §5's lease cost, theme 5's *Hold* move and its park table were reconciled to
  the same reading (claimable ≠ reclaimed). **No new theme; §2 stays at seven, and the index is
  unchanged.** **The class, and this is its third instance:** a claim about the board reasoned from
  a *predicate* instead of from the *flow that invokes it* — after the held-slot cost
  (`countWaitable` skips the row) and the re-entry claim (`isHandedOff` flips), both true of the
  predicate and neither reaching the running system. The fix that generalises: for a board claim,
  name the caller that runs the predicate before stating what the predicate buys.
  **§1's five lines — Outcome, Proof, Lead measure, Not doing, Kill line — are unchanged.**
