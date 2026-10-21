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
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { defineSessionBoard, workerConfigSchema, type WorkerManifest } from "../src";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import type { WorkerInstallation } from "../src/workers/installation";
import { ORG, boardWorkers, bootBoardHost, messageOf } from "./conversation-board-harness";

type Step = { id: string; goal: string; deps?: string[] };

type Controls = {
  plans: Record<string, Step[]>;
  failSteps: Set<string>;
  answerFiles: Set<string>;
  /** A worker whose plan turn also tries the writes a step refuses. */
  probes: Set<string>;
  refusals: Array<{ worker: string; error: string }>;
  turns: Array<{ worker: string; sessionId: string; kind: "turn" | "step" | "answer"; message: string }>;
};

const doorInput = z.object({ message: z.string() });
const STEP = "A step you filed for yourself";
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
        }
      };
      if (kind === "step") {
        const brief = input.message.split("The results of the steps it depends on:")[0]!;
        const step = (controls.plans[worker] ?? []).find((candidate) => brief.includes(candidate.goal));
        if (step === undefined) throw new Error(`no step matches: ${input.message}`);
        if (controls.failSteps.has(step.goal)) throw new Error(`${step.goal} could not be done`);
        // A value only this step produces, carrying what it saw of the step before.
        const before = /The results of the steps it depends on:\n([\s\S]*)$/.exec(input.message)?.[1] ?? "";
        return `${step.goal}#done${before.length > 0 ? ` after [${before.trim()}]` : ""}`;
      }
      if (kind === "answer") {
        if (controls.answerFiles.has(worker)) await refused(() => ref!.addTask({ goal: "one more step", assignee: worker }));
        return `answered: ${input.message}`;
      }
      if (input.message.startsWith('Task "')) return `${worker} heard: ${input.message}`;
      for (const step of controls.plans[worker] ?? []) {
        await refused(() => ref!.addTask({ id: step.id, goal: step.goal, assignee: worker, ...(step.deps ? { deps: step.deps } : {}) }));
      }
      if (controls.probes.has(worker)) {
        const first = (controls.plans[worker] ?? [])[0]!;
        await refused(() => ref!.complete(first.id, "done by hand"));
        await refused(() => ref!.fail(first.id, "failed by hand"));
        await refused(() => ref!.setAssignee(first.id, "someone.else"));
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
      run: { inputSchema: doorInput.strict(), block: planned, userMessage: (input: { message: string }) => input.message },
      ...board.actions
    },
    internal: { actions: board.entries(planned) },
    task: { actions: { work: workerTaskEntry({ name: "stepper-task", turn: planned }) } }
  } as never);
}

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });

function host(options: { taskChainLimit?: number } = {}) {
  const controls: Controls = { plans: {}, failSteps: new Set(), answerFiles: new Set(), probes: new Set(), refusals: [], turns: [] };
  const h = bootBoardHost({
    standard: [
      ...boardWorkers(),
      worker("writer", { flow: "stepper" }),
      worker("editor", { flow: "stepper", delegates: ["writer"] })
    ],
    flows: (installation) => ({ stepper: stepperFlow(installation, controls) }),
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
      const result = await h.act("alice", talk, "run", { message: "write me a post" }, "stepper");
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
      const result = await h.act("alice", talk, "run", { message: "just answer" }, "stepper");
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
      const result = await h.act("alice", talk, "run", { message: "write me a post" }, "stepper");
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
      const again = await h.act("alice", talk, "run", { message: "anything else?" }, "stepper");
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
      const result = await h.act("alice", talk, "run", { message: "outline it" }, "stepper");
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

describe("a step is the worker's: the tools settle no step, and nothing else files one (rule 18)", () => {
  it("refuses completing, failing or reassigning a step by a call: the drain records its turn's return", async () => {
    const h = host();
    try {
      h.controls.plans.writer = [outline[0]!];
      h.controls.probes.add("writer");
      const talk = await h.open("alice", "writer");
      expect((await h.act("alice", talk, "run", { message: "outline it" }, "stepper")).error).toBeUndefined();
      expect(h.controls.refusals.map((r) => r.error)).toEqual(["step_settles_itself", "step_settles_itself", "step_and_task_filed_apart"]);
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
      const filed = await h.act("alice", lead, "dispatchTask_tasks", { goal: "Edit it myself", assignee: "editor" }, "stepper");
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
      expect((await h.act("alice", lead, "run", { message: "plan the edit" }, "stepper")).error).toBeUndefined();
      expect((await h.act("alice", lead, "dispatchTask_tasks", { goal: "Write the piece", assignee: "writer" }, "stepper")).output).toMatchObject({ ok: true });
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
      const filed = await h.act("alice", lead, "dispatchTask_tasks", { goal: "Write me a post", assignee: "writer" }, "stepper");
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
      expect((await h.act("alice", lead, "dispatchTask_tasks", { goal: "Write me a post", assignee: "writer" }, "stepper")).output).toMatchObject({ ok: true });
      await h.settled();
      // Two steps fit under the limit of two; the third is refused, as a third piece would be.
      expect(h.controls.refusals).toEqual([{ worker: "writer", error: "TaskCapExceededError" }]);
      expect((await h.steps("alice")).map((row) => row.id)).toEqual(["s-outline", "s-draft"]);
    } finally {
      await h.dispose();
    }
  });
});
