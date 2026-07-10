/**
 * Shared runtime-resolution prelude for `fsdev run`, `fsdev dev`, and `fsdev chat`.
 *
 * Absorbs only the copy-paste-identical front of those commands: load `.env`
 * files, import an `fsdev.config.*` (or fall back to directory discovery), guard
 * the `--flow-dir` + config combination, and surface flow import failures. What
 * genuinely diverges per command — store backend, `--model` handling, the
 * `getRuntime()` error attribution, and dispose ownership — stays in the command
 * (BP-024: extract a helper only for the parts whose body doesn't vary).
 *
 * Also hoists the CLI stderr logger (`createCliLogger` + `resolveLogLevel`) that
 * `run` and `chat` share to keep stdout (NDJSON / chat transcript) uncorrupted by
 * engine logging.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { FlowState, RuntimeLogger, RuntimeLoggerLevel } from "@flow-state-dev/engine";
import {
  discoverFlows,
  getSearchedDirs,
  formatImportFailureWarning,
  type DiscoverFlowsOptions,
  type FlowImportFailure,
} from "./resolve-flow";
import { loadFsdevConfig } from "./load-config";
import { CliError } from "./resolve-block";
import { EXIT_INVALID_ARGS } from "./exit-codes";
import { loadEnvFiles, loadExplicitEnvFiles } from "./load-env";

/** Inputs shared by every command's runtime-resolution prelude. */
export interface ResolveRuntimeParams {
  /** Working directory (defaults to `process.cwd()`). */
  cwd?: string;
  /**
   * fsdev config selection. A string is an explicit `--config <path>`; `false`
   * is `--no-config`; `true`/absent means search for `fsdev.config.*` in cwd.
   */
  config?: string | boolean;
  /** `--flow-dir` overrides. Rejected with a loaded config. */
  flowDir?: string[];
  /** Explicit `--dotenv <path>` entries, loaded before the cwd `.env.local` walk-up. */
  dotenv?: string[];
  /**
   * Runs after `.env` files load but before the `fsdev.config.*` import — the
   * seam a command uses to set pre-config env defaults (e.g. `dev`'s
   * `FSDEV_DEBUG_ENDPOINTS` / `FSDEV_TRACING_LEVEL`). Kept as a callback rather
   * than absorbed so a `.env` override still wins (load-env is first-set-wins),
   * exactly as before this prelude was extracted.
   */
  beforeConfigLoad?: () => void;
}

/** Config path: an `fsdev.config.*` was found and loaded. */
export interface ConfigRuntimeSource {
  source: "config";
  /** Resolved working directory. */
  cwd: string;
  /** The app's `FlowState`. The command owns `getRuntime()` and `dispose()`. */
  flowState: FlowState;
  /** Absolute path of the loaded config, for diagnostics. */
  configPath: string;
}

/** Discovery path: no config; flows scanned from conventional directories. */
export interface DiscoveryRuntimeSource {
  source: "discovery";
  /** Resolved working directory. */
  cwd: string;
  /** Discovered flow instances (may be empty). */
  flows: FlowInstance[];
  /** Directories searched, for a "not found" diagnostic. */
  searchedDirs: string[];
  /** Modules that failed to import (already warned to stderr). */
  importFailures: FlowImportFailure[];
}

export type ResolvedRuntimeSource = ConfigRuntimeSource | DiscoveryRuntimeSource;

/**
 * Load env, resolve the runtime source (app config vs directory discovery), and
 * surface import failures — the identical prelude of `run`/`dev`/`chat`. Throws
 * `CliError(EXIT_INVALID_ARGS)` when `--flow-dir` is combined with a config;
 * `loadFsdevConfig` throws `CliError(EXIT_CONFIG_ERROR)` for a bad config. Does
 * NOT call `getRuntime()` or open discovery stores — those stay per-command so
 * init errors are attributed to the execution phase, not resolution.
 */
export async function resolveRuntimeSource(
  params: ResolveRuntimeParams,
): Promise<ResolvedRuntimeSource> {
  const cwd = params.cwd ?? process.cwd();

  // Load .env files. Explicit --dotenv entries first (they outrank the walk-up
  // and let a repo-root invocation reach an app's .env.local), then the cwd
  // .env.local walk-up. Must run before importing an fsdev.config.* so the
  // config's providers see the app's env (gateway keys).
  if (params.dotenv !== undefined) loadExplicitEnvFiles(cwd, params.dotenv);
  loadEnvFiles(cwd);

  // Command-specific pre-config env defaults (e.g. dev's debug/tracing flags),
  // applied after env files load and before the config imports.
  params.beforeConfigLoad?.();

  const useConfig = params.config !== false;
  const configPath = typeof params.config === "string" ? params.config : undefined;
  const loaded = useConfig ? await loadFsdevConfig({ cwd, configPath }) : undefined;

  if (loaded !== undefined) {
    if (params.flowDir !== undefined) {
      throw new CliError(
        "--flow-dir bypasses fsdev.config.*; pass --no-config to use directory discovery.",
        EXIT_INVALID_ARGS,
      );
    }
    return { source: "config", cwd, flowState: loaded.flowState, configPath: loaded.path };
  }

  // Discovery path: scan conventional directories. Import failures are warned to
  // stderr unconditionally — diagnostics about broken modules, the same category
  // as CliError output, and stderr keeps stdout pure.
  const importFailures: FlowImportFailure[] = [];
  const discoverOptions: DiscoverFlowsOptions = {
    cwd: params.cwd,
    ...(params.flowDir !== undefined ? { flowDirs: params.flowDir } : {}),
    onImportFailed: (failure) => importFailures.push(failure),
  };
  const flows = await discoverFlows(discoverOptions);
  for (const failure of importFailures) {
    process.stderr.write(formatImportFailureWarning(failure));
  }

  return {
    source: "discovery",
    cwd,
    flows: flows as FlowInstance[],
    searchedDirs: getSearchedDirs(discoverOptions),
    importFailures,
  };
}

/** Runtime log levels, in ascending severity. */
export const LOG_LEVELS: readonly RuntimeLoggerLevel[] = ["debug", "info", "warn", "error"] as const;

/**
 * Truncates context values for stderr logging. Strings over the byte budget are
 * trimmed in place; objects/arrays are kept intact when they serialize within
 * the budget (so the outer `JSON.stringify` produces real nested JSON), and
 * replaced with a truncated string preview only when they exceed it.
 */
function summarizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    if (typeof value === "string") {
      out[key] = value.length > 240 ? `${value.slice(0, 239)}…` : value;
      continue;
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        out[key] = String(value);
      } else if (serialized.length > 240) {
        out[key] = `${serialized.slice(0, 239)}…`;
      } else {
        out[key] = value;
      }
    } catch {
      out[key] = String(value);
    }
  }
  return out;
}

/** No-op logger used by `--quiet` to suppress server-side default console logging. */
const SILENT_LOGGER: RuntimeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

/**
 * Builds a CLI runtime logger that writes one line per event to stderr,
 * filtered to events at or above `level`. Returns a no-op logger for "silent".
 *
 * Always returns an explicit logger (never `undefined`) so that `runAction`
 * does not fall back to `DEFAULT_RUNTIME_LOGGER`, whose `console.debug`/
 * `console.info` calls write to stdout and would corrupt the stdout stream
 * (NDJSON for `run`, the transcript for `chat`).
 */
export function createCliLogger(level: RuntimeLoggerLevel | "silent"): RuntimeLogger {
  if (level === "silent") return SILENT_LOGGER;
  const minIdx = LOG_LEVELS.indexOf(level);
  const emit = (lvl: RuntimeLoggerLevel) => (message: string, context: Record<string, unknown>) => {
    if (LOG_LEVELS.indexOf(lvl) < minIdx) return;
    const summary = summarizeContext(context);
    process.stderr.write(`${message} ${JSON.stringify(summary)}\n`);
  };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error")
  };
}

/**
 * Resolves the effective stderr log level from `--quiet` / `--log-level`.
 * `--quiet` wins ("silent"); an explicit `--log-level` is validated; the default
 * is provided by the caller (`run` defaults to "info", `chat` to "warn" so the
 * transcript isn't drowned by info-level engine logs).
 */
export function resolveLogLevel(
  options: { quiet?: boolean; logLevel?: RuntimeLoggerLevel },
  defaultLevel: RuntimeLoggerLevel,
): RuntimeLoggerLevel | "silent" {
  if (options.quiet === true) return "silent";
  const requested = options.logLevel;
  if (requested !== undefined) {
    if (!LOG_LEVELS.includes(requested)) {
      throw new CliError(
        `Invalid --log-level "${requested}". Expected one of: ${LOG_LEVELS.join(", ")}`,
        EXIT_INVALID_ARGS,
      );
    }
    return requested;
  }
  return defaultLevel;
}
