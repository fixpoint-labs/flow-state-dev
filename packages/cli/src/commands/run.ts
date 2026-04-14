/**
 * `fsdev run <flowKind> <action>` command — executes a flow action with streaming NDJSON output.
 */
import { readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
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
  type StoreRegistry
} from "@flow-state-dev/server";
import type { FlowInstance, ModelResolver, JsonObject } from "@flow-state-dev/core/types";
import { discoverFlows, getSearchedDirs, type DiscoverFlowsOptions } from "../resolve-flow";
import { parseInputArg } from "../parse-input";
import { CliError } from "../resolve-block";
import { EXIT_SUCCESS, EXIT_EXECUTION_ERROR, EXIT_INVALID_ARGS, EXIT_DISCOVERY_ERROR, EXIT_INTERNAL_ERROR } from "../exit-codes";
import { loadEnvFiles } from "../load-env";

/** NDJSON event types emitted to stdout during flow execution. */
export type FlowEvent =
  | { type: "item_added"; item: OutputItem }
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
    .option("--seed-project <json>", "Seed project-level state (JSON or file path)")
    .option("--flow-dir <path>", "Override flow discovery root (repeatable)", collectValues, undefined)
    .option("--format <format>", "Output format", "json")
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
  seedProject?: string;
  flowDir?: string[];
  format?: string;
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
  // 0. Load .env.local files (walks up from cwd)
  const cwd = options.cwd ?? process.cwd();
  loadEnvFiles(cwd);

  // 1. Discover flows from conventional directories
  const discoverOptions: DiscoverFlowsOptions = {
    cwd: options.cwd,
    ...(options.flowDir !== undefined ? { flowDirs: options.flowDir } : {}),
  };
  const flows = await discoverFlows(discoverOptions);

  const flow = flows.find((f) => f.kind === flowKind);
  if (flow === undefined) {
    const available = flows.map((f) => f.kind).join(", ") || "(none found)";
    const searched = getSearchedDirs(discoverOptions).join(", ");
    throw new CliError(
      `Flow "${flowKind}" not found. Available flows: ${available}\n` +
      `Searched: ${searched}`,
      EXIT_DISCOVERY_ERROR,
    );
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

  // 4. Set up stores
  const stores = options.stores ?? createFilesystemStores({ rootDir: ".fsdev/data" });

  // 4b. Parse and apply seed state
  const sessionId = options.session ?? `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  if (options.seedSession !== undefined) {
    const seedData = parseSeedArg(options.seedSession, "session") as JsonObject;
    const existing = await stores.session.get(sessionId);
    if (existing !== undefined) {
      await stores.session.set(sessionId, {
        ...existing,
        state: { ...existing.state, ...seedData },
        updatedAt: Date.now(),
      });
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
      });
    }
  }

  // 5. Set up model resolver (override all generators when --model is set)
  let modelResolver: ModelResolver | undefined;
  if (options.model !== undefined) {
    const defaultResolver = createModelResolver();
    const override = ((_modelId: string, blockName?: string) => {
      return defaultResolver(options.model!, blockName);
    }) as ModelResolver;
    override.resolveId = (modelId: string) => defaultResolver.resolveId(modelId);
    modelResolver = override;
  }

  // 6. Create response emitter with NDJSON streaming
  const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const responseEmitter = createResponseEmitter({
    requestId,
    onEvent: (event) => {
      const ndjsonEvent = mapStreamEventToNdjson(event);
      if (ndjsonEvent !== undefined) {
        emitNdjson(ndjsonEvent);
      }
    },
  });

  // 7. Execute flow action
  const startMs = Date.now();
  let result: ExecutionResult;
  let error: { message: string; stack?: string } | undefined;
  let success = true;

  try {
    result = await runAction({
      flow: flow as FlowInstance,
      actionName,
      input: input ?? {},
      userId: "cli-user",
      sessionId,
      stores,
      modelResolver,
      responseEmitter,
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
    emitNdjson({
      type: "flow_complete",
      output: result.output ?? null,
      durationMs,
      items: result.items.length,
    });
  } else {
    emitNdjson({
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

  process.exitCode = success ? EXIT_SUCCESS : EXIT_EXECUTION_ERROR;

  return runResult;
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
