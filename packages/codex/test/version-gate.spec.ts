/**
 * Decision 1's enforcement: the block refuses to be BUILT against any installed
 * Codex SDK but the exact version this package was tested against.
 *
 * The wire sits behind `--experimental-json` and can change in a lockstep
 * CLI+SDK release, so a host must not be able to run an untested wire without a
 * release from us. There is no override option — that is the point — so the
 * only seam here is how the installed version is READ, which is what lets these
 * specs exercise versions that are not the one on disk.
 */
import { describe, it, expect } from "vitest";
import { codexAgent } from "../src/agent";
import { CodexSdkVersionMismatchError } from "../src/errors";
import { TESTED_SDK_VERSION } from "../src/types";

describe("the installed-SDK version gate", () => {
  it("refuses at build time when the installed SDK is not the tested version", () => {
    expect(() => codexAgent({ readInstalledSdkVersion: () => "0.153.4" })).toThrow(
      CodexSdkVersionMismatchError,
    );
  });

  it("names BOTH versions and the upgrade path, so the error is actionable", () => {
    let message = "";
    try {
      codexAgent({ readInstalledSdkVersion: () => "0.153.4" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("0.153.4");
    expect(message).toContain(TESTED_SDK_VERSION);
    expect(message).toMatch(/release/i);
  });

  it("builds when the installed SDK is exactly the tested version", () => {
    expect(() => codexAgent({ readInstalledSdkVersion: () => TESTED_SDK_VERSION })).not.toThrow();
  });

  it("builds when no SDK is installed — a missing SDK has no version to check", () => {
    // §9: absence stays the first-RUN install hint, not a build-time refusal,
    // because a block can legitimately be constructed on a host that never runs it.
    expect(() => codexAgent({ readInstalledSdkVersion: () => null })).not.toThrow();
  });

  it("reads the version off the SDK actually installed in this workspace", async () => {
    const { readInstalledCodexSdkVersion } = await import("../src/codex-client");
    // The devDependency is pinned to the tested version, so the default reader
    // must find exactly it — proving the reader works against the real layout
    // and not only against a stub.
    expect(readInstalledCodexSdkVersion()).toBe(TESTED_SDK_VERSION);
  });
});
