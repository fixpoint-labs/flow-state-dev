/**
 * The seam between this package and `@openai/codex-sdk`, and the version gate
 * that decides whether the installed SDK may be used at all.
 *
 * Two moments, deliberately separate:
 *
 * - **When the block is built** (synchronous): read the installed SDK's version
 *   and refuse one outside the tested range (core's SDK gate). A refusal here is a configuration
 *   error a host sees at wiring time rather than mid-run (decision 1).
 * - **On the first run** (asynchronous): lazily `import()` the SDK and
 *   construct its client. The SDK is an optional peer, so importing this
 *   package on a host that never runs Codex must not fail.
 *
 * Tests inject a scripted client through their own resolver and never touch the
 * real SDK — the shape `claude-code/sdk/sdk-client.ts` already uses.
 */
import { CodexSdkNotInstalledError } from "./errors";
import { readInstalledSdkVersion, type InstalledSdkVersion } from "@flow-state-dev/core/internal";
import type {
  CodexClientOptions,
  ResolveCodexClient,
  ResolvedCodexClient,
} from "./types";

/** The SDK module path. A variable so bundlers don't eagerly resolve it. */
const SDK_MODULE = "@openai/codex-sdk";

/** How the resolver loads the SDK module. Overridable so the absent-SDK path is testable. */
export type CodexSdkImporter = () => Promise<{ Codex?: unknown }>;

const defaultImporter: CodexSdkImporter = () =>
  import(/* @vite-ignore */ SDK_MODULE) as Promise<{ Codex?: unknown }>;

/**
 * Which `@openai/codex-sdk` is installed beside this package, read the way core's
 * SDK gate reads every harness's (`readInstalledSdkVersion`).
 */
export function readInstalledCodexSdkVersion(): InstalledSdkVersion {
  return readInstalledSdkVersion(SDK_MODULE, import.meta.url);
}

/**
 * Build a resolver that loads the SDK via `importSdk` and constructs its client
 * with `clientOptions`. Throws {@link CodexSdkNotInstalledError} when the module
 * cannot be loaded or does not export `Codex`.
 *
 * Exported mainly so a test can supply an importer that rejects; production
 * uses the default the block installs for itself.
 */
export function createDefaultResolveCodexClient(
  clientOptions: CodexClientOptions = {},
  importSdk: CodexSdkImporter = defaultImporter,
): ResolveCodexClient {
  return async (): Promise<ResolvedCodexClient> => {
    let mod: { Codex?: unknown };
    try {
      mod = await importSdk();
    } catch (err) {
      // `String(err)` rather than `err.message`: an import can reject with
      // something that is not an `Error`, and the install hint reading
      // "undefined" would waste the one message a host gets here.
      throw new CodexSdkNotInstalledError(undefined, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    if (typeof mod.Codex !== "function") {
      throw new CodexSdkNotInstalledError(
        "`@openai/codex-sdk` was found but does not export a `Codex` class.",
      );
    }
    const Ctor = mod.Codex as new (options?: CodexClientOptions) => ResolvedCodexClient;
    return new Ctor(clientOptions);
  };
}
