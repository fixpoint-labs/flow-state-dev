/**
 * The coordinator's turn carries the task tools once (FIX-1794 V3's must-test,
 * epic ER-32).
 *
 * The coordinator runs the built-in agent's shared worker turn, and its
 * conversation's board puts Orchestration's task tools on it. Core refuses a
 * turn that carries two tools of one name, so a second set (from a skill, a
 * preset, or a second capability instance) would fail every turn of every
 * coordinator. These read the tools the model is actually handed on a real
 * judgment turn, with a skill loaded and without one.
 *
 * The expected set is the task-board capability's own tool list, read off a
 * fresh instance, never a count: a later tool added to the capability joins it
 * here without this test changing.
 */
import { describe, expect, it } from "vitest";
import type { GeneratorTool } from "@flow-state-dev/core";
import { createTaskToolsCapability } from "@flow-state-dev/orchestration";
import { mockGenerator } from "@flow-state-dev/testing";
import { boardWorkers, bootBoardHost, messageOf } from "./conversation-board-harness";

/** The capability's tool list as a turn with no ask host gets it: the list is chosen per turn (FIX-1816). */
const resolvedControlTools = (list: unknown): GeneratorTool[] =>
  (typeof list === "function" ? list({}) : (list ?? [])) as GeneratorTool[];

/** The task-board capability's own tool names, from a fresh instance. */
function taskToolNames(): string[] {
  const capability = createTaskToolsCapability() as unknown as {
    __presetDefs?: { tools?: { controlTools?: unknown } };
  };
  const names = resolvedControlTools(capability.__presetDefs?.tools?.controlTools).map((tool) => tool.config?.name ?? tool.name);
  expect(names.length).toBeGreaterThan(0);
  return names;
}

const SKILL_MD = "---\nname: triage\ndescription: How to triage incoming work.\n---\nSort the work before handing it out.";

/** One judgment turn of `worker`, and the tool names the model was handed on it. */
async function judgmentToolNames(options: { skill: boolean; secondInstance?: "per-turn" }) {
  const seen: string[][] = [];
  const standard = boardWorkers().map((worker) =>
    worker.id === "lead" && options.skill
      ? {
          ...worker,
          declared: { ...worker.declared, skills: { active: ["triage"] } },
          skills: [{ name: "triage", skillMd: SKILL_MD }]
        }
      : worker
  );
  const host = bootBoardHost({
    standard,
    judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] }),
    // A second instance composed per turn, the way a skill or a preset would
    // reach the turn: nothing refuses it before the turn runs.
    ...(options.secondInstance === "per-turn" ? { agent: { uses: [() => [createTaskToolsCapability()]] } } : {}),
    observeTools: (blockName, names) => {
      if (blockName === "coordinator-judgment") seen.push(names);
    }
  });
  try {
    const conv = await host.conversation("alice", "lead");
    const result = await host.act("alice", conv, "run", { message: "what's on the board?" });
    await host.settled();
    return { seen, error: result.error, heard: JSON.stringify(host.judgment.calls.map((call) => call.input)) };
  } finally {
    await host.dispose();
  }
}

describe("the coordinator's turn carries the task tools once (ER-32)", () => {
  for (const skill of [false, true]) {
    it(`carries each task tool exactly once, and runBoard at most once, ${skill ? "with a skill loaded" : "with no skill"}`, async () => {
      const { seen, error, heard } = await judgmentToolNames({ skill });
      expect(error, messageOf(error)).toBeUndefined();
      // The skill is loaded into the turn when the worker names it.
      expect(heard.includes("Sort the work before handing it out.")).toBe(skill);
      expect(seen).toHaveLength(1);
      const [names] = seen as [string[]];
      for (const tool of taskToolNames()) {
        expect(names.filter((name) => name === tool), `${tool} on the turn`).toHaveLength(1);
      }
      // The skills library's own runner went with skill sub-agents (FIX-1814).
      expect(names.filter((name) => name === "runBoard").length).toBeLessThanOrEqual(1);
      // No two tools of one name, of any kind.
      expect(new Set(names).size).toBe(names.length);
    });
  }

  it("is refused, by core, when a second task-tools capability instance joins the turn", async () => {
    const { seen, error } = await judgmentToolNames({ skill: false, secondInstance: "per-turn" });
    expect(seen).toEqual([]);
    expect(messageOf(error)).toMatch(/has two tools named "addTask"/);
  });

  it("is refused when the app composes a second instance beside it, before any turn runs", () => {
    // The same name twice in a turn's static `uses` is refused when the flow
    // is built, so no coordinator can be registered carrying two sets.
    expect(() => bootBoardHost({ agent: { uses: [createTaskToolsCapability()] } })).toThrow(
      /"taskTools" is declared by two different defineCapability\(\) calls/
    );
  });
});
