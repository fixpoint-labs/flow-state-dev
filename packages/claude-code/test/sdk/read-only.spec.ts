/**
 * `claudeCodeAgent({ access })` (FIX-2900): a run fed `read-only` reaches the
 * SDK with reading tools only, whatever the host's option bag allows, and loads
 * nothing from its checkout that could widen that or start a process.
 *
 * The first half reads the options the block hands a scripted `query`. The
 * second drives the installed Agent SDK against a fake CLI that records its
 * arguments, so the claim is about how a real run is started.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import type { HarnessAccess } from "@flow-state-dev/core/harness";
import { claudeCodeAgent, type ClaudeCodeAgentOptions } from "../../src/sdk/agent";
import { claudeCodeHarness } from "../../src/sdk/harness";
import type { ClaudeCodeQuery, ClaudeCodeQueryOptions, ClaudeCodeSdkMessage, ResolveClaudeCodeAgent } from "../../src/sdk/types";

const RESULT_OK: ClaudeCodeSdkMessage = { type: "result", subtype: "success", result: "done", session_id: "sess_read_only" };

/** A scripted `query` that records the options the block handed it. */
function scripted(seen: ClaudeCodeQueryOptions[]): ResolveClaudeCodeAgent {
  return () => ({
    query: async function* (args) {
      seen.push(args.options!);
      yield RESULT_OK;
    },
  });
}

/** The kit's own option bag: what `claudeCodeHarness()` hands every run, plus an approval seam. */
const KIT: Partial<ClaudeCodeAgentOptions> = {
  allowedTools: ["Read", "Write", "Edit", "Bash"],
  permissionMode: "acceptEdits",
  settingSources: ["project"],
  settings: { disableAllHooks: false, permissions: { allow: ["Bash"] } },
  onToolApproval: () => ({ decision: "allow" }),
};

async function optionsFor(access: HarnessAccess | undefined, options: Partial<ClaudeCodeAgentOptions> = KIT): Promise<ClaudeCodeQueryOptions> {
  const seen: ClaudeCodeQueryOptions[] = [];
  const result = await testBlock(
    claudeCodeAgent({ ...options, ...(access === undefined ? {} : { access: () => access }), resolveClaudeAgent: scripted(seen) }),
    { input: { prompt: "go" } },
  );
  expect(result.error ?? null).toBeNull();
  return seen[0]!;
}

describe("a read-only Claude Code run", () => {
  it("is offered Read, Grep and Glob only, in dontAsk, over the host's tools, mode and approval seam", async () => {
    const options = await optionsFor("read-only");
    expect(options.tools).toEqual(["Read", "Grep", "Glob"]);
    expect(options.allowedTools).toEqual(["Read", "Grep", "Glob"]);
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.canUseTool).toBeUndefined();
  });

  it("loads no checkout settings, hooks or MCP servers, and relays no host MCP tools", async () => {
    let relayed = 0;
    const options = await optionsFor("read-only", { ...KIT, mcpTools: () => ((relayed += 1), {}) });
    expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.mcpServers).toEqual({});
    expect(options.settings).toMatchObject({ disableAllHooks: true, disableClaudeAiConnectors: true });
    // Never resolved, so no server the host relays is even connected.
    expect(relayed).toBe(0);
  });

  it("control: a full run, and a run with no access feed, get the host's options as before", async () => {
    for (const access of ["full", undefined] as const) {
      const options = await optionsFor(access);
      expect(options.tools).toBeUndefined();
      expect(options.permissionMode).toBe("acceptEdits");
      expect(options.allowedTools).toEqual(expect.arrayContaining(["Read", "Write", "Edit", "Bash"]));
      expect(options.settingSources).toEqual(["project"]);
      expect(options.canUseTool).toBeTypeOf("function");
    }
  });

  it("the block declares enforcesReadOnly, and the harness feeds it access", async () => {
    expect(claudeCodeAgent({}).enforcesReadOnly).toBe(true);
    const feeds = { cwd: () => "/tmp/run", worktree: () => "/tmp/run", resume: () => null, onSession: () => {}, onUsage: () => {}, access: () => "read-only" as const };
    expect(claudeCodeHarness().agent(feeds).enforcesReadOnly).toBe(true);
  });
});

const FAKE_CLI = resolve(import.meta.dirname, "fake-claude-argv.mjs");
const realSdkWithFakeCli: ResolveClaudeCodeAgent = async () => {
  const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as { query: ClaudeCodeQuery };
  return { query: (args) => sdk.query({ ...args, options: { ...args.options, pathToClaudeCodeExecutable: FAKE_CLI } as never }) };
};
const flagValue = (argv: string[], flag: string): string | undefined => {
  const joined = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (joined !== undefined) return joined.slice(flag.length + 1);
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

describe("a read-only Claude Code run, through the installed SDK", () => {
  it("starts the CLI with the reading tools, dontAsk, no setting sources and the strict MCP set", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "claude-read-only-")));
    const block = claudeCodeAgent({ ...KIT, access: () => "read-only", resolveClaudeAgent: realSdkWithFakeCli, cwd: () => dir });
    const result = await testBlock(block, { input: { prompt: "go" } });
    expect(String(result.error?.message)).toMatch(/exited with code 1/);
    const file = join(dir, "seen-argv.json");
    expect(existsSync(file)).toBe(true);
    const argv = JSON.parse(readFileSync(file, "utf8")) as string[];
    expect(flagValue(argv, "--tools")).toBe("Read,Grep,Glob");
    expect(flagValue(argv, "--permission-mode")).toBe("dontAsk");
    expect(flagValue(argv, "--setting-sources")).toBe("");
    expect(argv).toContain("--strict-mcp-config");
  }, 30_000);
});
