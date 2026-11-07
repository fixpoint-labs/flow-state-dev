/**
 * The SDK version gate every harness package calls (FIX-2458 D2).
 *
 * A harness package translates its vendor's wire, so an SDK it never ran
 * against produces malformed items, not an error. Each package names the
 * range it tested (its `peerDependencies` range) and how it reads the SDK
 * installed beside it; this refuses one outside the range, the same way for
 * every harness:
 *
 * - {@link assertTestedSdkVersion} when the block is built, throwing one
 *   {@link HarnessSdkVersionMismatchError} that names the SDK, the harness and
 *   both versions;
 * - {@link sdkVersionReadiness} in the package's readiness check, so a host
 *   learns it before it builds the block.
 *
 * On `core/internal`: our packages call it, and a host's answer is the
 * readiness check, not this class. The class's `code` stays readable to a
 * host that must branch on the thrown error.
 */
import type { HarnessReadiness } from "../types/harness";

/**
 * What can be established about the SDK installed beside a harness package:
 * its version, that there is none, or that it is there and its version can't
 * be read. The gate refuses the third: "nothing installed" is safe, "I cannot
 * tell" is not.
 */
export type InstalledSdkVersion =
  | { kind: "absent" }
  | { kind: "version"; version: string }
  | { kind: "unreadable"; reason: string };

/** How a harness package reads the SDK installed beside it. */
export type InstalledSdkVersionReader = () => InstalledSdkVersion;

/** The SDK a harness package was tested against. */
export interface TestedSdk {
  /** The harness, for a person: `Codex`. */
  harness: string;
  /** The SDK package: `@openai/codex-sdk`. */
  sdk: string;
  /** The range the package tested, its `peerDependencies` range: `0.164.0`, `>=0.3.316 <0.4.0`. */
  range: string;
}

/**
 * The command that installs a tested SDK, safe to paste into a shell: the
 * spec is quoted whenever the range is more than a bare version, since a shell
 * reads `>=` and `<` as redirections.
 */
function installCommand(tested: TestedSdk): string {
  const spec = `${tested.sdk}@${tested.range}`;
  return /^\d+\.\d+\.\d+$/.test(tested.range) ? `npm install ${spec}` : `npm install "${spec}"`;
}

/** A harness's SDK is installed at a version outside the range its package tested. Thrown when the block is built. */
export class HarnessSdkVersionMismatchError extends Error {
  readonly code = "HARNESS_SDK_VERSION_MISMATCH";
  /** The SDK package. */
  readonly sdk: string;
  /** The harness, for a person. */
  readonly harness: string;
  /** The range the package tested. */
  readonly tested: string;
  constructor(
    tested: TestedSdk,
    /** The version installed, or `null` when an SDK is there and its version can't be read. */
    readonly installed: string | null,
    /** Why the version couldn't be read, when it couldn't. */
    readonly unreadableReason?: string,
  ) {
    super(
      (installed === null
        ? `${tested.sdk} is installed, but its version can't be read (${unreadableReason ?? "reason unknown"}).`
        : `${tested.sdk} ${installed} is installed.`) +
        ` The ${tested.harness} harness is tested against ${tested.sdk} ${tested.range}, and refuses an SDK outside it:` +
        ` its wire can change between versions. Install a tested version: ${installCommand(tested)}`,
    );
    this.name = "HarnessSdkVersionMismatchError";
    this.sdk = tested.sdk;
    this.harness = tested.harness;
    this.tested = tested.range;
  }
}

/** A version as three numbers, or `null` for one this can't compare (a prerelease, a tag). */
function parse(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative, zero or positive as `a` is below, at or above `b`. */
function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Whether `version` is inside `range`: space-separated comparators
 * (`>=1.2.3 <1.3.0`) that must all hold, or one exact version (`0.164.0`).
 * Anything this can't compare (a prerelease, an unknown comparator) is
 * outside: the gate refuses what it can't check.
 */
export function satisfiesSdkRange(version: string, range: string): boolean {
  const installed = parse(version);
  if (installed === null) return false;
  const comparators = range.trim().split(/\s+/);
  if (comparators.length === 0 || comparators[0] === "") return false;
  return comparators.every((comparator) => {
    const match = /^(>=|<=|>|<|=)?(.+)$/.exec(comparator);
    const bound = match === null ? null : parse(match[2]!);
    if (match === null || bound === null) return false;
    const order = compare(installed, bound);
    switch (match[1]) {
      case ">=":
        return order >= 0;
      case "<=":
        return order <= 0;
      case ">":
        return order > 0;
      case "<":
        return order < 0;
      default:
        return order === 0;
    }
  });
}

/**
 * Refuse an installed SDK outside the range its package tested. Returns
 * quietly for a version inside it, and when none is installed: a missing SDK
 * has no wire to run, and its absence surfaces on the first run.
 *
 * @throws {@link HarnessSdkVersionMismatchError} for a version outside the range, or one that can't be read.
 */
export function assertTestedSdkVersion(tested: TestedSdk, read: InstalledSdkVersionReader): void {
  const installed = read();
  if (installed.kind === "absent") return;
  if (installed.kind === "version" && satisfiesSdkRange(installed.version, tested.range)) return;
  throw new HarnessSdkVersionMismatchError(
    tested,
    installed.kind === "version" ? installed.version : null,
    installed.kind === "unreadable" ? installed.reason : undefined,
  );
}

/**
 * The version half of a harness's readiness check: `null` when the installed
 * SDK is one the package tested, and not ready with the remedy when none is
 * installed or one outside the range is.
 */
export function sdkVersionReadiness(tested: TestedSdk, read: InstalledSdkVersionReader): HarnessReadiness | null {
  const remedy = installCommand(tested);
  const installed = read();
  if (installed.kind === "absent") return { ready: false, reason: `The ${tested.harness} SDK (${tested.sdk}) is not installed.`, remedy };
  try {
    assertTestedSdkVersion(tested, () => installed);
    return null;
  } catch (error) {
    return { ready: false, reason: (error as Error).message, remedy };
  }
}

/** Node's built-ins, reached at call time so this module loads where there are none (a browser bundle). */
interface NodeBuiltins {
  fs: { readFileSync(path: string, encoding: "utf8"): string };
  path: { dirname(path: string): string; join(...paths: string[]): string; parse(path: string): { root: string } };
  url: { fileURLToPath(url: string): string };
  module: { createRequire(from: string): { resolve(id: string): string } };
}

/** Node's built-ins, or `null` where there are none. */
function nodeBuiltins(): NodeBuiltins | null {
  const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule;
  if (typeof get !== "function") return null;
  return {
    fs: get("node:fs") as NodeBuiltins["fs"],
    path: get("node:path") as NodeBuiltins["path"],
    url: get("node:url") as NodeBuiltins["url"],
    module: get("node:module") as NodeBuiltins["module"],
  };
}

/**
 * The version of `sdk` installed beside the module at `from` (its
 * `import.meta.url`), read from the SDK's manifest by walking `node_modules`
 * up from there, as Node resolves a bare specifier.
 *
 * The walk reads the manifest because the resolver can't always: an SDK whose
 * `exports` map publishes no `./package.json` can't be resolved to it. When
 * the walk finds nothing, the resolver tells "not installed" apart from "a
 * layout the walk can't see" (Yarn PnP, a custom loader): only
 * `MODULE_NOT_FOUND` is absent, anything else is unreadable, which the gate
 * refuses rather than let an unchecked SDK through.
 */
export function readInstalledSdkVersion(sdk: string, from: string): InstalledSdkVersion {
  const node = nodeBuiltins();
  if (node === null) return { kind: "unreadable", reason: "this runtime has no file system to read it from" };
  let dir = node.path.dirname(node.url.fileURLToPath(from));
  const { root } = node.path.parse(dir);
  for (;;) {
    try {
      const manifest = JSON.parse(node.fs.readFileSync(node.path.join(dir, "node_modules", ...sdk.split("/"), "package.json"), "utf8")) as {
        version?: unknown;
      };
      if (typeof manifest.version === "string") return { kind: "version", version: manifest.version };
    } catch {
      // Not installed at this level, or an unreadable manifest: keep walking.
    }
    if (dir === root) break;
    dir = node.path.dirname(dir);
  }
  try {
    node.module.createRequire(from).resolve(sdk);
    return { kind: "unreadable", reason: "its manifest could not be located" };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") return { kind: "absent" };
    return { kind: "unreadable", reason: `its manifest could not be located and resolving it failed with ${code ?? "an unknown error"}` };
  }
}
