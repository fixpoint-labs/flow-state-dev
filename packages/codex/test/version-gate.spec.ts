/**
 * Decision 1's enforcement: the block refuses to be BUILT against any installed
 * Codex SDK but the exact version this package was tested against.
 *
 * The wire sits behind `--experimental-json` and can change in a lockstep
 * CLI+SDK release, so a host must not be able to run an untested wire without a
 * release from us. There is no override option — that is the point — so the
 * only seam here is how the installed version is READ, and it is keyed by a
 * symbol the package root does not export. A host that could substitute a reader
 * could answer with the tested version and defeat the whole guarantee, which is
 * why these specs reach for the module's own internals rather than an option.
 *
 * The gate FAILS CLOSED. Three answers, not two: nothing installed is safe, the
 * tested version is safe, and "I cannot tell" is refused — because an SDK the
 * walk cannot see is still an SDK the dynamic import will happily load and run.
 */
import { describe, it, expect } from "vitest";
import { codexAgent, INTERNAL_SDK_VERSION_READER, type CodexAgentOptions } from "../src/agent";
import { CodexSdkVersionMismatchError } from "../src/errors";
import { TESTED_SDK_VERSION, type InstalledSdkVersion } from "../src/types";

/** Build against a stated installed-SDK answer, through the private seam. */
const withInstalled = (installed: InstalledSdkVersion): CodexAgentOptions =>
  ({ [INTERNAL_SDK_VERSION_READER]: () => installed }) as CodexAgentOptions;

describe("the installed-SDK version gate", () => {
  it("refuses at build time when the installed SDK is not the tested version", () => {
    expect(() => codexAgent(withInstalled({ kind: "version", version: "0.153.4" }))).toThrow(
      CodexSdkVersionMismatchError,
    );
  });

  it("names BOTH versions and the upgrade path, so the error is actionable", () => {
    let message = "";
    try {
      codexAgent(withInstalled({ kind: "version", version: "0.153.4" }));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("0.153.4");
    expect(message).toContain(TESTED_SDK_VERSION);
    expect(message).toMatch(/release/i);
  });

  it("builds when the installed SDK is exactly the tested version", () => {
    expect(() =>
      codexAgent(withInstalled({ kind: "version", version: TESTED_SDK_VERSION })),
    ).not.toThrow();
  });

  it("builds when no SDK is installed — a missing SDK has no version to check", () => {
    // §9: absence stays the first-RUN install hint, not a build-time refusal,
    // because a block can legitimately be constructed on a host that never runs it.
    expect(() => codexAgent(withInstalled({ kind: "absent" }))).not.toThrow();
  });

  it("REFUSES when an SDK is present but its version cannot be read", () => {
    // The fail-open hole: a layout the manifest walk cannot see (Yarn PnP, a
    // custom loader) once read as "absent" and passed the gate, while the
    // dynamic import went on loading and running the very SDK we failed to
    // check. "Nothing is installed" is safe; "I cannot tell" is not.
    expect(() =>
      codexAgent(withInstalled({ kind: "unreadable", reason: "a custom loader" })),
    ).toThrow(CodexSdkVersionMismatchError);
  });

  it("says WHY it could not read the version, so the host can fix the layout", () => {
    let message = "";
    try {
      codexAgent(withInstalled({ kind: "unreadable", reason: "a custom loader" }));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("a custom loader");
    expect(message).toContain(TESTED_SDK_VERSION);
  });

  it("the version reader is NOT reachable from the public options", () => {
    // The guarantee this package sells is that a host cannot run an unvalidated
    // wire. A public seam would make that a claim rather than a guarantee, so
    // the option must not exist under any plausible spelling.
    const publicOptions: CodexAgentOptions = {};
    expect(Object.keys(publicOptions)).not.toContain("readInstalledSdkVersion");
    expect(() =>
      // A host passing the old option name gets the REAL gate, not their answer.
      codexAgent({ readInstalledSdkVersion: () => ({ kind: "absent" }) } as CodexAgentOptions),
    ).not.toThrow();
  });

  it("reads the version off the SDK actually installed in this workspace", async () => {
    const { readInstalledCodexSdkVersion } = await import("../src/codex-client");
    // The devDependency is pinned to the tested version, so the default reader
    // must find exactly it — proving the reader works against the real layout
    // and not only against a stub.
    expect(readInstalledCodexSdkVersion()).toEqual({
      kind: "version",
      version: TESTED_SDK_VERSION,
    });
  });
});
