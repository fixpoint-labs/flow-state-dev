/**
 * `fsdev.config.ts` loader — locates and imports an app's config module so the
 * CLI runs flows with the app's real wiring (registry, stores, model resolver)
 * instead of CLI-only defaults.
 *
 * The config file default-exports a `FlowState` (the `createFlowState()` handle);
 * both the app's server entry and the CLI consume the same object. Loading is a
 * plain native `import()` — never a bundling loader — so `@flow-state-dev/*`
 * resolves through `node_modules` and the live objects the config exports
 * (resolver functions, store instances, flow instances) keep their module
 * identity with the framework the CLI itself imports.
 *
 * Runtime floor: tsx in the monorepo, Node >= 22.18 native type stripping in a
 * consumer repo, or a `.mjs`/`.js` config as the universal escape. The loader
 * imports the file and validates the shape; it does NOT call `getRuntime()` /
 * open stores — that stays in the commands so init errors are attributed to the
 * execution phase, not config loading.
 */
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isFlowState, type FlowState } from "@flow-state-dev/server";
import { CliError } from "./resolve-block";
import { EXIT_CONFIG_ERROR } from "./exit-codes";

/** Conventional config filenames, in precedence order (TS-first). */
const CONFIG_FILENAMES = [
  "fsdev.config.ts",
  "fsdev.config.mts",
  "fsdev.config.js",
  "fsdev.config.mjs",
] as const;

/** Monotonic suffix making each import URL unique even within the same ms. */
let loadCounter = 0;

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

/** Node augments thrown errors with a string `code`; not in the lib types. */
interface NodeError extends Error {
  code?: string;
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
function locateConfig(options: LoadConfigOptions): string | undefined {
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

/** Builds the "this runtime can't load a TypeScript config" remediation error. */
function typescriptUnsupportedError(absPath: string, cwd: string, cause: unknown): CliError {
  return new CliError(
    `Failed to load TypeScript config ${displayPath(absPath, cwd)}: this runtime cannot import ` +
      `TypeScript directly.\n` +
      `Fix one of:\n` +
      `  - run on Node >= 22.18 (native TypeScript stripping), or\n` +
      `  - run the CLI under a TypeScript-capable runner (e.g. tsx), or\n` +
      `  - provide an fsdev.config.mjs / fsdev.config.js instead.\n` +
      `Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`,
    EXIT_CONFIG_ERROR,
  );
}

/**
 * Load the app's `fsdev.config.*` and return its `FlowState`, or `undefined`
 * when no config file exists (and none was named via `--config`). Throws
 * `CliError(EXIT_CONFIG_ERROR)` for every failure once a file is found or
 * explicitly named: missing `--config` target, a runtime that can't load TS, a
 * module that throws at import (including a synchronous `FlowStateConfigError`
 * from `createFlowState`), or a default export that is not a `FlowState`.
 */
export async function loadFsdevConfig(
  options: LoadConfigOptions,
): Promise<LoadedConfig | undefined> {
  const absPath = locateConfig(options);
  if (absPath === undefined) return undefined;

  // Cache-bust so repeated loads in one process (sequential test runs, a future
  // watch mode) get a fresh, undisposed FlowState rather than the module cache's
  // already-disposed handle from a prior run. A monotonic counter guarantees
  // uniqueness even for two loads within the same millisecond.
  const url = `${pathToFileURL(absPath).href}?t=${Date.now()}-${loadCounter++}`;

  let mod: { default?: unknown };
  try {
    mod = (await import(url)) as { default?: unknown };
  } catch (err) {
    const code = (err as NodeError).code;
    const isTsExt = /\.m?ts$/.test(absPath);
    if (isTsExt && code === "ERR_UNKNOWN_FILE_EXTENSION") {
      throw typescriptUnsupportedError(absPath, options.cwd, err);
    }
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
