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
  phaseDefinition,
  type EntityKind,
  type Gate,
  type Phase,
} from "../model/phases";
import type { World } from "../model/world";

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
