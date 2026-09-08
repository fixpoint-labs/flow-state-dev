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
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexSdkNotInstalledError, CodexSdkVersionMismatchError } from "./errors";
import { TESTED_SDK_VERSION } from "./types";
import type {
  CodexClientOptions,
  InstalledSdkVersion,
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
 * What can be established about the `@openai/codex-sdk` installed beside this
 * package: its version, that there is none, or that we cannot tell.
 *
 * The version comes from walking `node_modules` upward for the SDK's manifest,
 * rather than asking the module resolver, because the resolver cannot answer
 * this question: the SDK's `exports` map publishes only `.` under the `import`
 * condition, so `require.resolve("@openai/codex-sdk/package.json")` throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` on a package that is installed and perfectly
 * usable. The walk is the same one Node performs for a bare specifier, minus the
 * `exports` enforcement, which is not relevant to reading a manifest.
 *
 * **The third answer is the one that matters.** A layout the walk cannot see —
 * Yarn PnP, a custom loader — is not the same fact as "nothing is installed",
 * and reporting it as such let an unvalidated SDK through the very gate that
 * exists to refuse one, while the dynamic import went on loading and running it.
 * So when the walk comes up empty the resolver is asked to distinguish the two,
 * using its failure mode: `MODULE_NOT_FOUND` means there is genuinely nothing
 * there; anything else means the SDK is present and only its version is
 * unknown, which the gate refuses.
 */
export function readInstalledCodexSdkVersion(): InstalledSdkVersion {
  let dir = dirname(fileURLToPath(import.meta.url));
  const { root } = parse(dir);
  for (;;) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(dir, "node_modules", ...SDK_MODULE.split("/"), "package.json"), "utf8"),
      ) as { version?: string };
      if (typeof manifest.version === "string") {
        return { kind: "version", version: manifest.version };
      }
    } catch {
      // Not installed at this level, or an unreadable manifest — keep walking.
    }
    if (dir === root) break;
    dir = dirname(dir);
  }

  // The walk found nothing. That is only safe if the SDK is genuinely not
  // installed, so ASK THE RESOLVER rather than assuming it — a layout the walk
  // cannot see would otherwise read as "absent" and pass the gate while the
  // dynamic import went on loading and running the very SDK we failed to check.
  //
  // The resolver's failure mode is the discriminator. `MODULE_NOT_FOUND` means
  // there is nothing there. Anything else — notably `ERR_PACKAGE_PATH_NOT_EXPORTED`,
  // which this package's `exports` map produces for a `require` — means the SDK
  // IS present and we simply could not read its version.
  try {
    createRequire(import.meta.url).resolve(SDK_MODULE);
    return { kind: "unreadable", reason: "its manifest could not be located" };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") {
      return { kind: "absent" };
    }
    return {
      kind: "unreadable",
      reason: `its manifest could not be located and resolving it failed with ${code ?? "an unknown error"}`,
    };
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
  // Nothing installed: no version to check, and no wire to run. The absence
  // surfaces on the first run as an install hint instead (§9).
  if (installed.kind === "absent") return;
  if (installed.kind === "version" && installed.version === TESTED_SDK_VERSION) return;
  throw new CodexSdkVersionMismatchError(
    installed.kind === "version" ? installed.version : null,
    TESTED_SDK_VERSION,
    installed.kind === "unreadable" ? installed.reason : undefined,
  );
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
