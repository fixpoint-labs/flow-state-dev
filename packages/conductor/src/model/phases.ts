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
  type ArtifactKind,
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

const specPr = (world: World) => prForArtifact(world, artifactOfKind(world, "spec"));
const implArtifact = (world: World) => artifactOfKind(world, "implementation");
const implPr = (world: World) => prForArtifact(world, implArtifact(world));
const epicSpecPr = (world: World) =>
  prForArtifact(world, artifactOfKind(world, "epic_spec"));

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
 * > its goal passes.**
 *
 * Neither half mentions how many PRs the issue has, and that is the point: the
 * same predicates describe both shapes `orchestration.md` defines (the
 * paragraph after the lifecycle diagram, "For a **single-PR** issue…").
 *
 * - **Single-PR.** `issue-implement` proves the goal on the real path at
 *   completion, *before* the PR opens, so `goalCheck` is already `passed` by
 *   the time `awaiting_merge` is reached. The gate applies, a human merges,
 *   done. Conductor never invites a merge it has not proved.
 * - **Multi-PR.** The sub-PRs are nested tasks carrying gates of their own; the
 *   issue's own goal is the *assembled* one, which runs only once they settle.
 *   Its `goalCheck` is `null` until then, so `awaiting_merge` never applies at
 *   this level — correctly, because the issue-level merge gate was never about
 *   a sub-PR's merge.
 *
 * **Why `completedWhen` reads the artifact and its PR, and not `goalCheck`
 * alone.** Because the single-PR shape makes `goalCheck === "passed"` true while
 * the PR is still open, and completing on that alone settles an issue on its own
 * `pr_opened` — before CI, before review, before anyone merged. The condition is
 * *goal proved, and the work no longer sitting in an open PR*.
 *
 * The PR test alone cannot express that, because `implPr(w)` is `undefined` in
 * two states that mean opposite things, and `!== "open"` is vacuously true for
 * both:
 *
 * - **No PR of its own, ever** — the nested multi-PR shape. There is no merge at
 *   this level to wait for, and demanding one (`=== "merged"`) would strand the
 *   issue forever. This is why the PR test is `!== "open"`.
 * - **No PR yet.** `issue-implement` proves the goal *before* the submission
 *   exists, so for one tick the issue holds a passing verdict and no artifact at
 *   all. Completing here settles an issue seconds after the agent finished.
 *
 * They are told apart by **the artifact, not the PR**: the artifact is the
 * durable record that this phase produced something, and conductor mints it
 * itself (`runtime/tick`, from a vendor's report or from the branch). A phase
 * holding one has finished producing, whether or not that output is hosted at a
 * pull request; a phase holding none has not started. So the artifact is
 * required positively and the PR test keeps the `!== "open"` the multi-PR shape
 * needs — **absence of a trace is not evidence that there is nothing to wait
 * for.**
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
 * **`awaiting_goal_check` is not redundant.** It is the path for work that
 * reached the base *without* a proof: a human merging ahead of the gate, and
 * the assembled multi-PR goal. It is what dispatches `runGoalCheck`, and it is
 * the only gate that does.
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
      // it does not open until the goal has passed, so a human is never invited
      // to merge work conductor has not proved. See the phase note above.
      // `artifact.reviews`: it only applies once the PR carries a fresh human
      // approval, which is a read of the PR's reviews. `goalCheck`: the proof
      // requirement itself.
      name: "awaiting_merge",
      reads: ["pr.state", "pr.mergeable", "artifact.reviews", "goalCheck"],
      appliesWhen: (w) => hasFreshHumanApproval(implPr(w)) && w.goalCheck === "passed",
      satisfiedBy: (w) => implPr(w)?.state === "merged",
    },
    {
      name: "awaiting_goal_check",
      reads: ["pr.state", "goalCheck"],
      appliesWhen: (w) => implPr(w)?.state === "merged",
      satisfiedBy: (w) => w.goalCheck !== null,
    },
  ],
  completedWhen: (w) =>
    w.goalCheck === "passed" &&
    implArtifact(w) !== undefined &&
    implPr(w)?.state !== "open",
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
  completedWhen: (w) => artifactOfKind(w, "retrospective") !== undefined,
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

/** Every world fact the gates of a phase declare, deduplicated. */
export function factsReadBy(entity: EntityKind, phase: Phase): readonly WorldFact[] {
  const def = phaseDefinition(entity, phase);
  if (!def) return [];
  return [...new Set(def.gates.flatMap((g) => g.reads))];
}
