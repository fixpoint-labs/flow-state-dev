/**
 * Phases and gates — the table the driver reduces against.
 *
 * Three different kinds of thing, kept separate because mixing them is what
 * makes a lifecycle list hard to reason about:
 *
 * - **Phase** — where the work *is* (`SPEC`, `IMPLEMENTATION`, …). Stored on
 *   the entity, and changed only by an `enterPhase` action.
 * - **Gate** — what the work is *waiting on*. **Never stored.** Derived from a
 *   world snapshot on every tick, which is precisely what makes killing the
 *   process mid-gate survivable: there is no remembered gate to lose.
 * - **Signal** — what the world *reported* (see `./signals`).
 *
 * A gate declares the facts it reads (`reads`) so the tick can materialize them
 * before any predicate runs. That is the framework's own `uses`/capability
 * shape — declare the dependency, get it injected — not a new mechanism. Two
 * consequences, both accepted: the tick may over-fetch (it reads for gates that
 * turn out not to apply), and a phase cannot gate on a fact it did not declare.
 *
 * **`reads` covers the gate's whole handling, not only its two predicates.**
 * The branch `decide` keys on a gate reduces against the same snapshot and has
 * no declaration site of its own, so what it consults is declared here or
 * nowhere. `awaiting_ci` declares `pr.baseStatus` for exactly that reason: no
 * predicate touches it, but the branch that handles a red CI does — and a fetch
 * driven strictly by declarations would otherwise hand that branch a default
 * and leave the guard dead. The relation is a subset one: `reads` is what the
 * handling *may* touch, and a fact may be declared for reconciliation's sake
 * without any predicate reading it.
 */

import {
  artifactOfKind,
  hasFreshHumanApproval,
  hasHumanReviewAtHead,
  prForArtifact,
  standingVerdict,
  type ArtifactFacts,
  type ArtifactKind,
  type PullRequestFacts,
  type World,
} from "./world";

/** The two things that move through phases. */
export type EntityKind = "issue" | "epic";

/** Phases an issue moves through. `SETTLED` is terminal. */
export type IssuePhase = "SPEC" | "IMPLEMENTATION" | "SETTLED";

/** Phases an epic moves through. `SETTLED` is terminal. */
export type EpicPhase =
  | "FRAMING"
  | "CROSS_SPEC_REVIEW"
  | "ISSUES"
  | "WRAP"
  | "SETTLED";

export type Phase = IssuePhase | EpicPhase;

/** What an issue can be waiting on. */
export type IssueGate =
  | "awaiting_spec_review"
  | "awaiting_spec_approval"
  | "awaiting_spec_unmerge"
  | "awaiting_ci"
  | "awaiting_review"
  | "awaiting_merge"
  | "awaiting_goal_check";

/** What an epic can be waiting on. */
export type EpicGate =
  | "awaiting_objective_approval"
  | "awaiting_cross_spec_review"
  | "awaiting_issues";

export type Gate = IssueGate | EpicGate;

/**
 * The vocabulary a gate declares in `reads`. The tick maps each entry to the
 * fetch that materializes it. A user-defined phase declares from this same set.
 *
 * **`guidance` is deliberately declared by no gate, and is therefore inert.**
 * Written down rather than left to be rediscovered, because an undeclared fact
 * that looks live is the same hazard twice over. Three things have to be true
 * before it earns a declaration, and none of them is today:
 *
 * 1. Nothing in the driver reads `world.guidanceHashes`. `decide`'s
 *    `guidance_changed` branch reads the *signal's* path and the policy, not
 *    the snapshot. Declaring `guidance` on a gate would assert a read no
 *    predicate and no branch performs — the same incoherence from the other
 *    side — and would buy a content-hash request per guidance path per tick
 *    that nothing consumes.
 * 2. Nothing produces `guidance_changed`. The hashes exist to be diffed against
 *    the previous tick's, and no such comparison exists (`driver/reconcile`
 *    diffs PR facts only). Materializing them changes no behaviour.
 * 3. The default policy is `onGuidanceChanged: "ignore"`.
 *
 * When (2) is built, `guidance` needs a declaration site — and not a gate,
 * since `guidance_changed` is handled phase-universally, above the gate table.
 * That is a real design question and it belongs with the producer, not here.
 */
export type WorldFact =
  | "artifact.reviews"
  | "artifact.rounds"
  | "pr.state"
  | "pr.checkRuns"
  | "pr.mergeable"
  | "pr.baseStatus"
  | "goalCheck"
  | "childIssues"
  | "guidance";

/**
 * One gate. `appliesWhen` decides whether the gate is in play at all;
 * `satisfiedBy` decides whether it has been released. Both are pure over the
 * snapshot, and may only touch facts named in `reads`.
 */
export interface GateDefinition {
  readonly name: Gate;
  /**
   * Every fact this gate's handling may consult — its two predicates *and* the
   * `decide` branch keyed on it. The tick materializes exactly this set, so an
   * omission is not a style slip: it hands the branch a default value and kills
   * the behaviour silently.
   */
  readonly reads: readonly WorldFact[];
  readonly appliesWhen: (world: World) => boolean;
  readonly satisfiedBy: (world: World) => boolean;
}

/** One phase: what it dispatches on entry, what it waits on, where it goes next. */
export interface PhaseDefinition {
  readonly name: Phase;
  readonly entity: EntityKind;
  /** Evaluated in order; the first applying-and-unsatisfied gate is the current one. */
  readonly gates: readonly GateDefinition[];
  /**
   * Dispatched when the entity enters this phase. An array because `WRAP` runs
   * two independent pieces of work — the retrospective and the docs pass — and
   * special-casing that in the reducer would put process knowledge in the one
   * place that is supposed to be a table.
   */
  readonly onEnter?: readonly ("draftSpec" | "implement" | "retrospect" | "polishDocs")[];
  /**
   * The phase is done when this holds. Kept separate from "every gate is
   * satisfied" because an absent gate is ambiguous — it can mean *work is in
   * flight* as easily as *nothing left to wait for*.
   */
  readonly completedWhen: (world: World) => boolean;
  /** Where the entity goes when `completedWhen` holds. `null` for a terminal phase. */
  readonly next: Phase | null;
}

const specPr = (world: World) => activePr("SPEC", world);
const implArtifact = (world: World) => activeArtifact("IMPLEMENTATION", world);
const implPr = (world: World) => activePr("IMPLEMENTATION", world);
/**
 * The goal verdict, but only where it still describes **the code the issue's
 * implementation is sitting at** and **the claim that code now has to answer
 * for**. Every predicate below reads this rather than `world.goalCheck` — see
 * `./world`'s {@link standingVerdict} for why a bare verdict cannot hold the
 * invariant this phase is built around, and which of the two halves closes
 * which hole.
 */
const implProof = (world: World) => standingVerdict(world, implArtifact(world));
const epicSpecPr = (world: World) => activePr("FRAMING", world);

const SPEC: PhaseDefinition = {
  name: "SPEC",
  entity: "issue",
  onEnter: ["draftSpec"],
  gates: [
    {
      /**
       * A spec PR that was *merged* is a human doing something the process
       * forbids — a spec lives on its spec PR and in Linear, never on the base
       * branch (BP-037, which CI enforces). So it is not a state to route
       * around quietly, and this gate is declared first because the two gates
       * below apply only while the PR is open.
       *
       * Without it a merged spec PR made every gate stop applying, and the two
       * ways out were both wrong: with no standing approval the phase held no
       * gate and met no completion condition, so nothing could ever move it
       * again; with one, `completedWhen` advanced the issue to
       * `IMPLEMENTATION` as though the spec had been closed normally, leaving
       * the forbidden artifact on the base branch and saying nothing.
       *
       * `satisfiedBy` is `false` rather than a predicate because conductor
       * cannot observe the repair: a merged PR stays merged in GitHub's model
       * even after the merge is reverted. The release is `appliesWhen` going
       * false, which is what a human's actual recovery produces — a
       * replacement spec artifact, which {@link artifactOfKind} resolves as the
       * active one, being newest.
       *
       * **The ask that belongs beside it is missing.** Phase-scoped human
       * intervention is escalated (`decide`'s `pr_closed` branch is the
       * neighbouring case), and this gate has no branch in `decide`, so today
       * it holds visibly but silently. Adding that `case` is a `driver/decide`
       * change, not a table one.
       */
      name: "awaiting_spec_unmerge",
      reads: ["pr.state"],
      appliesWhen: (w) => specPr(w)?.state === "merged",
      satisfiedBy: () => false,
    },
    {
      // `artifact.rounds`: feedback here is revised or escalated on the
      // spec-review budget, and that comparison reads the artifact's rounds.
      name: "awaiting_spec_review",
      reads: ["pr.state", "artifact.reviews", "artifact.rounds"],
      appliesWhen: (w) => specPr(w)?.state === "open",
      satisfiedBy: (w) => hasHumanReviewAtHead(specPr(w)),
    },
    {
      name: "awaiting_spec_approval",
      reads: ["pr.state", "artifact.reviews", "artifact.rounds"],
      appliesWhen: (w) => specPr(w)?.state === "open",
      satisfiedBy: (w) => hasFreshHumanApproval(specPr(w)),
    },
  ],
  // A merged spec PR completes nothing, however the reviews read. Stated as
  // `!== "merged"` rather than `=== "open"` deliberately: closing the spec PR
  // unmerged *is* the process, and it is also the state conductor finds when it
  // first observes an issue whose spec was approved before it was watching —
  // demanding an open PR would strand every one of those.
  completedWhen: (w) =>
    specPr(w)?.state !== "merged" && hasFreshHumanApproval(specPr(w)),
  next: "IMPLEMENTATION",
};

/**
 * `IMPLEMENTATION` — and the invariant a multi-PR issue must not break.
 *
 * Two rules, stated once so the four gates below read as consequences rather
 * than as four independent choices:
 *
 * > **A merge gate never opens on unproved work, and an issue is not done until
 * > what landed passes its goal.**
 *
 * Neither half mentions how many PRs the issue has, and that is the point: the
 * same predicates describe both shapes `orchestration.md` defines (the
 * paragraph after the lifecycle diagram, "For a **single-PR** issue…").
 *
 * - **Single-PR.** `issue-implement` proves the goal on the real path at
 *   completion, *before* the PR opens, so a branch proof is already standing by
 *   the time `awaiting_merge` is reached. The gate applies, a human merges, and
 *   the base is proved before the issue settles. Conductor never invites a merge
 *   it has not proved.
 * - **Multi-PR.** The sub-PRs are nested tasks carrying gates of their own; the
 *   issue's own goal is the *assembled* one, which runs only once they settle.
 *   Its `goalCheck` is `null` until then, so `awaiting_merge` never applies at
 *   this level — correctly, because the issue-level merge gate was never about
 *   a sub-PR's merge.
 *
 * ---------------------------------------------------------------------------
 * THE LIFECYCLE OF A PROOF, IN FOUR ANSWERS
 * ---------------------------------------------------------------------------
 *
 * A proof is a **verdict, the revision it was taken against, and the ground it
 * stood on** (`./world`'s `ProofGround`). Every gate below reads all three
 * through {@link standingVerdict}, and the four questions the table answers are:
 *
 * 1. **What proves.** One dispatch: `runGoalCheck`, which conductor executes
 *    itself because a verdict must be an exit status rather than an agent's
 *    account of itself. A coding dispatch may *also* report a verdict it ran
 *    (`implement` does, in the single-PR shape, before the PR exists) — always a
 *    **branch** proof, because a dispatch runs standing on the phase's branch.
 * 2. **What invalidates.** The revision moving, by the property argued on
 *    `goalCheckFor`; and the *claim* moving, which is what a merge does — a
 *    branch proof says nothing about what landed. Both are read here as *there
 *    is no standing proof*, which is one question rather than a list of causes.
 * 3. **What re-proves, and when.** `awaiting_goal_check`, below, which applies to
 *    any live submission holding no passing proof on the ground it needs. It is
 *    the only gate that dispatches `runGoalCheck`, and `runtime/tick` derives the
 *    `goal_check_needed` that reaches it from durable state on every tick — so
 *    re-proving is a transition of this lifecycle rather than something that
 *    happens when a signal happens to arrive. It converges because the check
 *    writes a proof at that revision and ground, which is exactly the condition
 *    that stops the derivation.
 * 4. **What a failed proof means.** Not the same as no proof: it is a statement
 *    about the work, and `decide` routes it — back to the agent while the PR is
 *    open, to a human once it has merged. What it must never do is release the
 *    gate that demanded it, which is why `satisfiedBy` below reads `"passed"`
 *    and not "a verdict exists".
 *
 * **The floor this rests on, and where it is held:** a verdict is only as good
 * as the tree the command ran in. Conductor binds a proof to a revision, but the
 * workspace that revision was checked out into is the branch layer's to hand
 * over clean — a stale edit left in a re-entered worktree is code that is in the
 * tree and not in the revision, and a check that passes on it has proved
 * something that exists nowhere. `dispatch/branch` holds it by scrubbing a
 * worktree it re-enters before any checkout runs
 * (`WORKTREE_SCRUB_COMMANDS`). It is stated here rather than only there because
 * nothing in this table can detect its absence, so a change that drops it would
 * fail silently as a wrong verdict rather than as a broken checkout.
 *
 * **Why `completedWhen` reads the artifact and its PR, and not `goalCheck`
 * alone.** Because the single-PR shape makes a branch proof stand while the PR
 * is still open, and completing on that alone settles an issue on its own
 * `pr_opened` — before CI, before review, before anyone merged. The condition is
 * *the standing proof passed, and the work no longer sitting in an open PR* —
 * and after a merge the standing proof is a **base** one, so what settles the
 * issue is always a check of what landed.
 *
 * The PR test alone cannot express that, because `implPr(w)` is `undefined` in
 * two states that mean opposite things, and an absent PR passes any test written
 * about the PR's state:
 *
 * - **No PR of its own, ever** — the nested multi-PR shape. There is no merge at
 *   this level to wait for, and demanding one (`=== "merged"`) would strand the
 *   issue forever. This is why `undefined` completes.
 * - **No PR yet.** `issue-implement` proves the goal *before* the submission
 *   exists, so for one tick the issue holds a passing verdict and no artifact at
 *   all. Completing here settles an issue seconds after the agent finished.
 *
 * They are told apart by **the artifact, not the PR**: the artifact is the
 * durable record that this phase produced something, and conductor mints it
 * itself (`runtime/tick`, from a vendor's report or from the branch). A phase
 * holding one has finished producing, whether or not that output is hosted at a
 * pull request; a phase holding none has not started. So the artifact is
 * required positively and `undefined` still completes, which is what the
 * multi-PR shape needs — **absence of a trace is not evidence that there is
 * nothing to wait for.**
 *
 * A PR that is *present* is then read for what it says. Only `merged` completes:
 * `open` is work still in review, and `closed` is a change somebody abandoned,
 * which escalates rather than settling. That last one is not a third case so
 * much as the same rule said plainly — an issue is done when what **landed**
 * passes its goal, and nothing landed.
 *
 * One narrower absence is still read as "nothing to wait for" and is left that
 * way: an artifact recorded at a PR whose facts are missing from the snapshot.
 * That is a failed read rather than a state of the work, and the honest fix is
 * for the observer not to hand back a snapshot missing a PR it was asked for —
 * not for this predicate to guess which kind of silence it is looking at.
 *
 * **This is the rule's only home.** It lived for a while in `runtime/tick`, as a
 * guard that deferred a *passing* verdict to the next tick whenever the phase's
 * submission was not in the snapshot yet. That worked, and it put a phase
 * completion rule where the next person editing this table could not see it.
 *
 * Adding multi-PR therefore needs no PR-plan fact in `World` and no second gate
 * table. If it starts to look like it does, the nesting is being modelled in
 * the wrong place.
 */
const IMPLEMENTATION: PhaseDefinition = {
  name: "IMPLEMENTATION",
  entity: "issue",
  onEnter: ["implement"],
  gates: [
    {
      // `pr.baseStatus`: a red CI on a red base is not this PR's failure, and
      // the branch handling it waits for `base_recovered` instead of
      // dispatching an agent. Undeclared, `baseRed` reads `false` forever and
      // conductor chases someone else's breakage.
      // `artifact.rounds`: a CI failure here is revised or escalated on the
      // same budget as review feedback, and that comparison reads the
      // artifact's rounds. Declared here rather than borrowed from
      // `awaiting_review` — the tick unions a phase's declarations, so this
      // gate reads a real number today either way, but a guard that depends on
      // its neighbour's declaration breaks silently the moment that neighbour
      // changes, and the failure is unbounded paid work.
      name: "awaiting_ci",
      reads: ["pr.state", "pr.checkRuns", "pr.baseStatus", "artifact.rounds"],
      appliesWhen: (w) => implPr(w)?.state === "open" && implPr(w)?.checks !== null,
      satisfiedBy: (w) => implPr(w)?.checks === "success",
    },
    {
      // `artifact.rounds`: review feedback here is revised or escalated on the
      // implementation budget, and that comparison reads the artifact's rounds.
      // `pr.baseStatus`: this gate handles a failing CI too — a red base that
      // lands once review has started is no more this PR's failure than one
      // that lands before it — and it declares that read itself rather than
      // borrowing `awaiting_ci`'s. The tick unions a phase's declarations, so
      // relying on the neighbour would work right up until the neighbour
      // changed, and then fail silently with `baseRed` at its default.
      name: "awaiting_review",
      reads: ["pr.state", "artifact.reviews", "artifact.rounds", "pr.baseStatus"],
      appliesWhen: (w) => implPr(w)?.state === "open",
      satisfiedBy: (w) => hasFreshHumanApproval(implPr(w)),
    },
    {
      // Conductor never merges. This gate is released by a human, always — and
      // it does not open until the goal has passed **against the code that is
      // there now**, so a human is never invited to merge work conductor has not
      // proved. See the phase note above and `./world`'s `standingVerdict`.
      // `artifact.reviews`: it only applies once the PR carries a fresh human
      // approval, which is a read of the PR's reviews. `goalCheck`: the proof
      // requirement itself, verdict and proved revision together — they are one
      // conductor-owned fact materialized from one input, so the revision needs
      // no declaration of its own. The head it is compared against arrives with
      // `pr.state`: state and head come out of the one pull request record every
      // reader fetches, which is the mapping `test/declared-reads` asserts.
      //
      // **A closed submission is excluded, and that exclusion is what makes the
      // closure reach anyone.** An approval does not expire when a PR is closed,
      // so the approval-and-proof test alone kept this gate *applying* to a
      // change somebody abandoned — inviting a merge nobody can perform, and,
      // worse, telling `isPhaseStranded` that the table still had something to
      // say about the entity. No `progress_stalled` was derived and nothing
      // escalated: the issue waited forever on an answer it had already been
      // given. `awaiting_goal_check` below carries the same exclusion for the
      // same reason.
      name: "awaiting_merge",
      reads: ["pr.state", "pr.mergeable", "artifact.reviews", "goalCheck"],
      appliesWhen: (w) =>
        implPr(w)?.state !== "closed" &&
        hasFreshHumanApproval(implPr(w)) &&
        implProof(w) === "passed",
      satisfiedBy: (w) => implPr(w)?.state === "merged",
    },
    {
      /**
       * **The gate that keeps a proof re-earnable.**
       *
       * It applies to any *live* submission — open or merged — and it is
       * released by a **passing** proof on the ground that submission now needs.
       * Both halves are corrections of the same under-specification, and each
       * closes a way an issue used to go permanently idle while looking healthy:
       *
       * - **Open, not only merged.** A head that moves invalidates the proof,
       *   correctly. Applying only after a merge then left nothing that could
       *   ever take a new one: `awaiting_merge` refuses to apply on unproved
       *   work, the other open-PR gates are satisfied, and no gate was derived
       *   at all — so a revision, a rebase, a conflict fix or a human's push
       *   made the issue unmergeable *forever* short of a human merging work
       *   conductor considers unproved. Applying while the submission is open is
       *   what turns "the proof is gone" into "take another one".
       * - **Passing, not merely present.** `!== null` released this gate on a
       *   *failed* verdict — the gate that exists to demand a proof, satisfied
       *   by the proof failing. The phase could not complete, no gate was
       *   outstanding, and an applicable-but-satisfied gate suppressed stall
       *   detection too, so the issue sat idle with nothing reporting it. A
       *   failure is handled by `decide` (back to the agent, or to a human after
       *   a merge) and re-derived from the stored proof until that handling is on
       *   disk; it is never a release.
       *
       * A **closed, unmerged** submission is deliberately outside it. That is an
       * abandoned branch — `decide` escalates the closure to a human — and
       * proving it would be paid work on work nobody is taking forward. With no
       * gate applying, such an issue reads as stranded, which is the truth.
       *
       * `reads` is `pr.state` and `goalCheck`: the state decides both whether the
       * gate applies and which ground the proof must stand on, and the verdict,
       * its revision and its ground are one conductor-owned fact materialized
       * from one input. The head the revision is compared against arrives with
       * `pr.state` — state and head come out of the one pull request record every
       * reader fetches.
       */
      name: "awaiting_goal_check",
      reads: ["pr.state", "goalCheck"],
      appliesWhen: (w) => {
        const state = implPr(w)?.state;
        return state === "open" || state === "merged";
      },
      satisfiedBy: (w) => implProof(w) === "passed",
    },
  ],
  // `closed` is excluded alongside `open`, and only `undefined` and `merged`
  // complete. A PR closed unmerged is somebody abandoning the change, and
  // `!== "open"` was true of it — while `requiredGround` asks a closed
  // submission for a *branch* proof, which the verdict `implement` reported
  // before the PR existed already is. So an abandoned issue met every conjunct
  // and settled: nothing landed, and conductor recorded the work as done.
  //
  // The pair with `SPEC` is deliberate and must stay unequal. There, closing the
  // PR unmerged *is* the process — a spec lives on its spec PR and in Linear and
  // never on the base branch (BP-037) — so `SPEC` completes on `!== "merged"`.
  // Here the base branch is exactly where the work was supposed to land, so the
  // same shape means the opposite thing.
  //
  // `undefined` still completes, and it has to: the nested multi-PR shape hosts
  // its implementation at a file rather than a pull request, and there is no
  // merge at this level to wait for. It is told apart from *no PR yet* by the
  // artifact, which is required positively — see the phase note above.
  completedWhen: (w) => {
    const state = implPr(w)?.state;
    return (
      implProof(w) === "passed" &&
      implArtifact(w) !== undefined &&
      (state === undefined || state === "merged")
    );
  },
  next: "SETTLED",
};

const ISSUE_SETTLED: PhaseDefinition = {
  name: "SETTLED",
  entity: "issue",
  gates: [],
  completedWhen: () => false,
  next: null,
};

const FRAMING: PhaseDefinition = {
  name: "FRAMING",
  entity: "epic",
  onEnter: ["draftSpec"],
  gates: [
    {
      // `artifact.rounds`: shares the spec-review budget path — feedback on the
      // epic spec is revised or escalated against the artifact's rounds.
      name: "awaiting_objective_approval",
      reads: ["pr.state", "artifact.reviews", "artifact.rounds"],
      appliesWhen: (w) => epicSpecPr(w)?.state === "open",
      satisfiedBy: (w) => hasFreshHumanApproval(epicSpecPr(w)),
    },
  ],
  completedWhen: (w) => hasFreshHumanApproval(epicSpecPr(w)),
  next: "CROSS_SPEC_REVIEW",
};

/**
 * `CROSS_SPEC_REVIEW` — held, because conductor cannot run this pass yet.
 *
 * The process (`docs/contributing/orchestration.md` → "Cross-spec coherence",
 * and the `cross-spec-review` skill) puts three things between an epic's specs
 * and its implementations, and **not one of them is a fact this snapshot
 * carries**:
 *
 * 1. Every child spec is open and has cleared its own approval gate.
 * 2. The user has approved *running* the pass. It never runs automatically.
 * 3. Every alignment the pass produced has landed in its spec and every spec it
 *    changed has cleared approval again — the coordinator's `crossSpecCleared`,
 *    which exists precisely so a mechanical edit cannot clear a human gate.
 *
 * The phase used to be unconditionally complete with no entry dispatch, so
 * every multi-issue epic passed straight to `ISSUES` with none of the three
 * asked for. Read-only is what the *pass* is; it is not what this *phase* is,
 * and conflating the two is how the gate went missing.
 *
 * So the phase fails closed on the one thing it can read: an epic holding more
 * than one child has a spec set, and conductor holds it rather than reporting a
 * pass it never ran. One child or none has nothing to be incoherent with, so
 * there is no pass to wait for. `satisfiedBy` is `false` because no world fact
 * reports (2) or (3) — the release is a human's, and conductor has no way to
 * hear it today.
 *
 * **Two defects this does not fix, both needing more than this table:**
 *
 * - **The phase is sequenced before the artifacts it examines.** Child specs
 *   are produced inside `ISSUES` (its gate waits on children *settling*, which
 *   is the far end of their whole lifecycle), so a phase between `FRAMING` and
 *   `ISSUES` runs before a single spec exists. Putting it where it belongs
 *   means splitting `ISSUES` into a spec fan-out and an implementation fan-out,
 *   which needs per-child phase facts. `ChildIssueFacts` is `{ id, settled }`:
 *   it carries neither a child's spec state nor its route, so it cannot say
 *   "the children have specs and those specs are approved", and it cannot
 *   exclude the bug rows the pass explicitly does not cover.
 * - **A late child still slips past.** The hold reads `childIssues` at the
 *   moment `FRAMING` completes; an epic that registers its children afterwards
 *   passes this phase while empty. That is the ordering defect above, seen from
 *   the other side.
 *
 * Nothing here dispatches the pass either: `onEnter` may only name an action
 * `decide` can emit, and there is no `crossSpecReview` action kind.
 */
const CROSS_SPEC_REVIEW: PhaseDefinition = {
  name: "CROSS_SPEC_REVIEW",
  entity: "epic",
  gates: [
    {
      name: "awaiting_cross_spec_review",
      reads: ["childIssues"],
      appliesWhen: (w) => w.childIssues.length > 1,
      satisfiedBy: () => false,
    },
  ],
  completedWhen: (w) => w.childIssues.length <= 1,
  next: "ISSUES",
};

const ISSUES: PhaseDefinition = {
  name: "ISSUES",
  entity: "epic",
  gates: [
    {
      name: "awaiting_issues",
      reads: ["childIssues"],
      appliesWhen: (w) => w.childIssues.length > 0,
      satisfiedBy: (w) => w.childIssues.every((c) => c.settled),
    },
  ],
  completedWhen: (w) =>
    w.childIssues.length > 0 && w.childIssues.every((c) => c.settled),
  next: "WRAP",
};

const WRAP: PhaseDefinition = {
  name: "WRAP",
  entity: "epic",
  onEnter: ["retrospect", "polishDocs"],
  gates: [],
  completedWhen: (w) => activeArtifact("WRAP", w) !== undefined,
  next: "SETTLED",
};

const EPIC_SETTLED: PhaseDefinition = {
  name: "SETTLED",
  entity: "epic",
  gates: [],
  completedWhen: () => false,
  next: null,
};

/** Issue phase definitions, in order. */
export const ISSUE_PHASES: readonly PhaseDefinition[] = [
  SPEC,
  IMPLEMENTATION,
  ISSUE_SETTLED,
];

/** Epic phase definitions, in order. */
export const EPIC_PHASES: readonly PhaseDefinition[] = [
  FRAMING,
  CROSS_SPEC_REVIEW,
  ISSUES,
  WRAP,
  EPIC_SETTLED,
];

/**
 * Look up a phase definition. Returns `undefined` for a phase that does not
 * belong to the entity kind — callers treat that as "no transition", never as
 * a crash, so a corrupt or hand-edited ledger degrades rather than throws.
 */
export function phaseDefinition(
  entity: EntityKind,
  phase: Phase,
): PhaseDefinition | undefined {
  const table = entity === "issue" ? ISSUE_PHASES : EPIC_PHASES;
  return table.find((p) => p.name === phase);
}

/**
 * The artifact a phase produces and reviews, or `null` for a phase that
 * produces none. Used to scope an incoming PR-bound signal to the phase it
 * belongs to — a review on the spec PR must not advance an implementation.
 */
export function artifactKindForPhase(phase: Phase): ArtifactKind | null {
  switch (phase) {
    case "SPEC":
      return "spec";
    case "IMPLEMENTATION":
      return "implementation";
    case "FRAMING":
      return "epic_spec";
    case "WRAP":
      return "retrospective";
    default:
      return null;
  }
}

/**
 * **The artifact this phase is working on**, or `undefined` — for a phase that
 * produces none, or one that has not produced its own yet.
 *
 * The composition of {@link artifactKindForPhase} with `artifactOfKind` is the
 * question nearly every reader of a snapshot is actually asking, and it has
 * exactly one answer. Written once because a duplicated predicate is a place a
 * future fix can land without landing: the gate table, `decide`'s scoping, the
 * proof's ground and the tick's dispatch key must all resolve *the same*
 * artifact, and reconstructions cannot be kept in step by review.
 *
 * Keyed on the phase rather than the kind, because the phase is what a caller
 * holds and the mapping between the two is this file's to own.
 */
export function activeArtifact(phase: Phase, world: World): ArtifactFacts | undefined {
  const kind = artifactKindForPhase(phase);
  return kind ? artifactOfKind(world, kind) : undefined;
}

/**
 * The pull request {@link activeArtifact} is hosted at, or `undefined` when the
 * phase holds no artifact or hosts it at a file rather than a submission.
 *
 * The second half of the same composition, and the one every gate predicate
 * reads. `undefined` is deliberately ambiguous across those cases — a phase with
 * nothing to review and a phase whose output is a file are both "no submission
 * to ask about", and the callers that need to tell them apart read the artifact.
 */
export function activePr(phase: Phase, world: World): PullRequestFacts | undefined {
  return prForArtifact(world, activeArtifact(phase, world));
}

/** Every world fact the gates of a phase declare, deduplicated. */
export function factsReadBy(entity: EntityKind, phase: Phase): readonly WorldFact[] {
  const def = phaseDefinition(entity, phase);
  if (!def) return [];
  return [...new Set(def.gates.flatMap((g) => g.reads))];
}
