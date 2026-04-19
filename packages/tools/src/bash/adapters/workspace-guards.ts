/**
 * Workspace path guards for the LocalFs sandbox adapter.
 *
 * Provides best-effort pre-execution validation that commands and file paths
 * stay within the configured workspace root. This is a defense-in-depth layer
 * for cooperative LLM agents — not a security boundary. True isolation requires
 * OS-level mechanisms (chroot, namespaces, seccomp) planned for v2.
 *
 * Two guards are exported:
 * - `assertCommandWithinWorkspace` — inspects a raw bash command string
 * - `resolveWithinWorkspace` — resolves and validates a file path
 */

import path from "node:path";

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
 * 6. Absolute paths not rooted in the workspace or virtual destination
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

  // 6. Absolute paths outside workspace
  //    Extract tokens that look like absolute paths, then verify each one
  //    is within the workspace root, the virtual destination, or the safe list.
  const absolutePathPattern = /(?:^|[\s;|&<>=])(\/{1,2}[^\s;|&<>()'"`]*)/g;
  let match;
  while ((match = absolutePathPattern.exec(command)) !== null) {
    const absPath = match[1];

    // Skip safe system paths (/dev/null, etc.)
    if (isSafeSystemPath(absPath)) continue;

    const resolved = path.resolve(absPath);

    // Allow paths within the real workspace root
    if (
      resolved === normalizedRoot ||
      resolved.startsWith(normalizedRoot + path.sep)
    ) {
      continue;
    }

    // Allow paths within the virtual destination prefix
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
