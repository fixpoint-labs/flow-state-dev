/**
 * Aggregate generator-context entries into a tag-keyed accumulator.
 *
 * Object-form context entries are walked recursively. Each authored key is
 * normalized to kebab-case and validated, then merged into the accumulator
 * by these rules:
 *
 * - `string` and `string[]` → appended to a string-leaf array under the key
 * - nested object → recursive merge into a child `TagAccumulator`
 * - `function` → resolved with `(input, ctx)` and the result re-enters the algorithm
 * - `null` / `undefined` → reserves first-insertion order but contributes no content
 * - type mismatch (string vs nested object on the same key) → throws
 *
 * String entries (top-level `string` values from the user's array) and
 * AI-SDK-shaped pass-through messages (`{role, content, ...}`) bypass the
 * aggregator and are returned in the order they were authored, ready to be
 * emitted as their own system messages.
 */
import { normalizeTagName } from "../utils/string-case";
import { validateTagName } from "../prompt/reserved-tags";
import type { TagAccumulator, TagAccumulatorValue } from "../prompt/xml";
import type { BlockContext } from "../types/block";

/**
 * A value authored under a tag key in object-form context.
 *
 * String, string array, nested object, function, and null/undefined are all
 * permitted. Function values are resolved at render time and may return any
 * of the other shapes (or another function — though one level of resolution
 * is the supported pattern).
 */
export type ContextValue<TInput = unknown, TCtx = BlockContext> =
  | string
  | string[]
  | ContextObject<TInput, TCtx>
  | ((input: TInput, ctx: TCtx) => unknown | Promise<unknown>)
  | null
  | undefined;

/**
 * Object-form context: keys become XML tag names. Recursive — values can be
 * nested `ContextObject`s for nested tags.
 */
export type ContextObject<TInput = unknown, TCtx = BlockContext> = {
  [tagName: string]: ContextValue<TInput, TCtx>;
};

/** Result of `aggregateContextEntries`. */
export interface AggregatedContext {
  /** String entries (and pre-built `{role, content}` messages) in author order. */
  passThrough: unknown[];
  /** Aggregated tag tree keyed by canonical (kebab-case) tag name. */
  tagged: TagAccumulator;
  /** First-insertion order of top-level tag keys for stable rendering. */
  taggedOrder: string[];
}

/**
 * True if `value` is a `ContextObject` (a plain object that should be walked
 * for tag keys), not a pre-built AI-SDK message or array.
 */
function isContextObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !("role" in (value as Record<string, unknown>))
  );
}

/**
 * Walk resolved context entries and aggregate object-form entries into a
 * single tag-keyed accumulator. Strings and pre-built message objects are
 * passed through in author order.
 *
 * @param entries  Already-resolved entries from `resolveSlotValues`. Top-level
 *                 functions have been called; nested functions inside object
 *                 values are resolved here.
 * @param input    Block input, threaded into nested function resolution.
 * @param ctx      Block context, threaded into nested function resolution.
 * @param source   Optional human-readable source label for tag-name validation
 *                 errors (currently unused; reserved for richer error reporting).
 */
export async function aggregateContextEntries<TInput, TCtx extends BlockContext>(
  entries: unknown[],
  input: TInput,
  ctx: TCtx,
  source?: string
): Promise<AggregatedContext> {
  const result: AggregatedContext = {
    passThrough: [],
    tagged: {},
    taggedOrder: [],
  };

  for (const entry of entries) {
    await ingestEntry(entry, result, input, ctx, source);
  }

  return result;
}

async function ingestEntry<TInput, TCtx extends BlockContext>(
  entry: unknown,
  acc: AggregatedContext,
  input: TInput,
  ctx: TCtx,
  source: string | undefined
): Promise<void> {
  if (entry == null) return;

  if (typeof entry === "string") {
    if (entry.length > 0) acc.passThrough.push(entry);
    return;
  }

  if (typeof entry === "function") {
    const resolved = await (entry as (i: TInput, c: TCtx) => unknown)(input, ctx);
    await ingestEntry(resolved, acc, input, ctx, source);
    return;
  }

  if (Array.isArray(entry)) {
    for (const sub of entry) {
      await ingestEntry(sub, acc, input, ctx, source);
    }
    return;
  }

  if (isContextObject(entry)) {
    await mergeObjectInto(
      entry,
      acc.tagged,
      acc.taggedOrder,
      input,
      ctx,
      source,
      /* topLevel */ true
    );
    return;
  }

  // Anything else (e.g. a pre-built {role, content} message) passes through.
  acc.passThrough.push(entry);
}

async function mergeObjectInto<TInput, TCtx extends BlockContext>(
  obj: Record<string, unknown>,
  tagged: TagAccumulator,
  order: string[],
  input: TInput,
  ctx: TCtx,
  source: string | undefined,
  topLevel: boolean
): Promise<void> {
  for (const [authoredKey, rawValue] of Object.entries(obj)) {
    const key = normalizeTagName(authoredKey);
    validateTagName(key, source);

    // Resolve function values before merging.
    let value: unknown = rawValue;
    if (typeof value === "function") {
      value = await (value as (i: TInput, c: TCtx) => unknown)(input, ctx);
    }

    // Reserve order even for null placeholders so authors can declare layout
    // up front; tags with no resolved content are dropped at render time.
    if (topLevel && !order.includes(key) && !(key in tagged)) {
      order.push(key);
    }

    if (value == null) {
      // Placeholder slot. Initialize an empty leaf so render-time omission
      // logic has something to inspect; later contributors will fill it in.
      if (!(key in tagged)) {
        tagged[key] = [];
      }
      continue;
    }

    await mergeValueIntoKey(tagged, key, value, input, ctx, source);
  }
}

async function mergeValueIntoKey<TInput, TCtx extends BlockContext>(
  tagged: TagAccumulator,
  key: string,
  value: unknown,
  input: TInput,
  ctx: TCtx,
  source: string | undefined
): Promise<void> {
  const existing = tagged[key];

  if (typeof value === "string") {
    if (existing === undefined) {
      tagged[key] = [value];
      return;
    }
    if (Array.isArray(existing)) {
      existing.push(value);
      return;
    }
    throw new Error(
      `Context key "${key}" type mismatch: a string was contributed after a ` +
      `nested-object contribution.`
    );
  }

  if (Array.isArray(value)) {
    const strValues = value.filter((v): v is string => typeof v === "string");
    if (existing === undefined) {
      tagged[key] = [...strValues];
      return;
    }
    if (Array.isArray(existing)) {
      existing.push(...strValues);
      return;
    }
    throw new Error(
      `Context key "${key}" type mismatch: a string array was contributed ` +
      `after a nested-object contribution.`
    );
  }

  if (isContextObject(value)) {
    let target: TagAccumulator;
    if (existing === undefined) {
      target = {};
      tagged[key] = target;
    } else if (Array.isArray(existing)) {
      throw new Error(
        `Context key "${key}" type mismatch: a nested object was contributed ` +
        `after a string contribution.`
      );
    } else {
      target = existing as TagAccumulator;
    }
    await mergeObjectInto(
      value as Record<string, unknown>,
      target,
      [],
      input,
      ctx,
      source,
      /* topLevel */ false
    );
    return;
  }

  // Any other value type is coerced to its string representation.
  const coerced = String(value);
  if (existing === undefined) {
    tagged[key] = [coerced];
    return;
  }
  if (Array.isArray(existing)) {
    existing.push(coerced);
    return;
  }
  throw new Error(
    `Context key "${key}" type mismatch: a scalar was contributed after a ` +
    `nested-object contribution.`
  );
}

/**
 * Detect whether any object-form entry in the (un-resolved) slot list contains
 * a function value at any depth. Used to decide whether the tool-loop's
 * `prepareStep` callback must re-resolve context on each step.
 *
 * Top-level slot functions are detected by the caller; this helper is only
 * for nested function values inside `ContextObject`s.
 */
export function objectFormHasNestedFunction(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some(objectFormHasNestedFunction);
  }
  if (!isContextObject(value)) return false;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v === "function") return true;
    if (objectFormHasNestedFunction(v)) return true;
  }
  return false;
}

// Re-export accumulator types for consumers.
export type { TagAccumulator, TagAccumulatorValue };
