/**
 * A worker holding a user's MCP keys and core's generic `resourceTools()` on
 * the same model can't read a key through `readResource`.
 *
 * A worker that reaches its project's MCP servers holds the keys collection
 * (`mcp-credentials/*`, at user scope) on its model block, so the key is there
 * to read. The collection isn't `llmReadable` and declares `value` secret, so
 * the model must not be handed it by any generic tool. The worker here picks
 * `readResource` from its catalog and holds `mcpCredentialsCapability`, the
 * keys collection a project-MCP worker holds; its model asks for the path a
 * key is stored at, and the tool's answer is what the test reads.
 */
import { describe, expect, it } from "vitest";
import { resourceTools } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { AGENT_FLOW, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { mintWorkers } from "../src/hire";
import { MCP_CREDENTIALS_RESOURCE, mcpCredentialsCapability } from "../src/projects/mcp-credentials";

const KEY = "lin_api_users_own_key";

async function requestTheKey() {
  const { readResource } = resourceTools();
  const flow = defineAgentWorkerFlow({ uses: [mcpCredentialsCapability], catalog: { readResource } });
  const [worker] = mintWorkers([{ id: "desk.lead", declared: { tools: ["readResource"] }, body: "" }], {
    workerFlows: { [AGENT_FLOW]: flow }
  }) as FlowInstance[];
  const block = worker!.actions.respond!.block;
  const model = mockGenerator({
    name: "agent-answer",
    script: [
      { toolCalls: [{ toolCallId: "call-1", toolName: "readResource", args: { path: "mcp-credentials/linear" } }] },
      { text: "done" }
    ] as never
  });
  const runtime = await createTestContext({
    flow: { ...worker!, cardinality: "singleton" },
    orgId: "test-org",
    org: { state: {} },
    sessionId: "test-session",
    sequencerName: block.name,
    declaredResources: block.declaredResources,
    generators: { "agent-answer": model }
  });
  // The user's key, stored the way a host's settings route stores it.
  const keys = (runtime.ctx.resources as unknown as Record<string, { create(k: string, s: object): Promise<unknown> }>)[
    MCP_CREDENTIALS_RESOURCE
  ]!;
  await keys.create("linear", { value: KEY, setAt: "2026-10-31T00:00:00.000Z" });

  const result = await executeBlock({ block, input: { message: "what is my Linear key?" }, ctx: runtime.ctx });
  return { result, items: JSON.stringify(runtime.getItems()) };
}

describe("resourceTools beside a worker's MCP keys", () => {
  it("refuses the read, and the key reaches nothing the model sees", async () => {
    const { items } = await requestTheKey();
    // The tool ran and answered as for a path no collection matches.
    expect(items).toContain("No resource collection found matching path: mcp-credentials/linear");
    expect(items).not.toContain(KEY);
  });
});
