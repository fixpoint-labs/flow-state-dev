/**
 * Sequencer state schema bubbling — the build-time half of `ctx.sequencer`.
 *
 * A block's `sequencerStateSchema` names the state it needs from the sequencer
 * `ctx.sequencer` resolves to: the nearest enclosing sequencer that has a
 * `stateSchema`. A sequencer without one is transparent to that lookup, so it
 * holds no state of its own and passes its children's requirements up as its
 * own `sequencerStateSchema`; a router does the same for its routes. A
 * sequencer WITH a `stateSchema` absorbs them: each field it lacks is added
 * (keeping its default), and each field it already declares must agree in kind,
 * or the composition is refused with `SequencerSchemaMismatchError`. All of this
 * happens while the flow is built, so a conflicting schema never reaches a run.
 *
 * Runtime is unchanged: every container is created from the block's effective
 * `config.stateSchema`, which is what this module computes.
 */
import type { ZodObject, ZodRawShape, ZodTypeAny } from "zod";
import { SequencerSchemaMismatchError } from "../../errors/sequencer-output-schema-error";
import { compareStateFieldKinds, getZodObjectShape, getZodTypeName } from "../../helpers/zod-introspect";
import { isTransientSlot, transientSlot } from "../../helpers/transient-slot";
import type { BlockDefinition } from "../../types/block";

/**
 * A field added to a sequencer's state starts absent until a block writes it.
 * A field that neither has a default nor accepts `undefined` would make the
 * whole initial state fail to parse (dropping every other default) and fail
 * the checkpoint validation, so it joins as `.optional()`. A transient mark
 * moves with it.
 */
function asAddedField(field: ZodTypeAny): ZodTypeAny {
  if (field.safeParse(undefined).success) return field;
  const optional = field.optional();
  return isTransientSlot(field) ? transientSlot(optional) : optional;
}

/**
 * Merge one `sequencerStateSchema` requirement into a state schema.
 *
 * Returns `base` itself when the requirement adds nothing, so a child that
 * reuses its sequencer's schema leaves it untouched. Throws
 * `SequencerSchemaMismatchError` when a shared field disagrees in kind, or when
 * either side is not a `z.object()`.
 *
 * @param source How the requirement is named in the error (`block "x"`).
 */
export function absorbSequencerStateRequirement(
  base: ZodTypeAny,
  requirement: ZodTypeAny,
  sequencerName: string,
  source: string
): ZodTypeAny {
  if (base === requirement) return base;
  const baseShape = getZodObjectShape(base);
  const requiredShape = getZodObjectShape(requirement);
  if (baseShape === undefined || requiredShape === undefined) {
    const reason = "both the sequencer's state schema and the block's sequencerStateSchema must be z.object() to merge";
    throw new SequencerSchemaMismatchError(
      `Sequencer state conflict at "${sequencerName}": cannot merge the state ${source} requires: ${reason}`,
      {
        sequencerName,
        declaredKind: getZodTypeName(base) ?? "unknown",
        inferredKind: getZodTypeName(requirement),
        reason
      }
    );
  }

  const added: Record<string, ZodTypeAny> = {};
  for (const [key, field] of Object.entries(requiredShape)) {
    const declared = baseShape[key];
    if (declared === undefined) {
      added[key] = asAddedField(field);
      continue;
    }
    if (declared === field) continue;
    const mismatch = compareStateFieldKinds(declared, field);
    if (mismatch !== null) {
      const reason = `state field "${key}": ${mismatch}`;
      throw new SequencerSchemaMismatchError(
        `Sequencer state conflict at "${sequencerName}": ${source} requires a different ${reason}`,
        {
          sequencerName,
          declaredKind: getZodTypeName(declared) ?? "unknown",
          inferredKind: getZodTypeName(field),
          reason
        }
      );
    }
  }

  if (Object.keys(added).length === 0) return base;
  return (base as ZodObject<ZodRawShape>).extend(added);
}

/**
 * Fold the `sequencerStateSchema` of each composed block into `initial`.
 *
 * `initial` is the sequencer's own `stateSchema` (the requirements land on it)
 * or, for a sequencer or router that holds no state, its own requirement or
 * `undefined` (the requirements merge into what it passes up). A child that
 * is a sequencer with state of its own carries no `sequencerStateSchema` —
 * it absorbed its children — so it contributes nothing here.
 */
export function foldSequencerStateRequirements(
  initial: ZodTypeAny | undefined,
  children: readonly BlockDefinition<any, any>[],
  ownerName: string
): ZodTypeAny | undefined {
  let acc = initial;
  for (const child of children) {
    const requirement = (child.config as { sequencerStateSchema?: ZodTypeAny }).sequencerStateSchema;
    if (requirement === undefined) continue;
    acc = acc === undefined
      ? requirement
      : absorbSequencerStateRequirement(acc, requirement, ownerName, `block "${child.name}"`);
  }
  return acc;
}
