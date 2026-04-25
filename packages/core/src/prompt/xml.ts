/**
 * XML rendering utilities for object-form generator context.
 *
 * Object-form context (see `GeneratorSlotEntry`) lets authors and capabilities
 * declare prompt sections by tag name. At render time the runtime aggregates
 * per-key contributions into a `TagAccumulator` and passes it to
 * `renderTaggedContext` to emit a single XML block.
 *
 * String leaves are escaped (`<`, `>`, `&`) so that user data containing
 * angle brackets isn't mistaken by the model for nested tags. Nested-tag
 * emission bypasses escaping by construction — the renderer always knows
 * whether it's emitting a leaf or a nested structure.
 */

/**
 * Aggregated tag tree built by `aggregateContextEntries`. Keys are the
 * canonical (kebab-case-normalized) tag names. Values are either string-leaf
 * arrays or nested accumulators.
 *
 * Insertion order is not preserved by this map alone — the runtime tracks
 * authoring order separately in a parallel `order: string[]` array.
 */
export interface TagAccumulator {
  [key: string]: TagAccumulatorValue;
}

/**
 * A node inside an aggregated tag tree.
 *
 * - `string[]` — leaf content. Multiple values are joined by newline.
 * - `TagAccumulator` — nested tags. Recurses through `renderTaggedContext`.
 */
export type TagAccumulatorValue = string[] | TagAccumulator;

/** Options that adjust pretty-printing and escaping. */
export interface RenderTaggedContextOptions {
  /** Indentation per nesting level. Default: two spaces. Pass `""` for compact output. */
  indent?: string;
  /** Escape `<`, `>`, `&` in string leaves. Default: true. */
  escape?: boolean;
}

/**
 * Build a single XML tag with content. Empty content (after recursion)
 * suppresses the tag entirely so that placeholder slots nobody filled don't
 * leak empty `<documents></documents>` into the prompt.
 *
 * `xmlTag` does not escape its content — callers must pass already-escaped
 * strings if escaping is desired. The default rendering pipeline
 * (`renderTaggedContext`) escapes string leaves before they reach this helper.
 *
 * @example
 * xmlTag("documents", "doc body")
 * // "<documents>\n  doc body\n</documents>"
 *
 * xmlTag("documents", null) // ""
 */
export function xmlTag(
  name: string,
  content: string | string[] | null | undefined
): string {
  if (content == null) return "";
  const body = Array.isArray(content) ? content.filter((s) => s.length > 0).join("\n") : content;
  if (body.length === 0) return "";
  return `<${name}>\n${indentBlock(body, "  ")}\n</${name}>`;
}

/**
 * Render an aggregated tag tree (produced by `aggregateContextEntries`) into
 * a single XML string. Keys with no contributed content are omitted.
 *
 * @param tagged    Aggregated tag tree keyed by canonical tag name.
 * @param order     Authoring order for top-level keys. Keys not in `order`
 *                  are appended in `Object.keys(tagged)` order.
 * @param options   Pretty-printing and escaping controls.
 *
 * @example
 * renderTaggedContext(
 *   { documents: ["doc body"], memory: { recent: ["item"] } },
 *   ["documents", "memory"]
 * )
 * // "<documents>\n  doc body\n</documents>\n<memory>\n  <recent>\n    item\n  </recent>\n</memory>"
 */
export function renderTaggedContext(
  tagged: TagAccumulator,
  order: string[],
  options?: RenderTaggedContextOptions
): string {
  const indent = options?.indent ?? "  ";
  const escape = options?.escape !== false;
  return renderInner(tagged, order, indent, escape).join("\n");
}

function renderInner(
  tagged: TagAccumulator,
  order: string[],
  indent: string,
  escape: boolean
): string[] {
  const seen = new Set<string>();
  const fullOrder: string[] = [];
  for (const key of order) {
    if (key in tagged && !seen.has(key)) {
      seen.add(key);
      fullOrder.push(key);
    }
  }
  for (const key of Object.keys(tagged)) {
    if (!seen.has(key)) {
      seen.add(key);
      fullOrder.push(key);
    }
  }

  const lines: string[] = [];
  for (const key of fullOrder) {
    const rendered = renderTagValue(key, tagged[key]!, indent, escape);
    if (rendered.length > 0) {
      lines.push(rendered);
    }
  }
  return lines;
}

function renderTagValue(
  name: string,
  value: TagAccumulatorValue,
  indent: string,
  escape: boolean
): string {
  if (Array.isArray(value)) {
    const filtered = value.filter((s) => s.length > 0);
    if (filtered.length === 0) return "";
    const escaped = escape ? filtered.map(escapeXmlText) : filtered;
    const body = escaped.join("\n");
    if (indent === "") {
      return `<${name}>${body}</${name}>`;
    }
    return `<${name}>\n${indentBlock(body, indent)}\n</${name}>`;
  }

  // Nested accumulator
  const inner = renderInner(value, Object.keys(value), indent, escape);
  if (inner.length === 0) return "";
  const body = inner.join("\n");
  if (indent === "") {
    return `<${name}>${body}</${name}>`;
  }
  return `<${name}>\n${indentBlock(body, indent)}\n</${name}>`;
}

function indentBlock(text: string, indent: string): string {
  if (indent === "") return text;
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? indent + line : line))
    .join("\n");
}

/** Escape `<`, `>`, `&` in a string leaf. */
function escapeXmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
