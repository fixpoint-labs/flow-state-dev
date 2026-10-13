/**
 * A coordinator's post as rows on its conversation's board: one row per
 * delegate per post, worked in the delegate's own session for the
 * conversation, settled only by that delegate's run.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1872/BUSINESS-RULES.md`, V1 V3 V5 V7):
 *   BR-1, BR-20  a post row runs in the delegate's session for the conversation, the same one
 *                each time, never a task session;
 *   BR-5         the model's post takes `assignee` and `target` and nothing else; `target`
 *                alone isn't a post;
 *   BR-13        a conversation saved with the old delivery ledger reads as if it had none, and
 *                drops it at its next write;
 *   BR-18        a worker whose `tools:` line names `handOff` fails to load, pointing at
 *                `dispatchTask`;
 *   BR-21        a post row can't be reassigned, completed, failed or blocked from the board;
 *                a cancel ends that delegate's part, and its late answer lands nowhere.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator } from "@flow-state-dev/testing";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { createWorkerInstallation } from "../src/workers/installation";
import { hireWorkforce } from "../src/workers/register";
import { FILING_SESSION_STATE_KEY, TASK_ID_STATE_KEY, WORKER_ID_STATE_KEY } from "../src/workers/keys";
import { SLOW_MS, bootHost, messageOf, standardWorkers } from "./coordinator-harness";

type Host = ReturnType<typeof bootHost>;

async function post(host: Host, sessionId: string, message: string) {
  const result = await host.act("alice", sessionId, "run", { message });
  expect(result.error, messageOf(result.error)).toBeUndefined();
  await host.settled();
}

/** The delegates' lines in a conversation. */
const lines = async (host: Host, id: string) => (await host.items(id)).messages.filter((m: any) => m.agentName !== undefined);

describe("where a post row runs (V1)", () => {
  it("runs each post to a delegate in its one session for the conversation, never a task session (BR-1, BR-20)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await post(host, id, "first [route:eng.coder]");
    await post(host, id, "second [route:eng.coder]");
    const [one, two] = host.heard;
    expect(two!.sessionId).toBe(one!.sessionId);
    const rows = await host.postRows("alice");
    expect(rows.map((row) => [row.status, row.run.sessionId])).toEqual([
      ["completed", one!.sessionId],
      ["completed", one!.sessionId]
    ]);
    // The delegate's session for this conversation: born naming its worker and the conversation, and no task.
    const session = await host.sessionState(one!.sessionId);
    expect(session[WORKER_ID_STATE_KEY]).toBe("eng.coder");
    expect(session[FILING_SESSION_STATE_KEY]).toEqual(expect.any(String));
    expect(session[TASK_ID_STATE_KEY]).toBeUndefined();
  });
});

describe("the post form of dispatchTask (V3, BR-5)", () => {
  /** Run one judgment turn that makes `args` its one tool call, and return what the tool said. */
  const toolSaid = async (args: Record<string, unknown>) => {
    const judgment = mockGenerator({
      script: [{ toolCalls: [{ toolCallId: "d1", toolName: "dispatchTask", args }] }, { text: "Tried." }]
    });
    const host = bootHost({ judgment });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "go");
    const outputs = (await host.items(id)).all.filter((item: any) => item.type === "tool_output").map((item: any) => item.output);
    return { host, outputs };
  };

  it("refuses a post that carries a task's fields, and files nothing", async () => {
    const { host, outputs } = await toolSaid({ post: true, assignee: "eng.em", goal: "do it" });
    expect(outputs).toEqual([{ ok: false, error: expect.stringMatching(/^post_takes_assignee_and_target: .*\(not goal\)/) }]);
    expect(await host.postRows("alice")).toEqual([]);
    expect(host.heard).toEqual([]);
  });

  it("refuses a target without post: true", async () => {
    const { host, outputs } = await toolSaid({ assignee: "eng.em", target: "shared/apollo/checkout", goal: "do it" });
    expect(outputs).toEqual([{ ok: false, error: expect.stringMatching(/^target_without_post: /) }]);
    expect(host.heard).toEqual([]);
  });

  it("hands a post on with assignee alone, and says where its answer will land", async () => {
    const { host, outputs } = await toolSaid({ post: true, assignee: "eng.em" });
    expect(outputs).toEqual([{ ok: true, note: expect.stringMatching(/^Handed to eng\.em\. Its answer will land/) }]);
    expect(host.heard.map((h) => h.worker)).toEqual(["eng.em"]);
  });
});

describe("a post row on the board (BR-21)", () => {
  it("can't be reassigned, completed, failed or blocked; a cancel ends it, and the late answer lands nowhere", async () => {
    // eng.lead takes tasks, so this conversation files and its board answers the task tools.
    const host = bootHost({ standard: standardWorkers({ desk: { delegates: ["eng.em", "eng.coder", "support.general", "eng.lead"] } }) });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "run", { message: "status? [slow:eng.coder] [route:eng.coder]" })).error).toBeUndefined();
    let row: any;
    for (let i = 0; i < 200 && row?.status !== "in_progress"; i += 1) {
      [row] = await host.postRows("alice");
      if (row?.status !== "in_progress") await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(row).toMatchObject({ status: "in_progress", assignee: "eng.coder" });
    const write = async (action: string, input: Record<string, unknown>) => {
      const result = await host.act("alice", id, `${action}_tasks`, { taskId: row.id, ...input });
      expect(result.error, messageOf(result.error)).toBeUndefined();
      return JSON.stringify(result.output);
    };
    expect(await write("assignTask", { assignee: "eng.lead" })).toMatch(/immutable-assignee/);
    expect(await write("completeTask", { output: "a forged answer" })).toMatch(/disallowed/);
    expect(await write("failTask", { error: "x" })).toMatch(/disallowed/);
    expect(await write("blockTask", {})).toMatch(/disallowed/);
    expect(JSON.parse(await write("cancelTask", {}))).toEqual({ ok: true });

    // The coder finishes after the cancel: its settle is refused, so nothing lands.
    await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 200));
    await host.settled();
    expect((await host.postRows("alice")).map((r) => [r.status, r.assignee, r.output])).toEqual([["cancelled", "eng.coder", undefined]]);
    expect(await lines(host, id)).toEqual([]);
  });
});

describe("a conversation saved before posts were rows (V5, BR-13)", () => {
  it("reads a saved delivery ledger as none, and drops it at its next write", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    const runtime = await host.state.getRuntime();
    for (let written = false; !written; ) {
      const session = (await runtime.stores.session.get(id))!;
      const deliveries = [{ token: "t-old", postId: "p-old", round: 0, delegate: { worker: "eng.coder" }, answered: false }];
      written = (await runtime.stores.session.set(id, { ...session, state: { ...session.state, deliveries } } as never, session.version as never))
        .ok;
    }
    await post(host, id, "hello [route:eng.coder]");
    expect(host.heard.map((h) => h.worker)).toEqual(["eng.coder"]);
    expect((await lines(host, id)).map((m: any) => m.agentName)).toEqual(["eng.coder"]);
    expect((await host.sessionState(id)).deliveries).toBeUndefined();
  });
});

describe("a worker naming handOff (V7, BR-18)", () => {
  it("fails to load, and names dispatchTask in its place", () => {
    let flows: Record<string, unknown> = {};
    const installation = createWorkerInstallation({
      standardWorkers: [{ id: "old.chief", declared: { flow: "agent", tools: ["handOff"] }, body: "Hands posts on." }],
      workerFlows: () => flows as never
    });
    flows = { agent: defineAgentWorkerFlow({ installation }) };
    expect(() => hireWorkforce(installation)).toThrow(
      /worker "old\.chief"[\s\S]*names tool "handOff", which no longer exists[\s\S]*`dispatchTask` and `post: true`/
    );
  });
});

describe("the standard coordinators' tools (V7, BR-18)", () => {
  it("never carry handOff", () => {
    for (const worker of standardWorkers()) expect(JSON.stringify(worker.declared)).not.toContain("handOff");
  });
});
