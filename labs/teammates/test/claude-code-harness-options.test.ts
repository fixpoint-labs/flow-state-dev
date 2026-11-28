/** The live host wires skills and search into its Claude harness without loading server-user policy. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Harness } from "@flow-state-dev/core/harness";
import type { ClaudeCodeAgentOptions } from "@flow-state-dev/claude-code";
import { afterEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({
  config: undefined as Parameters<typeof import("@flow-state-dev/engine").createFlowState>[0] | undefined,
  agent: undefined as ClaudeCodeAgentOptions | undefined,
}));
vi.mock("@flow-state-dev/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/engine")>()),
  createFlowState: (config: NonNullable<typeof seen.config>) => { seen.config = config; },
}));
vi.mock("../../../packages/claude-code/src/sdk/agent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  claudeCodeAgent: (options: ClaudeCodeAgentOptions) => { seen.agent = options; return {}; },
}));

const { openTeammates } = await import("../host.mts");
const { harnesses } = await import("@flow-state-dev/harness-manager/kit");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  seen.config = undefined;
  seen.agent = undefined;
});

describe("the host's Claude Code harness", () => {
  it.each(["alice", "bob"])("hands %s's coding runs skills and search with only project settings and hooks off", async (userId) => {
    const dir = mkdtempSync(join(tmpdir(), "teammates-harness-"));
    dirs.push(dir);
    const repo = join(dir, "repo");
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "config", "user.email", "test@test"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "test"]);
    execFileSync("git", ["-C", repo, "commit", "--allow-empty", "-q", "-m", "init"]);
    vi.stubEnv("LAB_SERVER_ONLY_SECRET", "server-only");
    await openTeammates({
      store: join(dir, "store.sqlite"), model: "test/scripted", userId,
      user: (context) => context.request?.headers.get("x-user") ?? undefined,
      workdir: repo, runsRoot: join(dir, "runs"),
    });
    const values = seen.config?.fill?.[harnesses.slots.harnesses] as Harness[];
    const claude = values.find((harness) => harness.id === "claude-code");
    expect(claude).toBeDefined();
    claude!.agent({ cwd: () => repo, worktree: () => repo, resume: () => undefined, onSession: () => {}, onUsage: () => {} } as never);
    expect(seen.agent?.allowedTools).toEqual(["Read", "Write", "Edit", "Bash", "Grep", "Glob", "Skill"]);
    expect(seen.agent?.permissionMode).toBe("acceptEdits");
    expect(seen.agent?.settingSources).toEqual(["project"]);
    expect(seen.agent?.settings).toEqual({ disableAllHooks: true, disableSkillShellExecution: true });
    expect(seen.agent?.env).not.toHaveProperty("LAB_SERVER_ONLY_SECRET");
  });
});