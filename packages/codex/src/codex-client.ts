/**
 * The seam between this package and `@openai/codex-sdk`, and the version gate
 * that decides whether the installed SDK may be used at all.
 *
 * Two moments, deliberately separate:
 *
 * - **When the block is built** (synchronous): read the installed SDK's version
 *   and refuse anything but the tested pin. A refusal here is a configuration
 *   error a host sees at wiring time rather than mid-run (decision 1).
 * - **On the first run** (asynchronous): lazily `import()` the SDK and
 *   construct its client. The SDK is an optional peer, so importing this
 *   package on a host that never runs Codex must not fail.
 *
 * Tests inject a scripted client through their own resolver and never touch the
 * real SDK — the shape `claude-code/sdk/sdk-client.ts` already uses.
 */
import { readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexSdkNotInstalledError, CodexSdkVersionMismatchError } from "./errors";
import { TESTED_SDK_VERSION } from "./types";
import type {
  CodexClientOptions,
  InstalledSdkVersionReader,
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
 * Read the version of the `@openai/codex-sdk` installed beside this package, or
 * `null` when none is.
 *
 * Walks `node_modules` upward from this module rather than asking the module
 * resolver, because the resolver cannot answer this question. The SDK's
 * `exports` map publishes only `.` under the `import` condition, so
 * `require.resolve("@openai/codex-sdk/package.json")` throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` and `require.resolve("@openai/codex-sdk")`
 * throws too — on a package that is installed and perfectly usable. Either
 * would read as "not installed" and let an untested wire through the gate,
 * which is the one thing this function exists to prevent.
 *
 * The walk is the same one Node performs for a bare specifier, minus the
 * `exports` enforcement that is not relevant to reading a manifest. An exotic
 * layout the walk cannot see (Yarn PnP) yields `null`, which the gate treats as
 * "no SDK installed" — the run then fails at first use with the install hint
 * rather than silently on a wrong wire.
 */
export function readInstalledCodexSdkVersion(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  const { root } = parse(dir);
  for (;;) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(dir, "node_modules", ...SDK_MODULE.split("/"), "package.json"), "utf8"),
      ) as { version?: string };
      if (typeof manifest.version === "string") return manifest.version;
    } catch {
      // Not installed at this level, or an unreadable manifest — keep walking.
    }
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

/**
 * Decision 1's enforcement. Throws {@link CodexSdkVersionMismatchError} when an
 * SDK is installed at any version but the tested pin; returns quietly when the
 * version matches, and when nothing is installed at all — a missing SDK has no
 * version to check, and its absence surfaces on the first run as an install
 * hint instead (§9).
 */
export function assertTestedSdkVersion(read: InstalledSdkVersionReader): void {
  const installed = read();
  if (installed === null || installed === TESTED_SDK_VERSION) return;
  throw new CodexSdkVersionMismatchError(installed, TESTED_SDK_VERSION);
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
      throw new CodexSdkNotInstalledError(undefined, { cause: (err as Error).message });
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
