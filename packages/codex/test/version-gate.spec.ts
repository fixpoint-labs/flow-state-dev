/**
 * The block refuses to be BUILT against an installed @openai/codex-sdk outside the
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
import { codexAgent, INTERNAL_SDK_VERSION_READER, type CodexAgentOptions } from "../src/agent";
import { checkCodexReadiness } from "../src/index";

/** Build against a stated installed-SDK answer, through the private seam. */
const withInstalled = (installed: InstalledSdkVersion): CodexAgentOptions =>
  ({ [INTERNAL_SDK_VERSION_READER]: () => installed }) as CodexAgentOptions;

/** The range this package peers its SDK at: the range it tested. */
const PEER_RANGE = (JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as {
  peerDependencies: Record<string, string>;
}).peerDependencies["@openai/codex-sdk"]!;

describe("the installed-SDK version gate", () => {
  it("peers its SDK at a bounded range", () => {
    expect(PEER_RANGE).toBe("0.164.0");
  });

  it.each([
    ["one step below", "0.163.0"],
    ["one step above", "0.164.1"],
  ])("refuses at build time an SDK %s the tested range, naming both versions", (_side, version) => {
    let thrown: unknown;
    try {
      codexAgent(withInstalled({ kind: "version", version }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessSdkVersionMismatchError);
    expect(thrown).toMatchObject({ sdk: "@openai/codex-sdk", installed: version, tested: PEER_RANGE });
    expect((thrown as Error).message).toContain(version);
    expect((thrown as Error).message).toContain(PEER_RANGE);
  });

  it("builds against a version inside the range", () => {
    expect(() => codexAgent(withInstalled({ kind: "version", version: "0.164.0" }))).not.toThrow();
  });

  it("builds when no SDK is installed: its absence surfaces on the first run", () => {
    expect(() => codexAgent(withInstalled({ kind: "absent" }))).not.toThrow();
  });

  it("refuses an SDK whose version can't be read", () => {
    expect(() => codexAgent(withInstalled({ kind: "unreadable", reason: "no manifest on the walk" }))).toThrow(HarnessSdkVersionMismatchError);
  });

  it("readiness refuses the same SDK before a host builds the block", async () => {
    const answer = await checkCodexReadiness({ env: {}, readInstalledSdkVersion: () => ({ kind: "version", version: "0.164.1" }) });
    expect(answer).toMatchObject({ ready: false, remedy: `Install @openai/codex-sdk ${PEER_RANGE}` });
  });
});
