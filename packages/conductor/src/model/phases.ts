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
  | "awaiting_ci"
  | "awaiting_review"
  | "awaiting_merge"
  | "awaiting_goal_check";

/** What an epic can be waiting on. */
export type EpicGate = "awaiting_objective_approval" | "awaiting_issues";

export type Gate = IssueGate | EpicGate;

/**
 * The vocabulary a gate declares in `reads`. The tick maps each entry to the
 * fetch that materializes it. A user-defined phase declares from this same set.
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
const implPr = (world: World) =>
  prForArtifact(world, artifactOfKind(world, "implementation"));
const epicSpecPr = (world: World) =>
  prForArtifact(world, artifactOfKind(world, "epic_spec"));

const SPEC: PhaseDefinition = {
  name: "SPEC",
  entity: "issue",
  onEnter: ["draftSpec"],
  gates: [
    {
      name: "awaiting_spec_review",
      reads: ["pr.state", "artifact.reviews"],
      appliesWhen: (w) => specPr(w)?.state === "open",
      satisfiedBy: (w) => hasHumanReviewAtHead(specPr(w)),
    },
    {
      name: "awaiting_spec_approval",
      reads: ["pr.state", "artifact.reviews"],
      appliesWhen: (w) => specPr(w)?.state === "open",
      satisfiedBy: (w) => hasFreshHumanApproval(specPr(w)),
    },
  ],
  completedWhen: (w) => hasFreshHumanApproval(specPr(w)),
  next: "IMPLEMENTATION",
};

const IMPLEMENTATION: PhaseDefinition = {
  name: "IMPLEMENTATION",
  entity: "issue",
  onEnter: ["implement"],
  gates: [
    {
      name: "awaiting_ci",
      reads: ["pr.state", "pr.checkRuns"],
      appliesWhen: (w) => implPr(w)?.state === "open" && implPr(w)?.checks !== null,
      satisfiedBy: (w) => implPr(w)?.checks === "success",
    },
    {
      name: "awaiting_review",
      reads: ["pr.state", "artifact.reviews"],
      appliesWhen: (w) => implPr(w)?.state === "open",
      satisfiedBy: (w) => hasFreshHumanApproval(implPr(w)),
    },
    {
      // Conductor never merges. This gate is released by a human, always.
      name: "awaiting_merge",
      reads: ["pr.state", "pr.mergeable"],
      appliesWhen: (w) => hasFreshHumanApproval(implPr(w)),
      satisfiedBy: (w) => implPr(w)?.state === "merged",
    },
    {
      name: "awaiting_goal_check",
      reads: ["pr.state", "goalCheck"],
      appliesWhen: (w) => implPr(w)?.state === "merged",
      satisfiedBy: (w) => w.goalCheck !== null,
    },
  ],
  completedWhen: (w) => w.goalCheck === "passed",
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
      name: "awaiting_objective_approval",
      reads: ["pr.state", "artifact.reviews"],
      appliesWhen: (w) => epicSpecPr(w)?.state === "open",
      satisfiedBy: (w) => hasFreshHumanApproval(epicSpecPr(w)),
    },
  ],
  completedWhen: (w) => hasFreshHumanApproval(epicSpecPr(w)),
  next: "CROSS_SPEC_REVIEW",
};

const CROSS_SPEC_REVIEW: PhaseDefinition = {
  name: "CROSS_SPEC_REVIEW",
  entity: "epic",
  gates: [],
  // Read-only: it reports conflicts to the coordinator and never blocks on a gate.
  completedWhen: () => true,
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
