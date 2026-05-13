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
 * String, nested object, function, heterogeneous array (strings, functions,
 * and nested objects mixed together), and null/undefined are all permitted.
 * Function values are resolved at render time and may return any of the
 * non-array shapes (or `null`/`undefined`).
 *
 * Heterogeneous arrays let multiple contributors aggregate under the same
 * tag — e.g. `{ skills: [catalogFn, activeFn] }` resolves both functions and
 * concatenates their string output inside one `<skills>` block.
 */
export type ContextValue<TInput = unknown, TCtx = BlockContext> =
  | string
  | ContextObject<TInput, TCtx>
  | ContextValueFn<TInput, TCtx>
  | Array<ContextValueLeaf<TInput, TCtx>>
  | null
  | undefined;

/** Function value within a `ContextObject` — resolved at render time. */
export type ContextValueFn<TInput = unknown, TCtx = BlockContext> = (
  input: TInput,
  ctx: TCtx
) => unknown | Promise<unknown>;

/**
 * Element type for arrays inside a `ContextValue`. Excludes nested arrays —
 * arrays of arrays aren't authored directly; if you need to compose multiple
 * contributors, list them as siblings in the same array.
 */
export type ContextValueLeaf<TInput = unknown, TCtx = BlockContext> =
  | string
  | ContextObject<TInput, TCtx>
  | ContextValueFn<TInput, TCtx>
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

/** Valid AI-SDK `ModelMessage` role literals. */
const AI_SDK_MESSAGE_ROLES: ReadonlySet<string> = new Set([
  "system",
  "user",
  "assistant",
  "tool",
]);

/**
 * True if `value` looks like a pre-built AI-SDK `ModelMessage`: a plain object
 * whose `role` is one of the literal AI-SDK roles AND that carries a `content`
 * field. The presence of a `role` key alone is not enough — that would silently
 * misclassify any object-form context entry that happens to use `role` as a tag
 * name (which is itself a reserved tag).
 */
function isPreBuiltModelMessage(value: Record<string, unknown>): boolean {
  const role = value.role;
  return (
    typeof role === "string" &&
    AI_SDK_MESSAGE_ROLES.has(role) &&
    "content" in value
  );
}

/**
 * True if `value` is a `ContextObject` (a plain object that should be walked
 * for tag keys), not a pre-built AI-SDK message or array. Pre-built messages
 * are detected by `isPreBuiltModelMessage`; anything else — including objects
 * with a `role` key that fails that check — is treated as object-form context.
 */
function isContextObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return !isPreBuiltModelMessage(value as Record<string, unknown>);
}

/**
 * Format an arbitrary value for inclusion in an error message. Functions and
 * objects are summarized rather than fully serialized to keep the diagnostic
 * focused on the *kind* of bad value, not its contents.
 */
function describeBadRole(value: unknown): string {
  if (typeof value === "function") return "a function";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  return `${typeof value} ${JSON.stringify(value)}`;
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
    // An object that reaches the context-walk path with a `role` key is
    // ambiguous: it almost certainly meant to be a pre-built AI-SDK message
    // but failed the `isPreBuiltModelMessage` check (role wasn't a literal
    // AI-SDK role, or `content` was missing). Surface this directly rather
    // than letting it fall through to `validateTagName("role")`, which would
    // emit a generic "reserved tag" message that doesn't explain the user's
    // likely intent.
    if ("role" in entry) {
      const sourceSuffix = source ? ` on "${source}"` : "";
      const roleIsValidLiteral =
        typeof entry.role === "string" && AI_SDK_MESSAGE_ROLES.has(entry.role);
      const diagnosis = roleIsValidLiteral
        ? `\`role\` is "${entry.role as string}" (a valid AI-SDK role) but the \`content\` field is missing`
        : `\`role\` key whose value is ${describeBadRole(entry.role)} — not a valid AI-SDK message role`;
      throw new Error(
        `Generator context entry${sourceSuffix} has a ${diagnosis}. ` +
        `If you meant a tag named "role", rename it (role is ` +
        `a reserved context tag name). If you meant a pre-built message, ` +
        `set \`role\` to one of "system" | "user" | "assistant" | "tool" ` +
        `and include a \`content\` field.`
      );
    }
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
    for (const item of value) {
      let resolved: unknown = item;
      if (typeof resolved === "function") {
        resolved = await (resolved as (i: TInput, c: TCtx) => unknown)(input, ctx);
      }
      if (resolved == null) continue;
      await mergeValueIntoKey(tagged, key, resolved, input, ctx, source);
    }
    return;
  }

  if (isContextObject(value)) {
    let target: TagAccumulator;
    // Treat an empty array as a still-unfilled placeholder (see the null
    // branch in mergeObjectInto): it reserved order but committed to no
    // leaf shape yet, so an object contributor can claim it.
    if (existing === undefined || (Array.isArray(existing) && existing.length === 0)) {
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
  if (value == null) return false;
  if (typeof value === "function") return true;
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some(objectFormHasNestedFunction);
  }
  if (!isContextObject(value)) return false;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (objectFormHasNestedFunction(v)) return true;
  }
  return false;
}

// Re-export accumulator types for consumers.
export type { TagAccumulator, TagAccumulatorValue };
