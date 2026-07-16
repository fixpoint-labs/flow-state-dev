/** Framework-native execution boundary for the trading-desk eval CLI. */
import {
  runAction,
  type ExecutionResult,
  type FlowState,
  type RuntimeLogger,
} from "@flow-state-dev/engine";

const SILENT_LOGGER: RuntimeLogger = {};

export type EvalActionResult = {
  output: unknown;
  /** Preserved for whole-run cost accounting in FIX-792. */
  items: ExecutionResult["items"];
  error: string | null;
};

export type EvalRuntime = {
  run(actionName: string, input: unknown, sessionId: string): Promise<EvalActionResult>;
};

type RuntimeOptions = {
  /** One backing per command. Undefined preserves the app's normal environment. */
  dataDir?: string;
  /** Test seam; production dynamically imports the trading-desk config. */
  loadFlowState?: () => Promise<FlowState>;
};

async function loadTradingDeskFlowState(): Promise<FlowState> {
  return (await import("../fsdev.config")).default;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run one eval command against the app's real registry, stores, and runtime
 * config. The config import happens only after the optional PGlite directory is
 * selected because the app resolves that environment value at module load.
 */
export async function withEvalRuntime<T>(
  options: RuntimeOptions,
  task: (runtime: EvalRuntime) => Promise<T>,
): Promise<T> {
  const previousDataDir = process.env.TRADING_DESK_DATA_DIR;
  // When an explicit eval data dir is requested, mask the deploy database URLs
  // too. `db/portfolio-db.ts` checks `FSD_DB_URL`/`DATABASE_URL` FIRST and takes
  // the shared Postgres branch when either is set — so without masking, a sweep
  // would write fixture sessions into the application/production database and an
  // `--data-dir` read would hit the wrong backing. Deleting them forces the
  // isolated PGlite backing at `TRADING_DESK_DATA_DIR`. Restored in the finally.
  const maskedDbUrls: Array<["FSD_DB_URL" | "DATABASE_URL", string | undefined]> = [];
  if (options.dataDir !== undefined) {
    process.env.TRADING_DESK_DATA_DIR = options.dataDir;
    for (const key of ["FSD_DB_URL", "DATABASE_URL"] as const) {
      maskedDbUrls.push([key, process.env[key]]);
      delete process.env[key];
    }
  }

  let flowState: FlowState | undefined;
  try {
    flowState = await (options.loadFlowState ?? loadTradingDeskFlowState)();
    const resolved = await flowState.getRuntime();
    const flow = resolved.registry.get("analysis");
    if (flow === undefined) {
      throw new Error('Flow "analysis" not found in trading-desk fsdev config');
    }

    const runtime: EvalRuntime = {
      async run(actionName, input, sessionId) {
        try {
          // Existing sessions may have been created by the UI (devuser) rather
          // than this CLI. Reuse the persisted owner so the framework's session
          // identity binding remains intact; new sweep sessions default to the
          // established CLI identity.
          const storedSession = await resolved.stores.session.get(sessionId);
          if (actionName === "runArtifacts" && storedSession === undefined) {
            return {
              output: undefined,
              items: [],
              error: `Session "${sessionId}" not found`,
            };
          }
          const userId = storedSession?.userId ?? "cli-user";
          const result = await runAction({
            flow,
            actionName,
            input,
            userId,
            sessionId,
            stores: resolved.stores,
            // The old `fsdev run --quiet` path suppressed engine traces. Preserve
            // that CLI behavior while forwarding every other app runtime option.
            runtimeConfig: { ...resolved.runtimeConfig, logger: SILENT_LOGGER },
          });
          return {
            output: result.output,
            items: result.items,
            error: result.error === undefined ? null : result.error.message,
          };
        } catch (error) {
          return { output: undefined, items: [], error: errorMessage(error) };
        }
      },
    };

    return await task(runtime);
  } finally {
    try {
      try {
        await flowState?.dispose();
      } finally {
        // The app repository and framework store share a host-owned PGlite
        // instance. FlowState releases its stores; this one-shot host also owns
        // closing the shared backing so Node has no lingering database handle.
        if (options.loadFlowState === undefined) {
          const { disposePortfolioBacking } = await import("../db/portfolio-db");
          await disposePortfolioBacking();
        }
      }
    } finally {
      if (options.dataDir !== undefined) {
        if (previousDataDir === undefined) delete process.env.TRADING_DESK_DATA_DIR;
        else process.env.TRADING_DESK_DATA_DIR = previousDataDir;
        for (const [key, value] of maskedDbUrls) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    }
  }
}
