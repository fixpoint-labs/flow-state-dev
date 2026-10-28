/**
 * A worker's steps for itself (FIX-2076 D1, D2): a filing a worker's own turn
 * makes naming itself is a step on its session's plan ledger, worked by the
 * same request after the turn, in order, each step seeing the one before; then
 * the worker answers once more, told how every step ended, and that answer is
 * the request's result.
 *
 * The flow here is an app's own worker flow carrying the filing kit, whose
 * turn runs no model: it files what the test's controls say through the ref
 * the model's task tools read (`turnResolver`), and answers a step with a
 * value only that step produced. Every turn is recorded.
 *
 * What each leg asserts is read back from the store (the plan ledger, the
 * conversation ledger, the session records), never from the turn's own say-so.
 */
import { describe, expect, it } from "vitest";
import { handler, defineFlow } from "@flow-state-dev/core";
import { onRequestEnded, type BlockContext } from "@flow-state-dev/core/types";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { defineSessionBoard, workerConfigSchema, type WorkerManifest } from "../src";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import type { WorkerInstallation } from "../src/workers/installation";
import { ORG, boardWorkers, bootBoardHost, messageOf } from "./conversation-board-harness";

/** A row a turn files: a step for itself, or, with `assignee`, a task for that delegate. */
type Step = { id: string; goal: string; deps?: string[]; assignee?: string; session?: "new" | "ongoing" };

type Controls = {
  plans: Record<string, Step[]>;
  failSteps: Set<string>;
  /** Steps whose turn tries to file one more step for itself. */
  stepFiles: Set<string>;
  answerFiles: Set<string>;
  /** Workers whose turn files its whole plan in one `addTasks` batch. */
  batches: Set<string>;
  /** A second batch a batching worker's turn files after its plan. */
  secondBatch: Record<string, Step[]>;
  /** The rule each refused filing named (`TaskFilingRefusedError.rule`), or its code. */
  rules: string[];
  /** A worker whose plan turn also tries the writes a step refuses. */
  probes: Set<string>;
  refusals: Array<{ worker: string; error: string }>;
  /** Goals a turn handed as its whole message does as a step in a session of its own (FIX-2082 D2). */
  ownSession: Set<string>;
  /** How long a planning turn's request takes to park once it has parked its drain, as a slow store would. */
  parkDelayMs?: number;
  turns: Array<{ worker: string; sessionId: string; kind: "turn" | "step" | "answer"; message: string }>;
};

const doorInput = z.object({ message: z.string() });
const STEP = "You are working a step you filed for yourself";
const ANSWER = "The steps you filed for yourself have ended";

function stepperFlow(installation: WorkerInstallation, controls: Controls) {
  const board = defineSessionBoard({ installation, flowKind: "stepper" });
  const turn = handler({
    name: "stepper-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    resources: { ...installation.resources, ...board.resources },
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const worker = String((ctx.session.state as Record<string, unknown>).workerId);
      const kind = input.message.startsWith(STEP) ? "step" : input.message.startsWith(ANSWER) ? "answer" : "turn";
      controls.turns.push({ worker, sessionId: ctx.session.identity.id, kind, message: input.message });
      const ref = await board.board.turnResolver(ctx as never);
      const refused = async (write: () => Promise<unknown>) => {
        try {
          await write();
        } catch (error) {
          controls.refusals.push({ worker, error: error instanceof Error ? `${(error as { code?: string }).code ?? error.name}` : String(error) });
          const named = error as { rule?: string; code?: string };
          controls.rules.push(named.rule ?? named.code ?? String(error));
        }
      };
      if (kind === "step") {
        const brief = input.message.split("The results of the steps it depends on:")[0]!;
        const step = [...(controls.plans[worker] ?? []), ...(controls.secondBatch[worker] ?? [])].find((candidate) => brief.includes(candidate.goal));
        if (step === undefined) throw new Error(`no step matches: ${input.message}`);
        if (controls.failSteps.has(step.goal)) throw new Error(`${step.goal} could not be done`);
        if (controls.stepFiles.has(step.goal)) await refused(() => ref!.addTask({ goal: `after ${step.goal}`, assignee: worker }));
        // A value only this step produces, carrying what it saw of the step before.
        const before = /The results of the steps it depends on:\n([\s\S]*)$/.exec(input.message)?.[1] ?? "";
        return `${step.goal}#done${before.length > 0 ? ` after [${before.trim()}]` : ""}`;
      }
      if (kind === "answer") {
        if (controls.answerFiles.has(worker)) await refused(() => ref!.addTask({ goal: "one more step", assignee: worker }));
        return `answered: ${input.message}`;
      }
      if (input.message.startsWith('Task "')) return `${worker} heard: ${input.message}`;
      // A step handed to a session of its own arrives as the task it is: a value only that session produced.
      if (controls.ownSession.has(input.message.trim())) return `${input.message.trim()}#own@${ctx.session.identity.id}`;
      const parkDelayMs = controls.parkDelayMs;
      if (parkDelayMs !== undefined) {
        // A request-end hook runs after the drain's wait gate is written and
        // before the request is recorded parked: the window a step's ending can land in.
        onRequestEnded(ctx, async (ending) => {
          if (ending.status === "suspended") await new Promise((r) => setTimeout(r, parkDelayMs));
        });
      }
      const asInit = (step: Step) => ({
        id: step.id,
        goal: step.goal,
        assignee: step.assignee ?? worker,
        ...(step.deps ? { deps: step.deps } : {}),
        ...(step.session ? { session: step.session } : {})
      });
      if (controls.batches.has(worker)) {
        await refused(() => ref!.addTasks((controls.plans[worker] ?? []).map(asInit)));
        const second = controls.secondBatch[worker];
        if (second !== undefined) await refused(() => ref!.addTasks(second.map(asInit)));
      }
      else for (const step of controls.plans[worker] ?? []) {
        await refused(() => ref!.addTask(asInit(step)));
      }
      if (controls.probes.has(worker)) {
        const first = (controls.plans[worker] ?? [])[0]!;
        await refused(() => ref!.complete(first.id, "done by hand"));
        await refused(() => ref!.fail(first.id, "failed by hand"));
        await refused(() => ref!.setAssignee(first.id, "someone.else"));
        // A step runs after this turn, in this request: a wait on it would never end (FIX-2082).
        await refused(() => ref!.markWait!(first.id, { gateId: "probe", deadline: Date.now() + 60_000, requestId: "probe" }));
      }
      return `${worker} planned`;
    }
  });
  const planned = board.planned(turn);
  const resolveWorker = handler({
    name: "stepper-resolve-worker",
    inputSchema: z.unknown(),
    outputSchema: z.object({ worker: z.string() }),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => ({ worker: (await installation.resolveWorker(ctx, "stepper")).id })
  });
  return defineFlow({
    kind: "stepper",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    request: { onStarted: resolveWorker },
    actions: {
      respond: { inputSchema: doorInput.strict(), block: planned, userMessage: (input: { message: string }) => input.message },
      ...board.actions
    },
    internal: { actions: board.entries(planned) },
    task: { actions: { work: workerTaskEntry({ name: "stepper-task", turn: planned }) } }
  } as never);
}

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });

function host(options: { taskChainLimit?: number; durable?: boolean } = {}) {
  const controls: Controls = { plans: {}, failSteps: new Set(), stepFiles: new Set(), answerFiles: new Set(), batches: new Set(), secondBatch: {}, rules: [], probes: new Set(), refusals: [], turns: [], ownSession: new Set() };
  const h = bootBoardHost({
    standard: [
      ...boardWorkers(),
      worker("writer", { flow: "stepper" }),
      worker("editor", { flow: "stepper", delegates: ["writer"] })
    ],
    flows: (installation) => ({ stepper: { flow: stepperFlow(installation, controls), roles: ["contributor", "manager"] } }),
    ...(options.durable === true ? { durable: true } : {}),
    ...(options.taskChainLimit === undefined ? {} : { hire: { taskChainLimit: options.taskChainLimit } })
  });
  const open = async (userId: string, workerId: string): Promise<string> => {
    const created = await h.create(userId, "stepper", { state: { workerId } });
    if (created.status >= 300) throw new Error(`creating ${workerId}'s session failed: ${JSON.stringify(created.body)}`);
    return created.body.session!.id;
  };
  /** Every row of `userId`'s plan ledger, read from the store. */
  const steps = async (userId: string): Promise<Array<Task & { partition: string }>> => {
    const runtime = await h.state.getRuntime();
    const entries = await runtime.stores.resourceState.getByPrefix("user", `${userId}:~org:${ORG}`, "plan/");
    return Object.entries(entries)
      .map(([key, value]) => ({ ...(value.state as Task), partition: key.split("/")[1]! }))
      .sort((a, b) => a.createdAt - b.createdAt);
  };
  /** Every session the store holds. */
  const sessions = async () => (await (await h.state.getRuntime()).stores.session.list({})) as Array<{ id: string; state: Record<string, unknown> }>;
  return Object.assign(h, { controls, open, steps, sessions });
}

const outline: Step[] = [
  { id: "s-outline", goal: "Outline the post" },
  { id: "s-draft", goal: "Draft the post", deps: ["s-outline"] },
  { id: "s-tighten", goal: "Tighten the draft", deps: ["s-draft"] }
];

describe("a worker's steps for itself run in its own request (D1)", () => {
  it("works three steps in order in the same session, each seeing the one before, with no child session and no delegation row", async () => {
    const h = host();
    try {
      h.controls.plans.writer = outline;
      const talk = await h.open("alice", "writer");
      const before = (await h.sessions()).length;
      const result = await h.act("alice", talk, "respond", { message: "write me a post" }, "stepper");
      expect(result.error, messageOf(result.error)).toBeUndefined();
      await h.settled();

      const steps = await h.steps("alice");
      expect(steps.map((row) => [row.id, row.status, row.assignee])).toEqual([
        ["s-outline", "completed", "writer"],
        ["s-draft", "completed", "writer"],
        ["s-tighten", "completed", "writer"]
      ]);
      // Each started only after the one it depends on ended.
      expect(steps[1]!.startedAt!).toBeGreaterThanOrEqual(steps[0]!.completedAt!);
      expect(steps[2]!.startedAt!).toBeGreaterThanOrEqual(steps[1]!.completedAt!);
      // Each step's output carries the value only the step before it produced.
      expect(steps[1]!.output).toMatch(/Draft the post#done after \[.*Outline the post#done/);
      expect(steps[2]!.output).toMatch(/Tighten the draft#done after \[.*Draft the post#done/);
      // Every turn ran in the conversation itself: no session was opened for a step.
      expect(new Set(h.controls.turns.map((t) => t.sessionId))).toEqual(new Set([talk]));
      expect((await h.sessions()).length).toBe(before);
      // The conversation ledger holds no row: nothing was handed to a delegate.
      expect(await h.rows("alice")).toEqual([]);
      // One turn, three steps, one answer.
      expect(h.controls.turns.map((t) => t.kind)).toEqual(["turn", "step", "step", "step", "answer"]);
      // The answer saw every step end, and it is the request's result.
      const answer = h.controls.turns.at(-1)!.message;
      for (const step of outline) expect(answer).toContain(`"${step.goal}" (${step.id}) completed`);
      expect(result.output).toMatch(/^answered: The steps you filed for yourself have ended/);
      expect(result.output).toContain("Tighten the draft#done");
    } finally {
      await h.dispose();
    }
  });

  it("spends nothing more on a turn that files no step", async () => {
    const h = host();
    try {
      const talk = await h.open("alice", "writer");
      const result = await h.act("alice", talk, "respond", { message: "just answer" }, "stepper");
      expect(result.error, messageOf(result.error)).toBeUndefined();
      expect(result.output).toBe("writer planned");
      expect(h.controls.turns.map((t) => t.kind)).toEqual(["turn"]);
      expect(await h.steps("alice")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("answers around a failed step: it fails for good, the step after it never runs, and the answer names the failure", async () => {
    const h = host();
    try {
      h.controls.plans.writer = outline;
      h.controls.failSteps.add("Draft the post");
      const talk = await h.open("alice", "writer");
      const result = await h.act("alice", talk, "respond", { message: "write me a post" }, "stepper");
      expect(result.error, messageOf(result.error)).toBeUndefined();

      const steps = await h.steps("alice");
      expect(steps.map((row) => [row.id, row.status])).toEqual([
        ["s-outline", "completed"],
        ["s-draft", "errored"],
        ["s-tighten", "cancelled"]
      ]);
      // One attempt: a step that fails is the answering turn's to handle.
      expect(steps[1]!.attempts).toBe(1);
      expect(h.controls.turns.map((t) => t.kind)).toEqual(["turn", "step", "step", "answer"]);
      const answer = h.controls.turns.at(-1)!.message;
      expect(answer).toMatch(/"Draft the post" \(s-draft\) failed: .*Draft the post could not be done/);
      expect(answer).toContain(`"Tighten the draft" (s-tighten) cancelled`);
      // Nothing is left for a later turn to answer again.
      h.controls.plans.writer = [];
      const again = await h.act("alice", talk, "respond", { message: "anything else?" }, "stepper");
      expect(again.output).toBe("writer planned");
    } finally {
      await h.dispose();
    }
  });

  it("refuses a step the answering turn files for itself, and files nothing", async () => {
    const h = host();
    try {
      h.controls.plans.writer = [outline[0]!];
      h.controls.answerFiles.add("writer");
      const talk = await h.open("alice", "writer");
      const result = await h.act("alice", talk, "respond", { message: "outline it" }, "stepper");
      expect(result.error, messageOf(result.error)).toBeUndefined();
      expect(h.controls.refusals).toEqual([{ worker: "writer", error: "no_step_while_answering" }]);
      expect((await h.steps("alice")).map((row) => row.id)).toEqual(["s-outline"]);
      // Exactly one more model call for the planned request.
      expect(h.controls.turns.map((t) => t.kind)).toEqual(["turn", "step", "answer"]);
    } finally {
      await h.dispose();
    }
  });
});

describe("a step and a delegate's task don't wait on each other: each ledger's deps resolve only on that ledger", () => {
  it("refuses a step that depends on a task for a delegate, and files nothing", async () => {
    const h = host();
    try {
      h.controls.plans.editor = [
        { id: "w-draft", goal: "Draft the post", assignee: "writer" },
        { id: "e-review", goal: "Review the draft", deps: ["w-draft"] }
      ];
      const lead = await h.open("alice", "editor");
      expect((await h.act("alice", lead, "respond", { message: "plan it" }, "stepper")).error).toBeUndefined();
      await h.settled();
      expect(h.controls.refusals).toEqual([{ worker: "editor", error: "deps_across_ledgers" }]);
      expect(await h.steps("alice")).toEqual([]);
      // The task for the delegate was filed and ran.
      expect((await h.rows("alice")).map((row) => [row.id, row.status])).toEqual([["w-draft", "completed"]]);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a task for a delegate that depends on a step, and files nothing", async () => {
    const h = host();
    try {
      h.controls.plans.editor = [
        { id: "e-outline", goal: "Outline the post" },
        { id: "w-draft", goal: "Draft the post", assignee: "writer", deps: ["e-outline"] }
      ];
      const lead = await h.open("alice", "editor");
      expect((await h.act("alice", lead, "respond", { message: "plan it" }, "stepper")).error).toBeUndefined();
      await h.settled();
      expect(h.controls.refusals).toEqual([{ worker: "editor", error: "deps_across_ledgers" }]);
      expect(await h.rows("alice")).toEqual([]);
      expect((await h.steps("alice")).map((row) => [row.id, row.status])).toEqual([["e-outline", "completed"]]);
    } finally {
      await h.dispose();
    }
  });
});

describe("a batch of steps and delegates' tasks is filed whole or not at all", () => {
  it("files nothing, not even the delegate's task, when a step in the batch is refused", async () => {
    const h = host();
    try {
      h.controls.batches.add("editor");
      h.controls.plans.editor = [
        { id: "w-draft", goal: "Draft the post", assignee: "writer" },
        { id: "e-review", goal: "Review the draft", deps: ["e-ghost"] }
      ];
      const lead = await h.open("alice", "editor");
      expect((await h.act("alice", lead, "respond", { message: "plan it" }, "stepper")).error).toBeUndefined();
      await h.settled();
      expect(h.controls.refusals).toEqual([{ worker: "editor", error: "TaskFilingRefusedError" }]);
      // The refused step's batch reached neither ledger: the delegate never ran the draft.
      expect(await h.rows("alice")).toEqual([]);
      expect(await h.steps("alice")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("files a valid batch whose step comes before the step it depends on", async () => {
    const h = host();
    try {
      h.controls.batches.add("editor");
      h.controls.plans.editor = [
        { id: "w-draft", goal: "Draft the post", assignee: "writer" },
        { id: "e-review", goal: "Review the outline", deps: ["e-outline"] },
        { id: "e-outline", goal: "Outline the post" }
      ];
      const lead = await h.open("alice", "editor");
      expect((await h.act("alice", lead, "respond", { message: "plan it" }, "stepper")).error).toBeUndefined();
      await h.settled();
      expect(h.controls.refusals).toEqual([]);
      expect((await h.rows("alice")).map((row) => [row.id, row.status])).toEqual([["w-draft", "completed"]]);
      expect((await h.steps("alice")).map((row) => [row.id, row.status]).sort()).toEqual([
        ["e-outline", "completed"],
        ["e-review", "completed"]
      ]);
    } finally {
      await h.dispose();
    }
  });
});

describe("a batch is refused whole before anything is reserved or filed", () => {
  it("refuses a step whose id is already on the plan ledger, and files none of its batch", async () => {
    const h = host();
    try {
      h.controls.batches.add("editor");
      h.controls.plans.editor = [{ id: "e-a", goal: "Outline the post" }];
      h.controls.secondBatch.editor = [
        { id: "w-new", goal: "Draft the post", assignee: "writer" },
        { id: "e-a", goal: "Outline it again" }
      ];
      const lead = await h.open("alice", "editor");
      expect((await h.act("alice", lead, "respond", { message: "plan it" }, "stepper")).error).toBeUndefined();
      await h.settled();
      expect(h.controls.rules).toEqual(["duplicate_task_id"]);
      expect(await h.rows("alice")).toEqual([]);
      expect((await h.steps("alice")).map((row) => row.id)).toEqual(["e-a"]);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a step depending on a delegate's task in the same batch as across ledgers", async () => {
    const h = host();
    try {
      h.controls.batches.add("editor");
      h.controls.plans.editor = [
        { id: "w-draft", goal: "Draft the post", assignee: "writer" },
        { id: "e-review", goal: "Review the draft", deps: ["w-draft"] }
      ];
      const lead = await h.open("alice", "editor");
      expect((await h.act("alice", lead, "respond", { message: "plan it" }, "stepper")).error).toBeUndefined();
      await h.settled();
      expect(h.controls.rules).toEqual(["deps_across_ledgers"]);
      expect(await h.rows("alice")).toEqual([]);
      expect(await h.steps("alice")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a delegate's task depending on a step in the same batch as across ledgers", async () => {
    const h = host();
    try {
      h.controls.batches.add("editor");
      h.controls.plans.editor = [
        { id: "e-outline", goal: "Outline the post" },
        { id: "w-draft", goal: "Draft the post", assignee: "writer", deps: ["e-outline"] }
      ];
      const lead = await h.open("alice", "editor");
      expect((await h.act("alice", lead, "respond", { message: "plan it" }, "stepper")).error).toBeUndefined();
      await h.settled();
      expect(h.controls.rules).toEqual(["deps_across_ledgers"]);
      expect(await h.rows("alice")).toEqual([]);
      expect(await h.steps("alice")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});

describe("a step's own turn files no step: further work goes in its answer", () => {
  it("refuses a step filed while a step runs, and the request still answers once", async () => {
    const h = host();
    try {
      h.controls.plans.writer = [outline[0]!];
      h.controls.stepFiles.add("Outline the post");
      const talk = await h.open("alice", "writer");
      expect((await h.act("alice", talk, "respond", { message: "outline it" }, "stepper")).error).toBeUndefined();
      expect(h.controls.refusals).toEqual([{ worker: "writer", error: "no_step_while_stepping" }]);
      expect((await h.steps("alice")).map((row) => [row.id, row.status])).toEqual([["s-outline", "completed"]]);
      expect(h.controls.turns.map((t) => t.kind)).toEqual(["turn", "step", "answer"]);
    } finally {
      await h.dispose();
    }
  });

  it("tells the step to report further work in its answer", async () => {
    const h = host();
    try {
      h.controls.plans.writer = [outline[0]!];
      const talk = await h.open("alice", "writer");
      expect((await h.act("alice", talk, "respond", { message: "outline it" }, "stepper")).error).toBeUndefined();
      const step = h.controls.turns.find((t) => t.kind === "step")!;
      expect(step.message).toMatch(/say so in your answer rather than filing it/);
    } finally {
      await h.dispose();
    }
  });
});

describe("a step is the worker's: the tools settle no step, and nothing else files one (rule 18)", () => {
  it("refuses completing, failing, reassigning or waiting on a step by a call: the drain records its turn's return", async () => {
    const h = host();
    try {
      h.controls.plans.writer = [outline[0]!];
      h.controls.probes.add("writer");
      const talk = await h.open("alice", "writer");
      expect((await h.act("alice", talk, "respond", { message: "outline it" }, "stepper")).error).toBeUndefined();
      expect(h.controls.refusals.map((r) => r.error)).toEqual(["step_settles_itself", "step_settles_itself", "step_and_task_filed_apart", "step_cannot_wait"]);
      const [row] = await h.steps("alice");
      expect(row).toMatchObject({ id: "s-outline", status: "completed", output: "Outline the post#done", assignee: "writer" });
    } finally {
      await h.dispose();
    }
  });

  it("refuses a public action that files for the session's own worker: it is no delegate", async () => {
    const h = host();
    try {
      const lead = await h.open("alice", "editor");
      const filed = await h.act("alice", lead, "createTask_tasks", { goal: "Edit it myself", assignee: "editor" }, "stepper");
      expect(filed.output).toMatchObject({ ok: false, error: expect.stringMatching(/^unknown_assignee: "editor"/) });
      expect(await h.rows("alice")).toEqual([]);
      expect(await h.steps("alice")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("lists a step beside the session's tasks through the task actions", async () => {
    const h = host();
    try {
      h.controls.plans.editor = [{ id: "e-plan", goal: "Plan the edit" }];
      const lead = await h.open("alice", "editor");
      expect((await h.act("alice", lead, "respond", { message: "plan the edit" }, "stepper")).error).toBeUndefined();
      expect((await h.act("alice", lead, "createTask_tasks", { goal: "Write the piece", assignee: "writer" }, "stepper")).output).toMatchObject({ ok: true });
      await h.settled();
      const listed = (await h.act("alice", lead, "listTasks_tasks", {}, "stepper")).output as { tasks: Array<{ id: string; assignee: string }> };
      expect(listed.tasks.map((task) => task.assignee).sort()).toEqual(["editor", "writer"]);
    } finally {
      await h.dispose();
    }
  });
});

describe("a task session works its steps in its task's request (D1, D2)", () => {
  it("completes its task with the answering turn's answer, in its own session, never parked on its steps", async () => {
    const h = host();
    try {
      h.controls.plans.writer = outline;
      const lead = await h.open("alice", "editor");
      const filed = await h.act("alice", lead, "createTask_tasks", { goal: "Write me a post", assignee: "writer" }, "stepper");
      expect(filed.output).toMatchObject({ ok: true });
      await h.settled();

      const [task] = await h.rows("alice");
      expect(task).toMatchObject({ goal: "Write me a post", status: "completed", assignee: "writer" });
      const taskSession = task!.run!.sessionId;
      // The answer is the result: one answer, not `{ answer, pieces }`.
      expect(task!.output).toMatch(/^answered: The steps you filed for yourself have ended/);
      // The steps sit on the task session's own plan ledger, apart from the task.
      const steps = await h.steps("alice");
      expect(steps.map((row) => row.status)).toEqual(["completed", "completed", "completed"]);
      expect(new Set(steps.map((row) => row.partition)).size).toBe(1);
      expect(steps[0]!.partition).not.toBe(task!.partition);
      // Every turn of the writer ran in its one task session.
      expect(new Set(h.controls.turns.filter((t) => t.worker === "writer").map((t) => t.sessionId))).toEqual(new Set([taskSession]));
      // No delegation row but the task itself: a session of its own for a step would need one.
      expect((await h.rows("alice")).map((row) => row.id)).toEqual([task!.id]);
    } finally {
      await h.dispose();
    }
  });

  it("counts its steps toward the chain under its top task, as pieces were", async () => {
    const h = host({ taskChainLimit: 2 });
    try {
      h.controls.plans.writer = outline;
      const lead = await h.open("alice", "editor");
      expect((await h.act("alice", lead, "createTask_tasks", { goal: "Write me a post", assignee: "writer" }, "stepper")).output).toMatchObject({ ok: true });
      await h.settled();
      // Two steps fit under the limit of two; the third is refused, as a third piece would be.
      expect(h.controls.refusals).toEqual([{ worker: "writer", error: "TaskCapExceededError" }]);
      expect((await h.steps("alice")).map((row) => row.id)).toEqual(["s-outline", "s-draft"]);
    } finally {
      await h.dispose();
    }
  });
});

describe("a step filed session: \"new\" runs in a session of its own, and its drain waits on it (FIX-2082 D2)", () => {
  const plan: Step[] = [
    { id: "s-outline", goal: "Outline the post" },
    { id: "s-check", goal: "Fact-check the outline", deps: ["s-outline"], session: "new" },
    { id: "s-draft", goal: "Draft the post", deps: ["s-check"] }
  ];

  it("hands it to a new session of the same worker; the next step sees what that session produced", async () => {
    const h = host({ durable: true });
    try {
      await h.state.getRouter();
      h.controls.plans.writer = plan;
      h.controls.ownSession.add("Fact-check the outline");
      const talk = await h.open("alice", "writer");
      const run = await h.act("alice", talk, "respond", { message: "write a post" }, "stepper");
      expect(run.error, messageOf(run.error)).toBeUndefined();
      await h.settled(20_000);

      const steps = await h.steps("alice");
      expect(steps.map((row) => [row.id, row.status])).toEqual([
        ["s-outline", "completed"],
        ["s-check", "completed"],
        ["s-draft", "completed"]
      ]);
      const check = steps.find((row) => row.id === "s-check")!;
      const own = /#own@(\S+)$/.exec(String(check.output))![1]!;
      // Its own session: not the conversation's, and a writer session born for this step.
      expect(own).not.toBe(talk);
      expect(h.controls.turns.filter((t) => t.sessionId === own).map((t) => t.worker)).toEqual(["writer"]);
      // The inline steps ran in the conversation, the next one after it, seeing its result.
      const draftTurn = h.controls.turns.find((t) => t.kind === "step" && t.message.includes("Draft the post"))!;
      expect(draftTurn.sessionId).toBe(talk);
      expect(draftTurn.message).toContain(own);
      // The request answered once, after every step ended, and no notice of a step reached anyone.
      expect(h.controls.turns.filter((t) => t.sessionId === talk && t.kind === "answer")).toHaveLength(1);
      expect(h.controls.turns.filter((t) => t.message.startsWith('Task "'))).toEqual([]);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  // The plan's last open step is the one in its own session: when it ends, nothing is left to work,
  // and the request that waited on it still owes the worker's answer (FIX-2110).
  it("answers once after it when it is the plan's last step, and the answer is the request's result", async () => {
    const h = host({ durable: true });
    try {
      await h.state.getRouter();
      h.controls.plans.writer = plan.slice(0, 2);
      h.controls.ownSession.add("Fact-check the outline");
      const talk = await h.open("alice", "writer");
      const run = await h.act("alice", talk, "respond", { message: "write a post" }, "stepper");
      expect(run.error, messageOf(run.error)).toBeUndefined();
      await h.settled(20_000);

      const steps = await h.steps("alice");
      expect(steps.map((row) => [row.id, row.status])).toEqual([
        ["s-outline", "completed"],
        ["s-check", "completed"]
      ]);
      const own = /#own@(\S+)$/.exec(String(steps.find((row) => row.id === "s-check")!.output))![1]!;
      const answers = h.controls.turns.filter((t) => t.sessionId === talk && t.kind === "answer");
      expect(answers).toHaveLength(1);
      // Told how the step in its own session ended: with what only that session produced.
      expect(answers[0]!.message).toContain(own);
      // The request's result is that answer, not the turn's before the drain.
      const requests = await (await h.state.getRuntime()).stores.request.list({ sessionId: talk });
      const respond = requests.find((r) => r.actionName === "respond");
      expect(respond?.status).toBe("completed");
      expect(String(respond?.result?.output)).toMatch(/^answered: The steps you filed for yourself have ended/);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  // A step in its own session can end while the drain that waits on it is still parking: its resume
  // is refused busy and stays owed. The session's pass retries it at its due time, so the request
  // answers in seconds, not at the wait's deadline five minutes on.
  it("still resumes the drain promptly when the step ends while the drain is parking", async () => {
    const h = host({ durable: true });
    try {
      await h.state.getRouter();
      h.controls.plans.writer = plan.slice(0, 2);
      h.controls.ownSession.add("Fact-check the outline");
      h.controls.parkDelayMs = 100;
      const talk = await h.open("alice", "writer");
      const run = await h.act("alice", talk, "respond", { message: "write a post" }, "stepper");
      expect(run.error, messageOf(run.error)).toBeUndefined();

      const runtime = await h.state.getRuntime();
      const deadline = Date.now() + 10_000;
      let respond: { status: string } | undefined;
      for (;;) {
        respond = (await runtime.stores.request.list({ sessionId: talk })).find((r) => r.actionName === "respond");
        if (respond?.status === "completed" || Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(respond?.status).toBe("completed");
      expect((await h.steps("alice")).map((row) => [row.id, row.status])).toEqual([
        ["s-outline", "completed"],
        ["s-check", "completed"]
      ]);
      expect(h.controls.turns.filter((t) => t.sessionId === talk && t.kind === "answer")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("refuses a step filed session: \"ongoing\": a step runs here, or in a new session of its own", async () => {
    const h = host({ durable: true });
    try {
      h.controls.plans.writer = [{ id: "s-ongoing", goal: "Keep at it", session: "ongoing" }];
      const talk = await h.open("alice", "writer");
      await h.act("alice", talk, "respond", { message: "keep at it" }, "stepper");
      expect(h.controls.rules).toEqual(["step_session_ongoing"]);
      expect(await h.steps("alice")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});
