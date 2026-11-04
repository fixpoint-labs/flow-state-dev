/**
 * The Lab's Claude Code coder starts from Claude Code's own prompt.
 *
 * A plain-string `systemPrompt` replaces Claude Code's preset, and with it
 * what tells the agent to keep a plan: the task inspector's plan then never
 * fills. These checks pin what the coder hands the Claude Code block: the
 * preset with the Lab's brief appended, the search tools named (Claude Code
 * offers them outside its terminal only when they are), and a brief that asks
 * for the commit the implement phase waits on and a report of what changed
 * and what was checked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { handler } from "@flow-state-dev/core";

/** Build the coder with `claudeCodeAgent` replaced, and return the options it was handed. */
async function coderOptions(): Promise<Record<string, unknown>> {
  vi.resetModules();
  const handed: Record<string, unknown>[] = [];
  vi.doMock("@flow-state-dev/claude-code/sdk", async (original) => ({
    ...((await original()) as object),
    claudeCodeAgent: (options: Record<string, unknown>) => (handed.push(options), handler({ name: "x", execute: async () => null } as never)),
  }));
  const { claudeCodeHarness } = await import("../teams/devteam/harness.mts");
  claudeCodeHarness({ cwd: () => "/w", resume: () => null, onSession: () => {} } as never);
  return handed[0]!;
}

afterEach(() => {
  vi.doUnmock("@flow-state-dev/claude-code/sdk");
});

describe("the Lab's Claude Code coder", () => {
  it("keeps Claude Code's own prompt and appends the Lab's brief, so the run still keeps a plan", async () => {
    const options = await coderOptions();
    // A string here would replace the preset; the plan panel depends on the preset.
    expect(typeof options.systemPrompt).not.toBe("string");
    expect(options.systemPrompt).toMatchObject({ type: "preset", preset: "claude_code" });
    const { CODER_BRIEF } = await import("../teams/devteam/harness.mts");
    expect((options.systemPrompt as { append?: string }).append).toBe(CODER_BRIEF);
  });

  it("can search the checkout", async () => {
    const options = await coderOptions();
    expect(options.allowedTools).toEqual(expect.arrayContaining(["Read", "Write", "Edit", "Bash", "Grep", "Glob"]));
  });

  it("is asked to commit and to report what it changed and what it checked, not to do nothing else", async () => {
    const { CODER_BRIEF } = await import("../teams/devteam/harness.mts");
    expect(CODER_BRIEF).toMatch(/commit it with git/);
    expect(CODER_BRIEF).toMatch(/what you changed/);
    expect(CODER_BRIEF).toMatch(/what you checked/);
    expect(CODER_BRIEF).not.toMatch(/Do nothing else/);
  });
});
