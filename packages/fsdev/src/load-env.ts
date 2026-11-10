/**
 * Loads .env.local files into process.env.
 *
 * Two entry points:
 * - {@link loadEnvFiles} auto-discovers `.env.local` in cwd and every ancestor.
 * - {@link loadExplicitEnvFiles} loads paths named via `--env-file`, so a
 *   repo-root invocation can still pick up an app's `.env.local` that lives in a
 *   subdirectory the walk-up never reaches.
 *
 * Callers run the explicit files first, so the effective precedence is:
 * 1. Real shell environment (already in process.env — always wins)
 * 2. Explicit `--dotenv` paths, in the order given
 * 3. .env.local in cwd, then walking up to the filesystem root
 *
 * The first source to set a key wins; existing values are never overwritten.
 */
import { resolve, dirname, isAbsolute } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { CliError } from "./resolve-block";
import { EXIT_CONFIG_ERROR } from "./exit-codes";

const ENV_FILE = ".env.local";

/**
 * Parse a .env file into key-value pairs.
 * Supports:
 * - KEY=VALUE
 * - KEY="quoted value"
 * - KEY='single quoted'
 * - # comments
 * - Empty lines
 */
function parseEnvFile(content: string): Map<string, string> {
  const vars = new Map<string, string>();

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key.length > 0) {
      vars.set(key, value);
    }
  }

  return vars;
}

/**
 * Reads, parses, and applies a single env file into process.env. Existing
 * values win (first-set wins). Throws if the file cannot be read; callers decide
 * whether to surface or swallow that.
 */
function applyEnvFile(envPath: string): void {
  const vars = parseEnvFile(readFileSync(envPath, "utf-8"));
  for (const [key, value] of vars) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Loads .env.local files starting from `cwd` and walking up to the filesystem root.
 * Does not overwrite existing environment variables.
 * Returns the list of files that were loaded (for logging).
 */
export function loadEnvFiles(cwd: string): string[] {
  const loaded: string[] = [];
  const seen = new Set<string>();

  let dir = resolve(cwd);
  while (true) {
    const envPath = resolve(dir, ENV_FILE);
    if (!seen.has(envPath) && existsSync(envPath)) {
      seen.add(envPath);
      try {
        applyEnvFile(envPath);
        loaded.push(envPath);
      } catch {
        // Silently skip unreadable files
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }

  return loaded;
}

/**
 * Loads explicit env files named via `--dotenv` into process.env.
 *
 * Paths are resolved relative to `cwd` (or used as-is when absolute), so a file
 * outside the cwd ancestry can be loaded — this is what lets a repo-root
 * invocation pick up `apps/<app>/.env.local`. Files are applied in the order
 * given; existing process.env values are never overwritten.
 *
 * The flag is `--dotenv`, not `--env-file`, on purpose: Node 20.6+ and tsx treat
 * `--env-file` as a built-in flag and consume it before the CLI parses argv, so
 * it would never reach commander under the `pnpm fsdev` (tsx) dev path.
 *
 * A path that does not exist throws `CliError(EXIT_CONFIG_ERROR)`: naming a file
 * explicitly is a claim it exists, so a typo should fail loudly rather than be
 * silently skipped the way the {@link loadEnvFiles} walk-up is.
 *
 * Returns the list of resolved absolute paths that were loaded (for logging).
 */
export function loadExplicitEnvFiles(cwd: string, files: string[]): string[] {
  const loaded: string[] = [];
  for (const file of files) {
    const envPath = isAbsolute(file) ? file : resolve(cwd, file);
    if (!existsSync(envPath)) {
      throw new CliError(`--dotenv file not found: ${envPath}`, EXIT_CONFIG_ERROR);
    }
    applyEnvFile(envPath);
    loaded.push(envPath);
  }
  return loaded;
}
