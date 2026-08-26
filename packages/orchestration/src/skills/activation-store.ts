/**
 * Where a per-generator skill binding keeps its **dynamic** activations.
 *
 * The settled Skills v2 model (FIX-911) replaces the session-global
 * `activeSkills` bag with a per-generator location, so an activation on one
 * generator never bleeds into another's context. A binding stores dynamic
 * activations in one of two places:
 *
 *   - **Block state (default).** The generator's own request-scoped block
 *     state (FIX-914). The reader runs in the generator's scope and reads
 *     `ctx.self`; the model-facing load tool runs as a child block and writes
 *     the generator's state via `ctx.parent`. Request-scoped, so nothing
 *     carries into the next turn, and it never leaves that generator.
 *   - **Explicit `activeState: { scope, field }`.** A named field at a chosen
 *     durable scope (`session` / `user` / `org`) or `request`. The author owns
 *     lifetime and cross-generator sharing by choosing the scope and field.
 *     An upstream matcher that runs before the generator (so it cannot reach a
 *     downstream generator's not-yet-created block state) must use this.
 *
 * Both sides — reader and writer — go through the helpers here so the two
 * addressing modes stay in one place.
 */

import type { BlockContext, ScopeStateOps } from "@flow-state-dev/core/types";
import {
  pushActiveSkill,
  type ActiveSkillEntry,
} from "./active-skill-state";

/** Field name used when a binding stores dynamic activations in block state. */
export const BLOCK_STATE_FIELD = "activeSkills";

/** Explicit persisted/request scopes an `activeState` field can live at. */
export type ExplicitActivationScope = "request" | "session" | "user" | "org";

/**
 * Where a binding's dynamic activations live.
 *   - `{ kind: "block" }` — the generator's own block state (the default).
 *   - `{ kind: "explicit", scope, field }` — a named field at a chosen scope.
 */
export type ActivationLocation =
  | { kind: "block" }
  | { kind: "explicit"; scope: ExplicitActivationScope; field: string };

function readFieldEntries(state: unknown, field: string): ActiveSkillEntry[] {
  if (state === null || typeof state !== "object") return [];
  const value = (state as Record<string, unknown>)[field];
  return Array.isArray(value) ? (value as ActiveSkillEntry[]) : [];
}

/**
 * Read the dynamic activations for a binding, from the reader's point of view
 * (running in the host generator's scope). For the block default this reads
 * the generator's own `ctx.self` state; for an explicit location it reads the
 * chosen scope's state field.
 */
export function readActivations(
  ctx: BlockContext,
  location: ActivationLocation,
): ActiveSkillEntry[] {
  if (location.kind === "block") {
    return readFieldEntries(ctx.self?.state, BLOCK_STATE_FIELD);
  }
  const scopeState = scopeStateSnapshot(ctx, location.scope);
  return readFieldEntries(scopeState, location.field);
}

/** The mutation surface for a scope, as exposed on the block context. */
type MutableScope = Partial<ScopeStateOps<Record<string, unknown>>> & {
  state?: unknown;
};

function scopeHandle(
  ctx: BlockContext,
  scope: ExplicitActivationScope,
): MutableScope | undefined {
  switch (scope) {
    case "request":
      return ctx.request as unknown as MutableScope;
    case "session":
      return ctx.session as unknown as MutableScope;
    case "user":
      return ctx.user as unknown as MutableScope;
    case "org":
      return ctx.org as unknown as MutableScope | undefined;
  }
}

function scopeStateSnapshot(
  ctx: BlockContext,
  scope: ExplicitActivationScope,
): unknown {
  return scopeHandle(ctx, scope)?.state;
}

/**
 * Append (dedup by name+mode) a dynamic activation entry, from the writer's
 * point of view (a child block of the generator — e.g. the load tool). For the
 * block default this writes the parent generator's block state via `ctx.parent`
 * (FIX-914's child→ancestor handle); for an explicit location it writes the
 * chosen scope's field. Uses an atomic mutator so concurrent tool calls don't
 * clobber one another.
 */
export async function appendActivation(
  ctx: BlockContext,
  location: ActivationLocation,
  entry: ActiveSkillEntry,
): Promise<void> {
  if (location.kind === "block") {
    const parent = ctx.parent;
    if (!parent?.atomicState) {
      throw new Error(
        "Skill activation has nowhere to write: the host generator declares no block " +
          "state. Add `stateSchema: z.object({ activeSkills: activeSkillsArraySchema })` " +
          "to the generator, or configure an explicit `activeState` on the skills binding.",
      );
    }
    await parent.atomicState((current) => ({
      [BLOCK_STATE_FIELD]: pushActiveSkill(
        readFieldEntries(current, BLOCK_STATE_FIELD),
        entry,
      ),
    }));
    return;
  }

  const handle = scopeHandle(ctx, location.scope);
  if (!handle?.atomicState) {
    throw new Error(
      `Skill activation cannot write to ${location.scope} state — scope unavailable`,
    );
  }
  const field = location.field;
  await handle.atomicState((current) => ({
    [field]: pushActiveSkill(readFieldEntries(current, field), entry),
  }));
}

/**
 * Replace (not append) the dynamic activations at a location. This is the
 * up-front matcher's per-turn semantics: a matcher writes the whole set it
 * resolved for this turn, overwriting the previous turn's. Only meaningful for
 * an explicit location — an upstream matcher runs before the generator, so it
 * cannot reach a downstream generator's block state.
 */
export async function replaceActivations(
  ctx: BlockContext,
  location: Extract<ActivationLocation, { kind: "explicit" }>,
  entries: ActiveSkillEntry[],
): Promise<void> {
  const handle = scopeHandle(ctx, location.scope);
  if (!handle?.patchState) {
    throw new Error(
      `Skill activation cannot write to ${location.scope} state — scope unavailable`,
    );
  }
  await handle.patchState({ [location.field]: entries });
}
