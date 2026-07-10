/**
 * Shared slash-command grammar for the framework's `/`-prefixed command surfaces.
 *
 * A line matches when its first character is `/` followed by a lowercase command
 * name (`[a-z0-9]` then up to 63 more of `[a-z0-9-]`) and an optional
 * whitespace-separated argument tail. The pattern is anchored at the start, so a
 * leading space (`" /foo"`) does not match — that is the deliberate escape hatch
 * that lets a line be treated as plain text.
 *
 * Capture groups: `[1]` = command name, `[2]` = argument tail (may be `undefined`).
 *
 * Two consumers share this one pattern so their grammars can never drift:
 *   - `@flow-state-dev/skills` tier-1 slash match (`skill-slash-match.ts`), which
 *     resolves `/skill-name args` inside a running flow.
 *   - `@flow-state-dev/cli` `fsdev chat` parser, which classifies a typed line as a
 *     built-in command vs chat text; an unclaimed `/name` falls through to the flow,
 *     where the skills tier-1 match above can still fire.
 */
export const SLASH_COMMAND_PATTERN = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$/;
