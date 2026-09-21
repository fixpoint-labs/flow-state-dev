/**
 * Third surface: Jev as optional skill-activator tier 3.
 * Package-off leaves slash / keyword; Jev is simply not there.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testBlock, testFlow } from "@flow-state-dev/testing";
import {
  SKILL_ACTIVATOR_FLOW_KIND,
  createSkillActivatorDemoFlow,
  createSystemOneSkillActivator,
} from "../src/skill-activator-flow";
import { SYSTEM_ONE_SKILL_NONE, SYSTEM_ONE_SKILL_QUESTION } from "../src/skill-classifier";
import type { TypeSafeEvaluateOutput } from "../src/schemas";
import { scriptedClient } from "./scripted-client";

const USER = "lab-user";

function skillChoice(name: string, confidence: number): TypeSafeEvaluateOutput {
  return {
    model: "typesafe/jev-1.13-20260917",
    answers: {
      [SYSTEM_ONE_SKILL_QUESTION]: {
        type: "choice",
        choice: name,
        probabilities: { [name]: confidence, [SYSTEM_ONE_SKILL_NONE]: 1 - confidence },
        confidence,
      },
    },
  };
}

describe("skill-activator demo (systemOne on)", () => {
  it("declares status, activate, and activeSkills", () => {
    const { client } = scriptedClient(skillChoice("billing", 0.9));
    const flow = createSkillActivatorDemoFlow({ systemOne: true, client });
    expect(flow.kind).toBe(SKILL_ACTIVATOR_FLOW_KIND);
    expect(Object.keys(flow.actions).sort()).toEqual(["activate", "activeSkills", "status"]);
  });

  it("status reports jev when System One is on", async () => {
    const { client } = scriptedClient(skillChoice("billing", 0.9));
    const flow = createSkillActivatorDemoFlow({ systemOne: true, client });
    const status = await testFlow({
      flow,
      action: "status",
      userId: USER,
      input: {},
      stores: createInMemoryStores(),
    });
    expect(status.status).toBe("completed");
    expect(status.output).toEqual({ systemOne: true, classifier: "jev" });
  });

  it("Jev tier activates a catalog skill when slash and keyword miss", async () => {
    const { client, calls } = scriptedClient(skillChoice("billing", 0.88));
    const flow = createSkillActivatorDemoFlow({ systemOne: true, client });
    const stores = createInMemoryStores();

    const activated = await testFlow({
      flow,
      action: "activate",
      userId: USER,
      input: { message: "the card was charged twice" },
      stores,
      sessionId: "jev-on",
    });
    expect(activated.status).toBe("completed");
    expect(calls).toHaveLength(1);

    const read = await testFlow({
      flow,
      action: "activeSkills",
      userId: USER,
      input: {},
      stores,
      sessionId: "jev-on",
    });
    expect(read.status).toBe("completed");
    expect(read.output).toMatchObject({
      activeSkills: [{ name: "billing", source: "classifier" }],
    });
  });

  it("slash resolves without calling Jev", async () => {
    const { client, calls } = scriptedClient(skillChoice("billing", 0.99));
    const block = createSystemOneSkillActivator({ systemOne: true, client });
    const result = await testBlock(block, { input: { message: "/launch next week" } });
    expect(result.error).toBeNull();
    expect(calls).toHaveLength(0);
    expect(result.state.session.activeSkills).toEqual([
      expect.objectContaining({ name: "launch", source: "slash" }),
    ]);
  });
});

describe("skill-activator demo (systemOne off)", () => {
  it("activator still runs; Jev is not called", async () => {
    const { client, calls } = scriptedClient(skillChoice("billing", 0.99));
    const flow = createSkillActivatorDemoFlow({ systemOne: false, client });
    const stores = createInMemoryStores();

    const status = await testFlow({
      flow,
      action: "status",
      userId: USER,
      input: {},
      stores,
    });
    expect(status.output).toEqual({ systemOne: false, classifier: "off" });

    const activated = await testFlow({
      flow,
      action: "activate",
      userId: USER,
      input: { message: "the card was charged twice" },
      stores,
      sessionId: "jev-off",
    });
    expect(activated.status).toBe("completed");
    expect(calls).toHaveLength(0);

    const read = await testFlow({
      flow,
      action: "activeSkills",
      userId: USER,
      input: {},
      stores,
      sessionId: "jev-off",
    });
    expect(read.output).toEqual({ activeSkills: [] });
  });

  it("slash still activates when System One is off", async () => {
    const { client, calls } = scriptedClient(skillChoice("billing", 0.99));
    const block = createSystemOneSkillActivator({ systemOne: false, client });
    const result = await testBlock(block, { input: { message: "/billing refund please" } });
    expect(result.error).toBeNull();
    expect(calls).toHaveLength(0);
    expect(result.state.session.activeSkills).toEqual([
      expect.objectContaining({ name: "billing", source: "slash" }),
    ]);
  });
});
