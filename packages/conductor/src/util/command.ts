/**
 * Rendering an argv for a human — the one place conductor turns a command it
 * runs into a command a person can read, paste, and get the same program from.
 *
 * Conductor spawns with `shell: false`, so an argv element is one argument no
 * matter what it contains. A rendering has no such luxury: the moment the string
 * reaches a shell — an operator pasting a failure reason, an agent obeying a
 * brief — every space, quote and metacharacter in it is parsed. Joining on
 * spaces therefore renders a *different command*, silently and plausibly:
 * `["bash", "-lc", "pnpm tsx run.mts"]` reads back as `bash -lc pnpm`, which
 * runs `pnpm`.
 *
 * **Display only.** Nothing here is on the path to `spawn`, and putting it there
 * would be the mistake this file exists to keep unnecessary — quoting is what
 * you need when a shell is involved, and conductor's answer to a shell is not to
 * have one.
 */

/**
 * Argv elements a shell takes verbatim.
 *
 * The conservative POSIX set — alphanumerics and the punctuation that carries no
 * meaning to any shell. Everything outside it is quoted rather than escaped
 * character by character, because a list of characters to escape is a list that
 * can be missing one.
 */
const NEEDS_NO_QUOTING = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * One argv element, as a shell would have to be given it.
 *
 * Single quotes, so nothing inside is expanded — a `$HOME` or a backtick in an
 * argument stays the characters it was. A single quote cannot appear inside
 * single quotes at all, so it is closed, escaped, and reopened: `'\''`. The
 * empty string quotes to `''`, which is the only way to spell an empty argument.
 */
function quote(element: string): string {
  if (NEEDS_NO_QUOTING.test(element)) return element;
  return `'${element.replaceAll("'", "'\\''")}'`;
}

/**
 * Render an argv as the command line a shell parses back into that same argv.
 *
 * @param argv The command, exactly as it would be spawned.
 * @returns One line, safe to read and to paste.
 */
export function renderCommand(argv: readonly string[]): string {
  return argv.map(quote).join(" ");
}
