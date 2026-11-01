/**
 * The operator's trust in Kitchen Sink's repository (FIX-2421): how the two
 * settings beside the workspace setting are read, and the line each harness
 * mode's session header shows about what its run loads from the repository.
 *
 * Red states produced before these were trusted:
 *   - read any non-empty `KITCHEN_SINK_HARNESS_TRUSTED` as on: the "only 1" case fails.
 *   - read the names when untrusted: the "off changes nothing" case finds a key.
 *   - skip a bad name instead of saying it: the workspace case reads as on.
 *   - word the Claude Code line from the setting, not the options: the `hooks-on` case reads "hooks off".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { claudeCodeRepoLine, claudeCodeRepoOptions } from "@/lib/claude-code-mode";
import { codexRepoLine } from "@/lib/codex-mode";
import { cursorRepoLine } from "@/lib/cursor-mode";
import { harnessTrust } from "@/lib/harness-trust";
import { readHarnessTrust, readHarnessWorkspace } from "@/lib/harness-workspace";

afterEach(() => vi.unstubAllEnvs());

const TRUSTED = { trusted: true, pass: ["LINEAR_API_KEY", "GH_TOKEN"] } as const;
const UNTRUSTED = { trusted: false, pass: [] } as const;

describe("reading the trust settings", () => {
  it("is off when unset, and only `1` turns it on", () => {
    expect(readHarnessTrust({})).toEqual(UNTRUSTED);
    expect(readHarnessTrust({ KITCHEN_SINK_HARNESS_TRUSTED: "true" })).toEqual(UNTRUSTED);
    expect(readHarnessTrust({ KITCHEN_SINK_HARNESS_TRUSTED: "1" })).toEqual({ trusted: true, pass: [] });
  });

  it("reads the named keys, trimmed and once each", () => {
    expect(
      readHarnessTrust({ KITCHEN_SINK_HARNESS_TRUSTED: "1", KITCHEN_SINK_HARNESS_PASS: " LINEAR_API_KEY, GH_TOKEN,,LINEAR_API_KEY " }),
    ).toEqual(TRUSTED);
  });

  it("off, the names change nothing: no key is passed", () => {
    expect(readHarnessTrust({ KITCHEN_SINK_HARNESS_PASS: "LINEAR_API_KEY" })).toEqual(UNTRUSTED);
  });

  it("is off on Vercel, whatever the settings say", () => {
    expect(readHarnessTrust({ VERCEL: "1", KITCHEN_SINK_HARNESS_TRUSTED: "1", KITCHEN_SINK_HARNESS_PASS: "GH_TOKEN" })).toEqual(UNTRUSTED);
  });

  it("a name that is not a variable name turns the harness modes off, and says which", () => {
    const env = { KITCHEN_SINK_HARNESS_TRUSTED: "1", KITCHEN_SINK_HARNESS_PASS: "GH_TOKEN,$(id)" };
    expect(readHarnessTrust(env)).toMatchObject({ trusted: false, pass: [], reason: expect.stringContaining('"$(id)"') });
    expect(readHarnessWorkspace({ ...env, NODE_ENV: "development" }, process.cwd())).toEqual({
      ok: false,
      reason: expect.stringContaining("KITCHEN_SINK_HARNESS_PASS"),
    });
  });

  it("the goal control `untrusted` reads the server as untrusted, in test mode only", () => {
    vi.stubEnv("KITCHEN_SINK_HARNESS_TRUSTED", "1");
    vi.stubEnv("KITCHEN_SINK_HARNESS_PASS", "GH_TOKEN");
    vi.stubEnv("GOAL_CONTROL", "untrusted");
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
    expect(harnessTrust()).toEqual({ trusted: true, pass: ["GH_TOKEN"] });
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    expect(harnessTrust()).toEqual(UNTRUSTED);
  });
});

describe("what each session's header says about the repository", () => {
  it("Claude Code: loaded with hooks off when trusted, not loaded when not", () => {
    expect(claudeCodeRepoLine(TRUSTED)).toEqual({ conventions: "loaded, hooks off", keys: ["LINEAR_API_KEY", "GH_TOKEN"] });
    expect(claudeCodeRepoLine(UNTRUSTED)).toEqual({ conventions: "not loaded", keys: [] });
  });

  it("Claude Code: the line follows the options the run gets, so `hooks-on` says hooks on", () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("GOAL_CONTROL", "hooks-on");
    expect(claudeCodeRepoOptions(TRUSTED)).toEqual({ settingSources: ["project"] });
    expect(claudeCodeRepoLine(TRUSTED).conventions).toBe("loaded, hooks on");
  });

  it("Codex: AGENTS.md either way; your MCP servers on only when trusted", () => {
    expect(codexRepoLine(TRUSTED).conventions).toBe("AGENTS.md, with your Codex MCP servers on");
    expect(codexRepoLine(UNTRUSTED).conventions).toBe("AGENTS.md only, your Codex MCP servers off");
  });

  it("Cursor: not loaded, trusted or not, and the named keys still pass", () => {
    expect(cursorRepoLine(TRUSTED)).toEqual({
      conventions: expect.stringMatching(/^not loaded/),
      keys: ["LINEAR_API_KEY", "GH_TOKEN"],
    });
    expect(cursorRepoLine(UNTRUSTED)).toEqual({ conventions: "not loaded", keys: [] });
  });
});
