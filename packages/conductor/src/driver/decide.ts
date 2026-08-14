/**
 * `decide(entity, signal, world) → Action[]` — the deterministic spine.
 *
 * A reducer: one signal in, the actions that follow out. Pure, synchronous, and
 * exhaustively testable over the phase × gate × signal matrix.
 *
 * The invariant this file exists to hold:
 *
 * > **Every transition is reproducible from the ledger.**
 *
 * A model may sit anywhere *upstream* of a signal — classifying a human comment
 * into `feedback_received` versus `question_asked` is real judgment and belongs
 * to a model. Its output is recorded as a signal, so a wrong call produces a
 * wrong-but-valid transition that is visible in the ledger and replayable. A
 * model *inside this function* would produce a different transition each run
 * from identical state: unauditable, untestable, and the exact failure this
 * design exists to remove. That is the whole claim. It is not that judgment is
 * unwelcome; it is that judgment must be recorded before it is acted on.
 *
 * Two structural rules follow, and both are enforced here rather than assumed:
 *
 * - **Unknown input is inert, never fatal.** An unrecognized signal, a phase
 *   that does not belong to the entity kind, or a signal addressed elsewhere
 *   all reduce to `[]`. A hand-edited or partially-migrated ledger degrades
 *   instead of crashing the tick.
 * - **Duplicates and out-of-order arrivals are harmless.** Actions are
 *   idempotent, and every decision is taken against the *current* world rather
 *   than against signal history, so replaying a signal re-derives the same
 *   answer.
 */

import type { Action, ActionBase } from "../model/actions";
import {
  artifactKindForPhase,
  phaseDefinition,
  type Gate,
} from "../model/phases";
import type { Signal } from "../model/signals";
import { artifactOfKind, type ArtifactFacts, type World } from "../model/world";
import { deriveGate, isPhaseComplete, type ConductorEntity } from "./derive-gate";

/** The PR number a signal is about, or `undefined` when it is not PR-bound. */
function signalPullNumber(signal: Signal): number | undefined {
  return "pullNumber" in signal ? signal.pullNumber : undefined;
}

/** The artifact the entity's current phase produces and reviews. */
function activeArtifact(
  entity: ConductorEntity,
  world: World,
): ArtifactFacts | undefined {
  const kind = artifactKindForPhase(entity.phase);
  return kind ? artifactOfKind(world, kind) : undefined;
}

/**
 * Drop a PR-bound signal that belongs to a different PR than the one this phase
 * is working on — a late approval on a spec PR must not advance an
 * implementation.
 *
 * Deliberately lenient when the artifact is not in the snapshot yet: a
 * backdated `pr_opened` synthesized by reconciliation arrives precisely because
 * conductor had no record of that PR, and dropping it would defeat the recovery
 * it exists for.
 */
function belongsToThisPhase(
  entity: ConductorEntity,
  signal: Signal,
  world: World,
): boolean {
  const signalPr = signalPullNumber(signal);
  if (signalPr === undefined) return true;
  const artifact = activeArtifact(entity, world);
  if (!artifact || artifact.hostedAt.type !== "pr") return true;
  return artifact.hostedAt.number === signalPr;
}

/** Review rounds allowed against the entity's active artifact. */
function roundBudget(entity: ConductorEntity, world: World): number {
  return entity.phase === "IMPLEMENTATION"
    ? world.policy.implementationReviewRoundBudget
    : world.policy.specReviewRoundBudget;
}

/** True when the artifact has spent its review-round budget. */
function budgetSpent(entity: ConductorEntity, world: World): boolean {
  const artifact = activeArtifact(entity, world);
  if (!artifact) return false;
  return artifact.reviewRounds >= roundBudget(entity, world);
}

/**
 * Revise the artifact, or escalate once the round budget is spent. Past the
 * budget we stop auto-handling feedback and ask a human whether the approach
 * itself needs re-examining — grinding out round thirteen is not the answer the
 * process wants.
 */
function reviseOrEscalate(
  entity: ConductorEntity,
  world: World,
  reviseKind: "reviseSpec" | "addressFeedback",
  because: string,
): Action[] {
  const base: ActionBase = { kind: reviseKind, entityId: entity.id };
  if (budgetSpent(entity, world)) {
    return [
      {
        kind: "escalate",
        entityId: entity.id,
        reason: `${reviseKind === "reviseSpec" ? "Spec" : "Implementation"} review budget of ${roundBudget(entity, world)} rounds is spent — the approach may need re-examining rather than another revision.`,
      },
    ];
  }
  return [{ ...base, kind: reviseKind, because } as Action];
}

/**
 * Signals that mean the same thing in any phase. Returns `undefined` when the
 * signal is not universal, so the caller falls through to the phase table.
 */
function decideUniversal(
  entity: ConductorEntity,
  signal: Signal,
  world: World,
): Action[] | undefined {
  switch (signal.kind) {
    case "guidance_changed":
      return world.policy.onGuidanceChanged === "reExamineOpenPrs"
        ? [
            {
              kind: "reExamineOpenPrs",
              entityId: entity.id,
              because: `Guidance changed: ${signal.path}`,
            },
          ]
        : [];

    case "dispatch_failed":
      return [
        {
          kind: "escalate",
          entityId: entity.id,
          reason: `Dispatch ${signal.dispatchId} exhausted its attempts.`,
        },
      ];

    case "pr_closed":
      // A PR closed without merging is a human intervention, not a transition
      // conductor should route around.
      return [
        {
          kind: "escalate",
          entityId: entity.id,
          reason: `PR #${signal.pullNumber} was closed without merging.`,
        },
      ];

    // `approval_expressed` is advisory and deliberately inert: a model's
    // reading of prose must never advance a gate. The gate reads a real review.
    case "approval_expressed":
      return [];

    // A dispatch settling changes the world, not the phase. Whatever it
    // produced arrives as its own structural signal.
    case "dispatch_completed":
      return [];

    case "external_status_changed":
      return [];

    default:
      return undefined;
  }
}

/** The gate an approval releases in this phase — its last, by construction. */
function terminalGate(entity: ConductorEntity): Gate | undefined {
  const def = phaseDefinition(entity.kind, entity.phase);
  return def?.gates.at(-1)?.name;
}

/**
 * Reduce one signal against one entity.
 *
 * @param entity The entity being advanced — id, kind, and stored phase.
 * @param signal What the world reported, or what reconciliation inferred.
 * @param world A snapshot materialized before this call. Never fetched from here.
 * @returns The actions that follow. Empty when the signal does not apply.
 */
export function decide(
  entity: ConductorEntity,
  signal: Signal,
  world: World,
): Action[] {
  if (signal.entityId !== entity.id) return [];

  const def = phaseDefinition(entity.kind, entity.phase);
  if (!def) return [];

  // A settled entity absorbs everything. Late CI, a late comment, a duplicate
  // merge — none of it reopens finished work.
  if (def.next === null) return [];

  if (!belongsToThisPhase(entity, signal, world)) return [];

  const universal = decideUniversal(entity, signal, world);
  if (universal !== undefined) return universal;

  if (signal.kind === "phase_entered") {
    return (def.onEnter ?? []).map((kind) => ({ kind, entityId: entity.id }) as Action);
  }

  // Advance before consulting the gate table, so the signal that *completes* a
  // phase advances it rather than being absorbed by the gate it just released.
  if (isPhaseComplete(entity, world) && def.next) {
    const actions: Action[] = [];
    if (signal.kind === "approved") {
      const gate = terminalGate(entity);
      if (gate) {
        actions.push({
          kind: "recordApproval",
          entityId: entity.id,
          gate,
          reviewer: signal.reviewer,
          sha: signal.sha,
        });
      }
    }
    actions.push({ kind: "enterPhase", entityId: entity.id, phase: def.next });
    return actions;
  }

  const gate = deriveGate(entity, world);

  // Conflict and base recovery are handled phase-wide rather than only under
  // `awaiting_merge`: a conflict that lands while CI is still running is just
  // as real, and waiting for the merge gate to fix it would stall the PR.
  if (entity.phase === "IMPLEMENTATION") {
    if (signal.kind === "merge_conflict") {
      return [
        {
          kind: "resolveConflict",
          entityId: entity.id,
          because: `PR #${signal.pullNumber} is conflicting with its base.`,
        },
      ];
    }
    if (signal.kind === "base_recovered") {
      return [
        {
          kind: "rebaseOnBase",
          entityId: entity.id,
          because: "The base branch is green again.",
        },
      ];
    }
    // A goal check that fails after the PR merged needs a human: there is no
    // open PR left to push a fix to, and the change is already on the base.
    if (signal.kind === "goal_check_failed") {
      return [
        {
          kind: "escalate",
          entityId: entity.id,
          reason:
            "The goal check failed after merge — the change is on the base branch and did not do what the issue asked.",
        },
      ];
    }
  }

  if (gate === null) return [];

  switch (gate) {
    case "awaiting_spec_review":
    case "awaiting_spec_approval":
    case "awaiting_objective_approval":
      if (signal.kind === "feedback_received" || signal.kind === "changes_requested") {
        return reviseOrEscalate(entity, world, "reviseSpec", "Review feedback arrived.");
      }
      if (signal.kind === "question_asked") {
        return [
          {
            kind: "answerQuestion",
            entityId: entity.id,
            because: `Question on PR #${signal.pullNumber}.`,
          },
        ];
      }
      return [];

    case "awaiting_ci":
      if (signal.kind === "ci_concluded" && signal.conclusion === "failure") {
        const pr = activeArtifact(entity, world);
        const prFacts =
          pr && pr.hostedAt.type === "pr" ? world.pullRequests[pr.hostedAt.number] : undefined;
        // A red base is not our failure. Wait for `base_recovered` rather than
        // dispatching an agent to chase someone else's breakage.
        if (prFacts?.baseRed) return [];
        return [
          {
            kind: "addressFeedback",
            entityId: entity.id,
            because: `CI failed on ${signal.sha}.`,
          },
        ];
      }
      return [];

    case "awaiting_review":
      if (signal.kind === "changes_requested" || signal.kind === "feedback_received") {
        return reviseOrEscalate(
          entity,
          world,
          "addressFeedback",
          "Review feedback arrived on the implementation PR.",
        );
      }
      if (signal.kind === "question_asked") {
        return [
          {
            kind: "answerQuestion",
            entityId: entity.id,
            because: `Question on PR #${signal.pullNumber}.`,
          },
        ];
      }
      if (signal.kind === "ci_concluded" && signal.conclusion === "failure") {
        return [
          {
            kind: "addressFeedback",
            entityId: entity.id,
            because: `CI failed on ${signal.sha} after review started.`,
          },
        ];
      }
      return [];

    case "awaiting_merge":
      // Conductor never merges. It waits here until a human does.
      return [];

    case "awaiting_goal_check":
      if (signal.kind === "merged") {
        return [
          {
            kind: "runGoalCheck",
            entityId: entity.id,
            because: `PR #${signal.pullNumber} merged.`,
          },
        ];
      }
      return [];

    case "awaiting_issues":
      // Completion is handled above; an individual child settling while others
      // are outstanding needs nothing.
      return [];

    default:
      return [];
  }
}
