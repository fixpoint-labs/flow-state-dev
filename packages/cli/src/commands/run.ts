/**
 * `fsdev run <flowKind> <action>` command — executes a flow action with streaming NDJSON output.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import type { Command } from "commander";
import type { OutputItem } from "@flow-state-dev/core/items";
import {
  runAction,
  createInMemoryStores,
  createFilesystemStores,
  createModelResolver,
  createResponseEmitter,
  type ExecutionResult,
  type RequestStreamEventWithId,
  type RuntimeConfig,
  type RuntimeLogger,
  type RuntimeLoggerLevel,
  type StoreRegistry
} from "@flow-state-dev/engine";
import type { FlowInstance, ModelResolver, JsonObject } from "@flow-state-dev/core/types";
import {
  discoverFlows,
  getSearchedDirs,
  formatImportFailureWarning,
  formatFailedImportSection,
  type DiscoverFlowsOptions,
  type FlowImportFailure,
} from "../resolve-flow";
import { loadFsdevConfig } from "../load-config";
import { forceModelResolver } from "../model-override";
import { parseInputArg } from "../parse-input";
import { CliError } from "../resolve-block";
import { EXIT_SUCCESS, EXIT_EXECUTION_ERROR, EXIT_INVALID_ARGS, EXIT_CONFIG_ERROR, EXIT_DISCOVERY_ERROR, EXIT_INTERNAL_ERROR } from "../exit-codes";
import { loadEnvFiles, loadExplicitEnvFiles } from "../load-env";

/** NDJSON event types emitted to stdout during flow execution. */
export type FlowEvent =
  | { type: "item_added"; item: OutputItem }
  | { type: "item_updated"; itemId: string; patch: Record<string, unknown> }
  | { type: "item_done"; item: OutputItem }
  | { type: "content_delta"; itemId: string; delta: string }
  | { type: "state_change"; scope: string; resourcePath: string; changeType: string }
  | { type: "flow_complete"; output: unknown; durationMs: number; items: number }
  | { type: "error"; message: string; code?: string };

/** Structured final result for `fsdev run`. */
export interface FlowRunResult {
  success: boolean;
  flow: { kind: string; action: string };
  output: unknown;
  execution: { durationMs: number; itemCount: number };
  error?: { message: string; stack?: string };
}

/** Writes a single NDJSON line to stdout. */
function emitNdjson(event: FlowEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

/**
 * Parses a seed value: inline JSON (starts with `{` or `[`) or file path.
 */
function parseSeedArg(value: string, label: string): Record<string, unknown> {
  const trimmed = value.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new CliError(`Invalid JSON in --seed-${label}`, EXIT_INVALID_ARGS);
    }
  }

  // Treat as file path
  const filePath = isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new CliError(`Cannot read seed file for --seed-${label}: ${filePath}`, EXIT_INVALID_ARGS);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new CliError(`Invalid JSON in seed file for --seed-${label}: ${filePath}`, EXIT_INVALID_ARGS);
  }
}

/** Commander accumulator for repeatable options. */
function collectValues(value: string, previous: string[] | undefined): string[] {
  return (previous ?? []).concat(value);
}

/** Registers the `run` subcommand on the given commander program. */
export function registerRunCommand(program: Command): void {
  program
    .command("run <flowKind> <action>")
    .description("Execute a flow action with streaming NDJSON output")
    .option("-i, --input <json>", "Inline JSON input")
    .option("-f, --input-file <path>", "Path to JSON input file")
    .option("-m, --model <model>", "Override model for all generator blocks")
    .option("-s, --session <id>", "Session ID for reuse across invocations")
    .option("--seed-session <json>", "Seed session-level state (JSON or file path)")
    .option("--seed-user <json>", "Seed user-level state (JSON or file path)")
    .option("--seed-org <json>", "Seed org-level state (JSON or file path)")
    .option("--flow-dir <path>", "Override flow discovery root (repeatable)", collectValues, undefined)
    .option("--dotenv <path>", "Load a specific .env file, e.g. an app's (repeatable, resolved from cwd)", collectValues, undefined)
    .option("--config <path>", "Path to an fsdev config file (default: fsdev.config.{ts,mts,js,mjs} in cwd)")
    .option("--no-config", "Ignore fsdev.config.* and use directory discovery")
    .option("--format <format>", "Output format", "json")
    .option("--quiet", "Suppress runtime logs on stderr (NDJSON on stdout still emitted)")
    .option("--log-level <level>", "Stderr log level: debug | info | warn | error (default: info)")
    .option("--capture <path>", "Write the full structured run output to a JSON file")
    .action(async (flowKind: string, action: string, options: RunCommandOptions) => {
      try {
        await executeRunCommand(flowKind, action, options);
      } catch (err) {
        if (err instanceof CliError) {
          process.stderr.write(err.message + "\n");
          process.exitCode = err.exitCode;
          return;
        }
        process.stderr.write(
          `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exitCode = EXIT_INTERNAL_ERROR;
      }
    });
}

export interface RunCommandOptions {
  input?: string;
  inputFile?: string;
  model?: string;
  session?: string;
  seedSession?: string;
  seedUser?: string;
  seedOrg?: string;
  flowDir?: string[];
  /** Explicit `--dotenv <path>` entries to load before the cwd `.env.local` walk-up. */
  dotenv?: string[];
  /**
   * fsdev config selection. A string is an explicit `--config <path>`; `false`
   * is `--no-config`; `true`/absent means search for `fsdev.config.*` in cwd.
   */
  config?: string | boolean;
  format?: string;
  /** Suppress all runtime logs on stderr. */
  quiet?: boolean;
  /** Minimum runtime log level emitted to stderr (default: "info"). */
  logLevel?: RuntimeLoggerLevel;
  /** When set, writes the full structured run output to this JSON file. */
  capture?: string;
}

const LOG_LEVELS: readonly RuntimeLoggerLevel[] = ["debug", "info", "warn", "error"] as const;

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
 * `console.info` calls write to stdout and would corrupt the NDJSON stream.
 */
function createCliLogger(level: RuntimeLoggerLevel | "silent"): RuntimeLogger {
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

/** Resolves the effective stderr log level from command options. */
function resolveLogLevel(options: RunCommandOptions): RuntimeLoggerLevel | "silent" {
  if (options.quiet === true) return "silent";
  const requested = options.logLevel;
  if (requested !== undefined) {
    if (!LOG_LEVELS.includes(requested)) {
      throw new CliError(
        `Invalid --log-level "${requested}". Expected one of: ${LOG_LEVELS.join(", ")}`,
        EXIT_INVALID_ARGS
      );
    }
    return requested;
  }
  return "info";
}

/** Final on-disk shape written by `--capture`. */
interface CapturePayload {
  command: {
    flow: string;
    action: string;
    input: unknown;
    model: string | null;
    session: string | null;
    seedSession: unknown;
    seedUser: unknown;
    seedOrg: unknown;
  };
  events: FlowEvent[];
  result: FlowRunResult & { exitCode: number };
}

/** Writes a capture payload to disk, creating parent directories as needed. */
function writeCaptureFile(path: string, payload: CapturePayload): void {
  const target = isAbsolute(path) ? path : resolve(process.cwd(), path);
  try {
    mkdirSync(dirname(target), { recursive: true });
  } catch {
    // best-effort: writeFileSync below will surface a real error
  }
  writeFileSync(target, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

/** Internal options for testability. */
export interface RunCommandInternalOptions extends RunCommandOptions {
  /** Override flow discovery directory (defaults to process.cwd()). */
  cwd?: string;
  /** Override stores (defaults to filesystem at .fsdev/data). */
  stores?: StoreRegistry;
}

/** Core execution logic for `fsdev run`, separated for testability. */
export async function executeRunCommand(
  flowKind: string,
  actionName: string,
  options: RunCommandInternalOptions,
): Promise<FlowRunResult> {
  // 0. Load .env files. Explicit --dotenv entries first (they outrank the
  // walk-up and let a repo-root invocation reach an app's .env.local), then the
  // cwd .env.local walk-up. Must run before importing an fsdev.config.* so the
  // config's providers see the app's env (gateway keys).
  const cwd = options.cwd ?? process.cwd();
  if (options.dotenv !== undefined) loadExplicitEnvFiles(cwd, options.dotenv);
  loadEnvFiles(cwd);

  // 1. Resolve the runtime source. When the app ships an fsdev.config.*, the CLI
  // runs the app's own wiring (registry, stores, model resolver); otherwise it
  // falls back to directory discovery and CLI defaults. `--no-config` forces the
  // legacy path; `--config <path>` names an explicit file.
  const useConfig = options.config !== false;
  const configPath = typeof options.config === "string" ? options.config : undefined;
  const loaded = useConfig ? await loadFsdevConfig({ cwd, configPath }) : undefined;

  // Dispose the config's FlowState once the run settles (closes the app's pools,
  // drains a started worker). Failures are warned, never masking the run result.
  const disposeConfig =
    loaded !== undefined
      ? async () => {
          try {
            await loaded.flowState.dispose();
          } catch (err) {
            process.stderr.write(
              `Warning: failed to dispose fsdev config: ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
        }
      : undefined;

  try {
    let flow: FlowInstance;
    let stores: StoreRegistry;
    let baseRuntimeConfig: RuntimeConfig | undefined;

    if (loaded !== undefined) {
      // --- config path: take the app's registry/stores/runtimeConfig ---
      if (options.flowDir !== undefined) {
        throw new CliError(
          "--flow-dir bypasses fsdev.config.*; pass --no-config to use directory discovery.",
          EXIT_INVALID_ARGS,
        );
      }
      let runtime;
      try {
        runtime = await loaded.flowState.getRuntime();
      } catch (err) {
        throw new CliError(
          `Failed to initialize fsdev config ${loaded.path}: ${err instanceof Error ? err.message : String(err)}`,
          EXIT_CONFIG_ERROR,
        );
      }
      const found = runtime.registry.get(flowKind);
      if (found === undefined) {
        const kinds = [...new Set(runtime.registry.list().map((f) => f.kind))].join(", ") || "(none)";
        throw new CliError(
          `Flow "${flowKind}" not found in fsdev config (${loaded.path}). Available flows: ${kinds}`,
          EXIT_DISCOVERY_ERROR,
        );
      }
      flow = found;
      stores = options.stores ?? runtime.stores;
      baseRuntimeConfig = runtime.runtimeConfig;
    } else {
      // --- discovery path: scan conventional directories, CLI defaults ---
      // Import failures are warned to stderr unconditionally (not gated by
      // --quiet): diagnostics about broken modules, the same category as
      // CliError output, and stderr keeps stdout NDJSON-pure.
      const failures: FlowImportFailure[] = [];
      const discoverOptions: DiscoverFlowsOptions = {
        cwd: options.cwd,
        ...(options.flowDir !== undefined ? { flowDirs: options.flowDir } : {}),
        onImportFailed: (failure) => failures.push(failure),
      };
      const flows = await discoverFlows(discoverOptions);
      for (const failure of failures) {
        process.stderr.write(formatImportFailureWarning(failure));
      }
      const found = flows.find((f) => f.kind === flowKind);
      if (found === undefined) {
        const available = flows.map((f) => f.kind).join(", ") || "(none found)";
        const searched = getSearchedDirs(discoverOptions).join(", ");
        throw new CliError(
          `Flow "${flowKind}" not found. Available flows: ${available}\n` +
          `Searched: ${searched}` + formatFailedImportSection(failures),
          EXIT_DISCOVERY_ERROR,
        );
      }
      flow = found;
      // `fsdev run` is a local one-shot runner, so the filesystem store is
      // acknowledged development-only (FIX-406 6A).
      stores =
        options.stores ??
        createFilesystemStores({ rootDir: ".fsdev/data", developmentOnly: true });
    }

    // 2. Validate action exists on flow
    const actionConfig = flow.actions[actionName];
    if (actionConfig === undefined) {
      const available = Object.keys(flow.actions).join(", ") || "(none)";
      throw new CliError(
        `Action "${actionName}" not found on flow "${flowKind}". Available actions: ${available}`,
        EXIT_INVALID_ARGS,
      );
    }

    // 3. Parse input
    const input = parseInputArg({ input: options.input, inputFile: options.inputFile });

    // 4. Parse and apply seed state
    const sessionId = options.session ?? `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    if (options.seedSession !== undefined) {
      const seedData = parseSeedArg(options.seedSession, "session") as JsonObject;
      const existing = await stores.session.get(sessionId);
      if (existing !== undefined) {
        await stores.session.set(sessionId, {
          ...existing,
          state: { ...existing.state, ...seedData },
          updatedAt: Date.now(),
        }, "any");
      } else {
        await stores.session.set(sessionId, {
          id: sessionId,
          flowKind: flowKind,
          userId: "cli-user",
          state: seedData,
          version: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          journal: [],
        }, "any");
      }
    }

    // 5. Resolve the effective model resolver. With a config, `--model` wraps
    // the app's resolver so its gateways/providers still apply; without one it
    // wraps a bare default resolver. No `--model` leaves the config's resolver
    // (or undefined in the discovery path).
    let modelResolver: ModelResolver | undefined;
    if (loaded !== undefined) {
      const base = baseRuntimeConfig?.modelResolver ?? createModelResolver();
      modelResolver = options.model !== undefined ? forceModelResolver(base, options.model) : base;
    } else if (options.model !== undefined) {
      modelResolver = forceModelResolver(createModelResolver(), options.model);
    }

    // 6. Create response emitter with NDJSON streaming.
    //    When --capture is set, also collect every emitted event for the on-disk payload.
    const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const captureEnabled = options.capture !== undefined && options.capture !== "";
    const capturedEvents: FlowEvent[] = [];
    const recordEvent = (event: FlowEvent): void => {
      if (captureEnabled) capturedEvents.push(event);
      emitNdjson(event);
    };
    const responseEmitter = createResponseEmitter({
      requestId,
      onEvent: (event) => {
        const ndjsonEvent = mapStreamEventToNdjson(event);
        if (ndjsonEvent !== undefined) {
          recordEvent(ndjsonEvent);
        }
      },
    });

    // 6b. Construct the stderr runtime logger (suppressible via --quiet, level via --log-level).
    const logLevel = resolveLogLevel(options);
    const logger = createCliLogger(logLevel);

    // 7. Execute the flow action. With a config, forward the app's runtimeConfig
    // (durability, middleware, settings, ...), overriding only the logger (CLI
    // stderr discipline) and the model resolver (per --model).
    const runtimeConfig: RuntimeConfig =
      baseRuntimeConfig !== undefined
        ? { ...baseRuntimeConfig, modelResolver, logger }
        : { modelResolver, logger };

    const startMs = Date.now();
    let result: ExecutionResult;
    let error: { message: string; stack?: string } | undefined;
    let success = true;

    try {
      result = await runAction({
        flow,
        actionName,
        input: input ?? {},
        userId: "cli-user",
        sessionId,
        stores,
        responseEmitter,
        runtimeConfig,
      });

      if (result.error !== undefined) {
        success = false;
        error = {
          message: result.error.message,
          stack: result.error.stack,
        };
      }
    } catch (err) {
      success = false;
      result = { output: undefined, items: [], durationMs: Date.now() - startMs };
      error = {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      };
    }

    const durationMs = Date.now() - startMs;

    // 8. Emit terminal NDJSON event
    if (success) {
      recordEvent({
        type: "flow_complete",
        output: result.output ?? null,
        durationMs,
        items: result.items.length,
      });
    } else {
      recordEvent({
        type: "error",
        message: error!.message,
      });
    }

    const runResult: FlowRunResult = {
      success,
      flow: { kind: flowKind, action: actionName },
      output: result.output ?? null,
      execution: { durationMs, itemCount: result.items.length },
      ...(error !== undefined ? { error } : {}),
    };

    const exitCode = success ? EXIT_SUCCESS : EXIT_EXECUTION_ERROR;

    // 9. Optional --capture: write structured run payload to disk.
    //    Capture failures are surfaced on stderr but don't override the run's exit code.
    if (captureEnabled) {
      try {
        writeCaptureFile(options.capture!, {
          command: {
            flow: flowKind,
            action: actionName,
            input: input ?? null,
            model: options.model ?? null,
            session: options.session ?? null,
            seedSession: options.seedSession ?? null,
            seedUser: options.seedUser ?? null,
            seedOrg: options.seedOrg ?? null,
          },
          events: capturedEvents,
          result: { ...runResult, exitCode },
        });
      } catch (err) {
        process.stderr.write(
          `Failed to write --capture file: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }

    process.exitCode = exitCode;

    return runResult;
  } finally {
    await disposeConfig?.();
  }
}

/**
 * Maps a ResponseEmitter stream event to a CLI-friendly NDJSON event.
 * Returns undefined for events we don't surface in the CLI.
 */
function mapStreamEventToNdjson(event: RequestStreamEventWithId): FlowEvent | undefined {
  switch (event.type) {
    case "item.added": {
      const item = (event as any).item as OutputItem | undefined;
      if (item !== undefined) {
        return { type: "item_added", item };
      }
      return undefined;
    }

    case "item.updated": {
      const itemId = (event as any).itemId as string | undefined;
      const patch = (event as any).patch as Record<string, unknown> | undefined;
      if (itemId !== undefined && patch !== undefined) {
        return { type: "item_updated", itemId, patch };
      }
      return undefined;
    }

    case "item.done": {
      const item = (event as any).item as OutputItem | undefined;
      if (item !== undefined) {
        return { type: "item_done", item };
      }
      return undefined;
    }

    case "content.delta": {
      const delta = (event as any).delta as string | undefined;
      const itemId = (event as any).itemId as string | undefined;
      if (delta !== undefined && itemId !== undefined) {
        return { type: "content_delta", itemId, delta };
      }
      return undefined;
    }

    case "resource.changed": {
      const scope = (event as any).scope as string | undefined;
      const resourcePath = (event as any).resourcePath as string | undefined;
      const changeType = (event as any).changeType as string | undefined;
      if (scope !== undefined && resourcePath !== undefined && changeType !== undefined) {
        return { type: "state_change", scope, resourcePath, changeType };
      }
      return undefined;
    }

    default:
      return undefined;
  }
}
