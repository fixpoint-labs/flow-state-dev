/**
 * The block refuses to be BUILT against an installed @cursor/sdk outside the
 * range this package tested (FIX-2458 D2), through core's one SDK gate.
 *
 * The package translates its vendor's wire, so an untested SDK would produce
 * malformed items, not an error. There is no override option: the seam here
 * is how the installed version is READ, keyed by a symbol no public entry
 * exports. A host that could substitute a reader could answer with a tested
 * version and defeat the guarantee, which is why these specs reach for the
 * module's own internals rather than an option. A host's readiness check does
 * take a reader: a check told the wrong version only misreports, while the
 * block still reads the installed one.
 *
 * The gate FAILS CLOSED: nothing installed is safe, a tested version is safe,
 * and "I cannot tell" is refused.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { HarnessSdkVersionMismatchError, type InstalledSdkVersion } from "@flow-state-dev/core/internal";
import { cursorAgent, INTERNAL_CURSOR_SDK_VERSION_READER, type CursorAgentOptions } from "../src/agent";
import { checkCursorReadiness } from "../src/index";

/** Build against a stated installed-SDK answer, through the private seam. */
const withInstalled = (installed: InstalledSdkVersion): CursorAgentOptions =>
  ({ [INTERNAL_CURSOR_SDK_VERSION_READER]: () => installed }) as CursorAgentOptions;

/** The range this package peers its SDK at: the range it tested. */
const PEER_RANGE = (JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as {
  peerDependencies: Record<string, string>;
}).peerDependencies["@cursor/sdk"]!;

describe("the installed-SDK version gate", () => {
  it("peers its SDK at a bounded range", () => {
    expect(PEER_RANGE).toBe("1.0.40");
  });

  it.each([
    ["one step below", "1.0.39"],
    ["one step above", "1.0.41"],
  ])("refuses at build time an SDK %s the tested range, naming both versions", (_side, version) => {
    let thrown: unknown;
    try {
      cursorAgent(withInstalled({ kind: "version", version }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessSdkVersionMismatchError);
    expect(thrown).toMatchObject({ sdk: "@cursor/sdk", installed: version, tested: PEER_RANGE });
    expect((thrown as Error).message).toContain(version);
    expect((thrown as Error).message).toContain(PEER_RANGE);
  });

  it("builds against a version inside the range", () => {
    expect(() => cursorAgent(withInstalled({ kind: "version", version: "1.0.40" }))).not.toThrow();
  });

  it("builds when no SDK is installed: its absence surfaces on the first run", () => {
    expect(() => cursorAgent(withInstalled({ kind: "absent" }))).not.toThrow();
  });

  it("refuses an SDK whose version can't be read", () => {
    expect(() => cursorAgent(withInstalled({ kind: "unreadable", reason: "no manifest on the walk" }))).toThrow(HarnessSdkVersionMismatchError);
  });

  it("readiness refuses the same SDK before a host builds the block", async () => {
    const answer = await checkCursorReadiness({}, { readInstalledSdkVersion: () => ({ kind: "version", version: "1.0.41" }) });
    expect(answer).toMatchObject({ ready: false, remedy: `npm install @cursor/sdk@${PEER_RANGE}` });
  });
});
