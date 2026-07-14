/**
 * `fsdev chat [flow] [action]` — a persistent interactive session over a
 * flow-state project. Resolves the runtime the same way `fsdev run` does (the
 * shared prelude), binds a default target, and runs the read-eval loop.
 */
import { mkdir } from "node:fs/promises";
import type { Command } from "commander";
import {
  createFlowRegistry,
  createModelResolver,
  type FlowRegistry,
  type RequestRecord,
  type RuntimeConfig,
  type RuntimeLoggerLevel,
  type StoreRegistry,
} from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { resolveRuntimeSource, assertNoFlowDirWithConfig, createCliLogger, resolveLogLevel } from "../resolve-runtime";
import { forceModelResolver } from "../model-override";
import { CliError } from "../resolve-block";
import { EXIT_INVALID_ARGS, EXIT_CONFIG_ERROR, EXIT_DISCOVERY_ERROR, EXIT_INTERNAL_ERROR } from "../exit-codes";
import { createHarnessState, bindTarget } from "../chat/state";
import { listTargets, pickTarget, type FlowActionTarget } from "../chat/targets";
import { createBuiltinRegistry } from "../chat/registry";
import { createPlainTextRenderer } from "../chat/render";
import { runChatLoop, type SessionGuard } from "../chat/loop";
import { collectValues } from "../cli-options";

/** Registers the `chat` subcommand on the given commander program. */
export function registerChatCommand(program: Command): void {
  program
    .command("chat [flow] [action]")
    .description("Start an interactive chat session over a flow")
    .option("-s, --session <id>", "Resume an engine session for the initially bound flow")
    .option("-m, --model <model>", "Override model for all generator blocks")
    .option("-u, --user <id>", "Engine identity for sessions and turns (default: cli-user)")
    .option("--flow-dir <path>", "Override flow discovery root (repeatable)", collectValues, undefined)
    .option("--dotenv <path>", "Load a specific .env file (repeatable, resolved from cwd)", collectValues, undefined)
    .option("--config <path>", "Path to an fsdev config file (default: fsdev.config.{ts,mts,js,mjs} in cwd)")
    .option("--no-config", "Ignore fsdev.config.* and use directory discovery")
    .option("--quiet", "Suppress runtime logs on stderr")
    .option("--log-level <level>", "Stderr log level: debug | info | warn | error (default: warn)")
    .action(async (flow: string | undefined, action: string | undefined, options: ChatCommandOptions) => {
      try {
        await executeChatCommand(flow, action, options);
      } catch (err) {
        if (err instanceof CliError) {
          process.stderr.write(err.message + "\n");
          process.exitCode = err.exitCode;
          return;
        }
        process.stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = EXIT_INTERNAL_ERROR;
      }
    });
}

export interface ChatCommandOptions {
  session?: string;
  user?: string;
  model?: string;
  flowDir?: string[];
  dotenv?: string[];
  /** fsdev config selection (string path, `false` for --no-config, or absent). */
  config?: string | boolean;
  quiet?: boolean;
  logLevel?: RuntimeLoggerLevel;
}

/** Internal options for testability — inject stores, resolver, and streams. */
export interface ChatCommandInternalOptions extends ChatCommandOptions {
  cwd?: string;
  stores?: StoreRegistry;
  modelResolver?: ModelResolver;
  input?: NodeJS.ReadableStream & { isTTY?: boolean };
  output?: NodeJS.WritableStream & { isTTY?: boolean };
}

/**
 * Resolve a config-declared default target (`chat.default`), given as
 * `"<flowKind>"` or `"<flowKind>.<action>"`, against the enumerated targets.
 */
function resolveConfigDefaultTarget(spec: string, targets: FlowActionTarget[]): FlowActionTarget {
  const dot = spec.indexOf(".");
  const flowKind = dot === -1 ? spec : spec.slice(0, dot);
  const actionName = dot === -1 ? undefined : spec.slice(dot + 1);
  const picked = pickTarget(targets, flowKind, actionName);
  if (picked.ok) return picked.target;
  switch (picked.reason) {
    case "unknown-flow":
      throw new CliError(`chat.default "${spec}" names unknown flow "${flowKind}".`, EXIT_CONFIG_ERROR);
    case "unknown-action":
      throw new CliError(`chat.default "${spec}": flow "${flowKind}" has no action "${actionName}". Actions: ${picked.actions.join(", ")}`, EXIT_CONFIG_ERROR);
    case "ambiguous":
      throw new CliError(`chat.default "${spec}" is ambiguous; use <flow>.<action>. Actions: ${picked.actions.join(", ")}`, EXIT_CONFIG_ERROR);
  }
}

/** Resolve the initially bound target from positional args, config, or auto-bind. */
function resolveInitialTarget(
  flowKind: string | undefined,
  actionName: string | undefined,
  targets: FlowActionTarget[],
  configDefault: string | undefined,
): FlowActionTarget | undefined {
  if (flowKind !== undefined) {
    const picked = pickTarget(targets, flowKind, actionName);
    if (picked.ok) return picked.target;
    switch (picked.reason) {
      case "unknown-flow":
        throw new CliError(`Flow "${flowKind}" not found. Available flows: ${picked.available.join(", ") || "(none)"}`, EXIT_DISCOVERY_ERROR);
      case "unknown-action":
        throw new CliError(`Action "${actionName}" not found on flow "${flowKind}". Available actions: ${picked.actions.join(", ")}`, EXIT_INVALID_ARGS);
      case "ambiguous":
        throw new CliError(`Flow "${flowKind}" has multiple actions: ${picked.actions.join(", ")}. Specify one: fsdev chat ${flowKind} <action>`, EXIT_INVALID_ARGS);
    }
  }
  if (configDefault !== undefined) return resolveConfigDefaultTarget(configDefault, targets);
  // Exactly one flow + action → auto-bind. Otherwise start unbound.
  if (targets.length === 1) return targets[0];
  return undefined;
}

/** Core execution logic for `fsdev chat`, separated for testability. */
export async function executeChatCommand(
  flowKind: string | undefined,
  actionName: string | undefined,
  options: ChatCommandInternalOptions,
): Promise<void> {
  const resolved = await resolveRuntimeSource({
    cwd: options.cwd,
    config: options.config,
    flowDir: options.flowDir,
    dotenv: options.dotenv,
  });

  let registry: FlowRegistry;
  let stores: StoreRegistry;
  let baseRuntimeConfig: RuntimeConfig | undefined;
  let configDefault: string | undefined;
  let runtimeSnapshot: { source: string; store: string };
  // Set only for resources this command owns: the config's FlowState, or a
  // discovery-path SQLite store we opened. Injected stores stay caller-owned.
  let dispose: (() => Promise<void>) | undefined;

  if (resolved.source === "config") {
    assertNoFlowDirWithConfig(options.flowDir);
    let runtime;
    try {
      runtime = await resolved.flowState.getRuntime();
    } catch (err) {
      await resolved.flowState.dispose().catch(() => {});
      throw new CliError(
        `Failed to initialize fsdev config ${resolved.configPath}: ${err instanceof Error ? err.message : String(err)}`,
        EXIT_CONFIG_ERROR,
      );
    }
    registry = runtime.registry;
    stores = options.stores ?? runtime.stores;
    baseRuntimeConfig = runtime.runtimeConfig;
    configDefault = runtime.chat?.default;
    runtimeSnapshot = { source: `config (${resolved.configPath})`, store: "app-configured stores" };
    dispose = async () => {
      try {
        await resolved.flowState.dispose();
      } catch (err) {
        process.stderr.write(`Warning: failed to dispose fsdev config: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    };
  } else {
    if (resolved.flows.length === 0) {
      const searched = resolved.searchedDirs.join(", ");
      throw new CliError(
        `No flows found. Searched: ${searched}\nPlace flow definitions in src/flows/ or flows/, or use --flow-dir.`,
        EXIT_DISCOVERY_ERROR,
      );
    }
    registry = createFlowRegistry();
    registry.registerMany(resolved.flows);
    if (options.stores !== undefined) {
      stores = options.stores;
    } else {
      await mkdir(".fsdev/data", { recursive: true });
      const sqlite = createSQLiteStores({ filename: ".fsdev/data/fsdev.db" });
      stores = sqlite;
      dispose = async () => sqlite.close();
    }
    runtimeSnapshot = { source: "discovery", store: ".fsdev/data/fsdev.db (SQLite)" };
  }

  try {
    const targets = listTargets(registry);
    if (targets.length === 0) {
      throw new CliError("No flow targets available to chat with.", EXIT_DISCOVERY_ERROR);
    }

    // Resolve the model resolver (test override wins; else mirror `fsdev run`).
    // With a config, `--model` wraps the app's resolver; without one it wraps a
    // bare default. In the discovery path, no `--model` leaves it undefined — the
    // engine falls back to its own default, exactly as `fsdev run` does — so we
    // never eagerly construct a resolver that could reject on a misconfigured env.
    let modelResolver: ModelResolver | undefined;
    if (options.modelResolver !== undefined) {
      modelResolver = options.modelResolver;
    } else if (resolved.source === "config") {
      const base = baseRuntimeConfig?.modelResolver ?? createModelResolver();
      modelResolver = options.model !== undefined ? forceModelResolver(base, options.model) : base;
    } else if (options.model !== undefined) {
      modelResolver = forceModelResolver(createModelResolver(), options.model);
    }

    const logger = createCliLogger(resolveLogLevel(options, "warn"));
    const runtimeConfig: RuntimeConfig =
      baseRuntimeConfig !== undefined
        ? { ...baseRuntimeConfig, modelResolver, logger }
        : { modelResolver, logger };

    const userId = options.user ?? "cli-user";

    // Session guard (§4.4): reject an existing session whose record flow-kind, or
    // whose completed-request history, belongs to a different flow.
    const validateSessionForTarget: SessionGuard = async (sessionId, target) => {
      const record = await stores.session.get(sessionId).catch(() => undefined);
      if (record !== undefined && record.flowKind !== target.flowKind) {
        return { ok: false, message: `Session ${sessionId} belongs to flow "${record.flowKind}", not "${target.flowKind}".` };
      }
      // No tenantId filter: fsdev chat runs single-identity (tenantId undefined
      // throughout), so this is over-broad rather than unsafe — it can only reject
      // a foreign-flow request under a shared session id, never leak one.
      const priorRequests = await stores.request
        .list({ sessionId, status: "completed", limit: 50 })
        .catch((): RequestRecord[] => []);
      const foreign = priorRequests.find((r) => r.flowKind !== target.flowKind);
      if (foreign !== undefined) {
        return { ok: false, message: `Session ${sessionId} has history from flow "${foreign.flowKind}", not "${target.flowKind}".` };
      }
      return { ok: true };
    };

    const state = createHarnessState();
    const initialTarget = resolveInitialTarget(flowKind, actionName, targets, configDefault);

    // --session requires an initially bound target — it names the session for
    // that one flow, and there is nothing to bind it to when starting unbound.
    if (options.session !== undefined && initialTarget === undefined) {
      throw new CliError(
        "--session requires an initially bound target. Pass a positional flow (fsdev chat <flow> [action]), " +
          "or bind one with /use and then /session <id>.",
        EXIT_INVALID_ARGS,
      );
    }

    const input = options.input ?? process.stdin;
    const output = options.output ?? process.stdout;
    const isTTY = Boolean((input as { isTTY?: boolean }).isTTY);

    const renderer = createPlainTextRenderer(output, { isTTY });
    const write = (line: string) => renderer.onSystem(line);

    if (initialTarget !== undefined) {
      if (options.session !== undefined) {
        const verdict = await validateSessionForTarget(options.session, initialTarget);
        if (!verdict.ok) throw new CliError(verdict.message, EXIT_INVALID_ARGS);
        state.defaultTarget = initialTarget;
        state.sessions.set(initialTarget.flowKind, options.session);
        write(`Chatting with ${initialTarget.flowKind} · ${initialTarget.actionName} (session ${options.session}, resumed).`);
      } else {
        const { sessionId } = bindTarget(state, initialTarget);
        write(`Chatting with ${initialTarget.flowKind} · ${initialTarget.actionName} (session ${sessionId}).`);
      }
    } else {
      write(`No default target bound. ${targets.length} target${targets.length === 1 ? "" : "s"} available — /targets to list, /use <flow> to bind.`);
    }
    write("Type /help for commands, /exit to quit.");

    const exitCode = await runChatLoop({
      state,
      registry,
      targets,
      builtins: createBuiltinRegistry(),
      renderer,
      stores,
      runtimeConfig,
      userId,
      runtime: runtimeSnapshot,
      validateSessionForTarget,
      input,
      output,
      isTTY,
    });

    process.exitCode = exitCode;
  } finally {
    await dispose?.();
  }
}
