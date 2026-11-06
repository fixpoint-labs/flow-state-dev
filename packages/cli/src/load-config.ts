/**
 * `fsdev.config.ts` loader — locates and imports an app's config module so the
 * CLI runs flows with the app's real wiring (registry, stores, model resolver)
 * instead of CLI-only defaults.
 *
 * The config file default-exports a `FlowState` (the `createFlowState()` handle);
 * both the app's server entry and the CLI consume the same object. How the file
 * is imported (native `import()`, then jiti for a `.ts` config Node can't load,
 * e.g. one with extensionless relative imports) lives in `import-config-module.ts`.
 * The loader imports the file and validates the shape; it does NOT call
 * `getRuntime()` / open stores — that stays in the commands so init errors are
 * attributed to the execution phase, not config loading.
 */
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { isFlowState } from "@flow-state-dev/engine/host";
import { type FlowState } from "@flow-state-dev/engine";
import { CliError } from "./resolve-block";
import { EXIT_CONFIG_ERROR } from "./exit-codes";
import { importConfigModule } from "./import-config-module";

/** Conventional config filenames, in precedence order (TS-first). */
export const CONFIG_FILENAMES = [
  "fsdev.config.ts",
  "fsdev.config.mts",
  "fsdev.config.js",
  "fsdev.config.mjs",
] as const;

/** Inputs for {@link loadFsdevConfig}. */
export interface LoadConfigOptions {
  /** Directory to search for the config file (config search is cwd-only). */
  cwd: string;
  /**
   * Explicit path from `--config`. Bypasses the search; a missing file at this
   * path is a `CliError` rather than a fall-through to discovery.
   */
  configPath?: string;
}

/** Result of a successful config load. */
export interface LoadedConfig {
  /** The app's `FlowState`, default-exported from the config module. */
  flowState: FlowState;
  /** Absolute path of the loaded file, for diagnostics. */
  path: string;
}

/** Renders a path relative to cwd for readable diagnostics, falling back to the absolute path. */
function displayPath(absPath: string, cwd: string): string {
  const rel = relative(cwd, absPath);
  return rel === "" || rel.startsWith("..") ? absPath : rel;
}

/**
 * Locate the config file. An explicit `configPath` is resolved against cwd and
 * must exist; otherwise the conventional filenames are probed in cwd in
 * precedence order. Returns `undefined` when no config exists and none was
 * named (callers fall back to legacy discovery + defaults).
 */
export function locateConfig(options: LoadConfigOptions): string | undefined {
  const { cwd, configPath } = options;

  if (configPath !== undefined) {
    const abs = isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
    if (!existsSync(abs)) {
      throw new CliError(
        `Config file not found: ${configPath} (resolved to ${abs})`,
        EXIT_CONFIG_ERROR,
      );
    }
    return abs;
  }

  const present = CONFIG_FILENAMES.map((name) => resolve(cwd, name)).filter(existsSync);
  if (present.length === 0) return undefined;

  const [winner, ...shadowed] = present;
  for (const other of shadowed) {
    process.stderr.write(
      `Warning: multiple fsdev config files found; using ${displayPath(winner!, cwd)}, ` +
        `ignoring ${displayPath(other, cwd)}\n`,
    );
  }
  return winner;
}

/**
 * Load the app's `fsdev.config.*` and return its `FlowState`, or `undefined`
 * when no config file exists (and none was named via `--config`). Throws
 * `CliError(EXIT_CONFIG_ERROR)` for every failure once a file is found or
 * explicitly named: missing `--config` target, a module that can't be loaded
 * or throws at import (including a synchronous `FlowStateConfigError`
 * from `createFlowState`), or a default export that is not a `FlowState`.
 */
export async function loadFsdevConfig(
  options: LoadConfigOptions,
): Promise<LoadedConfig | undefined> {
  const absPath = locateConfig(options);
  if (absPath === undefined) return undefined;

  let mod: { default?: unknown };
  try {
    mod = await importConfigModule(absPath);
  } catch (err) {
    throw new CliError(
      `Failed to load fsdev config ${displayPath(absPath, options.cwd)}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      EXIT_CONFIG_ERROR,
    );
  }

  const def = mod.default;
  if (!isFlowState(def)) {
    const received =
      def === undefined
        ? "it has no default export"
        : `the default export is a ${typeof def}, not a FlowState`;
    throw new CliError(
      `fsdev config ${displayPath(absPath, options.cwd)} must default-export a FlowState — ${received}.\n` +
        `Expected: export default createFlowState({ ... })`,
      EXIT_CONFIG_ERROR,
    );
  }

  return { flowState: def, path: absPath };
}
