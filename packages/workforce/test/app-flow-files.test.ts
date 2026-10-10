/**
 * An app's own worker flow files for its worker's delegates (FIX-1802 S1, V1
 * and the goal's leg b): the flow carries the session board's three parts
 * (the tools on its model block, the actions, the entries), keeps its own
 * kind, and its workers file exactly as an `agent` worker does.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, generator, handler } from "@flow-state-dev/core";
import type { GeneratorTool } from "@flow-state-dev/core";
import { createTaskToolsCapability } from "@flow-state-dev/orchestration";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { defineSessionBoard, workerConfigSchema, type WorkerManifest } from "../src";
import type { WorkerInstallation } from "../src/workers/installation";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

const TASK_TOOLS = (() => {
  const capability = createTaskToolsCapability() as unknown as {
    __presetDefs?: { tools?: { controlTools?: GeneratorTool[] } };
  };
  return (capability.__presetDefs?.tools?.controlTools ?? []).map((tool) => tool.config?.name ?? tool.name);
})();

const doorInput = z.object({ message: z.string() });

/** An app's worker flow, `em`, carrying the session board: its own kind and its own settings. */
function emFlow(installation: WorkerInstallation) {
  const board = defineSessionBoard({ installation, flowKind: "em" });
  const resolveWorker = handler({
    name: "em-resolve-worker",
    inputSchema: z.unknown(),
    outputSchema: z.object({ worker: z.string() }),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => ({ worker: (await installation.resolveWorker(ctx, "em")).id })
  });
  const answer = generator({
    name: "em-answer",
    model: "scripted/em",
    inputSchema: doorInput,
    uses: [board.tools],
    user: (input) => input.message
  });
  return defineFlow({
    kind: "em",
    configSchema: workerConfigSchema().extend({ document: z.string().optional() }),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    request: { onStarted: resolveWorker },
    actions: {
      run: { inputSchema: doorInput.strict(), block: answer, userMessage: (input: { message: string }) => input.message },
      ...board.actions
    },
    internal: { actions: board.entries(answer) }
  } as never);
}

const worker = (id: string, declared: Record<string, unknown>, body = ""): WorkerManifest => ({
  id,
  declared,
  body,
  skills: []
});

function host(script = [{ when: () => true, then: { text: "OK." } }] as never[]) {
  const seen: Array<{ names: string[]; input: string }> = [];
  const emAnswer = mockGenerator({ script });
  const h = bootBoardHost({
    standard: [
      ...boardWorkers(),
      worker("lead.em", { flow: "em", document: "handbook", delegates: ["otto"] }, "Leads the feature."),
      worker("lone.em", { flow: "em" }, "Works alone.")
    ],
    agentAnswer: mockGenerator({ script: [{ when: () => true, then: { text: "otto did it." } }] }),
    flows: (installation) => ({ em: emFlow(installation) }),
    generators: { "em-answer": emAnswer },
    observeTools: (block, names, input) => {
      if (block === "em-answer") seen.push({ names, input: JSON.stringify(input) });
    }
  });
  return Object.assign(h, { seen, emAnswer });
}

async function emSession(h: BoardHost, userId: string, workerId: string): Promise<string> {
  const created = await h.create(userId, "em", { state: { workerId } });
  if (created.status >= 300) throw new Error(`creating ${workerId}'s session failed: ${JSON.stringify(created.body)}`);
  return created.body.session!.id;
}

const file = async (h: BoardHost, userId: string, sessionId: string, input: Record<string, unknown>) => {
  const result = await h.act(userId, sessionId, "addTask_tasks", input, "em");
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string; error?: string };
};

describe("a worker on an app's own flow files for its delegates (S1, the goal's leg b)", () => {
  it("files for an `agent` delegate from the app; the task completes, and the notice reaches the flow that filed it", async () => {
    const h = host();
    try {
      const talk = await emSession(h, "alice", "lead.em");
      const filed = await file(h, "alice", talk, { goal: "Write the release notes", assignee: "otto" });
      expect(filed).toMatchObject({ ok: true });
      await h.settled();
      expect((await h.rows("alice")).map((row) => [row.goal, row.assignee, row.status])).toEqual([
        ["Write the release notes", "otto", "completed"]
      ]);
      const heard = (await h.requestsOf(talk)).filter((request) => request.actionName === "onTaskSettled");
      expect(heard.map((request) => request.status)).toEqual(["completed"]);
      // It woke the em's own turn with the ending.
      expect(h.seen.some((entry) => entry.input.includes("completed by otto"))).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  it("puts each of the eight task tools on its model's turn once, and files through them", async () => {
    let called = false;
    const h = host([
      { when: (input: unknown) => called && JSON.stringify(input).includes("ship it"), then: { text: "Filed." } },
      {
        when: (input: unknown) => {
          if (called || !JSON.stringify(input).includes("ship it")) return false;
          called = true;
          return true;
        },
        then: { toolCalls: [{ toolCallId: "em-1", toolName: "addTask", args: { goal: "Ship the build", assignee: "otto" } }] }
      },
      { when: () => true, then: { text: "OK." } }
    ] as never[]);
    try {
      const talk = await emSession(h, "alice", "lead.em");
      const turn = await h.act("alice", talk, "run", { message: "ship it" }, "em");
      expect(turn.error, messageOf(turn.error)).toBeUndefined();
      await h.settled();
      const [first] = h.seen;
      for (const tool of TASK_TOOLS) expect(first!.names.filter((name) => name === tool), tool).toHaveLength(1);
      expect((await h.rows("alice")).map((row) => [row.goal, row.status])).toEqual([["Ship the build", "completed"]]);
    } finally {
      await h.dispose();
    }
  });

  it("gives a worker on it with no task-taking delegate no tools, and its addTask answers no_delegation_board", async () => {
    const h = host();
    try {
      const talk = await emSession(h, "alice", "lone.em");
      expect((await h.act("alice", talk, "run", { message: "anything?" }, "em")).error).toBeUndefined();
      expect(h.seen[0]!.names.filter((name) => TASK_TOOLS.includes(name))).toEqual([]);
      expect(await file(h, "alice", talk, { goal: "x", assignee: "otto" })).toMatchObject({
        ok: false,
        error: "no_delegation_board"
      });
    } finally {
      await h.dispose();
    }
  });

  it("refuses a create that seeds its delegates, with 400 naming the field (BR-6)", async () => {
    const h = host();
    try {
      const created = await h.create("alice", "em", { state: { workerId: "lone.em", delegates: [{ worker: "otto" }] } });
      expect(created.status).toBe(400);
      expect(created.body.error).toMatch(/"delegates"/);
    } finally {
      await h.dispose();
    }
  });
});
