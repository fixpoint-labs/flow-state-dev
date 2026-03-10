/**
 * Loads .env.local files into process.env.
 *
 * Search order (all loaded, later files do NOT override earlier ones):
 * 1. .env.local in cwd
 * 2. .env.local walking up parent directories until the filesystem root
 *
 * Existing environment variables are never overwritten.
 */
import { resolve, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";

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
        const content = readFileSync(envPath, "utf-8");
        const vars = parseEnvFile(content);
        for (const [key, value] of vars) {
          if (process.env[key] === undefined) {
            process.env[key] = value;
          }
        }
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
