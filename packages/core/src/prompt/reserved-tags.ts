/**
 * Reserved-tag list and validator for object-form generator context.
 *
 * Two categories of names are reserved:
 *
 * 1. Framework-emitted tags. The only existing one is `active-skill`
 *    (emitted by `@flow-state-dev/orchestration`). Authors using this key would
 *    silently collide with framework-injected content.
 * 2. Model-conditioned tags. Anthropic's training and tool-use protocol
 *    treat names like `thinking`, `tool_use`, `function_calls`, and the
 *    role names (`system`, `user`, `assistant`) as load-bearing. Authors
 *    using these as plain context tags get unpredictable model behavior.
 *
 * The list is checked against the **canonical (kebab-case) form** of an
 * authored key, so `tool_use` and `tool-use` both match.
 */

/** Names that may not be used as user-authored context tag keys. */
export const RESERVED_TAG_NAMES: ReadonlySet<string> = new Set([
  // Framework-emitted
  "active-skill",
  // Model-conditioned (Anthropic training / tool-use protocol)
  "thinking",
  "answer",
  "tool-use",
  "tool-result",
  "function-calls",
  "invoke",
  "parameter",
  "system",
  "user",
  "assistant",
  "role",
  "message",
]);

/** Permitted tag-name shape after normalization. */
const VALID_TAG_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Validate a normalized (kebab-case) tag name. Throws with a descriptive
 * message if the name is malformed or reserved.
 *
 * @param normalizedName  The post-normalization tag name to check.
 * @param source          Optional human-readable source (e.g. "user config",
 *                        capability name) for the error message.
 *
 * @example
 * validateTagName("documents") // ok
 * validateTagName("tool-use")  // throws: "tool-use" is reserved
 * validateTagName("1st")       // throws: invalid tag name
 */
export function validateTagName(
  normalizedName: string,
  source?: string
): void {
  const sourcePrefix = source ? ` (source: ${source})` : "";
  if (!VALID_TAG_NAME.test(normalizedName)) {
    throw new Error(
      `Invalid context tag name "${normalizedName}"${sourcePrefix}: ` +
      `must match /^[a-z][a-z0-9-]*$/ after normalization (lowercase letter ` +
      `or dash, no whitespace, no leading digit).`
    );
  }
  if (RESERVED_TAG_NAMES.has(normalizedName)) {
    throw new Error(
      `Reserved context tag name "${normalizedName}"${sourcePrefix}: this ` +
      `name collides with a framework-emitted tag or a model-conditioned ` +
      `name (Anthropic training / tool-use protocol). Choose a different key.`
    );
  }
}
