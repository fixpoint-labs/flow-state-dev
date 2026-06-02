/**
 * `transientSlot()` marker for sequencer-state schema fields.
 *
 * A transient slot's value lives in memory for the lifetime of the sequencer's
 * run — readable from later steps via `ctx.sequencer.state` — but is invisible
 * to the SSE stream and the persisted session log:
 *
 *   - No `state_change` SSE item is emitted when only transient keys change.
 *   - The `state_snapshot` payload omits transient keys, so the durable
 *     checkpoint store never sees them and they reset to schema defaults
 *     on resume.
 *
 * The marker is a `Symbol.for(...)`-keyed flag stamped directly on the schema
 * instance. We deliberately avoid `.describe()` because that field is already
 * used for human-readable documentation (`packages/core/src/schema/action-schema.ts`)
 * and overloading it would conflict with user-supplied descriptions.
 *
 * Apply LAST in the schema chain — after `.optional()`, `.default()`, etc. —
 * so the marker sits on the outermost schema instance referenced by the
 * parent ZodObject's shape.
 */
import type { ZodTypeAny } from "zod";
import { getZodObjectShape } from "./zod-introspect";

const TRANSIENT_FLAG = Symbol.for("@flow-state-dev/transient-slot");

/**
 * Mark a Zod schema field as a transient sequencer-state slot. Returns the
 * same schema instance with the marker stamped on it.
 */
export function transientSlot<T extends ZodTypeAny>(schema: T): T {
  (schema as unknown as Record<symbol, true>)[TRANSIENT_FLAG] = true;
  return schema;
}

/** Returns true when the schema instance has been stamped by `transientSlot()`. */
export function isTransientSlot(schema: ZodTypeAny | undefined): boolean {
  if (schema === undefined || schema === null) return false;
  return (schema as unknown as Record<symbol, true>)[TRANSIENT_FLAG] === true;
}

/**
 * Walk a `z.object({...})` schema's top-level shape and collect the keys
 * whose value schema was marked via `transientSlot()`. Non-object schemas
 * (or `undefined`) yield an empty set.
 */
export function getTransientKeys(stateSchema: ZodTypeAny | undefined): Set<string> {
  const keys = new Set<string>();
  if (stateSchema === undefined || stateSchema === null) return keys;
  const shape = getZodObjectShape(stateSchema);
  if (!shape) return keys;
  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (isTransientSlot(fieldSchema)) {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * Return a shallow copy of `state` with all keys in `transientKeys` removed.
 * The input is not mutated. When `transientKeys` is empty, the original
 * reference is returned (no allocation).
 */
export function stripTransientKeys<T extends Record<string, unknown>>(
  state: T,
  transientKeys: Set<string> | undefined
): T {
  if (!transientKeys || transientKeys.size === 0) return state;
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    return state;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(state)) {
    if (!transientKeys.has(key)) {
      out[key] = (state as Record<string, unknown>)[key];
    }
  }
  return out as T;
}
