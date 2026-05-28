/**
 * Shared coercion helpers for pattern blocks that record arbitrary
 * agent output into a typed `text` field. Hoisted here so round-robin
 * and debate (and future patterns) share one implementation.
 */

/**
 * Coerce arbitrary agent output into the `text` string we store. Accepts a
 * raw string or a `{ text: string }` shape directly; anything else is run
 * through `String()` and warned about once per agent.
 *
 * @param out - The raw block output to coerce.
 * @param agentName - Agent identifier, used to dedupe warnings.
 * @param warned - Mutable set tracking which agents have already warned.
 * @param label - Log context prefix and noun, e.g. `{ tag: "round-robin", noun: "roster agent" }`.
 */
export function coerceText(
  out: unknown,
  agentName: string,
  warned: Set<string>,
  label: { tag: string; noun: string },
): string {
  if (typeof out === "string") return out;
  if (out !== null && typeof out === "object") {
    const obj = out as { text?: unknown };
    if (typeof obj.text === "string") return obj.text;
  }
  if (!warned.has(agentName)) {
    warned.add(agentName);
    // eslint-disable-next-line no-console
    console.warn(
      `[${label.tag}] ${label.noun} "${agentName}" returned a non-string/non-{text} value; coerced via String().`,
    );
  }
  return String(out);
}
