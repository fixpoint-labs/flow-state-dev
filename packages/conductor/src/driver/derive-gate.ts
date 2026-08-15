/**
 * Gate derivation — the property that makes a restart survivable.
 *
 * A gate is **never stored**. It is computed from a world snapshot every tick,
 * so killing the process while an entity waits on one loses nothing: the next
 * tick re-derives the same gate from the same world. The earlier attempt at
 * this system stored its progression in a second place, drifted from the board,
 * and looped forever on a cold restart between two gates. Deriving is the fix.
 */

import {
  artifactKindForPhase,
  phaseDefinition,
  type EntityKind,
  type Gate,
  type Phase,
} from "../model/phases";
import { artifactOfKind, standingVerdict, type World } from "../model/world";

/** The minimum an entity must carry for the driver to reduce against it. */
export interface ConductorEntity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly phase: Phase;
}

/**
 * The gate this entity is currently waiting on, or `null`.
 *
 * `null` is genuinely ambiguous and callers must not read it as "ready to
 * advance": it means *either* work is in flight (a dispatch has not produced
 * its artifact yet) *or* every gate is released. Use `isPhaseComplete` to tell
 * those apart.
 */
export function deriveGate(entity: ConductorEntity, world: World): Gate | null {
  const def = phaseDefinition(entity.kind, entity.phase);
  if (!def) return null;
  for (const gate of def.gates) {
    if (gate.appliesWhen(world) && !gate.satisfiedBy(world)) return gate.name;
  }
  return null;
}

/**
 * True when this world leaves the phase **nowhere to go**: no gate of it applies,
 * and it has not completed.
 *
 * The world half of *stuck* (`runtime/tick`'s `stalled` is the whole of it, and
 * adds what only durable state can say — whether the phase's entry work has
 * settled, and whether a human has already been asked). Kept here because it is
 * a pure predicate over a snapshot, which is what this file is for, and because
 * that is what makes its three clauses testable against literals rather than
 * only through a drive that can reach them.
 *
 * **"No gate applies" is not "`deriveGate` returned `null`."** The difference is
 * the whole reason this reads `appliesWhen` directly. `deriveGate` answers *what
 * is outstanding*, and it returns `null` for two states that mean opposite
 * things: a phase whose gates all applied and were satisfied — the table
 * describes exactly where the entity is, it just is not waiting on that gate —
 * and a phase **no gate applies to at all**, where the table has nothing to say
 * about the entity's situation.
 *
 * `IMPLEMENTATION` is where they used to come apart, and not rarely. An approved
 * implementation PR whose goal was never proved derived no gate: `awaiting_ci`
 * and `awaiting_review` satisfied, `awaiting_merge` refusing to *apply* on
 * unproved work, and `awaiting_goal_check` waiting for a merge. It is an open
 * submission with a human's approval standing on it — a thing anyone can act on
 * — and reading it as stuck would have filed a report at the ordinary end of a
 * review. A phase holding no submission at all is the opposite: nobody has
 * anything to act on.
 *
 * **That world no longer exists**, because the same absence was also the reason a
 * proof could never be re-earned: `awaiting_goal_check` now applies to it and
 * asks for the proof. The two readings therefore agree everywhere the shipped
 * tables can reach today — which is a result of closing that hole rather than a
 * reason to stop reading `appliesWhen`. A phase table is data, and a phase
 * defined elsewhere can reintroduce a gate that applies and is satisfied while
 * its phase cannot complete.
 *
 * **A terminal phase is excluded rather than falling out of the predicate.**
 * `SETTLED` holds no gates and completes nothing, which is the exact shape of a
 * stranded phase one step earlier — and for a terminal phase that shape is what
 * being finished *means*. The phase table already says so with `next === null`,
 * so this reads it rather than inferring anything from the absence.
 */
export function isPhaseStranded(entity: ConductorEntity, world: World): boolean {
  const def = phaseDefinition(entity.kind, entity.phase);
  if (!def || def.next === null) return false;
  if (def.gates.some((gate) => gate.appliesWhen(world))) return false;
  return !def.completedWhen(world);
}

/** True when the entity's current phase has met its completion condition. */
export function isPhaseComplete(entity: ConductorEntity, world: World): boolean {
  const def = phaseDefinition(entity.kind, entity.phase);
  if (!def) return false;
  return def.completedWhen(world);
}

/** The phase this entity advances to when complete, or `null` at a terminal phase. */
export function nextPhase(entity: ConductorEntity): Phase | null {
  return phaseDefinition(entity.kind, entity.phase)?.next ?? null;
}

/**
 * What the work in front of the entity still **owes a proof**, or `null`.
 *
 * The pure half of the transition that re-proves. `awaiting_goal_check` already
 * answers *does this work need a proof it does not have* — including which
 * submissions are live enough to be worth proving and which ground the proof has
 * to stand on — so this asks the table rather than restating it, and splits the
 * one answer the table cannot give on its own:
 *
 * - **`goal_check_needed`** — nothing has proved the code in front of us. The
 *   answer is to run the check.
 * - **`goal_check_failed`** — something has, and it failed. That is a statement
 *   about the work, not a missing measurement, and the answer is to send the work
 *   back rather than to measure it again.
 *
 * Keyed on the **derived** gate rather than on `awaiting_goal_check`'s own
 * `appliesWhen`, so a red build or an unanswered review is handled first and
 * nothing pays for a proof of code CI has already failed.
 *
 * Pure over the snapshot, like everything else here. What it deliberately does
 * *not* know is whether a human has already been asked, or whether the caller
 * has just bought work that may have moved the code — both are statements about
 * durable state and about the pass in progress, and they belong to the caller
 * that holds them (`runtime/tick`, and the replay harness that mirrors it).
 */
export function outstandingProof(
  entity: ConductorEntity,
  world: World,
): "goal_check_needed" | "goal_check_failed" | null {
  if (deriveGate(entity, world) !== "awaiting_goal_check") return null;
  const kind = artifactKindForPhase(entity.phase);
  const verdict = kind ? standingVerdict(world, artifactOfKind(world, kind)) : null;
  return verdict === "failed" ? "goal_check_failed" : "goal_check_needed";
}
