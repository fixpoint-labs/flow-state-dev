/**
 * BR-24 on one shared `agent` copy: each worker's model reaches only the
 * documents its grants name, on every turn, through core's own resource
 * tools.
 *
 * One registered `agent` copy bound to an installation that declares two
 * documents. Two standard workers of one user: one granted `handbook`
 * read-only, one granted `ledger` read-write. A scripted model lists what it
 * can read, then reads and writes both documents. Graded on what the tools
 * handed the model back, and on a write actually landing.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORG_ID,
  defineResource,
  readResourceContentTool,
  writeResourceContentTool
} from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, type MockGeneratorInstance } from "@flow-state-dev/testing";
import { z } from "zod";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { createWorkerInstallation } from "../src/workers/installation";

function document(ref: string) {
  return defineResource({
    ref,
    scope: "org",
    stateSchema: z.object({}).passthrough(),
    default: {},
    content: `the ${ref} body`,
    llmReadable: true,
    llmWritable: true
  });
}

const TOOLS = ["readResourceContent", "writeResourceContent"];

/** What the tool handed the model on each turn that called one. */
type Seen = unknown[];

/**
 * A turn `call <tool> <json>` gets one step calling that tool with that JSON,
 * so the real tool runs; the step after records what it handed back and
 * answers. A tool that refuses fails the turn, which the test reads instead.
 */
function scripted(seen: Seen): MockGeneratorInstance {
  return {
    name: "agent-answer",
    calls: [],
    reset: () => undefined,
    next: (messages: Array<{ role: string; content: unknown }>, state: { toolResults: Array<{ result: unknown }> }) => {
      if (state.toolResults.length > 0) {
        seen.push(state.toolResults[0]!.result);
        return { text: "done" };
      }
      const turn = JSON.stringify([...messages].reverse().find((m) => m.role === "user")?.content ?? "");
      const call = /call (\w+) (\{.*\})/.exec(JSON.parse(turn) as string);
      if (call === null) return { text: "nothing to call" };
      return { toolCalls: [{ toolCallId: `c${seen.length}`, toolName: call[1]!, args: JSON.parse(call[2]!) }] };
    }
  } as unknown as MockGeneratorInstance;
}

describe("agent's document grants on one copy for every worker (BR-24)", () => {
  it("each worker's model lists, reads and writes exactly what its grants allow", async () => {
    let flows: Record<string, unknown> = {};
    const installation = createWorkerInstallation({
      standardWorkers: [
        { id: "desk.amy", declared: { tools: TOOLS, resources: ["handbook"] }, body: "You are Amy." },
        { id: "desk.bo", declared: { tools: TOOLS, resources: [{ ledger: "rw" }] }, body: "You are Bo." }
      ],
      documents: { handbook: document("handbook"), ledger: document("ledger") },
      workerFlows: () => flows as never
    });
    const agent = defineAgentWorkerFlow({
      installation,
      catalog: { readResourceContent: readResourceContentTool(), writeResourceContent: writeResourceContentTool() }
    });
    flows = { agent };
    const copy = agent({ id: "agent" }) as unknown as FlowInstance;
    const seen: Seen = [];
    const state = createFlowState({
      flows: { agent: copy },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({ generators: { "agent-answer": scripted(seen) }, policy: "allow" })
    });
    try {
      const runtime = await state.getRuntime();
      const router = await state.getRouter();
      for (const worker of ["desk.amy", "desk.bo"]) {
        const created = await router.POST(
          new Request("http://localhost/api/flows/agent/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userId: "alice", sessionId: `talk-${worker}`, state: { workerId: worker } })
          }),
          { params: { path: ["agent", "sessions"] } }
        );
        expect(created.status).toBe(201);
      }
      /** One turn as `worker` calling `tool`: what the tool handed back, or the turn's error. */
      const call = async (worker: string, tool: string, args: unknown) => {
        const before = seen.length;
        const turn = await runAction({
          orgId: DEFAULT_ORG_ID,
          flow: copy,
          actionName: "run",
          input: { message: `call ${tool} ${JSON.stringify(args)}` },
          userId: "alice",
          sessionId: `talk-${worker}`,
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        });
        if (turn.error !== undefined) return { error: String((turn.error as Error).message) };
        return { result: seen.length > before ? seen[seen.length - 1] : undefined };
      };

      // Each lists only its own grant.
      expect(await call("desk.amy", "readResourceContent", {})).toEqual({ result: { uris: ["org/handbook"] } });
      expect(await call("desk.bo", "readResourceContent", {})).toEqual({ result: { uris: ["org/ledger"] } });
      // Amy reads the handbook and can't write it; the ledger isn't there for her.
      expect(JSON.stringify(await call("desk.amy", "readResourceContent", { uri: "org/handbook" }))).toContain("the handbook body");
      expect((await call("desk.amy", "writeResourceContent", { uri: "org/handbook", content: "x" })).error).toContain(
        "Writable resource not found for uri: org/handbook"
      );
      expect((await call("desk.amy", "readResourceContent", { uri: "org/ledger" })).error).toContain(
        "Readable resource not found for uri: org/ledger"
      );
      // Bo writes the ledger and reads the write back; the handbook isn't there for him.
      expect((await call("desk.bo", "writeResourceContent", { uri: "org/ledger", content: "written by Bo" })).error).toBeUndefined();
      expect(JSON.stringify(await call("desk.bo", "readResourceContent", { uri: "org/ledger" }))).toContain("written by Bo");
      expect((await call("desk.bo", "readResourceContent", { uri: "org/handbook" })).error).toContain(
        "Readable resource not found for uri: org/handbook"
      );
    } finally {
      await state.dispose();
    }
  });
});

describe("the installation's resourceVisibility", () => {
  it("hides every grantable document on a turn that loaded no worker, and leaves other resources alone", () => {
    const installation = createWorkerInstallation({ documents: { handbook: document("handbook") } });
    const ctx = { session: {} } as never;
    expect(installation.resourceVisibility(ctx, { name: "handbook", ref: {} as never })).toBe("hidden");
    expect(installation.resourceVisibility(ctx, { name: "audit-log", ref: {} as never })).toBe("visible");
  });
});
