/**
 * Pure line parser for the `fsdev chat` loop: a typed line → a `ParsedInput`
 * classification. No I/O. Command detection uses the framework-shared
 * `SLASH_COMMAND_PATTERN` (from `@flow-state-dev/core`), the same grammar the
 * skills tier-1 slash match resolves against — so an unclaimed `/name` that
 * falls through to the flow is still recognized there.
 */
import { SLASH_COMMAND_PATTERN } from "@flow-state-dev/core";

/** The classification of a single typed line. */
export type ParsedInput =
  | { kind: "empty" }
  | { kind: "chat"; text: string }
  | { kind: "command"; name: string; args: string; raw: string };

/**
 * Classify a typed line.
 *
 * - Whitespace-only → `empty` (the loop re-prompts, no turn).
 * - First character `/` → `command`: a valid `/<name> [args]` yields that name
 *   and the trimmed argument tail; a lone `/` (or any `/…` the grammar rejects)
 *   yields `name: ""`, which dispatch maps to a help hint.
 * - Anything else → `chat`. A leading space is the escape hatch: `" /etc/hosts"`
 *   has first character space, so it is `chat`, and the space is preserved in
 *   `text` so the flow's own slash matcher (anchored the same way) won't fire on
 *   it either.
 */
export function parseInput(line: string): ParsedInput {
  if (line.trim() === "") return { kind: "empty" };

  if (line[0] === "/") {
    const match = line.match(SLASH_COMMAND_PATTERN);
    if (match) {
      return { kind: "command", name: match[1]!, args: (match[2] ?? "").trim(), raw: line };
    }
    // Starts with "/" but the grammar rejects it (lone "/", uppercase, symbols):
    // a command with an empty name — dispatch turns it into a help hint.
    return { kind: "command", name: "", args: "", raw: line };
  }

  return { kind: "chat", text: line };
}
