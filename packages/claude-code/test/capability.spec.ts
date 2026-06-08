import { describe, it, expect } from "vitest";
import { createClaudeCliCapability } from "../src/cli/capability";

describe("createClaudeCliCapability", () => {
  it("is a named capability with a default-on tools preset", () => {
    const cap = createClaudeCliCapability() as unknown as {
      name: string;
      __presetDefs: { tools: { tools: unknown[] }; default: string[] };
    };

    expect(cap.name).toBe("claude-cli");
    expect(cap.__presetDefs.default).toContain("tools");
    expect(cap.__presetDefs.tools.tools).toHaveLength(1);
  });

  it("exposes the dispatch handler block as its tool", () => {
    const cap = createClaudeCliCapability() as unknown as {
      __presetDefs: { tools: { tools: Array<{ kind: string; name: string }> } };
    };

    const [tool] = cap.__presetDefs.tools.tools;
    expect(tool.kind).toBe("handler");
    expect(tool.name).toBe("claude-remote-dispatch");
  });
});
