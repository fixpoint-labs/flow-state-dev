/**
 * `hireWorker` on any host, not only the Teammates lab: the model list a hire
 * may run on defaults to the agent flow's own model, so an app that sets no
 * `hire` config can still hire on the model its workers already run; and the
 * user's approval shows the instructions the new worker will keep.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, type MockGeneratorScriptEntry } from "@flow-state-dev/testing";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import { hireWorkersCapability, type HireWorkersOptions } from "../src/workers/hire-tool";
import { boardWorkers, bootBoardHost } from "./conversation-board-harness";

const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");
const fallback: MockGeneratorScriptEntry = { when: () => true, then: { text: "" } };

/** otto calls `hireWorker` with `args` on the user's message, once. */
function hireOnce(args: Record<string, unknown>): MockGeneratorScriptEntry[] {
  let called = false;
  return [
    {
      when: (input: unknown) => {
        if (called || !textOf(input).includes("Hire an analyst")) return false;
        called = true;
        return true;
      },
      then: { toolCalls: [{ toolCallId: "hire-1", toolName: "hireWorker", args }] }
    }
  ];
}

const analyst = { id: "analyst", description: "Explains the metrics.", instructions: "You explain what a metric means, citing the file." };

/** otto, which picks the capability, asks to hire on `provider`/`model`; what the tool answered, and the user's pending approvals. */
async function hireOn(provider: string, model: string, options?: HireWorkersOptions) {
  const h = bootBoardHost({
    durable: true,
    standard: boardWorkers({ otto: { capabilities: { hireWorkers: ["tool"] } } }),
    agentUses: (installation) => [hireWorkersCapability(installation, options)],
    agentAnswer: mockGenerator({ script: [...hireOnce({ ...analyst, provider, model }), fallback] }),
    judgment: mockGenerator({ script: [fallback] })
  });
  try {
    const created = await h.create("alice", "agent", { state: { workerId: "otto" } });
    const otto = created.body.session!.id;
    await h.post("alice", otto, "respond", { message: "Hire an analyst." }, "agent");
    await h.settled();
    const runtime = await h.state.getRuntime();
    const pending = (await runtime.stores.suspensions.list({ status: "pending" })) as SuspensionRecord[];
    const items = (await h.requestsOf(otto)).flatMap((request) => (request as unknown as { items?: any[] }).items ?? []);
    const answered = items.filter((item) => item.type === "tool_output" && item.toolCall?.name === "hireWorker" && item.output !== undefined).map((item) => item.output);
    return { pending, answered };
  } finally {
    await h.state.dispose();
  }
}

describe("hireWorker's model list", () => {
  it("defaults to the agent flow's model, so a host with no hire config can hire on it", async () => {
    const { pending, answered } = await hireOn("intent", "chat");
    expect(answered, "no refusal").toEqual([]);
    expect(pending, "the user is asked").toHaveLength(1);
    expect((pending[0] as { message?: string }).message, "the approval shows the instructions").toContain(analyst.instructions);
  });

  it("keeps that default when the config names `models: undefined`", async () => {
    const { pending } = await hireOn("intent", "chat", { models: undefined });
    expect(pending).toHaveLength(1);
  });

  it("refuses a model outside the list, naming the list", async () => {
    const { pending, answered } = await hireOn("openai", "gpt-6-luna");
    expect(pending).toHaveLength(0);
    expect(JSON.stringify(answered)).toContain("It runs them on: intent/chat");
  });
});
