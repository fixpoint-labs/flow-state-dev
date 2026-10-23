/**
 * A coordinator hands its user's message to a delegate by filing a task
 * (FIX-2083): a routed task is an ordinary task in the user's list, worked
 * in the delegate's ongoing session for the conversation, its result to the
 * conversation, one attempt, carrying the message as written in its
 * server-written brief. Read through the public task actions as Alice.
 *
 * Also the parts of FIX-1872 that still stand: a conversation saved with the
 * old delivery ledger reads as if it had none, and a worker naming `handOff` (retired-name-refusal)
 * fails to load, naming what replaced it.
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
  const result = await host.act("alice", sessionId, "respond", { message });
  expect(result.error, messageOf(result.error)).toBeUndefined();
  await host.settled();
}

/** The delegates' lines in a conversation. */
const lines = async (host: Host, id: string) => (await host.items(id)).messages.filter((m: any) => m.agentName !== undefined);

/** Alice's tasks on a conversation's board, through the public task actions: listed, then each read whole. */
async function aliceTasks(host: Host, id: string): Promise<any[]> {
  const listed = await host.act("alice", id, "listTasks_tasks", {});
  expect(listed.error, messageOf(listed.error)).toBeUndefined();
  const tasks = (listed.output as { tasks: Array<{ id: string }> }).tasks;
  const read: any[] = [];
  for (const { id: taskId } of tasks) {
    const got = await host.act("alice", id, "getTask_tasks", { id: taskId });
    read.push((got.output as { task: unknown }).task);
  }
  return read;
}

/** Wait until `check` holds, polling. */
async function until(check: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 400; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`never: ${what}`);
}

describe("a message a policy routes", () => {
  it("is one ordinary task in Alice's list: the delegate's ongoing session, its result to the conversation, one attempt", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await post(host, id, "first [route:eng.coder]");

    const [task] = await aliceTasks(host, id);
    expect(task).toMatchObject({
      status: "completed",
      assignee: "eng.coder",
      session: "ongoing",
      resultTo: "conversation",
      maxAttempts: 1,
      attempts: 1
    });
    // The delegate reads the message as written, and its answer lands once, under its name.
    expect(host.heard.map((h) => [h.worker, h.message])).toEqual([["eng.coder", "alice, through desk: first [route:eng.coder]"]]);
    expect(await lines(host, id)).toEqual([{ agentName: "eng.coder", text: "eng.coder heard: alice, through desk: first [route:eng.coder]" }]);
  });

  it("runs in the delegate's one session for the conversation, the same one each time, never a task session", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await post(host, id, "first [route:eng.coder]");
    await post(host, id, "second [route:eng.coder]");
    const [one, two] = host.heard;
    expect(two!.sessionId).toBe(one!.sessionId);
    const rows = await host.routedRows("alice");
    expect(rows.map((row) => [row.status, row.run.sessionId])).toEqual([
      ["completed", one!.sessionId],
      ["completed", one!.sessionId]
    ]);
    const session = await host.sessionState(one!.sessionId);
    expect(session[WORKER_ID_STATE_KEY]).toBe("eng.coder");
    expect(session[FILING_SESSION_STATE_KEY]).toEqual(expect.any(String));
    expect(session[TASK_ID_STATE_KEY]).toBeUndefined();
  });

  it("never goes to the coordinator itself, whatever its list says: no routed task lands on its own board", async () => {
    const host = bootHost({ standard: standardWorkers({ chief: { routing: "everyone", delegates: ["chief", "eng.em"] } }) });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "hello");
    expect((await host.routedRows("alice")).map((row) => row.assignee)).toEqual(["eng.em"]);
    expect(host.heard.map((h) => h.worker)).toEqual(["eng.em"]);
  });
});

describe("a second message to a busy delegate", () => {
  it("waits in Alice's list, pending, then starts in the same session once the first ends", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "respond", { message: "first [slow:eng.coder] [route:eng.coder]" })).error).toBeUndefined();
    await until(async () => host.heard.some((h) => h.message.includes("first")), "the first message reached eng.coder");
    expect((await host.act("alice", id, "respond", { message: "second [route:eng.coder]" })).error).toBeUndefined();

    // While the first runs, the second is filed and waits.
    await until(async () => (await host.routedRows("alice")).length === 2, "both messages were filed");
    const waiting = await aliceTasks(host, id);
    expect(waiting.map((task) => [task.goal.split(" ")[0], task.status])).toEqual([
      ["first", "in_progress"],
      ["second", "pending"]
    ]);
    expect(host.heard.some((h) => h.message.includes("second"))).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 200));
    await host.settled();
    await until(async () => (await lines(host, id)).length === 2, "both answers landed");
    const [first, second] = host.heard;
    expect([first!.message, second!.message].map((m) => m.split(": ")[1]!.split(" ")[0])).toEqual(["first", "second"]);
    expect(second!.sessionId).toBe(first!.sessionId);
    expect((await lines(host, id)).map((m: any) => m.text.split(": ")[2]!.split(" ")[0])).toEqual(["first", "second"]);
  });

  it("ends unstarted when Alice cancels it while it waits", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "respond", { message: "first [slow:eng.coder] [route:eng.coder]" })).error).toBeUndefined();
    await until(async () => host.heard.some((h) => h.message.includes("first")), "the first message reached eng.coder");
    expect((await host.act("alice", id, "respond", { message: "second [route:eng.coder]" })).error).toBeUndefined();
    await until(async () => (await host.routedRows("alice")).length === 2, "both messages were filed");
    const second = (await host.routedRows("alice"))[1]!;
    const cancelled = await host.act("alice", id, "updateTask_tasks", { id: second.id, status: "cancelled" });
    expect(cancelled.output).toEqual({ ok: true });

    await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 200));
    await host.settled();
    expect(host.heard.map((h) => h.message.split(": ")[1]!.split(" ")[0])).toEqual(["first"]);
    expect((await host.routedRows("alice")).map((row) => row.status)).toEqual(["completed", "cancelled"]);
    expect((await lines(host, id)).map((m: any) => m.text.split(": ")[2]!.split(" ")[0])).toEqual(["first"]);
  });
});

describe("Alice's cancel of a routed task while its delegate works", () => {
  it("ends the task; the delegate's late answer lands nowhere, and the round does not wait for it", async () => {
    const host = bootHost({
      roundDeadlineMs: 60_000,
      standard: standardWorkers({ chief: { routing: "everyone", rounds: 1, delegates: ["eng.em", "eng.coder"] } })
    });
    const id = await host.conversation("alice", "chief");
    expect((await host.act("alice", id, "respond", { message: "status? [slow:eng.coder]" })).error).toBeUndefined();
    let coder: any;
    await until(async () => {
      coder = (await host.routedRows("alice")).find((row) => row.assignee === "eng.coder");
      return coder?.status === "in_progress" && host.heard.some((h) => h.worker === "eng.coder");
    }, "eng.coder is working its task");
    const write = async (input: Record<string, unknown>) => {
      const result = await host.act("alice", id, "updateTask_tasks", { id: coder.id, ...input });
      expect(result.error, messageOf(result.error)).toBeUndefined();
      return result.output;
    };
    expect(JSON.stringify(await write({ assignee: "eng.em" }))).toMatch(/field_locked_after_start/);
    expect(await write({ status: "cancelled" })).toEqual({ ok: true });

    await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 200));
    await host.settled();
    const ended = (await host.routedRows("alice")).find((row) => row.id === coder.id);
    expect(ended?.status).toBe("cancelled");
    expect(ended?.output).toBeUndefined();
    // The coder's answer to Alice's message landed nowhere.
    expect((await lines(host, id)).filter((m: any) => m.text.startsWith("eng.coder heard: alice, through chief"))).toEqual([]);
    // Round 0 closed on the cancel, well before its minute-long deadline: eng.em's answer went
    // back out to the coder in round 1, and nothing is still open.
    expect(host.heard.filter((h) => h.worker === "eng.coder").map((h) => h.message.split(",")[0])).toEqual(["alice", "eng.em"]);
    expect((await host.sessionState(id)).openRounds).toEqual([]);
  });
});

describe("the judgment turn's filing on a turn routing a message", () => {
  /** Run one judgment turn that makes `args` its one createTask call, and return what the tool said. */
  const toolSaid = async (args: Record<string, unknown>) => {
    const judgment = mockGenerator({
      script: [{ toolCalls: [{ toolCallId: "d1", toolName: "createTask", args }] }, { text: "Tried." }]
    });
    const host = bootHost({ judgment });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "Draft it: the word is amber-77");
    const outputs = (await host.items(id)).all.filter((item: any) => item.type === "tool_output").map((item: any) => item.output);
    return { host, id, outputs };
  };

  it("files a routed task with the routing settings: the delegate reads the message as written, the goal beside it", async () => {
    const { host, id, outputs } = await toolSaid({
      goal: "Draft the launch post",
      assignee: "eng.em",
      session: "ongoing",
      resultTo: "conversation"
    });
    expect(outputs).toEqual([{ ok: true, taskId: expect.stringMatching(/^routed:/) }]);
    expect(host.heard.map((h) => h.message)).toEqual([
      "alice, through chief: Draft it: the word is amber-77\n\nYour task: Draft the launch post"
    ]);
    const [task] = await aliceTasks(host, id);
    // maxAttempts left out reads 1, never the board's default.
    expect(task).toMatchObject({ status: "completed", session: "ongoing", resultTo: "conversation", maxAttempts: 1 });
    expect((await lines(host, id)).filter((m: any) => m.agentName === "eng.em")).toHaveLength(1);
  });

  it("refuses maxAttempts: 3 on such a task, naming FIX-2080's rule, and files nothing", async () => {
    const { host, outputs } = await toolSaid({
      goal: "Draft it",
      assignee: "eng.em",
      session: "ongoing",
      resultTo: "conversation",
      maxAttempts: 3
    });
    expect(outputs).toEqual([{ ok: false, error: expect.stringMatching(/^conversation_result_one_attempt: /) }]);
    expect(await host.routedRows("alice")).toEqual([]);
    expect(host.heard).toEqual([]);
  });

  it("refuses a delegate that isn't one here, and files nothing", async () => {
    const { host, outputs } = await toolSaid({ goal: "Draft it", assignee: "eng.coder", session: "ongoing", resultTo: "conversation" });
    expect(outputs).toEqual([{ ok: false, error: expect.stringMatching(/eng\.coder/) }]);
    expect(await host.routedRows("alice")).toEqual([]);
    expect(host.heard).toEqual([]);
  });

  it("answers a replayed call with the task its first run filed, and records the delivery once (BR-15)", async () => {
    // The same call twice in one step shares its `runOnce` record, as a call
    // replayed after a crash does: the second run is the replay.
    const args = { goal: "Draft it", assignee: "eng.em", session: "ongoing", resultTo: "conversation" };
    const judgment = mockGenerator({
      script: [
        {
          toolCalls: [
            { toolCallId: "d1", toolName: "createTask", args },
            { toolCallId: "d1", toolName: "createTask", args }
          ]
        },
        { text: "Handed on." }
      ]
    });
    const host = bootHost({ judgment });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "Draft it: the word is amber-77");
    const outputs = (await host.items(id)).all.filter((item: any) => item.type === "tool_output").map((item: any) => item.output);
    expect(outputs).toEqual([
      { ok: true, taskId: expect.stringMatching(/^routed:/) },
      { ok: true, taskId: outputs[0].taskId }
    ]);
    expect(host.heard).toHaveLength(1);
    expect((await host.routedRows("alice")).map((row) => row.id)).toEqual([outputs[0].taskId]);
    const [record] = (await host.items(id)).records;
    expect(record.delegates).toEqual([{ worker: "eng.em", outcome: "delivered" }]);
  });

  it("refuses a session other than the delegate's ongoing one, and files nothing", async () => {
    const { host, outputs } = await toolSaid({ goal: "Draft it", assignee: "eng.em", session: "new", resultTo: "conversation" });
    expect(outputs).toEqual([{ ok: false, error: expect.stringMatching(/^routed_session_ongoing: /) }]);
    expect(await host.routedRows("alice")).toEqual([]);
    expect(host.heard).toEqual([]);
  });

  it("refuses held and deps by name, rather than starting the task anyway, and files nothing", async () => {
    for (const extra of [{ held: true }, { deps: ["task_elsewhere"] }]) {
      const { host, outputs } = await toolSaid({ goal: "Draft it", assignee: "eng.em", session: "ongoing", resultTo: "conversation", ...extra });
      expect(outputs).toEqual([{ ok: false, error: expect.stringMatching(new RegExp(`^routed_task_starts_now: .*takes no ${Object.keys(extra)[0]}`)) }]);
      expect(await host.routedRows("alice")).toEqual([]);
      expect(host.heard).toEqual([]);
    }
  });

  it("keeps none of the board's own markers a model writes in the task's metadata", async () => {
    const { host, outputs } = await toolSaid({
      goal: "Draft it",
      assignee: "eng.em",
      session: "ongoing",
      resultTo: "conversation",
      metadata: { pieceOf: "task_someone_elses", retryOf: "task_other", note: "kept" }
    });
    expect(outputs).toEqual([{ ok: true, taskId: expect.stringMatching(/^routed:/) }]);
    const [row] = await host.routedRows("alice");
    expect(row.metadata?.note).toBe("kept");
    expect(row.metadata).not.toHaveProperty("pieceOf");
    expect(row.metadata).not.toHaveProperty("retryOf");
  });
});

describe("a routed task that fails out", () => {
  it("filed by the judgment turn, is said once under its delegate's name and wakes that turn to act on it (FIX-2115)", async () => {
    // The turn files the message for eng.em, whose turn fails; the turn the
    // failure wakes is the script's third answer, and her next message the fourth.
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "d1", toolName: "createTask", args: { goal: "Draft it", assignee: "eng.em", session: "ongoing", resultTo: "conversation" } }] },
        { text: "Handed on." },
        { text: "The draft failed; I'll find someone else." },
        { text: "Nothing else." }
      ]
    });
    const host = bootHost({ judgment });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "Draft it [fail:eng.em], and refile it if it fails");
    await host.settled();

    const [task] = await aliceTasks(host, id);
    expect(task).toMatchObject({ status: "errored", resultTo: "conversation", attempts: 1 });
    // One line under the delegate's name, naming the task and its error.
    const failed = (await lines(host, id)).filter((m: any) => m.agentName === "eng.em");
    expect(failed).toEqual([{ agentName: "eng.em", text: expect.stringContaining(`(${task.id}) failed for good with eng.em: eng.em could not answer`) }]);
    // The coordinator's turn ran again, on the failure, so it can file the work elsewhere.
    expect(JSON.stringify(judgment.calls.at(-1)!.input)).toContain(`(${task.id}) failed for good`);
    expect((await lines(host, id)).map((m: any) => m.text)).toContain("The draft failed; I'll find someone else.");
    // Heard once, however often the board is touched after.
    await post(host, id, "anything else?");
    expect((await lines(host, id)).filter((m: any) => m.agentName === "eng.em")).toHaveLength(1);
  });

  it("filed by a best-fit coordinator's own turn, on a message it couldn't place, is said and wakes that turn too (FIX-2115)", async () => {
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "d1", toolName: "createTask", args: { goal: "Draft it", assignee: "eng.em", session: "ongoing", resultTo: "conversation" } }] },
        { text: "Handed on." },
        { text: "The draft failed; I'll find someone else." }
      ]
    });
    const host = bootHost({ judgment, standard: standardWorkers({ chief: { routing: "best-fit", delegates: ["eng.em"] } }) });
    const id = await host.conversation("alice", "chief");
    // No mark: the fit check fails, and with no fallback the coordinator's own turn takes the message.
    await post(host, id, "Draft it [fail:eng.em]");
    await host.settled();
    const [task] = await aliceTasks(host, id);
    expect(task).toMatchObject({ status: "errored", resultTo: "conversation" });
    expect((await lines(host, id)).filter((m: any) => m.agentName === "eng.em")).toEqual([
      { agentName: "eng.em", text: expect.stringContaining(`(${task.id}) failed for good with eng.em`) }
    ]);
    expect((await lines(host, id)).map((m: any) => m.text)).toContain("The draft failed; I'll find someone else.");
  });

  it("filed by the judgment turn and cancelled by Alice, says nothing and wakes no turn: whoever cancelled it knows (FIX-2083's cancel rule)", async () => {
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "d1", toolName: "createTask", args: { goal: "Draft it", assignee: "eng.em", session: "ongoing", resultTo: "conversation" } }] },
        { text: "Handed on." }
      ]
    });
    const host = bootHost({ judgment });
    const id = await host.conversation("alice", "chief");
    expect((await host.act("alice", id, "respond", { message: "Draft it [slow:eng.em]" })).error).toBeUndefined();
    let row: any;
    await until(async () => {
      row = (await host.routedRows("alice")).find((r) => r.assignee === "eng.em");
      return row?.status === "in_progress" && host.heard.some((h) => h.worker === "eng.em");
    }, "eng.em is working its task");
    const calls = judgment.calls.length;
    const cancelled = await host.act("alice", id, "updateTask_tasks", { id: row.id, status: "cancelled" });
    expect(cancelled.output).toEqual({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 200));
    await host.settled();
    expect((await host.routedRows("alice")).find((r) => r.id === row.id)?.status).toBe("cancelled");
    expect((await lines(host, id)).filter((m: any) => m.agentName === "eng.em")).toEqual([]);
    expect(judgment.calls).toHaveLength(calls);
  }, 20_000);

  it("routed by a policy, ends only that delegate's part of the round: no line, no turn (FIX-2083's rule)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await post(host, id, "first [route:eng.coder] [fail:eng.coder]");
    await host.settled();
    const [task] = await aliceTasks(host, id);
    expect(task).toMatchObject({ status: "errored", assignee: "eng.coder" });
    expect(await lines(host, id)).toEqual([]);
  });
});

describe("a post row stored before the upgrade", () => {
  it("is worked once, as a routed task, and its answer lands once", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    // Seed the board as a coordinator before FIX-2083 left it: one post row, pending.
    await post(host, id, "warm up [route:eng.em]");
    const runtime = await host.state.getRuntime();
    const scope = `alice:~org:${ORG}`;
    const entries = await runtime.stores.resourceState.getByPrefix("user", scope, "tasks/");
    const [key, entry] = Object.entries(entries).find(([, value]) => (value.state as { sealed?: unknown }).sealed !== undefined)!;
    const stored = entry.state as Record<string, any>;
    const now = Date.now();
    // The row's key ends in its id, as the store writes it, encoded or not.
    const legacyKey = key.includes(encodeURIComponent(stored.id))
      ? key.replace(encodeURIComponent(stored.id), encodeURIComponent("post:legacy:0:eng.coder"))
      : key.replace(stored.id, "post:legacy:0:eng.coder");
    expect(legacyKey).not.toBe(key);
    const legacy = {
      ...stored,
      id: "post:legacy:0:eng.coder",
      title: "Post for eng.coder",
      goal: "alice, through desk: an old post",
      status: "pending",
      assignee: "eng.coder",
      attempts: 0,
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
      incarnationId: "legacy-incarnation",
      sealed: {
        kind: "post",
        postId: "legacy",
        round: 0,
        delegate: { worker: "eng.coder" },
        session: { key: 'delegate:["eng.coder",null]' },
        body: "an old post",
        from: "alice",
        coordinator: "desk"
      }
    };
    for (const field of ["session", "resultTo", "run", "output", "startedAt", "completedAt", "leaseUntil", "claimedBy", "metadata"]) {
      delete legacy[field];
    }
    expect((await runtime.stores.resourceState.set("user", scope, legacyKey, legacy, "any")).ok).toBe(true);

    // The next message touches the board, which starts the stored row.
    await post(host, id, "next [route:eng.em]");
    await until(async () => (await lines(host, id)).some((m: any) => m.text.includes("an old post")), "the old post's answer landed");
    await host.settled();

    expect(host.heard.filter((h) => h.message.includes("an old post")).map((h) => [h.worker, h.message])).toEqual([
      ["eng.coder", "alice, through desk: an old post"]
    ]);
    expect((await lines(host, id)).filter((m: any) => m.text.includes("an old post"))).toEqual([
      { agentName: "eng.coder", text: "eng.coder heard: alice, through desk: an old post" }
    ]);
  });
});

describe("a routed task's ending, landed", () => {
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
    expect(requests.filter((r) => r.actionName === "onTaskSettled").map((r) => r.status)).toContain("failed");
    expect(await lines(host, id)).toEqual([]);

    // Writes land again. The next message touches the board, which sends the ending it still owes.
    lost = 20;
    await post(host, id, "second");
    await host.settled();
    const said = (await lines(host, id)).filter((m: any) => m.text.includes("first"));
    expect(said).toEqual([{ agentName: "eng.coder", text: expect.stringContaining("first") }]);
  });
});

describe("a conversation saved before messages were tasks (FIX-1872 BR-13)", () => {
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

describe("a worker naming handOff (FIX-1872 BR-18)", () => { // retired-name-refusal
  it("fails to load, and names createTask with the routing settings in its place", () => {
    let flows: Record<string, unknown> = {};
    const installation = createWorkerInstallation({
      standardWorkers: [{ id: "old.chief", declared: { flow: "agent", tools: ["handOff"] }, body: "Hands posts on." }], // retired-name-refusal
      workerFlows: () => flows as never
    });
    flows = { agent: defineAgentWorkerFlow({ installation }) };
    expect(() => hireWorkforce(installation)).toThrow(
      /worker "old\.chief"[\s\S]*names tool "handOff", which no longer exists[\s\S]*`createTask` and the routing settings/ // retired-name-refusal
    );
  });

  it("is in no standard coordinator's tools", () => {
    for (const worker of standardWorkers()) expect(JSON.stringify(worker.declared)).not.toContain("handOff"); // retired-name-refusal
  });
});
