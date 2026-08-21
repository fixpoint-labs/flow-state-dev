# Epic-spec — The harness manager

**Epic issue:** [LAB-140](https://linear.app/fixpoint-labs/issue/LAB-140/the-harness-manager-drive-one-real-issue-through-a-conductor-phase) ·
**Branch:** `epic/harness-manager` · **Project:** Development Workflow Orchestration (Labs)

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Nothing has yet driven one real issue end to end through the Conductor seam.
Every piece under that seam works on its own — the board claims and routes, `claudeCodeAgent`
runs, `startDetached` spawns, `settleParentTask` closes the row — and no one has put a real
issue through the join between them. This epic does exactly that, once, on real work, and
treats the join as the thing under test rather than the parts.

> **Outcome** — A real issue in this repo goes from a task row to an open PR driven by
> Conductor rather than by a person in a Claude session, including at least one point where
> the run needed a decision and got one without anybody opening a terminal.
>
> **Proof** — LAB-139's goal check: one real Linear issue (recommended: FIX-1196) driven from
> a conductor task row to an open PR, where the run posted a question to the inbox, the answer
> went back in through `steer`, and the run finished on it. Readable off the run's own `runs/*`
> row, the inbox row, and the PR.
>
> **Lead measure** — the set's goal-proven issues, named: FIX-150 · LAB-138 · LAB-139.
>
> **Not doing** — the mail/relay layer (FIX-1197 owns it; questions ride the hot path here,
> held in `awaiting_review` while the operator is present) · the parked-task cold path
> (`pending feedback` + a settle-time watch) · resume-with-continuity for a steered run
> (FIX-1179 — a steer restarts the coding agent with a re-stated prompt, and that is accepted)
> · the spec and review phase records and the durable approval gate between phases · the
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
at implementation. FIX-150 is not in question — a coding run's files have to live somewhere
and come back as state, its spec is already approved, and it subsumes a live data-loss bug
(FIX-998).

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

## 2. Themes & long-horizon direction

1. **The coordinator stays small on purpose.** The bet under test is that the session a person
   talks to holds only the *currently-open questions*, because the run's memory lives in
   resources rather than in a conversation. Every design call in this set is judged against
   whether it keeps that true. An issue that finds itself wanting to hold run history in the
   coordinator has hit this theme, not a local design problem — comment up on the epic PR.

2. **One manager, three records — not three adapters.** The Atlas's §7 argument: phases differ
   in a *prompt builder*, a *done-condition predicate* and a *readable set*, not in three block
   sequences. This epic writes the manager and **exactly one record (implement)**. The claim
   that a fourth phase costs a record is what the *next* epic tests; nothing here should make
   that harder. Concretely: a manager that cannot be pointed at a different record without
   editing the manager has broken this theme.

3. **Gaps go in the framework, never in conductor** — LAB-68's standing rule, carried forward.
   The tell that this has gone wrong is **a capability only conductor can call**. When an issue
   needs something the framework doesn't have, the work is to add it to the framework layer,
   not to grow a conductor-shaped shortcut.

4. **Everything under this seam already works; this epic is the join.** The board claims and
   routes, `claudeCodeAgent` runs, `startDetached` spawns, `settleParentTask` closes the row.
   The surprises live in the join — particularly **a run that asks something on its first
   turn**, before anything has been observed about it. Design against that case, not against
   the happy one.

5. **Questions ride the hot path.** A run holds its task in `awaiting_review` while its
   question is open, which keeps a worker slot occupied for as long as the person takes. The
   durable alternative needs the relay layer FIX-1197 is building; this epic **adopts that when
   it lands** rather than waiting for it. No issue in this set builds a cold path.

6. **A steer restarts the coding agent.** Nothing can hand a prior SDK session id into a
   detached run today (FIX-1179), so answering a question re-states the prompt and pays again
   for context the agent had already read. Correct and expensive; **accepted, and not to be
   worked around.** An issue that finds itself building continuity machinery has left this
   epic's scope.

7. **The inbox is a plain resource collection, not a new framework capability.** FIX-1075 asks
   exactly the right scoping question — *what does an inbox capability add that a shared
   resource collection does not?* — and the answer here is *nothing this epic needs*. Building
   it as an ordinary user-scoped collection keeps theme 3 intact and gives FIX-1075 the
   evidence it asked for. FIX-1056 is the same gap seen from the steering side.

8. **Sequencing.** LAB-138 lands before LAB-139 — the ask-and-answer path needs a run that is
   already watched and settled. They can be *specced* in parallel; they cannot merge out of
   order. FIX-150 is independent of both on the Conductor axis and is already through its spec
   gate, so it runs on its own track; the run in LAB-139's Proof needs its files to live
   somewhere, which is what makes it a member of this set rather than a neighbour.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [LAB-138](https://linear.app/fixpoint-labs/issue/LAB-138/the-harness-manager-a-task-row-becomes-a-watched-settled-coding-run) | The manager loop — a task row becomes a watched, settled coding run | spec | — | — | Needs spec |
| [LAB-139](https://linear.app/fixpoint-labs/issue/LAB-139/a-run-that-needs-a-decision-can-ask-for-one-and-be-answered) | A run that needs a decision can ask for one, and be answered. **Carries the epic's Proof.** Blocked by LAB-138 | spec | — | — | Needs spec |
| [FIX-150](https://linear.app/fixpoint-labs/issue/FIX-150/workspaces-if-validated-workspacerunner-block-and-virtual-filesystem) | Workspaces — the file-projection component. Large, three PRs (a component · b shell-tool migration · c coding-agent path). Subsumes FIX-998 | spec | [#1345](https://github.com/fixpoint-labs/flow-state-dev/pull/1345) — **approved** | — | Needs implementation |

*FIX-150 is on team **flow-state**, not Labs; it is a sub-issue of LAB-140 across teams. Its
spec gate is already passed (`spec approved` on #1345), so it enters at implementation.*

## 5. Open cross-cutting questions

- **Where conductor's own code lives.** Both LAB-138 and LAB-139 write into the same place and
  neither can settle it alone, so it is the epic's to answer. Raised at epic drafting. **Blocks
  nothing yet** — it blocks LAB-138's spec at the point where that spec has to name a package.
  Put to the product owner on the epic PR as a live fork; the ask is reproduced here so the
  record survives the thread:

  > **A supported public package, or an unpublished one we can churn?**
  >
  > *Plain terms:* conductor is the thing that drives our own development. The choice is
  > whether we publish it as `@flow-state-dev/conductor` — a public surface with a release
  > story, a changelog, and a dependency graph other packages can point at — or keep it as an
  > unpublished app / workspace-private package that nothing outside this repo can depend on.
  >
  > *Trade-off:* publishing makes it a product people can adopt, and makes every later change
  > to it a compatibility question. Keeping it private promises nothing and costs nothing to
  > rewrite, at the price of it reading as an internal tool rather than something the framework
  > offers.
  >
  > *My recommendation:* **unpublished, for now.** The design is still moving — this epic
  > exists precisely because the join has never been run once — and theme 2 says the phase
  > machine is the *next* epic's subject. Publishing a surface whose shape we expect to change
  > buys adoption we are not ready to support. Prior art agrees in one direction: PR #1297
  > explored a deterministic-driver shape and was not merged.
  >
  > *What would change my mind:* if conductor is meant to be something customers run — a
  > selling point rather than our own tooling — then it should be published from the start,
  > because retrofitting a public surface onto a private one is a rename plus a migration note
  > for everyone already importing the private path.
  >
  > *If I'm wrong:* going private-then-public later costs a rename and one release note.
  > Going public-then-churning costs a broken dependency for anyone who adopted it, and the
  > pressure not to churn is what quietly freezes a design we said was still moving.

---

## Epic evolution

- **Epic drafted** — three issues under one outcome: a real issue driven from a task row to an
  open PR without a person in a terminal, with at least one decision asked and answered on the
  way. Kept LAB-138 and LAB-139 as two issues with the seam named, recorded the three settled
  cross-cutting decisions (hot-path questions · steer restarts · the inbox is a plain
  collection), and opened the package-location fork to the product owner.
