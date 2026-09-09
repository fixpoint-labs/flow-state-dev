/**
 * FIX-1327 regression: the SKILL-FORCED worker path, end to end.
 *
 * `materialize-agent.test.ts` calls `materializeAgent` directly. This file goes
 * the way a real delegation skill does — `materializeWorker` resolves an
 * `agent-ref` seat through the agent registry and the injected materializer —
 * because that is the path the defect lived on: a seat that declared a
 * capability was built without it. `capabilityCatalog` is optional all the way
 * down that chain, so the wiring is exactly where a seat ends up with nothing
 * to resolve against, and asserting only the direct call would leave it
 * untested.
 */
import { describe, it, expect } from "vitest";
import { defineCapability, FlowError } from "@flow-state-dev/core";
import { materializeWorker } from "@flow-state-dev/orchestration";
import { defineAgent } from "../src/define-agent";
import { createAgentRegistry } from "../src/agent-registry";
import { materializeAgent } from "../src/materialize-agent";
import { AgentCapabilityError } from "../src/errors";

function inspect(block: any) {
  return block.__config ?? block._config ?? block.config ?? block;
}

function reviewer(usesCapabilities: Array<string | ReturnType<typeof defineCapability>>) {
  return defineAgent({
    name: "reviewer",
    description: "Reviews things",
    persona: "You review things.",
    usesCapabilities,
  });
}

/** Seat one agent on a skill board the way a delegation skill would. */
async function seat(
  agent: ReturnType<typeof defineAgent>,
  extraDeps: Record<string, unknown> = {},
) {
  return materializeWorker(
    "reviewer",
    { agentRef: agent.name },
    {
      catalog: {},
      agentRegistry: createAgentRegistry([agent]),
      materializeAgent,
      skillName: "review-skill",
      ...extraDeps,
    } as any,
  );
}

describe("skill-forced worker (FIX-1327)", () => {
  it("carries a declared capability onto the seated worker", async () => {
    const memory = defineCapability({ name: "memory" });
    const block = await seat(reviewer(["memory"]), { capabilityCatalog: { memory } });
    // Still a board worker — the seat shape is unchanged…
    expect(inspect(block).name).toBe("skillWorker_review-skill_reviewer");
    // …and it carries what the agent declared.
    expect(inspect(block).uses ?? []).toContain(memory);
  });

  it("refuses to seat an agent whose capability the skill gave it no way to resolve", async () => {
    // A skill wired with no capability catalog used to seat this agent anyway,
    // stripped of its memory, and run it — no error, no warning. The refusal is
    // what makes the gap visible to whoever wired the board.
    await expect(seat(reviewer(["memory"]))).rejects.toThrow(AgentCapabilityError);
    await expect(seat(reviewer(["memory"]))).rejects.toBeInstanceOf(FlowError);
  });

  it("seats an agent that declares capability references without any catalog", async () => {
    const memory = defineCapability({ name: "memory" });
    const block = await seat(reviewer([memory]));
    expect(inspect(block).uses ?? []).toContain(memory);
  });
});
