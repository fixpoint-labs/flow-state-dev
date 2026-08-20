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

  it("honours detached: true and declares no session-state schema", () => {
    // The half that fails SILENTLY if missed. A capability contributes its
    // `sessionStateSchema` through a channel the task board's block walk cannot
    // see, so a capability still declaring it would re-add the very key the
    // block just stopped declaring — and the board would accept the worker
    // while the collision it refuses is back.
    const cap = createClaudeCodeAgentCapability({ detached: true }) as unknown as {
      sessionStateSchema?: unknown;
      __presetDefs: { tools: { tools: Array<{ config?: { sessionStateSchema?: unknown } }> } };
    };

    expect(cap.sessionStateSchema).toBeUndefined();
    // …and the option reaches the block it wraps, rather than only the
    // capability's own declaration.
    const [tool] = cap.__presetDefs.tools.tools;
    expect(tool.config?.sessionStateSchema).toBeUndefined();
  });

  it("declares the session-state schema when `detached: false`", () => {
    // `capability.ts` reads the option at its OWN site with its own default, so
    // the three states are pinned here too rather than inferred from the
    // block's. `false` and omitted are different values arriving at that read;
    // only asserting both catches a read that collapses one into the other.
    // (The omitted case is the `sdkSessionId`/`sdkAgentRuns` test above.)
    const cap = createClaudeCodeAgentCapability({ detached: false }) as unknown as {
      sessionStateSchema?: unknown;
      __presetDefs: { tools: { tools: Array<{ config?: { sessionStateSchema?: unknown } }> } };
    };

    expect(cap.sessionStateSchema).toBeDefined();
    const [tool] = cap.__presetDefs.tools.tools;
    expect(tool.config?.sessionStateSchema).toBeDefined();
  });
});
