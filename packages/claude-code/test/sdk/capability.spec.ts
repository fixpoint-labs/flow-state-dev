import { describe, it, expect } from "vitest";
import { createClaudeCodeAgentCapability } from "../../src/sdk/capability";

describe("createClaudeCodeAgentCapability", () => {
  it("is a named capability with a default-on tools preset", () => {
    const cap = createClaudeCodeAgentCapability() as unknown as {
      name: string;
      __presetDefs: { tools: { tools: unknown[] }; default: string[] };
    };

    expect(cap.name).toBe("claude-code-agent");
    expect(cap.__presetDefs.default).toContain("tools");
    expect(cap.__presetDefs.tools.tools).toHaveLength(1);
  });

  it("exposes the agent handler block as its tool", () => {
    const cap = createClaudeCodeAgentCapability() as unknown as {
      __presetDefs: { tools: { tools: Array<{ kind: string; name: string }> } };
    };

    const [tool] = cap.__presetDefs.tools.tools;
    expect(tool.kind).toBe("handler");
    expect(tool.name).toBe("claude-code-agent");
  });

  it("declares a session-state schema with sdkSessionId and sdkAgentRuns", () => {
    const cap = createClaudeCodeAgentCapability() as unknown as {
      sessionStateSchema: { parse: (v: unknown) => Record<string, unknown> };
    };

    // Defaults populate both keys when parsing an empty object.
    const parsed = cap.sessionStateSchema.parse({});
    expect(parsed).toMatchObject({ sdkSessionId: null, sdkAgentRuns: [] });
  });
});
