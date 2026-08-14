/**
 * Actions — what `decide` returns.
 *
 * Every action is either a dispatch (hand a phase brief to the vendor harness)
 * or a ledger write. **None requires judgment at the moment it is produced** —
 * the judgment already happened, either in the classifier that produced the
 * signal or inside the dispatched phase that will execute the action.
 *
 * Actions are **discrete and idempotent**. Executing the same action twice must
 * be indistinguishable from executing it once, which is what makes a duplicate
 * or out-of-order signal harmless and a redundant tick free.
 */

import type { Gate, Phase } from "./phases";

/** Every action kind the driver can emit. */
export type ActionKind =
  // — dispatches: hand a brief to a vendor harness —
  | "draftSpec"
  | "reviseSpec"
  | "answerQuestion"
  | "implement"
  | "addressFeedback"
  | "resolveConflict"
  | "rebaseOnBase"
  | "runGoalCheck"
  | "retrospect"
  | "polishDocs"
  | "reExamineOpenPrs"
  // — ledger writes: conductor's own record —
  | "enterPhase"
  | "recordApproval"
  | "recordDivergence"
  | "escalate";

/** Fields every action carries. */
export interface ActionBase {
  readonly kind: ActionKind;
  /** The entity the action operates on. */
  readonly entityId: string;
}

/**
 * Move an entity into a phase. The only way a phase changes — so the phase
 * progression is an append-only sequence of recorded actions rather than an
 * implicit side effect of some other action.
 */
export interface EnterPhaseAction extends ActionBase {
  readonly kind: "enterPhase";
  readonly phase: Phase;
}

/** Hand a phase brief to a dispatcher. */
export interface DispatchAction extends ActionBase {
  readonly kind:
    | "draftSpec"
    | "reviseSpec"
    | "answerQuestion"
    | "implement"
    | "addressFeedback"
    | "resolveConflict"
    | "rebaseOnBase"
    | "runGoalCheck"
    | "retrospect"
    | "polishDocs"
    | "reExamineOpenPrs";
  /** What prompted this dispatch, carried into the brief as context. */
  readonly because?: string;
}

/** Record that a gate was satisfied, and by what. */
export interface RecordApprovalAction extends ActionBase {
  readonly kind: "recordApproval";
  readonly gate: Gate;
  readonly reviewer: string;
  readonly sha: string;
}

/**
 * Record that conductor's copy disagreed with an owning system. Emitted by
 * reconciliation, never by a live observation — the owner always wins, and the
 * divergence is kept so a conflict is resolvable rather than silent.
 */
export interface RecordDivergenceAction extends ActionBase {
  readonly kind: "recordDivergence";
  readonly fact: string;
  readonly observed: string;
  readonly fresh: string;
}

/** Stop auto-handling and ask a human. Carries why, so the ask is answerable. */
export interface EscalateAction extends ActionBase {
  readonly kind: "escalate";
  readonly reason: string;
}

/** The discriminated union `decide` returns. */
export type Action =
  | EnterPhaseAction
  | DispatchAction
  | RecordApprovalAction
  | RecordDivergenceAction
  | EscalateAction;

/** True when the action hands work to a dispatcher rather than writing the ledger. */
export function isDispatch(action: Action): action is DispatchAction {
  return (
    action.kind !== "enterPhase" &&
    action.kind !== "recordApproval" &&
    action.kind !== "recordDivergence" &&
    action.kind !== "escalate"
  );
}
