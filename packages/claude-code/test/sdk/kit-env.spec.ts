/**
 * The environment and permissions a Claude Code run started through
 * `claudeCode()`'s harness is handed: exactly Claude Code's pass list, never a
 * server variable outside it, since a run's model has a shell; the working
 * folder's own settings with every hook off; and `plan` mode only on the
 * `claude-code-plan` harness. The Claude Code block is replaced by a
 * recorder, so the options the harness hands it are what's read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ options: [] as Array<Record<string, any>> }));
vi.mock("../../src/sdk/agent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  claudeCodeAgent: (options: Record<string, unknown>) => (seen.options.push(options), {}),
}));

const { claudeCode } = await import("../../src/sdk/kit");
const { CLAUDE_CODE_PASS } = await import("../../src/sdk/env-pass");
const { harnessEnv } = await import("@flow-state-dev/core/harness");
const { harnesses } = await import("@flow-state-dev/harness-manager/kit");

const SECRET = "LAB_SERVER_ONLY_SECRET";
const feeds = { cwd: () => "/tmp/run", resume: () => undefined, onSession: () => {}, onUsage: () => {}, onActivity: () => {} };

beforeEach(() => {
  seen.options.length = 0;
  vi.stubEnv(SECRET, "server-only");
});
afterEach(() => vi.unstubAllEnvs());

/** The harness values `claudeCode(config)` fills the harness kit's slot with. */
function filled(config: { plan?: boolean }) {
  const kit = claudeCode(config);
  const given = kit.definition.contributes!({ config: kit.config as never, slots: {} as never });
  return given[harnesses.slots.harnesses] as Array<{ id: string; agent: (feeds: unknown) => unknown }>;
}

describe("a Claude Code run from claudeCode()", () => {
  it.each([
    ["claude-code", "acceptEdits"],
    ["claude-code-plan", "plan"],
  ])("%s gets only Claude Code's pass list, project settings with hooks off, in %s mode", (id, mode) => {
    filled({ plan: true }).find((harness) => harness.id === id)!.agent(feeds);
    const [built] = seen.options;
    expect(Object.keys(built!.env)).not.toContain(SECRET);
    expect(built!.env).toEqual(harnessEnv({ pass: CLAUDE_CODE_PASS }));
    expect(built!.permissionMode).toBe(mode);
    expect(built!.settingSources).toEqual(["project"]);
    expect(built!.settings).toEqual({ disableAllHooks: true });
  });

  it("fills plan mode only when asked", () => {
    expect(filled({}).map((harness) => harness.id)).toEqual(["claude-code"]);
  });
});
