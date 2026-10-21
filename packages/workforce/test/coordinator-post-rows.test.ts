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
 *   BR-18        a worker whose `tools:` line names `handOff` fails to load, pointing at (retired-name-refusal)
 *                `dispatchTask`;
 *   BR-21        a post row can't be reassigned, completed, failed or blocked from the board;
 *                a cancel ends that delegate's part, and its late answer lands nowhere.
 *
 * And the one attempt a post has: a row whose run stopped without a word is
 * taken back by the board once its lease lapses, and then ends errored rather
 * than running the post a second time.
 */
import { describe, expect, it } from "vitest";
import { inMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator } from "@flow-state-dev/testing";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { createWorkerInstallation } from "../src/workers/installation";
import { hireWorkforce } from "../src/workers/register";
import { FILING_SESSION_STATE_KEY, TASK_ID_STATE_KEY, WORKER_ID_STATE_KEY } from "../src/workers/keys";
import { ORG, SLOW_MS, bootHost, messageOf, standardWorkers } from "./coordinator-harness";

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
    expect(await write("updateTask", { patch: { status: "held" } })).toMatch(/disallowed|started/);
    expect(JSON.parse(await write("cancelTask", {}))).toEqual({ ok: true });

    // The coder finishes after the cancel: its settle is refused, so nothing lands.
    await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 200));
    await host.settled();
    expect((await host.postRows("alice")).map((r) => [r.status, r.assignee, r.output])).toEqual([["cancelled", "eng.coder", undefined]]);
    expect(await lines(host, id)).toEqual([]);
  });
});

describe("a post row whose run stopped without a word", () => {
  it("isn't worked again when its lease lapses: the board takes it back, and it ends errored", async () => {
    // The coder's run is cancelled and says nothing, as one whose process stopped would.
    const host = bootHost({ reportCancel: false });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "run", { message: "first [hang:eng.coder] [route:eng.coder]" })).error).toBeUndefined();
    expect(await host.cancelDelegate("alice", "eng.coder")).toBe(204);
    await host.settled();
    const [row] = await host.postRows("alice");
    expect(row).toMatchObject({ status: "in_progress", attempts: 1 });

    // Its lease lapses, and the next post wakes the board, which takes the row back.
    const runtime = await host.state.getRuntime();
    const scope = `alice:~org:${ORG}`;
    const entries = await runtime.stores.resourceState.getByPrefix("user", scope, "tasks/");
    const key = Object.keys(entries).find((k) => (entries[k]!.state as { id?: string }).id === row.id)!;
    const stored = entries[key];
    const lapsed = { ...(stored!.state as Record<string, unknown>), leaseUntil: Date.now() - 1 };
    expect((await runtime.stores.resourceState.set("user", scope, key, lapsed, stored!.version)).ok).toBe(true);
    await post(host, id, "second [route:eng.coder]");
    await host.settled();

    expect(host.heard.filter((h) => h.message.includes("first"))).toHaveLength(1);
    const ended = (await host.postRows("alice")).find((r) => r.id === row.id);
    expect(ended).toMatchObject({ status: "errored" });
    expect(ended.error).toMatch(/one attempt/);
  });
});

describe("a post row's ending, landed", () => {
  it("stays owed when landing it fails, and lands once at the board's next touch", async () => {
    // The write that lands the coder's answer loses to another writer every time it is
    // retried, so landing it fails.
    const adapter = inMemoryStores();
    const registry = await adapter.resolve();
    const set = registry.session.set.bind(registry.session);
    const landed = (state: unknown) => ((state as { landedAnswers?: unknown[] } | undefined)?.landedAnswers ?? []).length;
    let lost = 0;
    registry.session.set = async (id, value, expected) => {
      const stored = await registry.session.get(id);
      if (stored !== undefined && lost < 20 && landed(value.state) === 1 && landed(stored.state) === 0) {
        lost += 1;
        return { ok: false, conflict: { currentValue: stored, currentVersion: stored.version } };
      }
      return set(id, value, expected);
    };
    const host = bootHost({ stores: adapter as never });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "first [route:eng.coder]");
    const runtime = await host.state.getRuntime();
    const requests = await runtime.stores.request.list({ sessionId: id });
    expect(requests.filter((r) => r.actionName === "onPostSettled").map((r) => r.status)).toContain("failed");
    expect(await lines(host, id)).toEqual([]);

    // Writes land again. The next post touches the board, which sends the ending it still owes.
    lost = 20;
    await post(host, id, "second");
    await host.settled();
    const said = (await lines(host, id)).filter((m: any) => m.text.includes("first"));
    expect(said).toEqual([{ agentName: "eng.coder", text: expect.stringContaining("first") }]);
  });

  it("runs a later post to a delegate beside its turn on an earlier one that hasn't ended", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "run", { message: "first [hang:eng.coder] [route:eng.coder]" })).error).toBeUndefined();
    for (let i = 0; i < 200 && !host.heard.some((h) => h.message.includes("first")); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await host.act("alice", id, "run", { message: "second [route:eng.coder]" })).error).toBeUndefined();
    // The second answer lands while the first turn still hangs.
    let said: any[] = [];
    for (let i = 0; i < 300 && said.length === 0; i += 1) {
      said = (await lines(host, id)).filter((m: any) => m.text.includes("second"));
      if (said.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(said).toEqual([{ agentName: "eng.coder", text: expect.stringContaining("second") }]);
    expect(await host.cancelDelegate("alice", "eng.coder")).toBe(204);
    await host.settled();
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

describe("a worker naming handOff (V7, BR-18)", () => { // retired-name-refusal
  it("fails to load, and names dispatchTask in its place", () => {
    let flows: Record<string, unknown> = {};
    const installation = createWorkerInstallation({
      standardWorkers: [{ id: "old.chief", declared: { flow: "agent", tools: ["handOff"] }, body: "Hands posts on." }], // retired-name-refusal
      workerFlows: () => flows as never
    });
    flows = { agent: defineAgentWorkerFlow({ installation }) };
    expect(() => hireWorkforce(installation)).toThrow(
      /worker "old\.chief"[\s\S]*names tool "handOff", which no longer exists[\s\S]*`dispatchTask` and `post: true`/ // retired-name-refusal
    );
  });
});

describe("the standard coordinators' tools (V7, BR-18)", () => {
  it("never carry handOff", () => { // retired-name-refusal
    for (const worker of standardWorkers()) expect(JSON.stringify(worker.declared)).not.toContain("handOff"); // retired-name-refusal
  });
});
