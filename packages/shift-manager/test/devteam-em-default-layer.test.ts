/**
 * The EM's turn carries Workforce's default worker layer, as every worker on
 * the built-in agent flow does: who it is and who it can reach, then the rule
 * to work things out itself first. The EM runs on Shift Manager's own `em`
 * worker flow, so the layer reaches it only if that flow puts it in its
 * prompt; without it, the worker that turns a request into coding tasks is
 * the one worker told nothing about asking versus acting.
 *
 * Asserted off the system message the EM's model was actually handed, on the
 * real Lab, so the check reaches the prompt the turn sends and not a
 * neighbour of it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { EM_FLOW, EM_TURN } from "../teams/devteam/workforce/flows/workers/em.mts";

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

/** The tool-use rule's stable opener; the rule itself stays internal to workforce. */
const TOOL_USE_OPENER = "Work things out yourself first.";

/** The system message of each call the EM's turn made, in order. */
const systems: string[] = [];

/** The EM's turn: answers in one line, recording what it was told. */
const emModel: GeneratorModel = {
  modelId: "test/em",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep(call: { messages?: Array<{ role: string; content: unknown }> }) {
    const system = (call.messages ?? []).find((message) => message.role === "system");
    systems.push(typeof system?.content === "string" ? system.content : JSON.stringify(system?.content ?? ""));
    return { text: "Noted.", finishReason: "stop" };
  },
} as unknown as GeneratorModel;

const resolver = Object.assign(
  (id: string, block?: string) => {
    if (block === EM_TURN) return emModel;
    throw new Error(`no model in this test: ${block ?? id} asked for one`);
  },
  { resolveId: (id: string) => id },
) as unknown as ModelResolver;

async function open(): Promise<Lab> {
  const harness = selectHarness();
  systems.length = 0;
  opened = await openLab({
    modelResolver: resolver,
    stores: inMemoryStores(),
    harness: harness.slot,
    runTimeoutMs: harness.runTimeoutMs,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-em-default-layer-")), remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    inventory: true,
  });
  return opened;
}

describe("the EM's turn", () => {
  it("starts with the default worker layer, ahead of its team's and its own instructions", async () => {
    const lab = await open();
    const sessionId = `s-em-${globalThis.crypto.randomUUID()}`;
    const created = await lab.door("POST", `${EM_FLOW}/sessions`, { body: { userId: LAB_USER_ID, sessionId, state: { workerId: "eng.em" } } });
    expect(created.status).toBe(201);

    const runtime = await lab.state.getRuntime();
    const result = (await runAction({
      orgId: LAB_ORG_ID,
      flow: runtime.registry.get(EM_FLOW) as FlowInstance,
      actionName: "respond",
      input: { message: "What are you working on?" },
      userId: LAB_USER_ID,
      sessionId,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    } as never)) as { error?: unknown };
    expect(result.error).toBeUndefined();

    const [system] = systems;
    expect(system).toBeDefined();
    // Who it is, by its roster name and team, first: the identity half of the layer.
    expect(system!.startsWith("You are Engineering Manager, on the Engineering team.")).toBe(true);
    // Its delegates, named as ones to file tasks with.
    expect(system).toContain("eng.coder");
    // The ask-versus-act half of the layer, by its stable opener.
    expect(system).toContain(TOOL_USE_OPENER);
    // Its own file's text still follows the layer.
    const own = system!.indexOf("You are the EM on the engineering team.");
    expect(own).toBeGreaterThan(system!.indexOf(TOOL_USE_OPENER));
  });
});
