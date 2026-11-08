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
 * refused keys) is decided before they are called.
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
      create: (options: CursorCreateOptions & { local?: { cwd?: string } }) =>
        Agent.create(options),
      resume: (agentId: string, options: CursorCreateOptions & { local?: { cwd?: string } }) =>
        Agent.resume(agentId, options),
    };
  };
}
