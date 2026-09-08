/**
 * The capability: host opt-in for running Codex, and the shape a generator
 * picks the block up through.
 *
 * The half worth an assertion of its own is what it does NOT declare. The
 * Claude Code capability declares a session-state schema because that package
 * keeps conversation state; this one keeps none — the thread to continue is the
 * host's, reached through the `resume` resolver and written back through
 * `onSession`. A session-state schema here would put state this package does
 * not own back into the flow through the one door a hand-off refusal cannot
 * check.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineCapability, defineResourceCollection } from "@flow-state-dev/core";
import { createCodexAgentCapability } from "../src/capability";
import { INTERNAL_SDK_VERSION_READER, type CodexAgentOptions } from "../src/agent";
import { TESTED_SDK_VERSION } from "../src/types";

const GATE_OFF = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CodexAgentOptions;

describe("createCodexAgentCapability", () => {
  it("is a named capability whose default-on tools preset carries the block", () => {
    const cap = createCodexAgentCapability(GATE_OFF) as unknown as {
      name: string;
      __presetDefs: { tools: { tools: Array<{ name: string }> }; default: string[] };
    };

    expect(cap.name).toBe("codex-agent");
    expect(cap.__presetDefs.default).toContain("tools");
    expect(cap.__presetDefs.tools.tools).toHaveLength(1);
    expect(cap.__presetDefs.tools.tools[0].name).toBe("codex-agent");
  });

  it("declares NO session state — this package keeps none (decision 2)", () => {
    const cap = createCodexAgentCapability(GATE_OFF) as unknown as {
      sessionStateSchema?: unknown;
    };
    expect(cap.sessionStateSchema).toBeUndefined();
  });

  it("forwards its options to the block, so the version gate still refuses here", () => {
    expect(() =>
      createCodexAgentCapability({
        [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: "0.153.4" }),
      } as CodexAgentOptions),
    ).toThrow();
  });

  it("promotes a resource-declaring `uses` capability's resources onto itself", () => {
    // `uses` installs the capability on the agent HANDLER, and that handler is a
    // tool inside this capability's preset. A tool's resource declarations reach
    // no flow, so without promotion the capability is live at runtime while
    // `ctx.resources` resolves to nothing and the route 404s — on a build that
    // succeeded and tests that passed. Same seam the Claude Code capability
    // documents at length.
    const notes = defineResourceCollection({
      name: "agent-notes",
      pattern: "agent-notes/**",
      scope: "session",
      stateSchema: z.object({ path: z.string().nullable().default(null) }),
    });
    const withResources = defineCapability({ name: "note-taking", resources: { "agent-notes": notes } });

    const cap = createCodexAgentCapability({ ...GATE_OFF, uses: [withResources] }) as unknown as {
      resources?: Record<string, unknown>;
    };
    expect(Object.keys(cap.resources ?? {})).toContain("agent-notes");
  });
});
