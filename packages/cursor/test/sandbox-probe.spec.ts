/**
 * Cursor's sandbox, as a run would find it.
 *
 * The SDK finds `cursorsandbox` by walking up from the running script, not
 * from its own install. Under pnpm that walk misses the helper unless this
 * package depends on the platform packages.
 *
 * Red state produced before this was trusted: without the optional
 * dependencies, the first case fails (no helper on the walk), and the real
 * probe on this Linux host reported the SDK's "not supported" error.
 */
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { probeCursorSandbox } from "../src/sandbox-probe";
import { TESTED_SDK_VERSION } from "../src/types";

const RUNTIME_DIR = resolve(import.meta.dirname, "..", "runtime");

/** The SDK's own search: `node_modules/@cursor/sdk-<platform>-<arch>/bin/<helper>`, walking up from `start`. */
function findHelper(start: string): string | undefined {
  const helper = process.platform === "win32" ? "cursorsandbox.exe" : "cursorsandbox";
  let dir = start;
  const { root } = parse(dir);
  while (dir !== root) {
    const candidate = join(dir, "node_modules", "@cursor", `sdk-${process.platform}-${process.arch}`, "bin", helper);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return undefined;
}

function fixture(source: string): string {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

describe("Cursor's sandbox helper", () => {
  it("is found from the directory the runtime's scripts run in", () => {
    const helper = findHelper(RUNTIME_DIR);
    expect(helper, "no @cursor/sdk platform package on the walk up from runtime/").toBeDefined();
    expect(() => accessSync(helper as string, constants.X_OK)).not.toThrow();
  });

  it("comes from the SDK version this package is tested against", () => {
    // A bump of `@cursor/sdk` that leaves the platform packages behind would
    // pair the SDK with another release's helper.
    const manifest = join(dirname(dirname(findHelper(RUNTIME_DIR) as string)), "package.json");
    expect(JSON.parse(readFileSync(manifest, "utf8")).version).toBe(TESTED_SDK_VERSION);
  });
});

describe("probeCursorSandbox", () => {
  const env = { PATH: process.env.PATH ?? "" };

  it("reports Cursor's own reason when the SDK can't start its sandbox", () => {
    const sdk = fixture(`export async function createAgentPlatform() {
      return { async prewarmLocalWorkspace(o) {
        if (o.local?.sandboxOptions?.enabled !== true) throw new Error("the probe must request the sandbox");
        throw new Error("Local SDK sandboxing was requested, but sandboxing is not supported in this environment.");
      } };
    }`);
    expect(probeCursorSandbox({ cwd: RUNTIME_DIR, env, sdkModule: sdk })).toEqual({
      supported: false,
      reason: "Local SDK sandboxing was requested, but sandboxing is not supported in this environment.",
    });
  });

  it("reports supported when the SDK prepares a sandboxed workspace", () => {
    const sdk = fixture(`export async function createAgentPlatform() {
      return { async prewarmLocalWorkspace(o) {
        if (o.local?.sandboxOptions?.enabled !== true) throw new Error("the probe must request the sandbox");
        return async () => {};
      } };
    }`);
    expect(probeCursorSandbox({ cwd: RUNTIME_DIR, env, sdkModule: sdk })).toEqual({ supported: true });
  });

  it("is unsupported, with the reason, when the SDK can't be loaded", () => {
    const missing = pathToFileURL(resolve(import.meta.dirname, "fixtures/no-such-sdk.mjs")).href;
    const answer = probeCursorSandbox({ cwd: RUNTIME_DIR, env, sdkModule: missing });
    expect(answer).toMatchObject({ supported: false, reason: expect.stringContaining("no-such-sdk") });
  });
});
