/**
 * The block refuses to be BUILT against an installed @anthropic-ai/claude-agent-sdk outside the
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
import { claudeCodeAgent, INTERNAL_SDK_VERSION_READER, type ClaudeCodeAgentOptions } from "../../src/sdk/agent";
import { checkClaudeCodeReadiness } from "../../src/sdk/index";

/** Build against a stated installed-SDK answer, through the private seam. */
const withInstalled = (installed: InstalledSdkVersion): ClaudeCodeAgentOptions =>
  ({ [INTERNAL_SDK_VERSION_READER]: () => installed }) as ClaudeCodeAgentOptions;

/** The range this package peers its SDK at: the range it tested. */
const PEER_RANGE = (JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")) as {
  peerDependencies: Record<string, string>;
}).peerDependencies["@anthropic-ai/claude-agent-sdk"]!;

describe("the installed-SDK version gate", () => {
  it("peers its SDK at a bounded range", () => {
    expect(PEER_RANGE).toBe(">=0.3.316 <0.4.0");
  });

  it.each([
    ["one step below", "0.3.315"],
    ["one step above", "0.4.0"],
  ])("refuses at build time an SDK %s the tested range, naming both versions", (_side, version) => {
    let thrown: unknown;
    try {
      claudeCodeAgent(withInstalled({ kind: "version", version }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessSdkVersionMismatchError);
    expect(thrown).toMatchObject({ sdk: "@anthropic-ai/claude-agent-sdk", installed: version, tested: PEER_RANGE });
    expect((thrown as Error).message).toContain(version);
    expect((thrown as Error).message).toContain(PEER_RANGE);
  });

  it("builds against a version inside the range", () => {
    expect(() => claudeCodeAgent(withInstalled({ kind: "version", version: "0.3.400" }))).not.toThrow();
  });

  it("builds when no SDK is installed: its absence surfaces on the first run", () => {
    expect(() => claudeCodeAgent(withInstalled({ kind: "absent" }))).not.toThrow();
  });

  it("refuses an SDK whose version can't be read", () => {
    expect(() => claudeCodeAgent(withInstalled({ kind: "unreadable", reason: "no manifest on the walk" }))).toThrow(HarnessSdkVersionMismatchError);
  });

  it("readiness refuses the same SDK before a host builds the block", async () => {
    const answer = await checkClaudeCodeReadiness({ env: {}, readInstalledSdkVersion: () => ({ kind: "version", version: "0.4.0" }) });
    expect(answer).toMatchObject({ ready: false, remedy: `Install @anthropic-ai/claude-agent-sdk ${PEER_RANGE}` });
  });
});
