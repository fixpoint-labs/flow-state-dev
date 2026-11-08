/**
 * The block reads the @openai/codex-sdk installed beside this package every time it
 * is built (core's SDK gate). A reader that misread this layout would refuse
 * every build, so it is run here from the package's own location, against the
 * SDK this workspace installs.
 *
 * And the reader the gate takes is the package's alone: no public entry may
 * export the symbol that substitutes it, or a host could answer the gate with
 * a tested version and run an untested wire.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { satisfiesSdkRange } from "@flow-state-dev/core/internal";
import { INTERNAL_CODEX_SDK_VERSION_READER } from "../src/agent";
import { readInstalledCodexSdkVersion } from "../src/codex-client";

const PACKAGE_DIR = join(import.meta.dirname, "..");
const MANIFEST = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as {
  peerDependencies: Record<string, string>;
  exports: Record<string, string | { default: string }>;
};

describe("the installed-SDK reader, on this workspace", () => {
  it("finds the SDK installed here, at a version inside the range the package peers at", () => {
    const installed = readInstalledCodexSdkVersion();
    expect(installed.kind, JSON.stringify(installed)).toBe("version");
    const version = (installed as { version: string }).version;
    expect(satisfiesSdkRange(version, MANIFEST.peerDependencies["@openai/codex-sdk"]!), version).toBe(true);
  });
});

describe("the version gate's reader seam", () => {
  it("is exported by no entry of the package's exports map", async () => {
    const entries = Object.entries(MANIFEST.exports);
    expect(entries.length).toBeGreaterThan(0);
    for (const [subpath, target] of entries) {
      const file = typeof target === "string" ? target : target.default;
      const entry = (await import(pathToFileURL(join(PACKAGE_DIR, file)).href)) as Record<string, unknown>;
      expect(Object.keys(entry), subpath).not.toContain("INTERNAL_CODEX_SDK_VERSION_READER");
      for (const [name, value] of Object.entries(entry)) expect(value, `${subpath} exports it as ${name}`).not.toBe(INTERNAL_CODEX_SDK_VERSION_READER);
    }
  });
});
