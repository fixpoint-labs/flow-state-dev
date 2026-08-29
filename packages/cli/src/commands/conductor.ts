/**
 * `fsdev conductor` — operator surface for a `kind: "conductor"` flow.
 *
 * Same prelude as `fsdev run` / `fsdev chat`: load the app's `fsdev.config.*`
 * (or directory discovery), take its registry, stores, and runtimeConfig, then
 * dispatch the flow's own actions through `runAction`. The TUI is a renderer.
 * It does not host a second conductor.
 */
import { mkdir } from "node:fs/promises";
import type { Command } from "commander";
import {
  createFlowRegistry,
  createModelResolver,
  type FlowRegistry,
  type RuntimeConfig,
  type RuntimeLoggerLevel,
  type StoreRegistry,
} from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import type { ModelResolver } from "@flow-state-dev/core/types";
import {
  resolveRuntimeSource,
  assertNoFlowDirWithConfig,
  createCliLogger,
  installCliLogger,
  resolveLogLevel,
} from "../resolve-runtime";
import { forceModelResolver } from "../model-override";
import { formatFailedImportSection } from "../resolve-flow";
import { CliError } from "../resolve-block";
import {
  EXIT_INVALID_ARGS,
  EXIT_CONFIG_ERROR,
  EXIT_DISCOVERY_ERROR,
  EXIT_INTERNAL_ERROR,
} from "../exit-codes";
import { collectValues } from "../cli-options";
import { parseArgv, HELP_TEXT } from "../conductor/parse";
import {
  assertConductorActions,
  CONDUCTOR_FLOW_KIND,
  DEFAULT_SESSION_ID,
  DEFAULT_USER_ID,
  type ConductorDispatch,
} from "../conductor/dispatch";
import { runConductorHeadless } from "../conductor/headless";
import { runConductorTui } from "../conductor/loop";

/** Registers `fsdev conductor [verb…]` on the given commander program. */
export function registerConductorCommand(program: Command): void {
  program
    .command("conductor [args...]")
    .description("Drive a conductor flow: live board and coordinator talk, or headless seed/wake/status/answer/steer/abort")
    .option("-s, --session <id>", "Session id used for every wake (default: conductor-operator)")
    .option("-u, --user <id>", "Engine identity (default: cli-user)")
    .option("-m, --model <model>", "Override model for generator blocks run in this process")
    .option("--json", "Headless verbs print JSON")
    .option("--phase <phase>", "Phase for seed/start (default: implement)")
    .option("--flow-dir <path>", "Override flow discovery root (repeatable)", collectValues, undefined)
    .option("--dotenv <path>", "Load a specific .env file (repeatable, resolved from cwd)", collectValues, undefined)
    .option("--config <path>", "Path to an fsdev config file (default: fsdev.config.* in cwd)")
    .option("--no-config", "Ignore fsdev.config.* and use directory discovery")
    .option("--quiet", "Suppress runtime logs on stderr")
    .option("--log-level <level>", "Stderr log level: debug | info | warn | error (board default: silent; headless default: warn)")
    .addHelpText("after", `\n${HELP_TEXT}`)
    .action(async (args: string[] | undefined, options: ConductorCommandOptions) => {
      try {
        process.exitCode = await executeConductorCommand(forwardConductorArgv(args, options), options);
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

export interface ConductorCommandOptions {
  session?: string;
  user?: string;
  model?: string;
  json?: boolean;
  /** Phase for `seed` / `start`. */
  phase?: string;
  flowDir?: string[];
  dotenv?: string[];
  config?: string | boolean;
  quiet?: boolean;
  logLevel?: RuntimeLoggerLevel;
}

/** Internal options for testability — inject stores, resolver, and streams. */
export interface ConductorCommandInternalOptions extends ConductorCommandOptions {
  cwd?: string;
  stores?: StoreRegistry;
  modelResolver?: ModelResolver;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
  pollMs?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Override TTY detection. Tests set this so `start` does not open the TUI. */
  tty?: boolean;
}

function isInteractive(options: ConductorCommandInternalOptions): boolean {
  if (options.tty !== undefined) return options.tty;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  return Boolean(input.isTTY && output.isTTY);
}

/**
 * The board is a fullscreen surface. Engine lines on stderr write over it.
 * Headless verbs keep the warn default so a script still sees a failed drain.
 */
export function conductorDefaultLogLevel(
  invocation: { mode: "tui" } | { mode: "headless"; command: { kind: string } },
  options: ConductorCommandInternalOptions,
): "silent" | "warn" {
  if (invocation.mode === "tui") return "silent";
  if (invocation.command.kind === "start" && isInteractive(options)) return "silent";
  return "warn";
}

/** Where to stand when this cwd has no `kind: "conductor"` flow. */
function missingConductorFlowHint(): string {
  return (
    `This command drives a kind: "conductor" flow. cd into the app that defines one ` +
    `(in this workspace: labs/conductor), or pass --config / --flow-dir pointing at that app, ` +
    `or set CONDUCTOR_CONFIG.`
  );
}

/**
 * `--config` and `--no-config` win. When both are omitted, `CONDUCTOR_CONFIG`
 * is the config path so a product checkout can run `fsdev conductor` after
 * exporting it once.
 */
export function resolveConductorConfigOption(
  config: string | boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | boolean | undefined {
  if (config !== undefined) return config;
  const fromEnv = env.CONDUCTOR_CONFIG?.trim();
  if (fromEnv) return fromEnv;
  return undefined;
}

/**
 * Rebuild the verb argv after Commander has taken its own flags.
 * `--phase` and `--json` are registered on the command so they survive
 * parse; they still have to be put back on the line `parseArgv` reads.
 */
export function forwardConductorArgv(
  args: string[] | undefined,
  options: Pick<ConductorCommandOptions, "json" | "phase">,
): string[] {
  const argv = [...(args ?? [])];
  if (options.json === true) argv.push("--json");
  if (options.phase !== undefined && options.phase !== "") {
    argv.push("--phase", options.phase);
  }
  return argv;
}

/** Core execution. Separated so tests do not go through process.exit. */
export async function executeConductorCommand(
  argv: string[],
  options: ConductorCommandInternalOptions,
): Promise<number> {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    throw new CliError(parsed.message, EXIT_INVALID_ARGS);
  }
  const invocation = parsed.invocation;
  if (invocation === undefined) {
    throw new CliError("internal: parse produced no invocation", EXIT_INTERNAL_ERROR);
  }
  if (invocation.mode === "headless" && invocation.command.kind === "help") {
    (options.output ?? process.stdout).write(`${HELP_TEXT}\n`);
    return 0;
  }

  const resolved = await resolveRuntimeSource({
    cwd: options.cwd,
    config: resolveConductorConfigOption(options.config),
    flowDir: options.flowDir,
    dotenv: options.dotenv,
    // Unrelated apps in this repo fail to import from the root. The miss
    // message should be the hint, not those stack traces.
    warnImportFailures: false,
  });

  let registry: FlowRegistry;
  let stores: StoreRegistry;
  let baseRuntimeConfig: RuntimeConfig | undefined;
  let dispose: (() => Promise<void>) | undefined;

  const defaultLevel = conductorDefaultLogLevel(invocation, options);
  const logger =
    resolved.source === "config"
      ? installCliLogger(resolved.flowState, options, defaultLevel)
      : createCliLogger(resolveLogLevel(options, defaultLevel));

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
    dispose = async () => {
      try {
        await resolved.flowState.dispose();
      } catch (err) {
        process.stderr.write(
          `Warning: failed to dispose fsdev config: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    };
  } else {
    if (resolved.flows.length === 0) {
      const searched = resolved.searchedDirs.join(", ");
      throw new CliError(
        `${missingConductorFlowHint()}\nNo flows found. Searched: ${searched}`,
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
  }

  try {
    const flow = registry.get(CONDUCTOR_FLOW_KIND);
    if (flow === undefined) {
      const kinds = [...new Set(registry.list().map((f) => f.kind))].join(", ") || "(none)";
      const conductorFailures =
        resolved.source === "discovery"
          ? resolved.importFailures.filter((failure) =>
              /(?:^|\/)conductor(?:\/|$)/i.test(failure.filePath),
            )
          : [];
      throw new CliError(
        `${missingConductorFlowHint()}\nFlow "${CONDUCTOR_FLOW_KIND}" not found. Available flows: ${kinds}` +
          formatFailedImportSection(conductorFailures),
        EXIT_DISCOVERY_ERROR,
      );
    }
    try {
      assertConductorActions(flow);
    } catch (err) {
      throw new CliError(err instanceof Error ? err.message : String(err), EXIT_CONFIG_ERROR);
    }
    const epicLabel = flow.id ?? CONDUCTOR_FLOW_KIND;

    let modelResolver: ModelResolver | undefined;
    if (options.modelResolver !== undefined) {
      modelResolver = options.modelResolver;
    } else if (resolved.source === "config") {
      const base = baseRuntimeConfig?.modelResolver ?? createModelResolver();
      modelResolver = options.model !== undefined ? forceModelResolver(base, options.model) : base;
    } else if (options.model !== undefined) {
      modelResolver = forceModelResolver(createModelResolver(), options.model);
    }

    if (baseRuntimeConfig !== undefined) {
      baseRuntimeConfig.logger = logger;
    }
    const runtimeConfig: RuntimeConfig =
      baseRuntimeConfig !== undefined
        ? { ...baseRuntimeConfig, modelResolver, logger }
        : { modelResolver, logger };

    const dispatch: ConductorDispatch = {
      flow,
      stores,
      runtimeConfig,
      userId: options.user ?? DEFAULT_USER_ID,
      sessionId: options.session ?? DEFAULT_SESSION_ID,
    };

    const json = invocation.mode === "headless" ? invocation.json : options.json === true;

    if (invocation.mode === "tui") {
      return await runConductorTui({
        dispatch,
        epicLabel,
        input: options.input,
        output: options.output,
        ...(invocation.issue !== undefined ? { focusIssue: invocation.issue } : {}),
        ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
      });
    }

    // `start` is seed-then-operate. A TTY opens the board; a pipe watches it.
    // Both go through the same actions — this fork is presentation only.
    if (invocation.command.kind === "start" && isInteractive(options)) {
      const seedCode = await runConductorHeadless({
        dispatch,
        command: {
          kind: "seed",
          issue: invocation.command.issue,
          ...(invocation.command.phase !== undefined ? { phase: invocation.command.phase } : {}),
          ...(invocation.command.brief !== undefined ? { brief: invocation.command.brief } : {}),
        },
        json: false,
        stdout: options.output,
        stderr: options.stderr,
      });
      if (seedCode !== 0) return seedCode;
      return await runConductorTui({
        dispatch,
        epicLabel,
        input: options.input,
        output: options.output,
        focusIssue: invocation.command.issue,
        ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
      });
    }

    return await runConductorHeadless({
      dispatch,
      command: invocation.command,
      json,
      stdout: options.output,
      stderr: options.stderr,
      ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
      ...(options.maxPolls !== undefined ? { maxPolls: options.maxPolls } : {}),
      ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
    });
  } finally {
    if (dispose !== undefined) await dispose();
  }
}
