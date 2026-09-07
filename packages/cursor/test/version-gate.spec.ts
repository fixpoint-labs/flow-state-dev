/**
 * The version gate: the block refuses to be BUILT against any installed Cursor
 * SDK but the exact version this package was tested against.
 *
 * Cursor's SDK ships its local runtime as a native binary and its message wire
 * can change between patch releases, so a host must not be able to run an
 * untested wire without a release from us. There is no override option — that is
 * the point — so the only seam here is how the installed version is READ, and it
 * is keyed by a symbol the package root does not export. A host that could
 * substitute a reader could answer with the tested version and defeat the whole
 * guarantee, which is why these specs reach for the module's own internals
 * rather than an option.
 *
 * The gate FAILS CLOSED. Three answers, not two: nothing installed is safe, the
 * tested version is safe, and "I cannot tell" is refused — because an SDK the
 * walk cannot see is still an SDK the dynamic import will happily load and run.
 */
import { describe, it, expect } from "vitest";
import { cursorAgent, INTERNAL_SDK_VERSION_READER, type CursorAgentOptions } from "../src/agent";
import { CursorSdkVersionMismatchError } from "../src/errors";
import { TESTED_SDK_VERSION, type InstalledSdkVersion } from "../src/types";

/** Build against a stated installed-SDK answer, through the private seam. */
const withInstalled = (installed: InstalledSdkVersion): CursorAgentOptions =>
  ({ [INTERNAL_SDK_VERSION_READER]: () => installed }) as CursorAgentOptions;

describe("the installed-SDK version gate", () => {
  it("refuses at build time when the installed SDK is not the tested version", () => {
    expect(() => cursorAgent(withInstalled({ kind: "version", version: "1.0.30" }))).toThrow(
      CursorSdkVersionMismatchError,
    );
  });

  it("names BOTH versions and the upgrade path, so the error is actionable", () => {
    let message = "";
    try {
      cursorAgent(withInstalled({ kind: "version", version: "1.0.30" }));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("1.0.30");
    expect(message).toContain(TESTED_SDK_VERSION);
    expect(message).toMatch(/release/i);
  });

  it("builds when the installed SDK is exactly the tested version", () => {
    expect(() =>
      cursorAgent(withInstalled({ kind: "version", version: TESTED_SDK_VERSION })),
    ).not.toThrow();
  });

  it("builds when no SDK is installed — a missing SDK has no version to check", () => {
    // Absence stays the first-RUN install hint, not a build-time refusal, because
    // a block can legitimately be constructed on a host that never runs it.
    expect(() => cursorAgent(withInstalled({ kind: "absent" }))).not.toThrow();
  });

  it("REFUSES when an SDK is present but its version cannot be read", () => {
    // The fail-open hole: a layout the manifest walk cannot see (Yarn PnP, a
    // custom loader) read as "absent" would pass the gate while the dynamic
    // import went on loading and running the very SDK we failed to check.
    // "Nothing is installed" is safe; "I cannot tell" is not.
    expect(() =>
      cursorAgent(withInstalled({ kind: "unreadable", reason: "a custom loader" })),
    ).toThrow(CursorSdkVersionMismatchError);
  });

  it("says WHY it could not read the version, so the host can fix the layout", () => {
    let message = "";
    try {
      cursorAgent(withInstalled({ kind: "unreadable", reason: "a custom loader" }));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("a custom loader");
    expect(message).toContain(TESTED_SDK_VERSION);
  });

  it("a public-looking reader option is ignored — the host gets the REAL gate, not their answer", () => {
    // The guarantee this package sells is that a host cannot run an unvalidated
    // wire. A public seam would make that a claim rather than a guarantee. That
    // the option does not exist on the type is asserted at compile time in
    // `harness-conformance.test-d.ts`; this is the runtime half.
    expect(() =>
      cursorAgent({ readInstalledSdkVersion: () => ({ kind: "absent" }) } as CursorAgentOptions),
    ).not.toThrow();
  });

  it("the private seam is not exported from the package root under any name", async () => {
    const root = await import("../src/index");
    expect(Object.values(root)).not.toContain(INTERNAL_SDK_VERSION_READER);
  });
});
