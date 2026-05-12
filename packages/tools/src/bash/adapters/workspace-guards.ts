/**
 * Workspace path guards for the LocalFs sandbox adapter.
 *
 * Provides best-effort pre-execution validation that commands and file paths
 * stay within the configured workspace root. This is a defense-in-depth layer
 * for cooperative LLM agents — not a security boundary. True isolation requires
 * OS-level mechanisms (chroot, namespaces, seccomp) planned for v2.
 *
 * The command guard performs two passes:
 *  1. Raw-string regex checks for shell constructs whose mere presence is the
 *     violation (`~/`, `$HOME`, `$(...)`, backticks, `<(...)`, `>(...)`, `../`).
 *  2. Tokenization via `shell-quote` and per-token absolute-path validation,
 *     so quoted strings and heredoc bodies are treated as opaque data rather
 *     than scanned for slashes. If tokenization is unusable on a given input,
 *     the guard falls back to a conservative raw-string absolute-path scan.
 *
 * Two guards are exported:
 * - `assertCommandWithinWorkspace` — inspects a raw bash command string
 * - `resolveWithinWorkspace` — resolves and validates a file path
 */

import path from "node:path";
import { parse as shellParse } from "shell-quote";

// ---------------------------------------------------------------------------
// Safe system paths allowlist
// ---------------------------------------------------------------------------

/**
 * System paths that are safe to reference in commands. These don't expose
 * meaningful filesystem content and are commonly used in bash idioms
 * (e.g. `2>/dev/null`).
 */
const SAFE_SYSTEM_PATHS = [
  "/dev/null",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/zero",
  "/dev/urandom",
  "/dev/random",
  "/dev/fd",
];

function isSafeSystemPath(absPath: string): boolean {
  return SAFE_SYSTEM_PATHS.some(
    (safe) => absPath === safe || absPath.startsWith(safe + "/"),
  );
}

// ---------------------------------------------------------------------------
// Heredoc preprocessing
// ---------------------------------------------------------------------------

/**
 * Strip heredoc bodies from a command string before tokenization.
 *
 * `shell-quote` does not treat heredoc bodies as opaque — it splits them into
 * tokens, which would re-introduce the false-positive class we are fixing
 * (e.g. a body line `x = 1 / 2` would surface a `/` candidate). Bodies are
 * data, so we remove them outright before parsing.
 *
 * Handles `<<DELIM`, `<<-DELIM`, and quoted-delimiter forms (`<<'DELIM'`,
 * `<<"DELIM"`). The terminator line may have leading tabs only for the
 * `<<-` form.
 *
 * Heredoc-redirect operators (`<<`, `<<-`) themselves are preserved in the
 * stripped command, so a downstream parse still sees the redirection shape.
 */
function stripHeredocBodies(command: string): string {
  const startPattern = /<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/;
  let result = command;
  let match: RegExpExecArray | null;
  let searchFrom = 0;
  while ((match = startPattern.exec(result.slice(searchFrom))) !== null) {
    const absoluteStart = searchFrom + match.index;
    const absoluteAfterStart = absoluteStart + match[0].length;
    const dash = match[1];
    const delim = match[3];
    const tabPrefix = dash === "-" ? "\\t*" : "";
    const terminator = new RegExp(`\\n${tabPrefix}${delim}(?=\\n|$)`);
    const remaining = result.slice(absoluteAfterStart);
    const termMatch = terminator.exec(remaining);
    if (!termMatch) {
      // Malformed or unclosed heredoc — stop processing and let the fallback
      // raw-string scan inspect what we have.
      break;
    }
    const termEndInRemaining = termMatch.index + termMatch[0].length;
    result =
      result.slice(0, absoluteAfterStart) +
      result.slice(absoluteAfterStart + termEndInRemaining);
    searchFrom = absoluteAfterStart;
  }
  return result;
}

/**
 * Replace the bodies of quoted strings (both single- and double-quoted) with
 * a fixed placeholder before tokenization.
 *
 * Quoted-string contents are data, not paths. Without this step, `shell-quote`
 * would return the content as a string token that could trigger absolute-path
 * validation when the quoted text happens to start with `/` (regex literals,
 * URL strings, echo of an absolute-path literal). The placeholder is
 * deliberately path-shape-free.
 *
 * This trades one edge: a user-supplied quoted absolute path argument
 * (`cat "/etc/passwd"`) is treated the same as an arbitrary string literal.
 * That trade-off is documented in the package README. The unquoted form
 * (`cat /etc/passwd`) is still rejected.
 */
function stripQuotedStringBodies(command: string): string {
  return command
    .replace(/'[^']*'/g, "'__FSDEV_QUOTED__'")
    .replace(/"(?:\\.|[^"\\])*"/g, '"__FSDEV_QUOTED__"');
}

// ---------------------------------------------------------------------------
// Per-token absolute-path validation
// ---------------------------------------------------------------------------

/**
 * Validate one path-shaped token against the workspace root, the optional
 * virtual destination, and the safe-system allowlist. Throws with a message
 * that names the offending token if validation fails.
 */
function validateAbsolutePathToken(
  token: string,
  normalizedRoot: string,
  destination: string | undefined,
): void {
  if (isSafeSystemPath(token)) return;
  const resolved = path.resolve(token);
  if (
    resolved === normalizedRoot ||
    resolved.startsWith(normalizedRoot + path.sep)
  ) {
    return;
  }
  if (destination) {
    const normalizedDest = path.resolve(destination);
    if (
      resolved === normalizedDest ||
      resolved.startsWith(normalizedDest + path.sep)
    ) {
      return;
    }
  }
  throw new Error(
    `Command rejected: token "${token}" resolves to a path outside the workspace root` +
      ` (${normalizedRoot}). Use relative paths or paths within the workspace.`,
  );
}

/**
 * Fallback raw-string absolute-path scan. Used when `shell-quote` cannot
 * produce useful tokens for the input. Mirrors the pre-fix behavior so
 * dangerous commands are still caught when we cannot understand the syntax.
 */
function fallbackAbsolutePathScan(
  command: string,
  normalizedRoot: string,
  destination: string | undefined,
): void {
  const absolutePathPattern = /(?:^|[\s;|&<>=])(\/{1,2}[^\s;|&<>()'"`]*)/g;
  let match: RegExpExecArray | null;
  while ((match = absolutePathPattern.exec(command)) !== null) {
    const absPath = match[1];
    if (isSafeSystemPath(absPath)) continue;
    const resolved = path.resolve(absPath);
    if (
      resolved === normalizedRoot ||
      resolved.startsWith(normalizedRoot + path.sep)
    ) {
      continue;
    }
    if (destination) {
      const normalizedDest = path.resolve(destination);
      if (
        resolved === normalizedDest ||
        resolved.startsWith(normalizedDest + path.sep)
      ) {
        continue;
      }
    }
    throw new Error(
      `Command rejected: references path "${absPath}" outside the workspace root` +
        ` (${normalizedRoot}). Use relative paths or paths within the workspace.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Command guard
// ---------------------------------------------------------------------------

/**
 * Inspect a bash command string and throw if it references paths outside the
 * workspace root.
 *
 * Checks (in order):
 * 1. Home directory references (`~/`)
 * 2. `$HOME` / `${HOME}` environment variable
 * 3. Command substitution (`$(...)` and backticks)
 * 4. Process substitution (`<(...)`, `>(...)`)
 * 5. Path traversals (`../`)
 * 6. Absolute paths not rooted in the workspace or virtual destination,
 *    detected by tokenizing the command (after stripping heredoc bodies) and
 *    inspecting only path-shaped tokens. Quoted-string contents and heredoc
 *    bodies are treated as opaque data and are not scanned.
 *
 * @param workspaceRoot - Real filesystem path to the workspace (e.g. `/tmp/workspaces/session-1/`)
 * @param command - Raw bash command string to validate
 * @param destination - Optional virtual workspace prefix (e.g. `/workspace`)
 */
export function assertCommandWithinWorkspace(
  workspaceRoot: string,
  command: string,
  destination?: string,
): void {
  const normalizedRoot = path.resolve(workspaceRoot);

  // 1. Home directory references
  if (/(?:^|[\s;|&])~(?:\/|$)/.test(command)) {
    throw new Error(
      `Command rejected: contains home directory reference (~/).` +
        ` All paths must be relative to the workspace root (${normalizedRoot}).`,
    );
  }

  // 2. $HOME environment variable
  if (/\$HOME\b/.test(command) || /\$\{HOME\}/.test(command)) {
    throw new Error(
      `Command rejected: contains $HOME reference.` +
        ` All paths must be relative to the workspace root (${normalizedRoot}).`,
    );
  }

  // 3. Command substitution — can execute arbitrary commands
  if (/\$\(/.test(command)) {
    throw new Error(
      `Command rejected: contains command substitution $().` +
        ` Use simple commands with relative paths.`,
    );
  }
  if (/`/.test(command)) {
    throw new Error(
      `Command rejected: contains backtick command substitution.` +
        ` Use simple commands with relative paths.`,
    );
  }

  // 4. Process substitution
  if (/<\(/.test(command) || />\(/.test(command)) {
    throw new Error(
      `Command rejected: contains process substitution.` +
        ` Use simple commands with relative paths.`,
    );
  }

  // 5. Path traversals
  if (/\.\.\//.test(command) || /(?:^|[\s;|&])\.\.(?:\s|;|$)/.test(command)) {
    throw new Error(
      `Command rejected: contains path traversal (../).` +
        ` All paths must stay within the workspace root (${normalizedRoot}).`,
    );
  }

  // 6. Absolute paths outside workspace — tokenize and validate.
  //    Heredoc bodies are stripped first because shell-quote does not treat
  //    them as opaque. An env function returns placeholders for `$VAR`
  //    expansions so an empty expansion never produces a stray `/` token.
  const trimmed = command.trim();
  if (trimmed === "") return;

  const stripped = stripQuotedStringBodies(stripHeredocBodies(command));

  let tokens: ReturnType<typeof shellParse> | null = null;
  try {
    tokens = shellParse(stripped, (key) => `__FSDEV_VAR_${key}__`);
  } catch {
    tokens = null;
  }

  if (!tokens || (tokens.length === 0 && stripped.trim() !== "")) {
    fallbackAbsolutePathScan(command, normalizedRoot, destination);
    return;
  }

  for (const token of tokens) {
    if (typeof token === "string") {
      if (token.startsWith("/")) {
        validateAbsolutePathToken(token, normalizedRoot, destination);
      }
      continue;
    }
    // Object tokens. The `op` operators (`|`, `&&`, `;`, `>`, `<`, `<<`, etc.)
    // are control flow we already screen for at the raw-string level when
    // they matter (checks 3 and 4). Globs carry an absolute-or-relative
    // pattern we treat like a string token.
    if (token && typeof token === "object" && "pattern" in token) {
      const pattern = (token as { pattern: string }).pattern;
      if (typeof pattern === "string" && pattern.startsWith("/")) {
        validateAbsolutePathToken(pattern, normalizedRoot, destination);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// File path guard
// ---------------------------------------------------------------------------

/**
 * Resolve a file path within the workspace boundary and return the absolute
 * result. Throws if the resolved path falls outside the workspace root.
 *
 * @param workspaceRoot - Real filesystem path to the workspace
 * @param requestedPath - Path to resolve (relative or absolute)
 * @returns Resolved absolute path guaranteed to be within the workspace
 */
export function resolveWithinWorkspace(
  workspaceRoot: string,
  requestedPath: string,
): string {
  const normalizedRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(normalizedRoot, requestedPath);

  if (
    resolved !== normalizedRoot &&
    !resolved.startsWith(normalizedRoot + path.sep)
  ) {
    throw new Error(
      `Path "${requestedPath}" resolves outside the workspace root (${normalizedRoot}).`,
    );
  }

  return resolved;
}
