/**
 * `fsdev run <flowKind> <action>` command — executes a flow action with streaming NDJSON output.
 */
import {
  createFlowRegistry,
  ensureSessionRecord,
  ownsRecord,
  ReadonlySessionStateError,
  refuseReadonlyStateChange,
  refuseServerOwnedState,
  SessionCreateRefusedError,
  type SessionRecord
} from "@flow-state-dev/engine";
import { getReadonlyStateKeys } from "@flow-state-dev/core/helpers";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import type { Command } from "commander";
import type { OutputItem } from "@flow-state-dev/core/items";
import {
  runAction,
  resolveInProcessPrincipal,
  createModelResolver,
  resolveDurabilityProvider,
  createResponseEmitter,
  type ExecutionResult,
  type RequestStreamEventWithId,
  type RuntimeConfig,
  type RuntimeLoggerLevel,
  type StoreRegistry
} from "@flow-state-dev/engine";
import type { FlowInstance, ModelResolver, JsonObject } from "@flow-state-dev/core/types";
import { formatFailedImportSection } from "../resolve-flow";
import { resolveRuntimeSource, assertNoFlowDirWithConfig, createCliLogger, resolveLogLevel } from "../resolve-runtime";
import { forceModelResolver } from "../model-override";
import { parseInputArg } from "../parse-input";
import { CliError } from "../resolve-block";
import { collectValues } from "../cli-options";
import {
  askFlowState,
  checkSessionOwner,
  describePrincipal,
  resolveCliPrincipal,
  type AskPrincipal,
  type CliPrincipal,
  type PinOf,
} from "../principal";
import { openLocalStores, parseStoreFlag, STORE_FLAG_HELP, type LocalStoreKind } from "../local-store";
import { EXIT_SUCCESS, EXIT_EXECUTION_ERROR, EXIT_INVALID_ARGS, EXIT_CONFIG_ERROR, EXIT_DISCOVERY_ERROR, EXIT_INTERNAL_ERROR } from "../exit-codes";

/** NDJSON event types emitted to stdout during flow execution. */
export type FlowEvent =
  | { type: "item_added"; item: OutputItem }
  | { type: "item_updated"; itemId: string; patch: Record<string, unknown> }
  | { type: "item_done"; item: OutputItem }
  | { type: "content_delta"; itemId: string; delta: string }
  | { type: "state_change"; scope: string; resourcePath: string; changeType: string }
  | { type: "flow_complete"; output: unknown; durationMs: number; items: number }
  | ({ type: "suspended" } & RunSuspension)
  | { type: "error"; message: string; code?: string };

/**
 * A stop the run ended on (FIX-2063 D3): the request is held, waiting for a
 * person, and is answered through a server on the same store (`fsdev dev`).
 */
export interface RunSuspension {
  requestId: string;
  sessionId: string;
  suspensionId: string;
  reason: string;
  title?: string;
  message?: string;
  /** Where to answer it, as one sentence a person reads. */
  answer: string;
}

/** Structured final result for `fsdev run`. */
export interface FlowRunResult {
  success: boolean;
  flow: { kind: string; action: string };
  output: unknown;
  execution: { durationMs: number; itemCount: number };
  error?: { message: string; stack?: string };
  /** Set when the run ended waiting for a person; the exit code is 0. */
  suspended?: RunSuspension;
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

/** Registers the `run` subcommand on the given commander program. */
export function registerRunCommand(program: Command): void {
  program
    .command("run <flowKind> <action>")
    .description("Execute a flow action with streaming NDJSON output")
    .option("-i, --input <json>", "Inline JSON input")
    .option("-f, --input-file <path>", "Path to JSON input file")
    .option("-m, --model <model>", "Override model for generator blocks run in this process")
    .option("-s, --session <id>", "Session ID for reuse across invocations")
    .option("--org <id>", "Run in this organization and skip the app's resolver")
    .option("-u, --user <id>", "Run as this user. The organization comes from the app's resolver unless you also pass --org. Default: the user your app's resolver returns, or devuser (the DevTool's local user) if the app has none or you pass --org")
    .option("--seed-session <json>", "Seed session-level state (JSON or file path)")
    .option("--flow-dir <path>", "Override flow discovery root (repeatable)", collectValues, undefined)
    .option("--dotenv <path>", "Load a specific .env file, e.g. an app's (repeatable, resolved from cwd)", collectValues, undefined)
    .option("--config <path>", "Path to an fsdev config file (default: fsdev.config.{ts,mts,js,mjs} in cwd)")
    .option("--no-config", "Ignore fsdev.config.* and use directory discovery")
    .option("--quiet", "Suppress runtime logs on stderr (NDJSON on stdout still emitted)")
    .option("--log-level <level>", "Stderr log level: debug | info | warn | error (default: info)")
    .option("--capture <path>", "Write the full structured run output to a JSON file")
    .option("--store <kind>", STORE_FLAG_HELP)
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
  /** `--org`: run in this organization; the app's resolver is not asked. */
  org?: string;
  /** `--user`: run as this user. The organization comes from the app's resolver unless `--org` is also given. */
  user?: string;
  flowDir?: string[];
  /** Explicit `--dotenv <path>` entries to load before the cwd `.env.local` walk-up. */
  dotenv?: string[];
  /**
   * fsdev config selection. A string is an explicit `--config <path>`; `false`
   * is `--no-config`; `true`/absent means search for `fsdev.config.*` in cwd.
   */
  config?: string | boolean;
  /** Suppress all runtime logs on stderr. */
  quiet?: boolean;
  /** Minimum runtime log level emitted to stderr (default: "info"). */
  logLevel?: RuntimeLoggerLevel;
  /** When set, writes the full structured run output to this JSON file. */
  capture?: string;
  /** `--store`: the local store without an app config (default SQLite). */
  store?: LocalStoreKind;
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
    /** Who the run was, and whether the resolver, a flag, or the development default chose it. */
    principal: CliPrincipal;
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
  /** Override stores (defaults to the local SQLite file `fsdev dev` reads). */
  stores?: StoreRegistry;
}

/** Core execution logic for `fsdev run`, separated for testability. */
export async function executeRunCommand(
  flowKind: string,
  actionName: string,
  options: RunCommandInternalOptions,
): Promise<FlowRunResult> {
  // 0-1. Load .env, resolve the runtime source (app config vs directory
  // discovery), and surface import failures — the shared prelude. When the app
  // ships an fsdev.config.*, the CLI runs the app's own wiring (registry, stores,
  // model resolver); otherwise it falls back to directory discovery and CLI
  // defaults. The prelude also rejects `--flow-dir` combined with a config.
  const resolved = await resolveRuntimeSource({
    cwd: options.cwd,
    config: options.config,
    flowDir: options.flowDir,
    dotenv: options.dotenv,
  });

  // Dispose the config's FlowState once the run settles (closes the app's pools,
  // drains a started worker). Failures are warned, never masking the run result.
  const disposeConfig =
    resolved.source === "config"
      ? async () => {
          try {
            await resolved.flowState.dispose();
          } catch (err) {
            process.stderr.write(
              `Warning: failed to dispose fsdev config: ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
        }
      : undefined;

  let closeLocalStores: (() => void) | undefined;
  try {
    const storeKind = parseStoreFlag(options.store, resolved.source === "config");
    let flow: FlowInstance;
    let stores: StoreRegistry;
    /** Where a stop this run ends on is answered, as the waiting report says it. */
    let answerAt: string;
    let baseRuntimeConfig: RuntimeConfig | undefined;
    let askPrincipal: AskPrincipal;
    let pinOf: PinOf;

    if (resolved.source === "config") {
      // --- config path: take the app's registry/stores/runtimeConfig ---
      // Guarded here (inside the try) so a failure disposes the loaded FlowState.
      assertNoFlowDirWithConfig(options.flowDir);
      let runtime;
      try {
        runtime = await resolved.flowState.getRuntime();
      } catch (err) {
        throw new CliError(
          `Failed to initialize fsdev config ${resolved.configPath}: ${err instanceof Error ? err.message : String(err)}`,
          EXIT_CONFIG_ERROR,
        );
      }
      // Exact instance address: a singleton's kind, or a collection member's
      // explicit id. A collection's bare kind names nothing.
      const found = runtime.registry.get(flowKind);
      if (found === undefined) {
        const kinds = runtime.registry.list().map((f) => f.id).join(", ") || "(none)";
        throw new CliError(
          `Flow "${flowKind}" not found in fsdev config (${resolved.configPath}). Available flows: ${kinds}`,
          EXIT_DISCOVERY_ERROR,
        );
      }
      flow = found;
      stores = options.stores ?? runtime.stores;
      baseRuntimeConfig = runtime.runtimeConfig;
      askPrincipal = askFlowState(resolved.flowState, resolved.configPath);
      pinOf = (id) => runtime.registry.pinOf(id);
      answerAt = `Answer it in a server on this app's stores, such as fsdev dev with ${resolved.configPath}.`;
    } else {
      // --- discovery path: scan conventional directories, CLI defaults ---
      const found = resolved.flows.find((f) => f.id === flowKind);
      if (found === undefined) {
        const available = resolved.flows.map((f) => f.id).join(", ") || "(none found)";
        const searched = resolved.searchedDirs.join(", ");
        throw new CliError(
          `Flow "${flowKind}" not found. Available flows: ${available}\n` +
          `Searched: ${searched}` + formatFailedImportSection(resolved.importFailures),
          EXIT_DISCOVERY_ERROR,
        );
      }
      flow = found;
      // No app, so no host resolver: the flow's own, else the development default.
      const registry = createFlowRegistry();
      registry.register(flow);
      askPrincipal = (question) => resolveInProcessPrincipal({ registry }, question);
      pinOf = (id) => registry.pinOf(id);
      // The store `fsdev dev` reads, so a stop this run ends on is answered
      // there, after the run exits (FIX-2063 D1). Durable by the one engine
      // rule: on wherever the stores persist.
      if (options.stores !== undefined) {
        stores = options.stores;
        answerAt = "Answer it in a server on these stores.";
      } else {
        const local = await openLocalStores(storeKind);
        closeLocalStores = local.close;
        stores = local.stores;
        answerAt =
          local.kind === "filesystem"
            ? `Answer it in fsdev dev --store filesystem, started after this run exits: the filesystem store is ` +
              `single-process. Its state is under ${local.dataLine}.`
            : `Answer it in fsdev dev, which reads this store: ${local.dataLine}.`;
        if (local.kind === "filesystem" && !options.quiet) {
          process.stderr.write(
            `[fsdev] store: ${local.dataLine}. It is single-process: don't run fsdev dev on it while this run is going.\n`,
          );
        }
      }
      baseRuntimeConfig = { durabilityProvider: resolveDurabilityProvider({ stores }) };
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

    // 4. Who this run is — one identity per invocation, asked of the app the
    // way its HTTP routes ask, before anything is written. A refusal stops here.
    const principal = await resolveCliPrincipal(
      askPrincipal,
      { flowKind, action: actionName, input: input ?? {} },
      { org: options.org, user: options.user },
      pinOf,
    );

    // 5. Check an existing session against that identity, then apply seed state.
    // Both checks are reads: `runAction` refuses a foreign session too, but a
    // seed written first would already have rewritten its owner's state.
    const sessionId = options.session ?? `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const seedData =
      options.seedSession !== undefined
        ? (parseSeedArg(options.seedSession, "session") as JsonObject)
        : undefined;
    // A session this run did not create — found here, or created by another
    // run between this one's read and its write — is checked the same way
    // before anything runs on it: this flow's, this principal's, and, when a
    // seed is given, one the seed may be written into (no server-owned field,
    // no change to a readonly one).
    const checkHeldSession = (held: SessionRecord): void => {
      if (!ownsRecord(flow, held)) {
        throw new CliError(
          `Session "${sessionId}" belongs to flow instance "${held.flowId ?? held.flowKind}", ` +
            `not "${flow.id}"; nothing was written`,
          EXIT_INVALID_ARGS,
        );
      }
      const refusal = checkSessionOwner(held, sessionId, principal);
      if (refusal !== undefined) throw new CliError(refusal, EXIT_INVALID_ARGS);
      if (seedData === undefined) return;
      try {
        refuseServerOwnedState(flow, sessionId, seedData);
        refuseReadonlyStateChange(
          flow.kind,
          sessionId,
          getReadonlyStateKeys(flow.session?.stateSchema),
          held.state,
          { ...held.state, ...seedData },
        );
      } catch (err) {
        if (err instanceof SessionCreateRefusedError || err instanceof ReadonlySessionStateError) {
          throw new CliError(`${err.message} Nothing was written`, EXIT_INVALID_ARGS);
        }
        throw err;
      }
    };
    const existing = options.session !== undefined ? await stores.session.get(sessionId) : undefined;
    if (existing !== undefined) checkHeldSession(existing);

    if (!options.quiet) process.stderr.write(describePrincipal(principal, { org: options.org, user: options.user }) + "\n");

    if (existing !== undefined) {
      if (seedData !== undefined) {
        await stores.session.set(sessionId, {
          ...existing,
          state: { ...existing.state, ...seedData },
          updatedAt: Date.now(),
        }, "any");
      }
    } else if (seedData !== undefined || flow.session?.createCheck !== undefined) {
      // The one birth function: it parses the seed through the flow's state
      // schema, refuses a seeded server-owned field, runs the flow's create
      // check on what it parsed, and mints the lineage id (FIX-1068), which a
      // seeded CLI session needs as much as any other. A flow that checks its
      // creates is born here rather than by the run, so a refusal is this
      // command's error, not a failed run.
      const now = Date.now();
      let held: SessionRecord;
      try {
        held = await ensureSessionRecord(
          stores,
          sessionId,
          {
            flow,
            sessionId,
            principal: { userId: principal.userId, orgId: principal.orgId },
            ...(seedData !== undefined ? { state: seedData } : {}),
            fromCaller: true,
            via: "cli",
          },
          () => ({
            id: sessionId,
            flowKind: flow.kind,
            flowId: flow.id,
            // The identity the run below executes under, so the run accepts the
            // record it seeded.
            userId: principal.userId,
            orgId: principal.orgId,
            version: 0,
            createdAt: now,
            updatedAt: now,
            journal: [],
          }),
        );
      } catch (err) {
        if (err instanceof SessionCreateRefusedError) {
          const hint =
            flow.session?.createCheck !== undefined && seedData === undefined
              ? " Pass the session's initial state with --seed-session."
              : "";
          throw new CliError(`${err.message}${hint} Nothing was written`, EXIT_INVALID_ARGS);
        }
        throw err;
      }
      // A lost race returns the winner's record, which this run never
      // checked: it may be another principal's, or created with another value
      // for a readonly field than this run's seed.
      checkHeldSession(held);
    }

    // 6. Resolve the effective model resolver. With a config, `--model` wraps
    // the app's resolver so its gateways/providers still apply; without one it
    // wraps a bare default resolver. No `--model` leaves the config's resolver
    // (or undefined in the discovery path).
    let modelResolver: ModelResolver | undefined;
    if (resolved.source === "config") {
      const base = baseRuntimeConfig?.modelResolver ?? createModelResolver();
      modelResolver = options.model !== undefined ? forceModelResolver(base, options.model) : base;
    } else if (options.model !== undefined) {
      modelResolver = forceModelResolver(createModelResolver(), options.model);
    }

    // 7. Create response emitter with NDJSON streaming.
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

    // 7b. Construct the stderr runtime logger (suppressible via --quiet, level via --log-level).
    const logLevel = resolveLogLevel(options, "info");
    const logger = createCliLogger(logLevel);

    // Install it on the app's OWN runtime config too, not just on the derived
    // copy below. The FlowState logs on its own account outside any request —
    // notably while `dispose()` waits for detached work to finish — and it reads
    // this object, never the copy. Without this, `--quiet` silenced the run and
    // not the shutdown, which is the opposite of what the flag promises.
    if (baseRuntimeConfig !== undefined) {
      baseRuntimeConfig.logger = logger;
    }

    // 8. Execute the flow action. With a config, forward the app's runtimeConfig
    // (durability, settings, ...), overriding only the logger (CLI
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
        userId: principal.userId,
        orgId: principal.orgId,
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

    // 8b. A run that ended on a stop is held, not done (FIX-2063 D3): the
    // request waits for a person, answered through a server on this store,
    // and the command exits 0 saying so.
    const suspended = success ? await heldStop(result, stores, sessionId, answerAt) : undefined;

    // 9. Emit terminal NDJSON event
    if (suspended !== undefined) {
      recordEvent({ type: "suspended", ...suspended });
      if (!options.quiet) process.stderr.write(describeHeldStop(suspended));
    } else if (success) {
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
      ...(suspended !== undefined ? { suspended } : {}),
    };

    const exitCode = success ? EXIT_SUCCESS : EXIT_EXECUTION_ERROR;

    // 10. Optional --capture: write structured run payload to disk.
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
            principal,
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
    closeLocalStores?.();
    await disposeConfig?.();
  }
}

/**
 * The stop a run ended on, when its request is held waiting for a person:
 * the request record says `suspended`, and the stop is its last suspension item.
 * `fsdev chat` reads a held turn the same way.
 */
export async function heldStop(
  result: ExecutionResult,
  stores: StoreRegistry,
  sessionId: string,
  answer: string,
): Promise<RunSuspension | undefined> {
  if (result.requestId === undefined) return undefined;
  const record = await stores.request.get(result.requestId);
  if (record?.status !== "suspended") return undefined;
  const item = [...result.items].reverse().find((i) => (i as { type?: string }).type === "suspension") as
    | { suspensionId?: string; reason?: unknown; title?: string; message?: string }
    | undefined;
  if (item?.suspensionId === undefined) return undefined;
  return {
    requestId: result.requestId,
    sessionId,
    suspensionId: item.suspensionId,
    reason: String(item.reason),
    ...(item.title === undefined ? {} : { title: item.title }),
    ...(item.message === undefined ? {} : { message: item.message }),
    answer,
  };
}

/** The waiting report on stderr: what waits, its ids, where to answer it, and when its deadline fires. */
function describeHeldStop(stop: RunSuspension): string {
  const what = stop.message ?? stop.title ?? stop.reason;
  return (
    `[fsdev] waiting for a person: ${what}\n` +
    `[fsdev]   suspension ${stop.suspensionId} · request ${stop.requestId} · session ${stop.sessionId}\n` +
    `[fsdev]   ${stop.answer}\n` +
    `[fsdev]   Its deadline fires only while a server runs on this store.\n`
  );
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
