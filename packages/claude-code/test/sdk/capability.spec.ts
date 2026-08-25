import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineFlow, generator } from "@flow-state-dev/core";
import { createTestContext } from "@flow-state-dev/testing";
import { createClaudeCodeAgentCapability } from "../../src/sdk/capability";
import { claudeCodeAgent } from "../../src/sdk/agent";

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

/**
 * The capability's own resource declaration.
 *
 * The symptom of getting this wrong is a **404 at read time on a build that
 * succeeded**: the collections exist, the block writes into them, and the read
 * route cannot find them because nothing registered the refs on the flow. So the
 * assertions below are on `flow.resources`, which is the exact map
 * `findResourceConfig` consults before it answers 404.
 */
describe("createClaudeCodeAgentCapability — recordWork", () => {
  /** Build a flow whose one action is a generator holding the capability. */
  function flowUsing(cap: unknown) {
    const gen = generator({
      name: "coder",
      inputSchema: z.string(),
      outputSchema: z.string(),
      model: "demo-model",
      prompt: "do the thing",
      uses: [cap as never],
    });
    return defineFlow({ kind: "recording-flow", actions: { go: { block: gen } } })({
      id: "default",
    }) as unknown as { resources?: Record<string, unknown> };
  }

  it("declares no resources by default", () => {
    const cap = createClaudeCodeAgentCapability() as unknown as { resources?: unknown };
    expect(cap.resources).toBeUndefined();
  });

  it("registers every collection on a flow built through it", () => {
    const flow = flowUsing(createClaudeCodeAgentCapability({ recordWork: true }));
    expect(Object.keys(flow.resources ?? {}).sort()).toEqual([
      "observed-file-ops",
      "observed-gaps",
      "observed-plan",
    ]);
  });

  it("registers NOTHING when the same block only rides in a generator's tools", () => {
    // The contrast that makes the assertion above able to fail — and the reason
    // the capability declares the collections itself instead of forwarding the
    // option and trusting the block it wraps. A generator is a leaf that bubbles
    // none of its tools' rails, so a resource-declaring block sitting in `tools`
    // contributes no declaration at all: the build succeeds, the run writes, and
    // the read route answers 404.
    const gen = generator({
      name: "coder",
      inputSchema: z.string(),
      outputSchema: z.string(),
      model: "demo-model",
      prompt: "do the thing",
      tools: [claudeCodeAgent({ recordWork: true })],
    });
    const flow = defineFlow({
      kind: "forwarding-only-flow",
      actions: { go: { block: gen } },
    })({ id: "default" }) as unknown as { resources?: Record<string, unknown> };

    // The block DID declare them — so the missing piece is provably the
    // tools-don't-bubble step, not a block that declared nothing. Without this
    // half the assertion below would pass on a block that never declared.
    const declaring = claudeCodeAgent({ recordWork: true });
    expect(Object.keys(declaring.declaredResources ?? {})).toContain("observed-file-ops");

    expect(Object.keys(flow.resources ?? {})).not.toContain("observed-file-ops");
    expect(Object.keys(flow.resources ?? {})).not.toContain("observed-plan");
    expect(Object.keys(flow.resources ?? {})).not.toContain("observed-gaps");
  });
});

describe("createClaudeCodeAgentCapability — cwd", () => {
  it("forwards the working-directory resolver to the agent block it exposes", async () => {
    // The capability forwards ALL agent options, so this holds by construction
    // rather than by a line — which is exactly why it is worth pinning. The
    // sibling `detached` / `recordWork` tests exist because forwarding one
    // option and not another fails silently, and a working directory that never
    // reached the query would fail the same way.
    let seen: string | undefined;
    const cap = createClaudeCodeAgentCapability({
      cwd: () => "/work/checkout-a",
      resolveClaudeAgent: () => ({
        query: async function* (args) {
          seen = args.options?.cwd;
          yield {
            type: "result",
            subtype: "success",
            result: "ok",
            session_id: "s",
          } as never;
        },
      }),
    }) as unknown as {
      __presetDefs: {
        tools: {
          tools: Array<{
            config: { execute: (i: unknown, c: unknown) => Promise<unknown> };
          }>;
        };
      };
    };

    const [tool] = cap.__presetDefs.tools.tools;
    const runtime = await createTestContext({});
    await tool.config.execute({ prompt: "go" }, runtime.ctx as never);

    expect(seen).toBe("/work/checkout-a");
  });
});
