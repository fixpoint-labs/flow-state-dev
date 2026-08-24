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
> finished on it. Readable off the run's own `runs/*` row, the inbox row carrying the question and
> its answer, and the PR. One file, one line, zero blast radius, and outside every package this epic touches: a join
> proof wants a fix small enough that nothing about the fix can explain a failure. *(It replaces
> FIX-1177, which is stale — that describes a defect on PR #1297's branch, which closed unmerged;
> `packages/claude-code/src/sdk/headless.ts` does not exist and `maxTurns` is forwarded straight
> into the query options at `agent.ts:443`.)*
>
> **What the Proof does not show** — five limits, stated so it is not oversold:
> - **The ask is forced, not spontaneous.** LAB-139's implement prompt *requires* the run to
>   confirm one named decision through the inbox before it opens the PR. That is a chosen
>   experimental design: it isolates the variable under test — the channel, not the model's
>   judgment about when to reach for it. Whether a run asks unprompted is the *next* epic's
>   evidence, not this one's. FIX-1166 makes this weigh **more**, not less: the fix is one line,
>   so almost none of this run's value is the fix — the ask *is* the experiment, and it is staged.
> - **The Proof depends on four named pieces of work outside this epic, and they are not one
>   dependency.** *(Corrected: this document previously priced them as one "Relay" dependency, and
>   put park-exit under Relay. It is not.)*
>   - **The ask** is **Relay's** — [FIX-1230](https://linear.app/fixpoint-labs/issue/FIX-1230)
>     (address a session, send it a message), **In Development**, under
>     [FIX-1197](https://linear.app/fixpoint-labs/issue/FIX-1197).
>   - **The park and the wake** are the **honest task substrate's** —
>     [FIX-980](https://linear.app/fixpoint-labs/issue/FIX-980), *related to* Relay but **not
>     parented under it**: park-exit [FIX-1234](https://linear.app/fixpoint-labs/issue/FIX-1234)
>     (**In Review**) and unblock-with-input
>     [FIX-1244](https://linear.app/fixpoint-labs/issue/FIX-1244) (**Backlog**).
>   - **Continuing the same coding session** across the wait —
>     [FIX-1246](https://linear.app/fixpoint-labs/issue/FIX-1246), a **POC** under
>     [FIX-1179](https://linear.app/fixpoint-labs/issue/FIX-1179), **Backlog**. New, and it is a
>     **Proof blocker**: see the continuity limit below.
>
>   **Four pieces, and this epic consumes all of them and owns none** (owner decisions on
>   [#1429](https://github.com/fixpoint-labs/flow-state-dev/issues/1429), where **D-1 is now
>   closed**). Priced the way FIX-150 is priced (theme 4) — named rather than hidden, and **the
>   epic's schedule is not quietly made anyone else's.** Before they land, LAB-139 can **build and
>   unit-test its components** — the phase record, the question's inbox row and its replay-safe write,
>   the human-wait status write in isolation, and settlement's handle check.
>
>   **What it cannot do before FIX-1234 is goal-check the parked phase end to end through the manager
>   loop**, and this document already says why: today's runner is unconditionally
>   `.step(worker).tap(recordSuccess)`, so an `awaitReview` write is **stomped to `completed` on any
>   normal return** — row 1 of theme 5's measured table. The loop completes the row out from under the
>   park. So *"build and unit-test the parts"* and *"goal-check the phase"* are **different claims**,
>   and only the first is available now. *(Same class as the status correction below: a claim about
>   what is **decided** outrunning what is **landed**.)* And what LAB-139 cannot do until all four
>   land is run the round trip — which is the Proof.
>
>   **On the status, the distinction that keeps tripping this document: the *name* is decided and the
>   *enum member* is not landed, and those are different facts.** `parked` is the decided target name
>   (theme 5). `TaskStatus` today accepts **`awaiting_review`** and not `parked`, and the rename is
>   **[FIX-1245](https://linear.app/fixpoint-labs/issue/FIX-1245)** — Backlog, external, consumed by
>   this epic. **So LAB-139 builds against the shipped `awaiting_review` now**, per the owner:
>   *"keep shipped `awaiting_review` in this cycle… park-exit ships against whichever name is live."*
>   The status **is** buildable — against today's name, not tomorrow's. **This is not a re-gate:** the
>   enum-landing confirm did return, so the gate that once sat on LAB-139's spec at the field-naming
>   point is gone and stays gone. *(Third revision of this passage — gated · buildable ·
>   buildable-against-the-shipped-name — which is why the two facts are now separated on the page
>   rather than left to be inferred.)*
> - **The wake has an owner and does not have an implementation, and the second half is the risk.**
>   **[FIX-1244](https://linear.app/fixpoint-labs/issue/FIX-1244) — unblock-with-input, under
>   FIX-980 — owns it**, and says so itself: park-exit lets a drain *leave* while a row sits parked,
>   *"that is half the pair"*, and no framework primitive yet **resumes that row with a payload as a
>   new workstream request** — *"without this verb, an honest park-exit is a dead letter."*
>   **LAB-139 is its first consumer, never its owner.** *(Corrected: this document called the wake
>   unowned. That is false and the distinction matters — it is a **schedule** dependency, not an
>   **ownership** gap.)*
>   **The schedule point stands undiminished: FIX-1244 is Backlog, so the verb the Proof's round trip
>   needs is not built.** It sits on the Proof's critical path, because *"the answer went back in and
>   the run finished on it"* is half of what the Proof claims. **This document proposes no wake** —
>   reaffirmed by the owner — and an issue that finds itself inventing one has hit this limit and
>   should raise it on the epic PR rather than solve it locally. *(FIX-1244 independently reaches this
>   epic's own finding from the other side: `resumeFromReview`/`continueRequest` are the wrong shape
>   after park-exit, because they assume the launching request is still open.)*
>
> - **Restart is not Proof — the run must continue the *same* coding session across the wait.**
>   **Reversed by the owner**, and this document carried the opposite since it was drafted:
>   *"LAB-139's 'continuity out of scope / restart accepted' is **stale** — strike it. This epic is
>   **blocked on that POC for Proof**, it does not build the resume itself."* So a run that answers by
>   **re-stating the prompt and starting the agent over does not count as the Proof passing.** The
>   POC is [FIX-1246](https://linear.app/fixpoint-labs/issue/FIX-1246) under
>   [FIX-1179](https://linear.app/fixpoint-labs/issue/FIX-1179), **Backlog**, in its own words:
>   *"the task is already associated to the coding session, so resume from a second request should be
>   possible… This is a POC, not Proof. Restart is not the POC passing."* **This epic consumes it and
>   does not build the resume.** *(What this replaces: "a steer restarts the coding agent — correct
>   and expensive; accepted, and not to be worked around." That was wrong, not merely open, and it is
>   struck wherever it appeared.)*
>
> - **Nothing currently owns a *shipped* same-session resume, and the Proof now requires one.** The
>   three legs, each verified in source or in the issue, and stated together because separately they
>   each look survivable:
>   - **D-1 made same-session continuation mandatory for the Proof** — restart does not count as the
>     Proof passing (the limit above).
>   - **The only path Conductor has deliberately prevents it.**
>     `claudeCodeAgent({ detached: true })` — exactly what Conductor uses — **suppresses the SDK
>     `resume`**, and it is a design decision rather than an oversight: the docblock
>     (`packages/claude-code/src/sdk/agent.ts:124-135`) calls the suppression of the declaration, its
>     reads/writes and `resume` *"one decision rather than three"*, because *"the session provider is
>     not consulted at all, so a custom provider cannot hand back a saved id that silently resumes a
>     prior conversation."* Its stated consequence is exactly the blocker: **"a second task addressed
>     to the same workstream starts the agent fresh."**
>   - **The issue we consume proves feasibility without shipping it.**
>     [FIX-1246](https://linear.app/fixpoint-labs/issue/FIX-1246) is scoped **POC-only** — *in:*
>     *"POC that the association already on the task is enough to resume the same session from a new
>     request"*; *out:* *"full FIX-1179 rewrite if the POC is narrower."*
>
>   **So every named issue and every consumed dependency can finish and the Proof still will not
>   run.** That is the same shape as the wake gap, and it gets the same treatment: **stated, named as
>   the owner's, and not designed here.** A production path means **revisiting a documented decision**
>   — `detached: true`'s deliberate suppression — not filling a hole nobody noticed, and those are
>   different kinds of work to schedule. **This document does not re-open that decision**; naming that
>   it would have to be revisited is the point, and it is a different act from revisiting it.
>   [FIX-1179](https://linear.app/fixpoint-labs/issue/FIX-1179) — *"a detached run cannot resume its
>   external session"* — is the **natural** home, and this document does **not** assert it is the
>   answer. **Whether the shipped path is FIX-1179's, LAB-139's, or whether the Proof narrows, is the
>   owner's call**, live on the epic PR. **No mechanism is proposed here, no scope is added to
>   LAB-139, and FIX-1179 is not in the consumed set.**
>
> **Lead measure** — the set's goal-proven issues, named: FIX-150 · LAB-138 · LAB-139.
>
> **Not doing** — **building** Relay (FIX-1197 is its own epic; this epic consumes the channel and
> does not build it — the dependency is priced in the limits above, not hidden here) ·
> **building** the session resume itself (FIX-1179 / the FIX-1246 POC — this epic consumes it; the
> Proof now *requires* continuation, so this is a scope-out of the building, never of the outcome) · the spec and review phase records and the durable approval gate between phases · the
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
   watched local run at all. **So LAB-138 adds `cwd` to the SDK path**; theme 7 carries the
   portability constraint that path's runner contract still owes.
   *(An earlier revision read this as an open fork between two surfaces, on the strength of a `cwd`
   the CLI path takes for an unrelated purpose. Corrected — left open, it sends LAB-138's spec to
   evaluate an option that cannot work.)* Left unstated, the Proof run edits the conductor's own
   checkout instead of the run's workspace.

5. **The ask travels Relay, a human wait is a task *status*, and a normal return always settles the
   task `completed`.** *(Owner decision **D-1** — GitHub issue
   [#1429](https://github.com/fixpoint-labs/flow-state-dev/issues/1429), mirrored as FIX-1241.
   **Conductor does not use `ctx.suspend` for ask/HITL.**)* Three obligations; this theme states
   what must hold, and LAB-138 and LAB-139 write the mechanism with the code open.

   - **Ask** over **Relay**. The question leaves the run through the relay channel, not by
     suspending the request in place. Conductor **consumes** that channel and does not build it —
     Relay is its own epic (FIX-1197), and §1's limits price the dependency rather than hide it.
   - **Wait** in **`parked`**, not as a suspended request. A row waiting on a person must be
     distinguishable from a row waiting on other work; **`parked` is the status** and
     **dependencies stay `blocked`**. **`needs_input` is the human-ask display/reason — the *why*, not
     the *what*** — so a row is `parked`, and `needs_input` says what it is parked on. *(Owner call,
     and it **supersedes** an earlier call in this document that made `needs_input` the status
     itself.)*
     **Shipped `awaiting_review` stays this cycle.** The rename `awaiting_review → parked` is
     [FIX-1245](https://linear.app/fixpoint-labs/issue/FIX-1245) under
     [FIX-980](https://linear.app/fixpoint-labs/issue/FIX-980), Backlog, to land before FIX-980's
     human-wait closes — **this epic consumes it and does not own it.** Park-exit (#1422) is **not**
     gated on it and ships against whichever name is live.
     **There is no longer a gate on LAB-139's spec here.** It existed only while the representation
     was undecided; the confirm returned, so the spec names the field and proceeds — **and the field
     it names today is the shipped `awaiting_review`.** `parked` is the decided name, not a landed
     enum member; **the decision and the schema are different facts**, and conflating them is what
     made this passage move three times (§1).
     *(Neutral fact, unchanged throughout: the shipped **verbs** `awaitReview` and `resumeFromReview`
     are not renamed by any of this.)*
   - **Settle** only after checking the run handle's status: a terminal SDK error subtype returns
     normally as `status: "errored"`, so settling on a normal return alone reports a failed run as
     completed. `buildDetachedRunner`'s body is unconditionally `.step(worker).tap(recordSuccess)`,
     so any successful return calls `collection.complete()`. **Untouched by D-1** — this is a
     property of the runner, not of the park.

   **The inbox row still carries the question, and writing it must still be replay-safe.** A step
   with no committed output re-executes on re-entry, so an unguarded write can recreate or reset the
   row and attach an answer to a stale one. LAB-139 owns that obligation; D-1 changed the channel the
   question travels, not the row it is written to.

   **No single primitive covers all of this, and the split is deliberate.** Worth stating because it
   is why this is not a retreat (the architect's note on #1429): an **in-request `suspend`**, a
   **board wait-status**, and a **Relay send** are three different things. The design uses the right
   one at each point instead of forcing one primitive to serve all three.

   **A caution, no longer a reason: do not combine `awaitReview` with `ctx.suspend` on today's
   detached runner.** That combination strands the attempt permanently while the outer request still
   resolves `error: undefined` — [FIX-1200](https://linear.app/fixpoint-labs/issue/FIX-1200), still
   true as a fact about the runner. **It is not an argument for choosing suspend.** The reasoning
   this document previously ran — *"`awaiting_review` is unusable, therefore suspend is the only
   option"* — is superseded by D-1, and FIX-1200's sequencing is open (§5).

   **Evidence, superseded as the plan — kept because it is why D-1 is well-founded.** The three ways
   to park a detached worker, all measured on the real path with real `taskBoard()`, a durable
   collection and real SQLite. **None of these is the design any more.** Read the table as the
   measurement that ruled out parking-by-request and pointed at a board-level wait status — not as a
   menu to choose from.

   | Park via | Measured result |
   |---|---|
   | `awaitReview` + normal return | row stomped to `completed` in the same request — the question is lost |
   | `ctx.suspend` **alone** | parks correctly, but lease renewal stops (120 s default), so the next drain reclaims → duplicate run, and the answered original's write-back is then refused `lost-claim` |
   | `awaitReview` **+** `ctx.suspend` | attempt **permanently stranded**, and the outer request still resolves `error: undefined` |

   The third is the trap, because it is exactly what the lease's own docblock suggests
   (`task-board/index.ts:958-965` — *"a board that wants a long human pause … should park the
   TASK (`awaitReview`), which the lease deliberately does not govern"*). The exemption is real
   (a forced `reclaim(now + 10min)` returned `reclaimedCount 0`); the combination still fails.

6. **The operator's answer never travels the public caller-addressed route, and the allow-list is
   never widened.** `packages/engine/src/routes/public-reentry.ts` places `WORKSTREAM_SOURCE` in
   `NEVER_PUBLIC_REENTRY_SOURCES`, no host option overrides it, and
   `test/public-reentry-opt-in.test.ts` covers it. The reason is in the source and it is
   deliberate: a detached dispatch is not caller-addressed at all, so re-entering it from a public
   route would run it with caller-supplied input — BP-031, exactly. An implementer meets this as a
   **404** from `/api/flows/:kind/requests/:id/resume`. **Under D-1 that 404 is simply less likely
   to come up** — Conductor does not resume requests at all, so nobody on this path is knocking on
   that route. Said plainly rather than dressed in a new illustration.
   **The rule binds exactly as hard, and the reason is the Relay path itself:** an answer arrives
   from **outside** the run, and it must still never re-enter a detached dispatch through a
   caller-addressed route — a detached dispatch was never caller-addressed, so doing so would run it
   with caller-supplied input (BP-031). **An issue that reaches for the allow-list has hit this
   theme, not a bug**; the answer's route in is theme 5's, over Relay.

7. **The runner contract must not encode any one harness's shape.** The Atlas frames Conductor as
   a *meta-harness* whose harness is swappable, and the runner is the seam where that lives, so a
   contract only Claude Code can satisfy forecloses it silently. **Proving a second harness is
   explicitly not in scope** — nothing here builds one, tests one, or waits on one; this epic
   drives Claude Code only, and this constraint is not a commitment to a second adapter. **The
   tell: a clause of the contract that names a Claude Code notion** — a turn cap, an exit code —
   has broken it, and the fix is to restate that clause as the capability underneath it.
   **Portability is served by the adapter boundary, not by the seam's transport**, so nothing here
   is in tension with theme 4's finding that the in-process SDK path is the only watched local
   coding-agent path that exists.

   **LAB-138 defines the contract clause by clause, with the code open, and its implementer notes
   carry the clause-level detail** — the bound, the result shape, token usage, permission posture,
   and the documented-not-executed Codex/Cursor evidence behind them. That detail lived here and
   was wrong three times in three days, every time in a way only the source could catch. This
   document names the constraint; the issue spec that will write the interface names the clauses.

8. **Starting a run and continuing a parked one are the *same* workstream core, not two verbs.**
   Owner constraint on [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362):
   *"Do not design `taskStart`/`taskUnpark` as two workstream actions — one `flow.workstream` core,
   reuse-or-mint the harness session id inside it."* **The tell that this has been broken: a caller
   choosing between two entry points**, or a pair of workstream actions whose names distinguish
   *fresh* from *resumed*.
   **The reason, so nobody re-derives it the other way:** two verbs put the reuse-or-mint decision in
   the **caller**, which is exactly where it cannot live — the caller does not know whether a session
   already exists for that task. The core does. It also matches FIX-1246's premise — *"the task is
   already associated to the coding session"* — so if the association lives on the task, a
   caller-side fork is redundant at best and divergent at worst.
   **This constrains a seam that already exists; this epic does not build it.** `flow.workstream` is
   today the single `ActionCore` a `source: "workstream"` dispatch resolves to
   (`packages/core/src/flow/workstream-core.ts`, *"the one workstream core a detached dispatch
   resolves"*; the resolve site is `engine/src/execution/resolve-action-core.ts`). So the constraint
   is about **not growing two verbs beside it**, not about standing one up. **LAB-138 enters it to
   start a run and LAB-139 re-enters it after a wait — the same core both times.**
   **The mechanism is the issue specs', with the source open** — how the session id is reused or
   minted, where the association is read, and what the core's shape is are all theirs, not this
   document's (§2's altitude rule).

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [LAB-138](https://linear.app/fixpoint-labs/issue/LAB-138/the-harness-manager-a-task-row-becomes-a-watched-settled-coding-run) | The manager loop — a task row becomes a watched, settled coding run. Provisions the run's working directory and owns the **per-run `cwd` seam** that makes handing it down possible (theme 4). Settles on a **handle-status check**, not on a normal return (theme 5). **Defines the runner contract**, which must not encode any one harness's shape (theme 7) — the clause-level detail (the bound, the result shape, token usage, permission posture) is in this issue's implementer notes, deliberately not in the epic-spec. Adds the per-run `cwd` to the **SDK path** — the only surface that can host a watched run (theme 4) | spec | — | — | Needs spec |
| [LAB-139](https://linear.app/fixpoint-labs/issue/LAB-139/a-run-that-needs-a-decision-can-ask-for-one-and-be-answered) | A run that needs a decision can ask for one, and be answered. **Carries the epic's Proof** (FIX-1166). Blocked by LAB-138. Builds theme 5's ask-and-wait as decided by **D-1** (now closed) — the question travels **Relay**, and the row sits in **`parked`** (dependencies stay **`blocked`**; `needs_input` is the human-ask **reason**, not the status; shipped `awaiting_review` stays this cycle, renamed by FIX-1245 under FIX-980, which this epic consumes). Owns the **inbox row and its replay-safe write**. *(Rescoped by D-1: the `ctx.suspend` park, the in-process resume action, the `suspensionId` projection seam and the configured lease window are all withdrawn.)* **Cannot run the round trip until four consumed pieces land** — the ask (FIX-1230), park-exit (FIX-1234), the wake (FIX-1244) and **session resume (FIX-1246)**; **restart is not Proof**. Before that it can build and goal-check the phase record, the inbox row and its replay-safe write, the human-wait status — **against the shipped `awaiting_review`, since `parked` is the decided name but not yet a landed enum member (FIX-1245)** — and settlement (§1) | spec | — | — | Needs spec |
| [FIX-150](https://linear.app/fixpoint-labs/issue/FIX-150/workspaces-if-validated-workspacerunner-block-and-virtual-filesystem) | Workspaces — the file-projection component. Large, three PRs (a component · b shell-tool migration · c coding-agent path). Subsumes FIX-998. **Own track — carries no dependency edge into the Proof** (theme 4) | spec | [#1345](https://github.com/fixpoint-labs/flow-state-dev/pull/1345) — **approved** | — | Needs implementation |

*FIX-150 is on team **flow-state**, not Labs; it is a sub-issue of LAB-140 across teams. Its
spec gate is already passed (`spec approved` on #1345), so it enters at implementation. It is a
member of this set because the manager will adopt its projection — not because anything here
waits on it (theme 4).*

**What this index does not contain — and why that is correct.** **Four** pieces the Proof's round
trip needs are not in this table, because they are **not this epic's to build**. It consumes all
four and owns none.

- **The ask** — [FIX-1230](https://linear.app/fixpoint-labs/issue/FIX-1230) (In Development), under
  Relay (FIX-1197).
- **Park-exit** — [FIX-1234](https://linear.app/fixpoint-labs/issue/FIX-1234) (In Review), under the
  honest task substrate [FIX-980](https://linear.app/fixpoint-labs/issue/FIX-980).
- **The wake** — [FIX-1244](https://linear.app/fixpoint-labs/issue/FIX-1244) (Backlog), under
  FIX-980; LAB-139 is its **first consumer, not its owner**.
- **Session resume** — [FIX-1246](https://linear.app/fixpoint-labs/issue/FIX-1246) (Backlog), a POC
  under FIX-1179. **New, and a Proof blocker: restart is not Proof** (§1).

*(Also consumed, not owned, and not Proof blockers: **FIX-1245**, the `awaiting_review → parked`
rename under FIX-980; and **FIX-1247**, the fence making `ctx.suspend` error inside a workstream,
under FIX-1200.)*

**The visibility point is unchanged and still worth stating: every issue in this index can close
while the Proof's round trip is still unrunnable**, because FIX-1244 and FIX-1246 are Backlog — **and
now for a second, independent reason: nothing owns a *shipped* same-session resume at all.** FIX-1246
proves feasibility POC-only, and `detached: true` suppresses the SDK `resume` by design, so even
every consumed dependency landing does not by itself make the round trip runnable (§1). Said here
because the table otherwise reads as the whole set. **This is visibility, not a plan** — no
issue is proposed, no scope is added to LAB-139, and this document designs no wake, no resume and no
rename. Whether that gap ever changes this epic's shape is the **owner's**, live on the epic PR
([#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362)).

## 5. Open cross-cutting questions

- **~~Can a detached worker's task be parked in `awaiting_review` and continued by a later
  request?~~** *Resolved: **no**, in every combination **on today's detached runner** — and the
  conclusion once drawn from that is superseded.* **Read this entry as measurement, not as
  direction.** Its findings stand; what does not is the inference that followed them — *"parking the
  task is unusable, therefore suspend"*. Owner decision **D-1** (#1429 / FIX-1241) chose a **board
  wait-status plus Relay** instead, so `awaitReview`'s behaviour on today's runner is now a
  **caution about combining primitives**, not a reason to park the request. Raised
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
    in the HTTP handler. *(That observation was once the basis for an in-process resume action as
    the HITL wake. D-1 removed that path; theme 6's guard is what survives here, and it is
    unaffected.)*
  - **"The lease, not the task status, is the real limit on how long a question can stay open"** —
    this document's conclusion for three folds, and **D-1 reverses it.** The task status is the
    limit; the lease was an artefact of parking the request. See the entry below.

- **~~How long can a question stay open before the board takes the row back?~~** *Answered
  differently by **D-1**: the row is not held by a lease at all, because the run does not park the
  request. **Superseded as the plan; kept as the evidence that produced it.*** Whether a pre-chosen
  lease is an acceptable product control at all is now one of the owner's open questions below
  (**they lean no**, given the Relay path). The measurements in this entry are why the question was
  worth asking, and they remain accurate about the board.
  *(What follows is the measurement, with the superseded scope removed.)*
  Suspending stops lease renewal by design (`task-board/index.ts:958-965`), so on the 120 s default
  (`DEFAULT_LEASE_DURATION_MS`, `tasks/collection/internal.ts:640`) a parked run's row becomes
  claimable about two minutes in — and it **is** then reclaimed: the next drain on that board takes
  the task and re-runs the work from scratch. Settled from **tests already committed and passing on
  `main`** rather than by argument — `test/task-board/lease-recovery.test.ts` (park · lapse · a
  separately constructed board drains → `attempts 2 · abandonments 1`, a genuinely new worker having
  run it), corroborated by FIX-982's detached-child-death scenario and by `claim-task.ts`'s own *"a
  lease reclaim deliberately hands an abandoned task to a second worker"*. And when the answer
  arrives afterwards, the resumed original's settle is **declined `lost-claim`**, because its claim
  ticket no longer names the row's current attempt (`test/collection/lease-fence.test.ts`) — the
  answer lands in a run whose write-back is discarded, silently.
  **That last fact is the one that outlived the design, and it is why D-1 is well-founded.** Holding
  a human answer against a *lease* means the whole round trip rests on a duration chosen before the
  question is asked, and choosing it too short fails without a sound. A **board wait-status** does
  not have that property: waiting is a state of the row, not a countdown. *(An earlier fold priced
  the window as five lines of dispatcher configuration in Conductor's own code, which was true and
  is now moot — there is no window to configure, because the run does not park the request.)*

- **~~D-1's own open items~~ — ALL CLOSED.** *(Owner, #1362: "Issue #1429 still-open list is
  empty.")* D-1 settled the path (Relay + a board wait-status, not `ctx.suspend`) and for a while
  carried a live open list. **That list is now empty.** The questions are kept below as **answered**
  rather than deleted, so a reader can see they were asked — and so nobody re-opens one thinking it
  was never considered.
  - **~~The human-wait status and how it lands on the row~~ — ANSWERED: the status is `parked`.**
    `needs_input` is **demoted to the human-ask display/reason — the *why*, not the *what***;
    dependencies stay `blocked`. **This supersedes an earlier answer recorded here** that made
    `needs_input` the status itself. **Shipped `awaiting_review` stays this cycle**; the rename
    `awaiting_review → parked` is [FIX-1245](https://linear.app/fixpoint-labs/issue/FIX-1245) under
    FIX-980 (Backlog), to land before FIX-980's human-wait closes. **Park-exit #1422 is not gated on
    it** and ships against whichever name is live. *(The three readings this entry once weighed —
    rename · two statuses · display name — are moot; the answer is a rename, owned by FIX-1245,
    which this epic consumes and does not own. **The gate this put on LAB-139's spec is gone.**)*
  - **~~Who wakes a parked-and-exited board, and where park-exit lives~~ — ANSWERED (D-1
    membership).** The wake is **FIX-1244** (unblock-with-input) and park-exit is **FIX-1234**, both
    under **[FIX-980](https://linear.app/fixpoint-labs/issue/FIX-980)** — **related to Relay, not
    parented under it, and not under LAB-140.** **This epic consumes them and owns neither**;
    LAB-139 is FIX-1244's first consumer. What remains is a **schedule** dependency (FIX-1244 is
    Backlog), carried in §1's limits — and **this document still proposes no wake.**
  - **~~Does "answered" mean continuing the coding agent's own conversation?~~ — ANSWERED: yes, and
    it is a Proof blocker.** **Restart is not Proof.** The POC is
    [FIX-1246](https://linear.app/fixpoint-labs/issue/FIX-1246) under FIX-1179 (Backlog); this epic
    **consumes it and does not build the resume**. §1 carries it as a limit. *(This reverses this
    document's oldest decided entry — see the struck entry below.)*
  - **~~FIX-1200's sequencing~~ — ANSWERED, and narrower than the question assumed.** The scoped
    piece is a **fence**: `ctx.suspend` must **error** if called inside a workstream —
    [FIX-1247](https://linear.app/fixpoint-labs/issue/FIX-1247) under FIX-1200, Backlog. **Not a full
    FIX-1200 rewrite**, and not this epic's to build.
  - **~~BullMQ / serverless this release~~ — ANSWERED: out of cycle.** **In-process Relay is enough
    for the Proof**; BullMQ HITL is not in this cycle.
  - **~~Are `onIdle: complete` HITL boards in or out?~~ — ANSWERED, as a substrate expectation this
    epic relies on rather than builds:** `onIdle: complete` **must not report success while parked
    rows are still open.** The owner's model — *"a drain drains what it can. Held rows block
    dependents. The board is **not complete** while anything is on hold and not cancelled."*
    Recorded here because the Proof leans on it; **nothing in this set implements it.**
  - **~~Whether a pre-chosen lease is an acceptable product control~~ — moot.** The lease design was
    withdrawn with the suspend park; there is no pre-chosen window to accept or reject.
  - **Coordinator UX — not D-1's, and not the substrate's.** Both constructions are already allowed
    by the substrate, so there is no substrate pick to make. Any remaining presentation choice is
    **this epic's own product decision** (LAB-139 / LAB-140), and it is moved out of the D-1 list on
    that basis.

- **~~What is the human-wait status called?~~** *Decided: the status is **`parked`**.* Owner call on
  #1362, and it **supersedes an earlier answer recorded here** — this entry read *"Decided:
  `needs_input`"* for part of a day. **`needs_input` is the human-ask display/reason, not the
  status**: a row is `parked`, and `needs_input` says what it is parked *on*. **Dependencies stay
  `blocked`.** The reasoning that produced the distinction is unchanged and still holds — a board
  must be able to show which rows wait on a **person** rather than on other work, so this was never a
  naming preference. **Shipped `awaiting_review` stays this cycle**; the rename to `parked` is
  **[FIX-1245](https://linear.app/fixpoint-labs/issue/FIX-1245)** under FIX-980 (Backlog), which this
  epic **consumes and does not own**, and **park-exit #1422 is not gated on it.** The shipped
  **verbs** `awaitReview` and `resumeFromReview` are unchanged by any of it.

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

- **~~Do questions ride the hot path, or wait for the relay layer?~~** *Reversed by **D-1**: the
  questions ride **Relay**.* This document carried "the hot path, by parking the run" for four
  folds. Owner decision D-1 (#1429 / FIX-1241) chose Relay plus a board wait-status instead, so the
  answer here is the one this entry previously argued against. **The reversal is the owner's and is
  not re-litigated in this document.**
  **What the entry established that is still true and still useful:** a parked run holds **no board
  worker slot** — the suspended request settles and lets go
  (`packages/engine/src/execution/runAction.ts:1503-1520`) and the launching board never counted the
  row (`countWaitable` skips handed-off rows, `task-board/shared.ts:184-198`). Both were claims this
  document asserted for three rounds before checking, and both were withdrawn on checking. They no
  longer price anything here, because nothing in the chosen design parks a request.
  **What it got wrong, recorded because the class recurs:** it claimed the lease and the board's
  wait count interlock. True of the predicate, inert in the running system — `countWaitable` decides
  anything only while a drain is running, and this set's launching drain has already exited
  (`task-board/quiescence.ts:95-110`). The correction to *that* correction is in the lease entry
  above: expiry invokes no claim, but the next drain reclaims the row and re-runs the work.
  **FIX-1197's relay is no longer a thing this epic declines — it is the channel.** §1's limits
  price the dependency: Relay is its own epic, this one consumes it, and the epic's schedule is not
  silently made Relay's.

- **~~Does an answer continue the coding-agent conversation, or restart it?~~** *Answered: **it must
  continue**, and **restart is not Proof**.* **This reverses this document's oldest decided entry**,
  which read *"it restarts it… correct and expensive; accepted, and not to be worked around"* from
  the day the epic was drafted. The owner: *"LAB-139's 'continuity out of scope / restart accepted'
  is **stale** — strike it. This epic is **blocked on that POC for Proof**, it does not build the
  resume itself."*
  So a run that answers by **re-stating the prompt and starting the agent over does not count as the
  Proof passing.** The POC is [FIX-1246](https://linear.app/fixpoint-labs/issue/FIX-1246) under
  [FIX-1179](https://linear.app/fixpoint-labs/issue/FIX-1179), **Backlog**, and it says the same in
  its own words: *"the task is already associated to the coding session, so resume from a second
  request should be possible… This is a POC, not Proof. Restart is not the POC passing."*
  **This epic consumes it and does not build the resume** — that boundary is the one part of the old
  entry that survives. §1 carries it as a limit and as the fourth consumed dependency.
  *(Entry history, because this one moved twice: decided *restart* at drafting; re-grounded twice on
  premises that kept moving; held open when D-1 listed it; now answered the other way.)*

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
  (a dead worker's row waits out the configured window). *(Superseded by the final entry: the
  window needs no framework change — `TaskBoardConfig.dispatcher` already accepts a `TaskDispatcher`
  instance. The outcome is unchanged; the mechanism is five lines in Conductor.)* **Every correction in this fold was to a
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
  human intervenes or some later drain claims it. *(Superseded by the entry below: a lapsed row
  **is** reclaimed by the next drain, which conductor runs on every wake. The real exposure is a
  duplicate attempt and a fenced write-back, not a permanent strand.)* What would close it (a later drain trigger, the
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
- **Correction fold — theme 7 did to itself what theme 7 exists to prevent, and settlement 4
  corrected our own last correction.** Not a review round. Two corrections, both verified in source,
  both to clauses this document supplied. **First, the resume reference was incomplete.** Theme 5
  cited `resume-routes.ts:136-227` as the transaction to mirror, and that range stops before the
  rollback. The `catch` at `255-273` reverts the `SuspensionRecord` to `pending` and releases the
  continuation lease when setup fails *before the point of no return* — and its own comment
  explains why reverting is safe there and nowhere later, citing FIX-1095 if that boundary moves.
  Mirroring only `136-227` takes the lease, resolves the record, fails during setup, and leaves
  the record resolved with the lease held: **the operator's answer becomes permanently
  non-retryable on a run that never began.** Theme 5's constraint now names revert-and-release as
  part of the transaction and cites the whole handler. *(This entry originally stated that pair in
  the wrong order — resolve before lease. Corrected here; see the consolidation entry below, where
  getting the order wrong a third time is what forced the mechanism out of this document.)* **Second, "exit code" excluded the only
  adapter this epic builds.** Theme 7 defined a machine-readable result as an exit code plus a
  final JSON object; `SdkAgentHandle` (`claude-code/src/sdk/types.ts:32-44`) carries
  `status`/`resultSubtype`/`finalMessage`/`usage`/`costUsd` and **no process and no exit code**, so
  the clause forced the in-process SDK adapter — the only watched path in scope (theme 4) — to
  fabricate a CLI-ism. It is now semantic success/failure plus the terminal payload, with a CLI
  adapter translating its exit code into that.
  **The irony is the lesson.** Theme 7 exists to stop one harness's shape becoming the contract,
  and it was written by taking the *CLI research's* shape and making it the contract — excluding
  the adapter we are actually building. That is the third instance of mechanism-over-capability in
  this one theme (`killable subprocess` → cancellable; the process-spawn seam, withdrawn; exit code
  → semantic result), in three days.
  **So the theme is consolidated rather than corrected a third time.** §2's own altitude rule says
  the epic-spec names constraints and the issue specs name the calls; theme 7's clauses named
  calls, bound exactly one issue (LAB-138 defines the contract; LAB-139 consumes it as a contract),
  and were unverifiable at this altitude — which is what three corrections in three days
  demonstrated. Theme 7 now carries only what is genuinely cross-cutting: the obligation, the
  not-in-scope disclaimer that keeps it from reading as a commitment to a second adapter, the tell
  that makes it falsifiable, and *portability is served by the adapter boundary, not the seam's
  transport*. Its closing paragraph also duplicated theme 4's `cli/dispatch.ts` argument, which is
  how the withdrawn process-spawn conclusion went stale in the first place; theme 4 keeps it.
  **Everything cut is routed, not dropped** — the bound and `sdk/agent.ts:434`, the result shape as
  corrected, adapter-optional usage, per-adapter permission posture, and the
  **documented-not-executed** Codex/Cursor evidence with that caveat attached, all in LAB-138's
  implementer notes. LAB-139's existing resume note was amended in place with the rollback step
  rather than followed by a second note that corrects the first. **§2 stays at seven themes and
  gets shorter; §4's LAB-138 row was reconciled to say where the clauses now live, since a row
  still promising a bound the theme no longer states is the same defect one surface over.**
  **Same fold, second half — settlement 4 came back CONFIRMED, and it corrects the correction
  directly above.** The long lease is load-bearing and the owner's decision stands, settled not by
  a new POC but by **tests already committed and already passing on `main`**:
  `packages/orchestration/test/task-board/lease-recovery.test.ts` (*"a worker that parks on a
  suspension stops holding its task"*) parks a worker on a `SuspensionError`, lets the lease lapse,
  drains a **separately constructed** board over the same live collection, and the row completes
  `attempts 2 · abandonments 1` with a genuinely **new** worker having run the work — corroborated
  by FIX-982's `task-board-detached-child-death` scenario (dispatch 1 → 2) and by the shipped
  comments in `shared.ts`/`quiescence.ts` and `claim-task.ts`. **So the previous entry's conclusion
  is withdrawn**: a parked run whose harness dies is *not* stranded `in_progress` indefinitely.
  Codex's underlying point survives — lease expiry *invokes* no claim — but conductor drains on
  every wake, so reclaim follows in the ordinary course, and a row strands only if no further drain
  ever runs on that board.
  **The replacement limit is sharper than the one it replaces, which is why it is stated rather
  than dropped.** `packages/orchestration/test/collection/lease-fence.test.ts` (*"refuses a settle
  from a worker that ran past its lease"*) shows what happens when the answer finally arrives: the
  resumed original carries its **original claim ticket** across the suspend, the reclaim bumped the
  row's attempt, and the settle is declined `lost-claim`. **The human's answer is delivered into a
  run whose write-back is discarded, and the reclaimed attempt's output is what lands.** A
  too-short lease does not merely cost a duplicate run — it silently forks what the operator
  answered from what shipped. That is now stated beside the lease decision, because it *is* the
  reason the lease value matters. **"Not unattended-safe" is kept, and re-grounded**: not because a
  row strands, but because the only control is a window chosen before the question is asked and
  choosing it too short fails silently. §1's limits, theme 5's *Hold* move and park table, §5's
  lease entry and the hot-path entry were all reconciled to this one reading, and the superseded
  sentence in the entry above is marked in place rather than rewritten, so the log still records
  what we believed when.
  **Process note, and it is the cheap lesson of this fold:** settlement 4 cost nothing to run
  because the answer was already committed. Several of this epic's wrong board claims — the held
  slot, the wait-count interlock, the indefinite strand — would have been answered the same way.
  **For a claim about the task board, read `packages/orchestration/test/` before reasoning from
  source and before commissioning a POC.**
  **§1's five gated lines — Outcome, Proof, Lead measure, Not doing, Kill line — are unchanged;
  what changed in §1 is the limits block beneath the Proof, which now names four limits instead of
  three and no longer overstates one of them.**
- **Consolidation fold — the epic-spec was specifying an implementation it could not verify, and
  it stops.** Not a review round. The two folds above each flagged that §2 was under altitude
  pressure; this one acts on it, and the trigger is a pattern rather than a finding. **Three
  consecutive rounds found a defect in this document's specification of LAB-139's wake path — and
  none of them found a defect in the design.** The mechanism was named at epic altitude, where the
  source is not open, and it was wrong at a reliable rate: a bare `continueRequest()`; then a
  transaction missing its rollback; then, in the same breath as correcting that, **the step order
  itself stated backwards** — `resume-routes.ts` acquires the continuation lease at `201` and only
  then resolves the record at `221`, so the real order is **guards → lease → resolve → continue →
  revert-and-release**, not resolve-then-lease. Under the wrong order two answers can pass the
  pending guard, overwrite the record, and *then* fail lease acquisition, leaving an answer marked
  resolved whose continuation never began.
  **So themes 5 and 7 now carry obligations and no recipes.** Theme 5 keeps the four moves as
  things that must hold — park by suspending alone, hold the claim with a configured lease, wake
  through a single correctly-ordered, replay-safe, idempotent resolution transaction whose
  reference implementation is `resume-routes.ts`, and check the handle before settling — plus the
  measured park table and the durable-replay property that generalises past conductor. Theme 7
  keeps the portability obligation, the not-in-scope disclaimer and the tell. **Everything below
  that altitude moved into LAB-138's and LAB-139's implementer notes and nothing was dropped:** the
  transaction's step order and rollback, the replay-safety requirement, the `suspensionId`
  projection seam, the semantic-result shape, cancellable-with-a-deadline, adapter-optional usage,
  per-adapter permission posture, and the documented-not-executed Codex/Cursor evidence with that
  caveat attached. §5 keeps its decision *records* — what was decided and why is the epic's memory;
  the *how* left with the rest.
  **Two of this fold's three findings are new scope, not prose fixes, and they are LAB-139's.**
  The inbox write that precedes a suspend has no committed output, so it **re-executes on
  continuation** — the same durable-replay property that made the runner's `.tap()` gate unsafe
  (FIX-1200) — and an unguarded write can recreate or reset the row and attach the answer to a
  stale one. And **nothing projects the `suspensionId` anywhere the waker can read**:
  `context/createExecutionContext.ts:3205-3206` mints it internally and immediately throws, and
  `ctx.suspend()` accepts no id and returns nothing, so it reaches the suspension record and the
  stream item but never the run row. Until LAB-139 builds an idempotent projection or lookup seam,
  the wake path cannot address the gate at all. Both are named in theme 5 as obligations and
  specified in LAB-139's notes. *(Superseded by D-1: the `suspensionId` projection seam is withdrawn
  along with the suspend park, and §1's Proof no longer names the pair. The **wake** half of this
  finding did not go away — it moved. **It has since been located: FIX-1244 under FIX-980 owns the
  wake, and this epic consumes it** (owner, #1429). The **replay-safe inbox write** obligation
  survives D-1 unchanged.)*
  **The durable lesson, and it is the one worth keeping past this epic:** an epic-spec that names
  a call sequence has taken on a verification burden it cannot discharge, because verifying a call
  sequence means reading the file, and reading the file is the issue spec's job. §2's altitude rule
  said this after the first instance; it took three to act on it. **§1's five gated lines —
  Outcome, Proof, Lead measure, Not doing, Kill line — are unchanged, as they have been through
  every round and every fold. The epic still means exactly what it said.**
- **Subtraction fold — the answer window needs no framework change, and the epic gives back a
  public-surface expansion.** Not a review round. A P2 from a Codex review, verified in tree.
  This document carried "expose a claim/lease option on `taskBoard`" as framework work inside
  LAB-139 for two folds. **It was never needed.** `TaskBoardConfig.dispatcher` already accepts a
  `TaskDispatcher` instance (`TaskBoardDispatcherInput = TaskDispatcher | "fifo" | "topological" |
  "priority"`, `task-board/shared.ts:27-31`), `TaskDispatcher` is publicly exported from
  `@flow-state-dev/orchestration/tasks` (`tasks/index.ts:137`), and a dispatcher's whole job is to
  call `collection.claim(workerId, opts)` — `fifoDispatcher` is literally that one call
  (`tasks/dispatchers/fifo.ts:10-14`). So Conductor's board configures its own dispatcher with the
  answer window: **five lines in Conductor's own code.** The repo already ships the same shape as
  `leasingDispatcher` in `test/task-board/lease-recovery.test.ts:54-60` — the very test that
  settled the lease question two folds ago.
  **It holds across renewals, which is the half that had to be checked.** `startLeaseRenewal`
  derives its span from the claimed row rather than from a constant —
  `span = claimedTask.leaseUntil - claimedTask.updatedAt`, and every tick writes `now() + span`
  (`tasks/lease-renewal.ts:203-205, 234-238`) — so a dispatcher-set duration is the duration for
  the row's whole life, not a value the first renewal shortens back to the 120 s default. The
  docblock says so outright: *"a dispatcher that claimed with a five-second lease and a driver that
  assumed two minutes cannot disagree, because there is nothing to agree about."* And
  `MAX_LEASE_DURATION_MS` is `2_147_483_647 * 3` (~74 days), sized so `span / 3` fits the renewal
  timer's int32 delay — the constant was built for exactly this.
  **The outcome the product owner signed off on is unchanged.** The answer window is still closed
  and the parked row is still held; the limit §1 prices — a dead worker's row waits out the
  configured window — is the same limit. Only the mechanism got cheaper, so **this is not scope
  being quietly dropped**, and it is said in §5 in those words. What the epic gives back is a
  **public-surface expansion it no longer needs**, which also breaks a symmetry this document
  asserted: the lease is *not* a sibling of LAB-138's per-run `cwd` seam, which is a genuinely
  missing capability (theme 4). One was real framework work and one was a seam we had not looked
  for.
  **Routed, not dropped:** the dispatcher recipe and its four citations are in LAB-138's and
  LAB-139's implementer notes, along with the one caveat that does not belong in this document — a
  bare `collection.claim(workerId, { leaseDurationMs })` takes the substrate's **default**
  eligibility and ordering (pending + deps satisfied), not fifo/topological/priority, which is
  correct for the Proof's one board but means a board that later wants topological ordering
  composes `{ eligibility, order, leaseDurationMs }` rather than dropping the standard dispatcher.
  **The lesson is the mirror of the last fold's.** That one found this document specifying
  mechanism it could not verify; this one found it **scoping framework work that already existed**,
  for the same reason — a claim about a public surface asserted without the surface open. The
  generalisation that covers both: *before scoping framework work, grep the exported type.*
  **§1's five gated lines — Outcome, Proof, Lead measure, Not doing, Kill line — are unchanged.**
- **Owner decision fold — D-1: the HITL path is Relay plus a board wait-status, not `ctx.suspend`.**
  Trigger: the product owner's decision on GitHub issue
  [#1429](https://github.com/fixpoint-labs/flow-state-dev/issues/1429) (*"D-1: HITL path — Relay +
  `awaiting_feedback` vs suspend"*), mirrored as FIX-1241. **Not a review round and not a
  correction — a decision that changes the design.** What changed: theme 5 now states three
  obligations (ask over Relay · wait as a task status distinct from blocked-on-dependency · settle
  on the handle check) in place of the four-move suspend park; §1's limits drop the answer window
  and the silent lost-claim and gain the two consequences the decision creates; §5's
  `awaiting_review`, lease and hot-path entries are marked superseded as *plans* and kept as
  *evidence*; D-1's own open items are recorded unanswered; LAB-139's index row and implementer note
  are rescoped. Withdrawn: the `ctx.suspend` park, the configured dispatcher lease window, the
  in-process resume-as-HITL action and its `resume-routes.ts` transaction, and the `suspensionId`
  projection seam. **FIX-1200 survives as a caution** — *do not combine `awaitReview` with
  `ctx.suspend` on today's detached runner* — and no longer as a reason to choose suspend; that
  inference is exactly what D-1 killed. **Unchanged:** the Outcome, the Proof's substance (a real
  issue to an open PR with one decision asked and answered without a terminal), theme 6, theme 7,
  LAB-138, the inbox row as the question's carrier, and the replay-safety obligation on writing it.
  **Two gated lines did change**, which no previous fold has done and which is called out rather
  than buried: the **Proof** line no longer names the `{requestId, suspensionId}` pair it read off
  `runs/*`, and **Not doing** no longer scopes out the relay layer — Relay is the channel now, so
  what this epic is not doing is *building* it. Neither edit touches what the Outcome promises.
  **Why this is not a retreat, in the architect's words on #1429: there is no single primitive, and
  the split is allowed** — an in-request `suspend`, a board wait-status and a Relay send are three
  different things.
- **Owner decision fold — D-1 addendum: the human-wait status is `needs_input`.** *(Superseded by
  the closing fold below: the status is **`parked`**; `needs_input` is the display/reason.)* Trigger: the
  product owner's follow-up on #1429. What changed: theme 5's *Wait* obligation, LAB-139's index row,
  and §5 — the status name moves from the open list to a decided entry. **Dependencies stay
  `blocked`**; a distinct name is the decision rather than a synonym, because a board must be able to
  show which rows wait on a **person** rather than on other work. **`needs_input` is the product
  name; the shipped verbs `awaitReview` and `resumeFromReview` are unchanged.** Recorded as a **new
  open item, deliberately unpicked**: how `needs_input` relates to the shipped status enum — which
  has `awaiting_review` and not `needs_input`, while FIX-1234 (In Review) says the gap is *"the exit
  predicate, not a new status"* — rename · two statuses · product-layer name. **Every other D-1 open item stays open; this settled the name only.**
- **Reversal fold — the enum landing was closed on a recommendation, not on a decision, and is
  reopened.** The sequence, written out because a reader six weeks from now should see that this
  question moved twice rather than find a silent flip — **and because the error in it was an
  attribution error**: at **16:34:14Z** the **Architect recommended** that `needs_input` **rename**
  the shipped enum member; that recommendation **reached this document as though the owner had
  decided it**, and was written in and pushed as **`3a51956`**. At **16:36:15Z the owner held the
  question open** — *"leave the enum-landing question open. D-1 still has a confirm (rename of
  shipped `awaiting_review` vs two statuses). Don't pick it in this spec until that returns."* The
  close was **reverted in `8d1bf43`** and the open state rewritten here. The owner then reaffirmed
  on the PR: *"Decision Manager will not close that on my rec. Jake has not answered it."*
  **To be exact about who decided what: the Architect recommended the rename; the owner has not
  picked between rename and two statuses.** The **name** `needs_input` is the owner's call and is
  decided; the **landing** is not.
  **The lesson, and §5 is precisely where it has to hold: a decision arriving through a channel is
  not the same as a decision made by the person that channel speaks for.** A recommendation is input
  to a decision. Every *Decided* entry in §5 carries weight only because it means **the owner
  decided** — so a relayed recommendation recorded as an owner call does not just mis-credit
  someone, it forges the one signal this section exists to carry.
  **What the reverted close wrongly carried, now removed:** the BP-030 dual-read as **this epic's
  decided path** (it is a consequence of the rename reading only, so asserting it presumed the
  answer — it now appears as that option's price, inside the option), a deprecation/sweep path this
  epic has no business designing, and a follow-up-issue claim for a rename issue that does not
  exist. **The split is now stated before anything else in §5**, because it has been mis-recorded in
  both directions: **`needs_input` as the product name and dependencies staying `blocked` are
  DECIDED**; only the **representation on the row** is open, in three readings — with option 2
  sharpened to the owner's framing, a genuine product distinction rather than an implementation
  variant. **Park-exit #1422 / FIX-1234 is unblocked either way**, the one boundary that survives.
  **Folded in the same pass (Codex P1s on `98eb2d1`):** theme 5 required *persisting* `needs_input`
  while §5 deliberately left the representation open, which made it unimplementable — it now states
  the obligation (a status distinct from `blocked`) and names the representation as the gate on
  **LAB-139's spec at the point it names the field**, not on the issue. And the steer entry stood as
  *decided: it restarts* while D-1 carries *"does 'answered' mean continue the coding-agent
  conversation? (FIX-1179)"* as open — re-opened, narrowed to what holds regardless (nothing today
  can hand a prior SDK session id into a detached run), with §1's Not-doing line narrowed the same
  way and the no-continuity-machinery scope-out unchanged.
  **Kept as neutral fact:** the shipped verbs `awaitReview` / `resumeFromReview` are not renamed by
  anything in D-1. **The lesson about this document's reflexes:** two entries here were re-grounded
  on premises that kept moving, and both times the honest move was to hold the question open rather
  than find the old answer a new justification.
- **Membership fold — D-1 membership closed, and the "unowned wake" claim was false.** Trigger: the
  owner's decision on [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362) —
  *"D-1 membership closed. Park-exit is not this epic and is not Relay. The human-wait board pair
  lives under FIX-980 (honest task substrate). Unblock-with-input is FIX-1244 … This epic **consumes**
  park-exit + FIX-1244; it does not own them. Still propose no wake locally."*
  **The correction that matters: this document said nobody owned the wake, and that is now wrong.**
  **FIX-1244 owns it** and states the gap in its own words — park-exit lets a drain *leave* while a
  row sits parked, *"that is half the pair"*, and no primitive yet resumes that row with a payload as
  a new workstream request, so *"an honest park-exit is a dead letter."* It also names LAB-139 as
  **first consumer, not owner**, and independently reaches this epic's own finding from the other
  side: `resumeFromReview`/`continueRequest` are the wrong shape after park-exit because they assume
  the launching request is still open. **The wake is a schedule dependency now, not an ownership
  gap** — a distinction §1 and §4 both state rather than blur, because **FIX-1244 is Backlog** and the
  Proof's round trip still needs a verb nobody has built.
  **Second correction, and it was this document's error to inherit: park-exit was priced under
  Relay.** It is not. **One dependency was really two:** the **ask** is Relay's (FIX-1230, In
  Development, under FIX-1197); the **park and the wake** are the honest task substrate's (FIX-980 —
  FIX-1234 In Review, FIX-1238 Backlog, FIX-1244 Backlog), **related to Relay but not parented under
  it, and not under LAB-140.** §1's limits now carry both, named separately.
  **Changed:** §1's dependency and wake limits, §4's index note (still visibility, still not a plan),
  §5 — where membership moves from the open list to a **closed** item rather than being dropped, so
  the record shows it was answered. **Unchanged and deliberately so:** no wake is designed here, no
  scope is added to LAB-139, and no issue is created or implied. **The remaining D-1 opens are
  untouched:** rename vs two statuses · FIX-1200 sequencing · continuity (FIX-1179) ·
  BullMQ/serverless · `onIdle: complete` boards.
- **D-1 closing fold — the decision closed, and two of its answers reversed what this document had
  written.** Trigger: three owner comments on
  [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362) (18:49 · 18:50 · 19:25);
  **where they conflict the latest wins**, which matters because the status answer moved between
  them. **D-1 is closed — #1429's still-open list is empty.**
  **The status is `parked`, and `needs_input` is demoted to the human-ask display/reason — the *why*,
  not the *what*.** This **supersedes** the answer recorded here earlier the same day, which made
  `needs_input` the status itself; every place calling it "the product name for the status" was
  wrong and is corrected. Dependencies still stay `blocked`. **Shipped `awaiting_review` stays this
  cycle**; the rename is **FIX-1245** under FIX-980, before FIX-980's human-wait closes, and
  **park-exit #1422 is not gated on it.** **The enum-landing question is closed, so the gate it put
  on LAB-139's spec at the field-naming point is gone** — and the status returns to LAB-139's
  buildable list, reversing an edit made an hour earlier when the representation was still undecided.
  **Restart is not Proof — and this kills the oldest decision in this document.** *"LAB-139's
  'continuity out of scope / restart accepted' is **stale** — strike it. This epic is **blocked on
  that POC for Proof**, it does not build the resume itself."* The Proof now **requires** continuing
  the same coding session across the wait; a run that re-states the prompt and starts the agent over
  **does not count as the Proof passing**. The POC is **FIX-1246** under FIX-1179 (Backlog), which
  says the same itself. Struck from §1's Not-doing, §5's decided entry, and the index row. **So the
  consumed set is four, not three** — FIX-1230 · FIX-1234 · FIX-1244 · **FIX-1246** — and every place
  that counted three now counts four.
  **The smaller closures, all recorded as answered rather than dropped:** the FIX-1200 question is
  narrower than asked — the scoped piece is a **fence** (`ctx.suspend` errors inside a workstream),
  **FIX-1247** under FIX-1200, not a rewrite; **in-process Relay is enough for the Proof** and BullMQ
  HITL is out of cycle; **`onIdle: complete` must not report success while parked rows are open** —
  *"the board is not complete while anything is on hold and not cancelled"* — recorded as a
  **substrate expectation this epic relies on**, not as something it builds; and **coordinator UX is
  not a substrate pick at all** (both constructions are already allowed), so it moves out of D-1 and
  into this epic's own product scope.
  **§5 keeps every closed question as struck-and-answered rather than deleting it**, the same
  treatment membership got — a reader has to be able to see what was asked, or the next round
  re-opens it believing nobody considered it. **Boundaries held:** no wake, no resume and no rename
  is designed here; the only scope change to LAB-139 is the status returning to its buildable list.
- **Constraint fold — one `flow.workstream` core, not a `taskStart`/`taskUnpark` pair.** Trigger: an
  owner design constraint on [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362) —
  *"Do not design `taskStart`/`taskUnpark` as two workstream actions — one `flow.workstream` core,
  reuse-or-mint the harness session id inside it."* Added as **theme 8**, because it binds both
  issues: LAB-138 enters the core to start a run and LAB-139 re-enters it after a wait, and the
  constraint says those are the same core. **§2 goes from seven themes to eight**; the addition is an
  obligation with a tell, not clause-level detail, which is the line the consolidation fold drew.
  **Checked before writing rather than assumed:** `flow.workstream` **already exists** as the single
  `ActionCore` a `source: "workstream"` dispatch resolves to
  (`packages/core/src/flow/workstream-core.ts` — *"the one workstream core a detached dispatch
  resolves"*). So the theme is worded as constraining a seam that is already there and **not** as
  this epic building one. **No mechanism is stated** — how the session id is reused or minted, and
  where the task's association to it is read, are the issue specs' with the source open, and one line
  in each of LAB-138's and LAB-139's implementer notes points at the constraint. **Nothing else
  moved:** D-1 stays closed, the consumed set stays four, `parked` stays the status.
- **Correction fold — the decided name and the landed enum member are different facts.** Trigger: a
  Codex P2 on `b155d3f`, accepted. §1 listed the human-wait status as buildable on the strength of
  the enum-landing confirm having returned. **True about the decision, false about the code:**
  `TaskStatus` accepts `awaiting_review` and not `parked`, and the rename is FIX-1245 — Backlog and
  external — so an implementer reading "buildable" would reach for a value the schema rejects.
  **The owner's answer is not a re-gate**: *"keep shipped `awaiting_review` in this cycle… park-exit
  ships against whichever name is live."* So **LAB-139 builds against the shipped `awaiting_review`
  now**, `parked` is the decided target, and FIX-1245 renames it later. §1, theme 5 and LAB-139's
  index row all now separate the two facts on the page instead of leaving them to be inferred —
  **this passage has moved three times** (gated · buildable · buildable-against-the-shipped-name),
  and every move came from collapsing a naming decision into a schema state. **The gate that once sat
  on LAB-139's spec is gone and stays gone.**
  **Declined in the same round, and recorded because the reasoning is worth keeping:** a Codex P1
  wanted **FIX-1238** added to the consumed Proof-blocker set, on the grounds that without its
  carrier the manager could misclassify a parked phase. **FIX-1238 does not supply the carrier — it
  hardens one that already works.** In its own words the current path *"works, and it is
  invocation-scoped by construction… But it rests on **ordering discipline, not a typed contract**."*
  The verdict already travels. So **the consumed set stays four** and this document does not imply
  the verdict is missing. **The hazard is real but it is a trap, not a blocker**, and it is aimed at
  the drain LAB-138 composes — routed there as a caution in its implementer note rather than promoted
  to a dependency here.
  **And FIX-1238 is out of §1's enumeration entirely, not merely excluded from the count.** Listing
  it beside FIX-1234 and FIX-1244 — which the Proof genuinely waits on — gave it a status it does not
  have, and left a reader counting **five** links under a sentence that says **four**. That is the
  same class of internal inconsistency this document spent the day removing, so the list and the
  count now agree by construction rather than by a caveat.
- **Correction fold — two claims that outran what is landed, both narrowed rather than gated.**
  Trigger: two Codex findings on `78408a8`, both verified.
  **First (P2): the goal-check claim.** §1 said LAB-139 could *"build and goal-check"* the human-wait
  status and settlement before the consumed work lands. It can build and **unit-test** those; it
  **cannot goal-check the parked phase end to end through the manager loop** until FIX-1234, because
  today's runner is unconditionally `.step(worker).tap(recordSuccess)` and stomps an `awaitReview`
  write to `completed` on any normal return — **row 1 of this document's own measured table.** The
  two claims are now separated on the page. Same class as the `parked` correction directly above: a
  claim about what is **decided** outrunning what is **landed**, which is the failure mode this
  document keeps returning to.
  **Second (P1), and it is the sharpest finding of the day — stated, not solved.** Three legs that
  each look survivable alone: D-1 made same-session continuation **mandatory for the Proof**; the
  only path Conductor has, `claudeCodeAgent({ detached: true })`, **deliberately suppresses the SDK
  `resume`** — *"one decision rather than three… the session provider is not consulted at all"*, with
  the stated consequence *"a second task addressed to the same workstream starts the agent fresh"*
  (`sdk/agent.ts:124-135`); and FIX-1246 is scoped **POC-only**, explicitly excluding the full
  FIX-1179 rewrite. Together: **every named issue and every consumed dependency can finish and the
  Proof still will not run.** Added as a §1 limit beside the wake gap and given the same treatment —
  **named as the owner's, designed nowhere.** The point worth carrying is that a production path
  means **revisiting a documented decision**, not filling an unnoticed hole, and those schedule
  differently. **This document does not re-open that decision**; naming that it would have to be is a
  different act. FIX-1179 is named as the **natural** home and explicitly **not asserted** as the
  answer — the owner decides whether the shipped path is FIX-1179's, LAB-139's, or whether the Proof
  narrows. **§1 goes from four limits to five.** §4's index note gains one clause: its "every issue
  can close while the round trip is unrunnable" point is now true for a **second, independent**
  reason. **Consumed set stays four** — FIX-1179 is not added to it.
