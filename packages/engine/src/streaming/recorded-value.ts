/**
 * The record limit (FIX-1772): what the response emitter records in place of a
 * block output or tool result that is too large to keep.
 *
 * A step's return value and a tool's result are recorded on their items, which
 * go to the request log, the stream and later prompts. Over
 * `maxRecordedValueBytes` (256 KiB by default) once serialized, the record
 * keeps an {@link OmittedValue} instead: the size and the first 512 characters.
 * The run never sees this; it keeps the real value in memory.
 *
 * Sizing walks the value the way `JSON.stringify` does and counts UTF-8 bytes
 * without building the serialized string, so a multi-megabyte value that is
 * about to be dropped is never stringified whole. Only the preview's first 512
 * characters are ever built.
 */
import type { OmittedValue, StructureShape } from "@flow-state-dev/core/items";
import type { BlockValueInternal } from "@flow-state-dev/core/items/internal";

/** The limit an emitter applies when none is passed: 256 KiB. */
export const DEFAULT_MAX_RECORDED_VALUE_BYTES = 256 * 1024;

/** How many characters of the serialized value a placeholder keeps. */
export const OMITTED_PREVIEW_CHARS = 512;

const UNSERIALIZABLE = Symbol("unserializable");

/** UTF-8 bytes of a string once JSON-escaped, quotes included. Allocation-free. */
function escapedStringBytes(s: string): number {
  let bytes = 2;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c === 0x22 || c === 0x5c || c === 0x08 || c === 0x0c || c === 0x0a || c === 0x0d || c === 0x09) {
      bytes += 2;
    } else if (c < 0x20) {
      bytes += 6;
    } else if (c < 0x80) {
      bytes += 1;
    } else if (c < 0x800) {
      bytes += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 6; // a lone surrogate is escaped as \uXXXX
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** True when the value is skipped as an object property, as `JSON.stringify` does. */
function isSkipped(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

/**
 * Size a value as `JSON.stringify` would serialize it. Returns the UTF-8 byte
 * count and the first {@link OMITTED_PREVIEW_CHARS} characters, or
 * `UNSERIALIZABLE` for a cycle, a BigInt, or a throwing `toJSON`.
 */
function sizeOf(root: unknown): { bytes: number; preview: string } | typeof UNSERIALIZABLE {
  let bytes = 0;
  let preview = "";
  const stack = new Set<object>();

  const write = (chunk: string, chunkBytes: number): void => {
    bytes += chunkBytes;
    if (preview.length < OMITTED_PREVIEW_CHARS) {
      preview += chunk.slice(0, OMITTED_PREVIEW_CHARS - preview.length);
    }
  };
  const writeAscii = (chunk: string): void => write(chunk, chunk.length);
  const writeString = (s: string): void => {
    const room = OMITTED_PREVIEW_CHARS - preview.length;
    // One extra code unit keeps a surrogate pair whole at the cut; the escaped
    // prefix is then trimmed by `write`.
    const head = room > 0 ? JSON.stringify(s.slice(0, room + 1)) : "";
    write(head, escapedStringBytes(s));
  };

  /** `JSON.stringify`'s first step for any value: run its `toJSON`, unwrap a boxed primitive. */
  const resolve = (key: string, raw: unknown): unknown => {
    let value = raw;
    if (value !== null && typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
      value = (value as { toJSON: (k: string) => unknown }).toJSON(key);
    }
    if (value instanceof Number || value instanceof String || value instanceof Boolean) {
      value = value.valueOf();
    }
    return value;
  };

  /** Serialize a value `resolve` already produced. */
  const emit = (value: unknown): void => {
    if (value === null) return writeAscii("null");
    switch (typeof value) {
      case "string":
        return writeString(value);
      case "number":
        return writeAscii(Number.isFinite(value) ? String(value) : "null");
      case "boolean":
        return writeAscii(value ? "true" : "false");
      case "bigint":
        throw UNSERIALIZABLE;
      case "object":
        break;
      default:
        return writeAscii("null"); // undefined, a function or a symbol, inside an array
    }
    const obj = value as object;
    if (stack.has(obj)) throw UNSERIALIZABLE;
    stack.add(obj);
    if (Array.isArray(obj)) {
      writeAscii("[");
      for (let i = 0; i < obj.length; i += 1) {
        if (i > 0) writeAscii(",");
        emit(resolve(String(i), obj[i]));
      }
      writeAscii("]");
    } else {
      writeAscii("{");
      let first = true;
      for (const k of Object.keys(obj)) {
        const member = resolve(k, (obj as Record<string, unknown>)[k]);
        if (isSkipped(member)) continue;
        if (!first) writeAscii(",");
        first = false;
        writeString(k);
        writeAscii(":");
        emit(member);
      }
      writeAscii("}");
    }
    stack.delete(obj);
  };

  try {
    const value = resolve("", root);
    // `JSON.stringify(undefined)` records nothing.
    if (isSkipped(value)) return { bytes: 0, preview: "" };
    emit(value);
  } catch {
    // A cycle, a BigInt, or a `toJSON` that throws.
    return UNSERIALIZABLE;
  }
  return { bytes, preview };
}

/**
 * Measures values against one limit, once each. Results are cached per object
 * so a value seen on an `item.updated` patch and again on `item.done` is
 * walked once (strings are cheap to re-check and skip the cache).
 */
export class RecordedValueLimiter {
  private readonly cache = new WeakMap<object, OmittedValue | null>();

  constructor(readonly limit: number) {}

  /** The placeholder for `value`, or `undefined` when it is recorded whole. */
  measure(value: unknown): OmittedValue | undefined {
    if (value === undefined || value === null || typeof value === "boolean" || typeof value === "number") {
      return undefined;
    }
    if (typeof value === "string") {
      // Six bytes is the most one UTF-16 unit can serialize to.
      if (value.length * 6 + 2 <= this.limit) return undefined;
      return this.compute(value) ?? undefined;
    }
    if (typeof value === "object" || typeof value === "function") {
      const key = value as object;
      const cached = this.cache.get(key);
      if (cached !== undefined) return cached ?? undefined;
      const result = this.compute(value);
      this.cache.set(key, result);
      return result ?? undefined;
    }
    return this.compute(value) ?? undefined;
  }

  private compute(value: unknown): OmittedValue | null {
    const size = sizeOf(value);
    if (size === UNSERIALIZABLE) return { kind: "omitted", bytes: null, preview: "" };
    if (size.bytes <= this.limit) return null;
    return { kind: "omitted", bytes: size.bytes, preview: size.preview };
  }

  /** A block value with every inline leaf over the limit replaced, or the same object when none is. */
  limitBlockValue(value: BlockValueInternal<unknown>, onOmit: (omitted: OmittedValue) => void): BlockValueInternal<unknown> {
    if (value.kind === "inline") {
      const omitted = this.measure(value.value);
      if (omitted === undefined) return value;
      onOmit(omitted);
      return omitted;
    }
    if (value.kind !== "structure") return value;
    const shape = value.shape;
    if (shape.container === "array") {
      let changed = false;
      const entries = shape.entries.map((entry) => {
        const next = this.limitBlockValue(entry, onOmit);
        if (next !== entry) changed = true;
        return next;
      });
      return changed ? { kind: "structure", shape: { container: "array", entries } } : value;
    }
    let changed = false;
    const entries: Record<string, BlockValueInternal<unknown>> = {};
    for (const key of Object.keys(shape.entries)) {
      const entry = shape.entries[key]!;
      const next = this.limitBlockValue(entry, onOmit);
      if (next !== entry) changed = true;
      entries[key] = next;
    }
    return changed ? { kind: "structure", shape: { container: "object", entries } as StructureShape } : value;
  }

  /**
   * The recorded form of an item's recorded fields: a `block_trace`'s `output`,
   * a `tool_output`'s `output` and `modelOutput`. `fields` is the item or an
   * `item.updated` patch; only the keys it carries are measured. Returns the
   * fields unchanged (same object) when nothing is over the limit.
   */
  limitFields(
    itemType: string,
    fields: Record<string, unknown>,
    onOmit: (slot: string, omitted: OmittedValue) => void
  ): Record<string, unknown> {
    if (itemType === "block_trace") {
      const output = fields.output as BlockValueInternal<unknown> | undefined;
      if (output === undefined || output === null || typeof output !== "object") return fields;
      const next = this.limitBlockValue(output, (omitted) => onOmit("output", omitted));
      return next === output ? fields : { ...fields, output: next };
    }
    if (itemType === "tool_output") {
      const hasOutput = "output" in fields && fields.output !== undefined;
      const hasModelOutput = "modelOutput" in fields && fields.modelOutput !== undefined;
      if (!hasOutput && !hasModelOutput) return fields;
      const a = hasOutput ? this.measure(fields.output) : undefined;
      const b = hasModelOutput ? this.measure(fields.modelOutput) : undefined;
      if (a === undefined && b === undefined) return fields;
      const omitted = largerOf(a, b);
      onOmit("output", omitted);
      // `undefined`, not a deleted key: on an `item.updated` patch it also
      // clears a value an earlier patch recorded.
      return { ...fields, output: undefined, modelOutput: undefined, outputOmitted: omitted };
    }
    return fields;
  }
}

/** The placeholder for whichever of two values is larger; an unsized one wins. */
function largerOf(a: OmittedValue | undefined, b: OmittedValue | undefined): OmittedValue {
  if (a === undefined) return b!;
  if (b === undefined) return a;
  if (a.bytes === null) return a;
  if (b.bytes === null) return b;
  return a.bytes >= b.bytes ? a : b;
}

/** Item types whose fields carry a recorded value. */
export function carriesRecordedValue(item: { type: string }): boolean {
  return item.type === "block_trace" || item.type === "tool_output";
}
