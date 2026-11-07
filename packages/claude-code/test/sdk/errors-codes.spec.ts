/**
 * Each of this package's errors carries a stable `code`, so a host branches
 * on the failure without reading its message. The run's failure codes are
 * emitted into error items and stored, so they keep their values when the
 * classes' names change.
 */
import { describe, expect, it } from "vitest";
import { ClaudeCodeAgentAbortedError, ClaudeCodeAgentRunError, ClaudeCodeSdkNotInstalledError } from "../../src/sdk/index";

describe("the claude-code errors' codes", () => {
  it("are stable values a host can branch on", () => {
    expect(new ClaudeCodeSdkNotInstalledError().code).toBe("CLAUDE_AGENT_SDK_NOT_INSTALLED");
    expect(new ClaudeCodeAgentRunError("failed").code).toBe("CLAUDE_AGENT_RUN_FAILED");
    expect(new ClaudeCodeAgentAbortedError(null).code).toBe("CLAUDE_CODE_AGENT_ABORTED");
  });
});
