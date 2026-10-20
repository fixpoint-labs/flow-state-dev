/**
 * Build-time half of `ctx.sequencer`: fold each `sequencerStateSchema` into
 * the nearest sequencer that has a `stateSchema`. Rules live in
 * docs/architecture/blocks.md. Containers are created from the schema this
 * returns.
 */
import type { ZodObject, ZodRawShape, ZodTypeAny } from "zod";
import { SequencerSchemaMismatchError } from "../../errors/sequencer-output-schema-error";
import { compareStateFieldKinds, getZodObjectShape, getZodTypeName } from "../../helpers/zod-introspect";
import { isTransientSlot, transientSlot } from "../../helpers/transient-slot";
import type { BlockDefinition } from "../../types/block";

/**
 * A field that rejects `undefined` joins as `.optional()`, so the other
 * defaults still parse. A transient mark moves with it.
 */
function asAddedField(field: ZodTypeAny): ZodTypeAny {
  if (field.safeParse(undefined).success) return field;
  const optional = field.optional();
  return isTransientSlot(field) ? transientSlot(optional) : optional;
}

function conflict(
  sequencerName: string,
  messageTail: string,
  reason: string,
  declared: ZodTypeAny,
  inferred: ZodTypeAny
): never {
  throw new SequencerSchemaMismatchError(`Sequencer state conflict at "${sequencerName}": ${messageTail}`, {
    sequencerName,
    declaredKind: getZodTypeName(declared) ?? "unknown",
    inferredKind: getZodTypeName(inferred),
    reason
  });
}

/**
 * Merge `requirement` into `base`. Returns `base` when nothing is added.
 * Throws when a shared field disagrees in kind, or either side is not a `z.object()`.
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
    conflict(sequencerName, `cannot merge the state ${source} requires: ${reason}`, reason, base, requirement);
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
      conflict(sequencerName, `${source} requires a different ${reason}`, reason, declared, field);
    }
  }

  if (Object.keys(added).length === 0) return base;
  return (base as ZodObject<ZodRawShape>).extend(added);
}

/**
 * Fold each child's `sequencerStateSchema` into `initial`. A sequencer that
 * already has its own state absorbed its children, so it contributes nothing.
 *
 * @param initial The sequencer's own `stateSchema`, or, for a sequencer or
 *   router that holds no state, its own requirement (or `undefined`).
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
