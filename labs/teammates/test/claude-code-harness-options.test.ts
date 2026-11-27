/**
 * Teammate coding runs on Claude Code load skills and search like a direct
 * `claude` run in the repo, with hooks still off.
 */
import { describe, expect, it } from "vitest";
import { teammatesClaudeCodeHarnessOptions } from "../host.mts";

describe("teammates Claude Code harness options", () => {
  it("pre-approves Skill, Grep and Glob and loads project and user settings", () => {
    expect(teammatesClaudeCodeHarnessOptions.allowedTools).toEqual([
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Grep",
      "Glob",
      "Skill",
    ]);
    expect(teammatesClaudeCodeHarnessOptions.settingSources).toEqual(["project", "user"]);
  });
});