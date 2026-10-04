/**
 * What a record's `flow:` line selects — the one rule both doors read it by.
 *
 * Workers (`hireWorkforce`) and mailboxes (`kindOf` in the mailbox binder) each
 * turn a record's frontmatter into a kind. They differ in their default kind
 * and in how they word a refusal, and those stay with each door. What they
 * share is the classification: an absent key takes the door's default, a blank
 * string or a value that is not a string is refused, and anything else names a
 * kind. Two copies of that rule would drift silently, so there is one, here.
 *
 * A leaf on purpose: it imports neither door, so neither door depends on the
 * other. Not re-exported from the package root.
 */

/**
 * Which case a record's `flow:` is in.
 *
 * - `kind` — the kind the record runs on: the door's default when the key is
 *   absent, otherwise the declared name, untrimmed.
 * - `blank` — a string that is empty or whitespace only.
 * - `not-a-string` — a present key holding anything but a string, `null` and
 *   `undefined` included; `value` is what was declared, for the door to quote.
 */
export type DeclaredFlow =
  | { kind: string }
  | { refused: "blank" }
  | { refused: "not-a-string"; value: unknown };

/**
 * Classify a record's `flow:`, falling back to `defaultKind` only when the key
 * is absent. Returns the case; never throws and never words a refusal.
 *
 * `hasOwn` rather than a bare read of `.flow`: a `flow:` key parsed from a file
 * with no value (or `~`, or `null`) arrives as an own property holding `null` —
 * present, not absent — and reading it as "omitted" would silently hand the
 * default kind to a file that named the key. Only a record with no `flow` key
 * at all gets the default.
 *
 * Blankness is judged on the trimmed value, but a kind is returned as declared:
 * `" agent "` names a kind that does not exist, and the door's lookup says so.
 */
export function readDeclaredFlow(
  declared: Record<string, unknown>,
  defaultKind: string
): DeclaredFlow {
  if (!Object.hasOwn(declared, "flow")) return { kind: defaultKind };
  const value = declared.flow;
  if (typeof value !== "string") return { refused: "not-a-string", value };
  if (value.trim().length === 0) return { refused: "blank" };
  return { kind: value };
}
