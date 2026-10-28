/**
 * The agent worker flow's pre-answer step (FIX-1613): `beforeAnswer` runs a
 * block on every turn before the worker answers, the mirror of `afterAnswer`.
 * A history summary's fold goes here, so the answer reads a summary that
 * already holds the turns about to leave the window.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { AGENT_FLOW, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { mintWorkers } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";

function lead(flow: ReturnType<typeof defineAgentWorkerFlow>): FlowInstance {
  const manifest: WorkerManifest = { id: "engineering.lead", declared: {}, body: "Lead." };
  return mintWorkers([manifest], { workerFlows: { [AGENT_FLOW]: flow } })[0]!;
}

async function runTurn(worker: FlowInstance, message: string) {
  const answer = mockGenerator({ name: "agent-answer", script: [{ text: "answered" }] });
  const runtime = await createTestContext({
    flow: { ...worker, cardinality: "singleton" },
    orgId: "test-org",
    org: { state: {} },
    sessionId: "test-session",
    sequencerName: worker.actions.respond!.block.name,
    declaredResources: worker.actions.respond!.block.declaredResources,
    generators: { "agent-answer": answer }
  });
  const result = await executeBlock({ block: worker.actions.respond.block, input: { message }, ctx: runtime.ctx });
  return { result, answer };
}

type Named = { name: string; childBlocks?: readonly Named[] };
const names = (block: Named): string[] => [block.name, ...(block.childBlocks ?? []).flatMap(names)];

describe("defineAgentWorkerFlow beforeAnswer", () => {
  it("runs the block before the worker answers, and the answer still comes", async () => {
    const seen: { answeredYet: boolean }[] = [];
    const before = handler({
      name: "before-the-answer",
      inputSchema: z.any(),
      execute: (_input, ctx) => {
        seen.push({
          answeredYet: ctx.response.getItems().some((item) => item.type === "message" && item.role === "assistant")
        });
        return "this must not become the worker's input";
      }
    });

    const { result, answer } = await runTurn(lead(defineAgentWorkerFlow({ beforeAnswer: before })), "hello");

    expect(result.error).toBeUndefined();
    expect(seen).toEqual([{ answeredYet: false }]);
    expect(answer.calls).toHaveLength(1);
  });

  it("is a step of the turn only when the app passes one", () => {
    const before = handler({ name: "before-the-answer", inputSchema: z.any(), execute: () => null });

    expect(names(lead(defineAgentWorkerFlow({ beforeAnswer: before })).actions.respond!.block as Named)).toContain(
      "before-the-answer"
    );
    expect(names(lead(defineAgentWorkerFlow({})).actions.respond!.block as Named)).not.toContain("before-the-answer");
  });
});
