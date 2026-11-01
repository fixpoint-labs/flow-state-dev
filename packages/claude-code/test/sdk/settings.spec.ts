/**
 * `claudeCodeAgent({ settings })`: a settings layer the host hands a run.
 *
 * The case it exists for is a host that trusts the repository a run works in:
 * `settingSources: ["project"]` loads its `CLAUDE.md` and skills, but also its
 * hooks, which run by themselves and show in no transcript. The SDK's own
 * settings sit above the project's, so `{ disableAllHooks: true }` there keeps
 * the conventions and stops the hooks.
 *
 * The first half drives the **installed Agent SDK** against a fake CLI that
 * records its arguments, so the claim is about how a real run is started, not
 * about the options object the block builds. The second half pins how the
 * layer merges with the one `mcpTools` already sets.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { claudeCodeAgent, type ClaudeCodeAgentOptions } from "../../src/sdk/agent";
import type {
  ClaudeAgentQuery,
  ClaudeAgentQueryOptions,
  ResolveClaudeAgent,
  SdkMessageLike,
} from "../../src/sdk/types";

const FAKE_CLI = resolve(import.meta.dirname, "fake-claude-argv.mjs");

/** The real SDK's `query`, pointed at the fake CLI instead of the real one. */
const realSdkWithFakeCli: ResolveClaudeAgent = async () => {
  const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as { query: ClaudeAgentQuery };
  return {
    query: (args) =>
      sdk.query({ ...args, options: { ...args.options, pathToClaudeCodeExecutable: FAKE_CLI } as never }),
  };
};

/** Run the block once in a fresh directory; return the arguments the CLI was started with. */
async function argvSeenByRun(options: Partial<ClaudeCodeAgentOptions>): Promise<string[]> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "claude-settings-")));
  const block = claudeCodeAgent({ ...options, resolveClaudeAgent: realSdkWithFakeCli, cwd: () => dir });
  // The fake exits 1 once it has written the file, so the run fails for that
  // reason and no other; no file means the SDK never reached the spawn.
  const result = await testBlock(block, { input: { prompt: "go" } });
  expect(String(result.error?.message)).toMatch(/exited with code 1/);
  const file = join(dir, "seen-argv.json");
  expect(existsSync(file)).toBe(true);
  return JSON.parse(readFileSync(file, "utf8")) as string[];
}

/**
 * The value the CLI was given for `flag`, as `--flag value` or `--flag=value`
 * (the SDK uses both), or `undefined` when it was not given the flag.
 */
function flagValue(argv: string[], flag: string): string | undefined {
  const joined = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (joined !== undefined) return joined.slice(flag.length + 1);
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

const RESULT_OK: SdkMessageLike = { type: "result", subtype: "success", result: "done", session_id: "sess_settings" };

/** A scripted `query` that records the options the block handed it. */
function scripted(seen: ClaudeAgentQueryOptions[]): ResolveClaudeAgent {
  return () => ({
    query: async function* (args) {
      seen.push(args.options!);
      yield RESULT_OK;
    },
  });
}

describe("settings, through the installed SDK", () => {
  it("starts a project-trusting run with the project's settings and every hook off", async () => {
    const argv = await argvSeenByRun({
      settingSources: ["project"],
      settings: { disableAllHooks: true },
    });

    expect(flagValue(argv, "--setting-sources")).toBe("project");
    expect(JSON.parse(flagValue(argv, "--settings") ?? "null")).toEqual({ disableAllHooks: true });
  }, 30_000);

  it("control: without settings the same run is started with the project's hooks on", async () => {
    // BP-035, the off state: `["project"]` alone is what runs a repository's
    // hooks, so nothing in the arguments may switch them off.
    const argv = await argvSeenByRun({ settingSources: ["project"] });

    expect(flagValue(argv, "--setting-sources")).toBe("project");
    expect(argv.join(" ")).not.toContain("disableAllHooks");
  }, 30_000);
});

describe("settings beside mcpTools", () => {
  it("keeps the host's layer and adds the connector switch mcpTools needs", async () => {
    const seen: ClaudeAgentQueryOptions[] = [];
    await testBlock(
      claudeCodeAgent({ settings: { disableAllHooks: true }, mcpTools: {}, resolveClaudeAgent: scripted(seen) }),
      { input: { prompt: "go" } },
    );

    expect(seen[0]!.settings).toEqual({ disableAllHooks: true, disableClaudeAiConnectors: true });
  });

  it("lets no host layer turn the connectors back on while mcpTools is the run's whole MCP set", async () => {
    // `mcpTools` promises the handed servers and nothing from the account, so
    // its switch wins over a host's own value for the same key.
    const seen: ClaudeAgentQueryOptions[] = [];
    await testBlock(
      claudeCodeAgent({
        settings: { disableAllHooks: true, disableClaudeAiConnectors: false },
        mcpTools: {},
        resolveClaudeAgent: scripted(seen),
      }),
      { input: { prompt: "go" } },
    );

    expect(seen[0]!.settings).toEqual({ disableAllHooks: true, disableClaudeAiConnectors: true });
  });

  it("hands the host's layer unchanged, and no copy the host could see mutated, when mcpTools is unset", async () => {
    const seen: ClaudeAgentQueryOptions[] = [];
    const settings = { disableAllHooks: true };
    const block = claudeCodeAgent({ settings, resolveClaudeAgent: scripted(seen) });
    await testBlock(block, { input: { prompt: "go" } });
    await testBlock(claudeCodeAgent({ settings, mcpTools: {}, resolveClaudeAgent: scripted(seen) }), {
      input: { prompt: "go" },
    });

    expect(seen[0]!.settings).toEqual({ disableAllHooks: true });
    // The mcpTools merge built a new object rather than writing into the host's.
    expect(settings).toEqual({ disableAllHooks: true });
  });
});
