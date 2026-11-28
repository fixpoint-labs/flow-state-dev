/**
 * The environment and permissions a Claude Code run started through
 * `claudeCodeHarness()` is handed: exactly Claude Code's pass list, never a
 * server variable outside it, since a run's model has a shell; the working
 * folder's own settings with hooks off; and `plan` mode only on the
 * `claude-code-plan` value. The Claude Code block is replaced by a recorder,
 * so the options the harness hands it are what's read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ options: [] as Array<Record<string, any>> }));
vi.mock("../../src/sdk/agent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  claudeCodeAgent: (options: Record<string, unknown>) => (seen.options.push(options), {}),
}));

const { claudeCodeHarness } = await import("../../src/sdk/harness");
const { CLAUDE_CODE_PASS } = await import("../../src/sdk/env-pass");
const { harnessEnv } = await import("@flow-state-dev/core/harness");

const SECRET = "LAB_SERVER_ONLY_SECRET";
const feeds = { cwd: () => "/tmp/run", worktree: () => "/tmp/run", resume: () => undefined, onSession: () => {}, onUsage: () => {} };

beforeEach(() => {
  seen.options.length = 0;
  vi.stubEnv(SECRET, "server-only");
});
afterEach(() => vi.unstubAllEnvs());

describe("a Claude Code run from claudeCodeHarness()", () => {
  it.each([
    [{}, "claude-code", "acceptEdits"],
    [{ plan: true }, "claude-code-plan", "plan"],
  ])("%o is %s, gets only Claude Code's pass list, project settings with hooks off, in %s mode", (options, id, mode) => {
    const harness = claudeCodeHarness(options);
    expect(harness.id).toBe(id);
    harness.agent(feeds as never);
    const [built] = seen.options;
    expect(Object.keys(built!.env)).not.toContain(SECRET);
    expect(built!.env).toEqual(harnessEnv({ pass: CLAUDE_CODE_PASS }));
    expect(built!.permissionMode).toBe(mode);
    expect(built!.settingSources).toEqual(["project"]);
    expect(built!.settings).toEqual({ disableAllHooks: true });
    expect(built!.recordWork).toBe(true);
    expect(built!.allowedTools).toEqual(["Read", "Write", "Edit", "Bash"]);
  });

  it.each([false, true])("appends extraAllowedTools with plan=%s while keeping project settings and hooks off", (plan) => {
    claudeCodeHarness({
      plan,
      extraAllowedTools: ["Grep", "Glob", "Skill"],
    }).agent(feeds as never);
    const [built] = seen.options;
    expect(built!.allowedTools).toEqual(["Read", "Write", "Edit", "Bash", "Grep", "Glob", "Skill"]);
    expect(built!.permissionMode).toBe(plan ? "plan" : "acceptEdits");
    expect(built!.settingSources).toEqual(["project"]);
    expect(built!.settings).toEqual({ disableAllHooks: true });
  });

  it("forwards host overrides of settingSources", () => {
    claudeCodeHarness({ settingSources: ["project", "user"] }).agent(feeds as never);
    const [built] = seen.options;
    expect(built!.settingSources).toEqual(["project", "user"]);
    expect(built!.settings).toEqual({ disableAllHooks: true });
  });

  it("keeps only the default tool list when extraAllowedTools is omitted", () => {
    claudeCodeHarness().agent(feeds as never);
    expect(seen.options.at(-1)!.allowedTools).toEqual(["Read", "Write", "Edit", "Bash"]);
  });
});