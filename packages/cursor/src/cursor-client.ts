/**
 * The seam between this package and `@cursor/sdk`, and the version gate that
 * decides whether the installed SDK may be used at all.
 *
 * Two moments, deliberately separate:
 *
 * - **When the block is built** (synchronous): read the installed SDK's version
 *   and refuse one outside the tested range (core's SDK gate). A refusal here is a configuration
 *   error a host sees at wiring time rather than mid-run.
 * - **On the first run** (asynchronous): lazily `import()` the SDK and take its
 *   `Agent` entry point. The SDK is an optional peer, so importing this package
 *   on a host that never runs Cursor must not fail — and the SDK pulls a
 *   platform-specific native runtime, which is not something to load eagerly.
 *
 * Tests inject a scripted client through their own resolver and never touch the
 * real SDK — the shape `codex/codex-client.ts` already uses.
 */
import { CursorSdkNotInstalledError } from "./errors";
import { readInstalledSdkVersion, type InstalledSdkVersion } from "@flow-state-dev/core/internal";
import type {
  CursorAgentLike,
  CursorCreateOptions,
  ResolveCursorClient,
  ResolvedCursorClient,
} from "./types";

/** The SDK module path. A variable so bundlers don't eagerly resolve it. */
const SDK_MODULE = "@cursor/sdk";

/** The static `Agent` entry point this package drives, as the SDK exports it. */
interface SdkAgentStatics {
  create(options: unknown): Promise<CursorAgentLike>;
  resume(agentId: string, options?: unknown): Promise<CursorAgentLike>;
  listRuns?(
    agentId: string,
    options: SdkLocalRunOptions & { cursor?: string },
  ): Promise<{ items: Array<{ id: string; status: string }>; nextCursor?: string }>;
  cancelRun?(runId: string, options: SdkLocalRunOptions): Promise<void>;
}

/** Where the SDK finds a local agent's runs: its store is keyed by the agent's directory. */
interface SdkLocalRunOptions {
  runtime: "local";
  cwd?: string;
}

/**
 * Cancel every run the local store records as running on `agentId`, through
 * the SDK's `Agent.listRuns` and `Agent.cancelRun`: each marks the run
 * cancelled and frees the agent for its next run (measured against 1.0.40).
 * Resolves with how many it cancelled; `0` when the SDK has neither call.
 *
 * `runtime/cursor-runtime-child.mjs` carries the same steps for a run in the
 * child process; it is plain JavaScript and can't import this.
 */
export async function releaseActiveRuns(
  Agent: Pick<SdkAgentStatics, "listRuns" | "cancelRun">,
  agentId: string,
  cwd: string | undefined,
): Promise<number> {
  if (typeof Agent.listRuns !== "function" || typeof Agent.cancelRun !== "function") return 0;
  const where: SdkLocalRunOptions = { runtime: "local", ...(cwd === undefined ? {} : { cwd }) };
  const running: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await Agent.listRuns(agentId, { ...where, ...(cursor === undefined ? {} : { cursor }) });
    for (const run of page.items) if (run.status === "running") running.push(run.id);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  for (const runId of running) await Agent.cancelRun(runId, where);
  return running.length;
}

/** The SDK's agent, with the release this package adds beside it. */
function withRelease(Agent: SdkAgentStatics, agent: CursorAgentLike, cwd: string | undefined): CursorAgentLike {
  return {
    get agentId() {
      return agent.agentId;
    },
    send: (message, options) => agent.send(message, options),
    close: () => agent.close?.(),
    releaseActiveRun: () => releaseActiveRuns(Agent, agent.agentId, cwd),
  };
}

/** How the resolver loads the SDK module. Overridable so the absent-SDK path is testable. */
export type CursorSdkImporter = () => Promise<{ Agent?: unknown }>;

const defaultImporter: CursorSdkImporter = () =>
  import(/* @vite-ignore */ SDK_MODULE) as Promise<{ Agent?: unknown }>;

/**
 * Which `@cursor/sdk` is installed beside this package, read the way core's
 * SDK gate reads every harness's (`readInstalledSdkVersion`).
 */
export function readInstalledCursorSdkVersion(): InstalledSdkVersion {
  return readInstalledSdkVersion(SDK_MODULE, import.meta.url);
}

/**
 * Build a resolver that loads the SDK via `importSdk` and adapts its `Agent`
 * statics to this package's client seam. Throws
 * {@link CursorSdkNotInstalledError} when the module cannot be loaded or does
 * not export a usable `Agent`.
 *
 * The adapter is thin on purpose: `create` and `resume` are the SDK's own, and
 * everything this package decides about them (the directory, the resumed id, the
 * refused keys) is decided before they are called. The one addition is the
 * agent's `releaseActiveRun`, over the SDK's own run calls.
 *
 * Exported mainly so a test can supply an importer that rejects; production uses
 * the default the block installs for itself.
 */
export function createDefaultResolveCursorClient(
  importSdk: CursorSdkImporter = defaultImporter,
): ResolveCursorClient {
  return async (): Promise<ResolvedCursorClient> => {
    let mod: { Agent?: unknown };
    try {
      mod = await importSdk();
    } catch (err) {
      // `String(err)` rather than `err.message`: an import can reject with
      // something that is not an `Error`, and the install hint reading
      // "undefined" would waste the one message a host gets here.
      throw new CursorSdkNotInstalledError(undefined, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    const Agent = mod.Agent as SdkAgentStatics | undefined;
    if (typeof Agent?.create !== "function" || typeof Agent?.resume !== "function") {
      throw new CursorSdkNotInstalledError(
        "`@cursor/sdk` was found but does not export an `Agent` with `create` and `resume`.",
      );
    }
    return {
      create: async (options: CursorCreateOptions & { local?: { cwd?: string } }) =>
        withRelease(Agent, await Agent.create(options), options.local?.cwd),
      resume: async (agentId: string, options: CursorCreateOptions & { local?: { cwd?: string } }) =>
        withRelease(Agent, await Agent.resume(agentId, options), options.local?.cwd),
    };
  };
}
