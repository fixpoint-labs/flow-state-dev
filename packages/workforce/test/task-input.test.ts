/**
 * A flow's `work` entry declares what its tasks take, and every write path
 * and the claim check it (FIX-2894). On the real engine and the real board:
 * every grade reads the stored task and the input the worker block was
 * handed, never a tool's reply alone.
 *
 * - **Refuse.** A misfit is refused `input_refused`, naming the field, and no
 *   stored is written: `createTask`, a batch (refused whole), `updateTask`, a
 *   move, and the raw handle a task session is handed.
 * - **Own.** A filer's server-owned value is dropped and the filler's
 *   stored; an edit keeps the stored one; a `check` that changes one, even
 *   nested and in place, is refused and nothing is written.
 * - **Round trip.** A value the JSON round trip changes is refused at the
 *   write, by name; a schema that can break it is refused at build.
 * - **Move (D2).** Assigning an unassigned stored, or moving one onto a declared
 *   flow, runs the filler and the parse; a reassign within the flow keeps the
 *   stored values.
 * - **Stamp and claim.** A stored whose stamp names another declaration has its
 *   server-owned values filled again at claim (`at: "claim"`); a task that no
 *   longer fits fails its attempt and the block never runs; one the flow's
 *   `stored` maps runs on the mapped input.
 * - **Open.** A flow that declares nothing stores any object as sent.
 * - **Project.** A declaration that requires a project refuses `no_project`.
 * - **Discover (D3).** `listDelegates` shows the filer's fields as inlined
 *   draft-07 JSON Schema, without the server-owned ones.
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { TaskWriteRefusedError } from "@flow-state-dev/orchestration/tasks";
import { defineSessionBoard, filingConversationBoard, taskInputSchema, workerConfigSchema, workerFlow, type WorkerManifest } from "../src";
import { workerTaskEntry, type WorkerTaskBlockInput } from "../src/conversation-board/task-entry";
import { conversationLedgerResources } from "../src/conversation-board/ledger";
import { MESSAGE_RECEIVED_ENTRY } from "../src/messages/keys";
import { workerMessagesResources } from "../src/messages/message-log";
import { messageReceivedEntry } from "../src/messages/message-received-entry";
import type { WorkerInstallation } from "../src/workers/installation";
import { resolveWorkerFlows } from "../src/hire";
import { FILLED_FOR } from "../src/task-input/filing-check";
import { changeDelegates } from "../src/delegates/delegate-list";
import { boardWorkers, bootBoardHost } from "./conversation-board-harness";

type Host = ReturnType<typeof bootBoardHost>;
type Output = { ok: boolean; taskId?: string; error?: string };

/** What a test makes the triage flow's hooks do. */
const behaviour: { check?: "rewrite" | "nested" | "date" | "swap" } = {};
/** Each run of a declared flow's block: the task and the input it was handed. */
const seen: Array<{ flow: string; taskId: string; input: unknown }> = [];
/** What the raw-handle worker's writes came to. */
const raw: { writes: Array<() => Promise<unknown>>; outcomes: string[] } = { writes: [], outcomes: [] };

const userOf = (ctx: BlockContext): string => (ctx as { user?: { identity?: { userId?: string } } }).user?.identity?.userId ?? "";

const triageSchema = z
  .object({
    ticket: z.string().regex(/^ENG-\d+$/),
    severity: z.enum(["low", "high"]).default("low").describe('"high" only for a worker that is on call; any other worker refuses it'),
    meta: z.unknown().optional(),
    requestedBy: z.string().min(1),
    audit: z.object({ by: z.string() })
  })
  .strict();

const triage = taskInputSchema(triageSchema, {
  // `doneWhen` lies outside the schema: a server-owned name there is only dropped.
  serverOwned: ["requestedBy", "audit", "doneWhen"],
  fill: ({ ctx, at }) => ({ requestedBy: `u_${userOf(ctx)}`, audit: { by: at } }),
  refuse: (sent) => {
    if ("ticketId" in sent) throw new TaskWriteRefusedError("old_key", "ticketId is no longer accepted; send ticket instead. Nothing was filed.");
  },
  check: async (input, { assignee, worker, ctx }) => {
    if (input.severity === "high" && worker.config.onCall !== true) {
      throw new TaskWriteRefusedError("not_on_call", `"${assignee}" isn't on call, so it takes no high-severity task. Nothing was filed.`);
    }
    if (behaviour.check === "rewrite") return { ...input, requestedBy: "u_admin" };
    if (behaviour.check === "nested") {
      input.audit.by = "u_admin";
      return input;
    }
    if (behaviour.check === "date") return { ...input, meta: { seenAt: new Date(0) } };
    if (behaviour.check === "swap") {
      // The conversation's only delegate changes while the filing is checked: ops.triager out, ops.intern in.
      behaviour.check = undefined;
      await changeDelegates(ctx.session as never, { delegates: ["ops.triager"] }, { remove: { worker: "ops.triager" } });
      await changeDelegates(ctx.session as never, { delegates: [] }, { add: { worker: "ops.intern" } });
    }
    return input;
  },
  stored: (stored) => {
    if (!("ticketId" in stored)) return stored;
    const { ticketId, ...rest } = stored;
    return { ...rest, ticket: ticketId };
  }
});

const intake = taskInputSchema(z.object({ ticket: z.string(), queue: z.string().default("main"), requestedBy: z.string() }).strict(), {
  serverOwned: ["requestedBy"],
  fill: ({ ctx }) => ({ requestedBy: `intake:${userOf(ctx)}` })
});

/** A worker flow whose `work` entry declares `input`, recording what its block is handed. */
function declaredFlow(installation: WorkerInstallation, flowName: string, input: ReturnType<typeof taskInputSchema<any>>) {
  const block = handler({
    name: `${flowName}-block`,
    inputSchema: z.unknown(),
    resources: { ...installation.resources },
    execute: async (task: unknown) => {
      const handed = task as WorkerTaskBlockInput;
      seen.push({ flow: flowName, taskId: handed.taskId, input: handed.input });
      return "done";
    }
  });
  const door = handler({ name: `${flowName}-door`, inputSchema: z.object({ message: z.string() }), execute: () => "hi" });
  return defineFlow({
    kind: flowName,
    configSchema: workerConfigSchema().extend({ onCall: z.boolean().optional() }),
    session: installation.session(),
    resources: { ...installation.resources, ...conversationLedgerResources, ...workerMessagesResources },
    actions: { respond: { inputSchema: z.object({ message: z.string() }), block: door, userMessage: (i: { message: string }) => i.message } },
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: flowName, hears: "task-sessions" }) } },
    task: { actions: { work: workerTaskEntry({ name: `${flowName}-work`, block, inputSchema: input }) } }
  } as never);
}

/** A worker flow that declares nothing, whose block writes through the raw handle its task session is handed. */
function rawFlow(installation: WorkerInstallation) {
  const block = handler({
    name: "rawfiler-block",
    inputSchema: z.unknown(),
    resources: { ...installation.resources },
    execute: async (_task: unknown, ctx) => {
      await installation.resolveWorker(ctx as never, "rawfiler");
      const filed = await filingConversationBoard(ctx as never);
      for (const write of raw.writes.splice(0)) {
        try {
          const said = await (write as unknown as (tasks: unknown) => Promise<unknown>)(filed!.tasks);
          raw.outcomes.push(typeof said === "string" ? said : "ok");
        } catch (error) {
          raw.outcomes.push(error instanceof TaskWriteRefusedError ? `${error.code}: ${error.message}` : String(error));
        }
      }
      return "done";
    }
  });
  const door = handler({ name: "rawfiler-door", inputSchema: z.object({ message: z.string() }), execute: () => "hi" });
  return defineFlow({
    kind: "rawfiler",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...conversationLedgerResources, ...workerMessagesResources },
    actions: { respond: { inputSchema: z.object({ message: z.string() }), block: door, userMessage: (i: { message: string }) => i.message } },
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "rawfiler", hears: "task-sessions" }) } },
    task: { actions: { work: workerTaskEntry({ name: "rawfiler-work", block }) } }
  } as never);
}

/** What the planner's turn files for itself, and what each filing came to. */
const planner: { steps: Array<Record<string, unknown>>; outcomes: unknown[] } = { steps: [], outcomes: [] };

/** A worker whose own turn files steps for itself, `session: "new"`, through its declared `work` entry. */
function plannerFlow(installation: WorkerInstallation) {
  const board = defineSessionBoard({ installation, flowKind: "planner" });
  const turn = handler({
    name: "planner-turn",
    inputSchema: z.object({ message: z.string() }),
    resources: { ...installation.resources, ...board.resources },
    execute: async (input, ctx) => {
      if (input.message.startsWith("You are working a step") || input.message.startsWith("The steps you filed")) return "done";
      const ref = await board.board.turnResolver(ctx as never);
      for (const step of planner.steps.splice(0)) {
        try {
          const added = await ref!.createTask({ goal: "a step", assignee: "ops.planner", session: "new", ...step } as never);
          planner.outcomes.push({ assignee: added.assignee, input: added.input, stamp: added.metadata?.[FILLED_FOR] });
        } catch (error) {
          planner.outcomes.push(error instanceof TaskWriteRefusedError ? `${error.code}: ${error.message}` : String(error));
        }
      }
      return "planned";
    }
  });
  const planned = board.planned(turn);
  const resolveWorker = handler({
    name: "planner-resolve-worker",
    inputSchema: z.unknown(),
    outputSchema: z.object({}),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => {
      await installation.resolveWorker(ctx, "planner");
      return {};
    }
  });
  return defineFlow({
    kind: "planner",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    request: { onStarted: resolveWorker },
    actions: { respond: { inputSchema: z.object({ message: z.string() }), block: planned, userMessage: (i: { message: string }) => i.message }, ...board.actions },
    internal: { actions: board.entries(planned) },
    task: { actions: { work: workerTaskEntry({ name: "planner-work", turn: planned, inputSchema: triage }) } }
  } as never);
}

/** The filing conversation: a session board whose actions are the task tools, and a batch filing. */
function filerFlow(installation: WorkerInstallation) {
  const board = defineSessionBoard({ installation, flowKind: "filer" });
  const turn = handler({ name: "filer-turn", inputSchema: z.object({ message: z.string() }), execute: () => "noted" });
  const batch = handler({
    name: "filer-batch",
    inputSchema: z.object({ tasks: z.array(z.record(z.unknown())) }),
    resources: { ...installation.resources, ...board.resources },
    execute: async (input, ctx) => {
      const ref = await board.board.resolver(ctx as never);
      try {
        const added = await ref!.createTasks(input.tasks as never);
        return { ok: true, ids: added.map((stored) => stored.id) };
      } catch (error) {
        return { ok: false, error: error instanceof TaskWriteRefusedError ? `${error.code}: ${error.message}` : String(error) };
      }
    }
  });
  const routed = handler({
    name: "filer-routed",
    inputSchema: z.object({ id: z.string(), assignee: z.string(), input: z.record(z.unknown()) }),
    resources: { ...installation.resources, ...board.resources },
    execute: async (input, ctx) => {
      try {
        return { ok: true, outcome: await board.board.fileRouted(ctx as never, { id: input.id, goal: "routed", assignee: input.assignee, input: input.input }) };
      } catch (error) {
        return { ok: false, error: error instanceof TaskWriteRefusedError ? `${error.code}: ${error.message}` : String(error) };
      }
    }
  });
  const resolveWorker = handler({
    name: "filer-resolve-worker",
    inputSchema: z.unknown(),
    outputSchema: z.object({}),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => {
      await installation.resolveWorker(ctx, "filer");
      return {};
    }
  });
  return defineFlow({
    kind: "filer",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    request: { onStarted: resolveWorker },
    actions: {
      respond: { inputSchema: z.object({ message: z.string() }), block: turn, userMessage: (i: { message: string }) => i.message },
      batch: { inputSchema: z.object({ tasks: z.array(z.record(z.unknown())) }), block: batch },
      routed: { inputSchema: z.object({ id: z.string(), assignee: z.string(), input: z.record(z.unknown()) }), block: routed },
      ...board.actions,
      ...board.delegates.actions
    },
    internal: { actions: board.entries(turn) }
  } as never);
}

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });

function boot(): Host {
  return bootBoardHost({
    standard: [
      ...boardWorkers(),
      worker("jane.solo", { flow: "filer", delegates: ["ops.triager"] }),
      worker("jane.desk", { flow: "filer", delegates: ["ops.triager", "ops.intern", "ops.helper", "ops.intake", "ops.raw", "ops.proj"] }),
      worker("ops.triager", { flow: "triage", description: "Triages incidents", onCall: true }),
      worker("ops.intern", { flow: "triage", description: "Triages incidents, off call" }),
      worker("ops.intake", { flow: "intake", description: "Takes in tickets" }),
      worker("ops.helper", { flow: "helper", description: null }),
      worker("ops.raw", { flow: "rawfiler", description: "Files through the raw handle" }),
      worker("ops.proj", { flow: "projtaker", description: "Works in a project" }),
      worker("ops.planner", { flow: "planner", description: "Plans its own steps" })
    ],
    flows: (installation) => ({
      filer: { flow: filerFlow(installation), roles: ["manager"] },
      triage: { flow: declaredFlow(installation, "triage", triage), roles: ["contributor"] },
      intake: { flow: declaredFlow(installation, "intake", intake), roles: ["contributor"] },
      rawfiler: { flow: rawFlow(installation), roles: ["contributor"] },
      planner: { flow: plannerFlow(installation), roles: ["contributor", "manager"] },
      projtaker: {
        flow: declaredFlow(installation, "projtaker", taskInputSchema(z.record(z.string(), z.unknown()), { project: "required" })),
        roles: ["contributor"]
      }
    })
  });
}

let host: Host | undefined;
afterEach(async () => {
  behaviour.check = undefined;
  seen.length = 0;
  raw.writes.length = 0;
  raw.outcomes.length = 0;
  planner.steps.length = 0;
  planner.outcomes.length = 0;
  await host?.dispose();
  host = undefined;
});

/** A filing conversation for `worker`, and its board's partition. */
async function conversation(h: Host, workerId = "jane.desk") {
  const created = await h.create("jane", "filer", { state: { workerId } });
  const id = created.body.session!.id;
  return { id, partition: ((await h.act("jane", id, "listDelegates", {}, "filer")).output as { filingSessionId: string }).filingSessionId };
}

const file = async (h: Host, conv: string, input: Record<string, unknown>) => (await h.act("jane", conv, "createTask_tasks", input, "filer")).output as Output;
const update = async (h: Host, conv: string, input: Record<string, unknown>) => (await h.act("jane", conv, "updateTask_tasks", input, "filer")).output as Output;
const tasksOf = async (h: Host) => h.rows("jane");

describe("filing for a declared flow", () => {
  it("applies the default and the filler, and stamps the task for the flow and declaration", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const filed = await file(host, id, { assignee: "ops.triager", goal: "Why is checkout slow?", input: { ticket: "ENG-142" }, held: true });
    expect(filed).toMatchObject({ ok: true });
    const stored = await host.row("jane", partition, filed.taskId!);
    expect(stored?.input).toEqual({ ticket: "ENG-142", severity: "low", requestedBy: "u_jane", audit: { by: "filing" } });
    expect(stored?.metadata?.[FILLED_FOR]).toEqual({ flow: "triage", declaration: triage.fingerprint });
  });

  it("drops a filer's server-owned values and stores the filler's", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const filed = await file(host, id, {
      assignee: "ops.triager",
      goal: "g",
      input: { ticket: "ENG-142", severity: "high", requestedBy: "u_admin", audit: { by: "u_admin" }, doneWhen: "never" },
      held: true
    });
    expect(filed).toMatchObject({ ok: true });
    expect((await host.row("jane", partition, filed.taskId!))?.input).toEqual({ ticket: "ENG-142", severity: "high", requestedBy: "u_jane", audit: { by: "filing" } });
  });

  it("checks a filing with no assignee against the conversation's only task-taking delegate", async () => {
    host = boot();
    const { id, partition } = await conversation(host, "jane.solo");
    const filed = await file(host, id, { goal: "g", input: { ticket: "ENG-142" }, held: true });
    const stored = await host.row("jane", partition, filed.taskId!);
    expect(stored).toMatchObject({ assignee: "ops.triager", input: { ticket: "ENG-142", severity: "low", requestedBy: "u_jane" } });
    expect(await file(host, id, { goal: "another", input: { ticket: 142 } })).toMatchObject({ ok: false, error: expect.stringMatching(/^input_refused: /) });
  });

  it("refuses a misfit naming the delegate, its flow, the path and what was expected, and writes no task", async () => {
    host = boot();
    const { id } = await conversation(host);
    const refused = await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: 142 } });
    expect(refused.error).toBe(
      'input_refused: this task\'s input doesn\'t fit what "ops.triager" takes (flow "triage"): at "ticket", expected string, received number. ' +
        "Read what it takes with listDelegates. Nothing was filed."
    );
    expect((await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-142", urgent: true } })).error).toContain('unrecognized key "urgent"');
    expect((await file(host, id, { assignee: "ops.triager", goal: "g", input: {} })).error).toContain('at "ticket", required');
    expect((await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-1", severity: "urgent" } })).error).toContain(
      'at "severity", expected "low" | "high", received "urgent"'
    );
    expect(await tasksOf(host)).toEqual([]);
  });

  it("refuses a batch whole when one task doesn't fit", async () => {
    host = boot();
    const { id } = await conversation(host);
    const out = (await host.act("jane", id, "batch", {
      tasks: [
        { assignee: "ops.triager", goal: "fits", input: { ticket: "ENG-1" } },
        { assignee: "ops.triager", goal: "doesn't", input: { ticket: 2 } }
      ]
    }, "filer")).output as Output;
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^input_refused: .*at "ticket"/) });
    expect(await tasksOf(host)).toEqual([]);
  });

  it("runs the flow's refuse on what was sent, and its check on the parsed input, by worker", async () => {
    host = boot();
    const { id } = await conversation(host);
    expect((await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticketId: "ENG-142" } })).error).toMatch(/^old_key: /);
    expect((await file(host, id, { assignee: "ops.intern", goal: "g", input: { ticket: "ENG-142", severity: "high" } })).error).toBe(
      'not_on_call: "ops.intern" isn\'t on call, so it takes no high-severity task. Nothing was filed.'
    );
    expect(await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-142", severity: "high" }, held: true })).toMatchObject({ ok: true });
  });

  it("refuses a check that changes a server-owned value, a new one or one mutated in place, and writes nothing", async () => {
    host = boot();
    const { id } = await conversation(host);
    behaviour.check = "rewrite";
    expect((await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-1" } })).error).toBe(
      'input_refused: flow "triage"\'s check changed "requestedBy", which only its filler writes. This is a bug in the flow, not in the task. Nothing was filed.'
    );
    behaviour.check = "nested";
    expect((await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-1" } })).error).toContain('changed "audit"');
    expect(await tasksOf(host)).toEqual([]);
  });

  it("refuses a value the JSON round trip would change, by name, at the write", async () => {
    host = boot();
    const { id } = await conversation(host);
    behaviour.check = "date";
    expect((await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-1" } })).error).toBe(
      'input_refused: this task\'s input for "ops.triager" (flow "triage") doesn\'t survive being stored: at "meta.seenAt", a Date becomes a string. ' +
        "Store plain JSON values. Nothing was filed."
    );
    expect(await tasksOf(host)).toEqual([]);
  });

  it("stores any object as sent for a flow that declares nothing", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const filed = await file(host, id, { assignee: "ops.helper", goal: "Summarise", input: { notes: ["a", "b"], n: 3, requestedBy: "u_admin" }, held: true });
    const stored = await host.row("jane", partition, filed.taskId!);
    expect(stored?.input).toEqual({ notes: ["a", "b"], n: 3, requestedBy: "u_admin" });
    expect(stored?.metadata?.[FILLED_FOR]).toBeUndefined();
  });

  it("refuses a task for a flow that requires a project when the conversation has none", async () => {
    host = boot();
    const { id } = await conversation(host);
    expect((await file(host, id, { assignee: "ops.proj", goal: "g", input: {} })).error).toMatch(/^no_project: "ops.proj" works in a project's files/);
    expect(await tasksOf(host)).toEqual([]);
  });
});

describe("editing and moving a task", () => {
  it("keeps the stored server-owned values on an edit, and refuses an edit that doesn't fit", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const filed = await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-142" }, held: true });
    // Another user's turn would fill another value: the edit keeps the stored one, whatever is sent.
    expect(await update(host, id, { id: filed.taskId, input: { ticket: "ENG-150", requestedBy: "u_admin", audit: { by: "u_admin" } } })).toMatchObject({ ok: true });
    expect((await host.row("jane", partition, filed.taskId!))?.input).toEqual({ ticket: "ENG-150", severity: "low", requestedBy: "u_jane", audit: { by: "filing" } });
    expect((await update(host, id, { id: filed.taskId, input: { ticket: "150" } })).error).toMatch(/^input_refused: .*at "ticket", invalid.*Nothing was filed\.$/);
    expect((await host.row("jane", partition, filed.taskId!))?.input).toMatchObject({ ticket: "ENG-150" });
  });

  it("treats an edit of a task stored before rows carried the stamp as a filing", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const filed = await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-9" }, held: true });
    const stored = (await host.row("jane", partition, filed.taskId!))!;
    const { [FILLED_FOR]: _stamp, ...metadata } = stored.metadata ?? {};
    await host.writeRow("jane", partition, { ...stored, metadata, input: { ticketId: "ENG-9", requestedBy: "u_admin" } });
    expect(await update(host, id, { id: filed.taskId, input: { ticket: "ENG-9", severity: "high" } })).toMatchObject({ ok: true });
    const after = await host.row("jane", partition, filed.taskId!);
    expect(after?.input).toEqual({ ticket: "ENG-9", severity: "high", requestedBy: "u_jane", audit: { by: "filing" } });
    expect(after?.metadata?.[FILLED_FOR]).toEqual({ flow: "triage", declaration: triage.fingerprint });
  });

  it("runs the filler and the parse when a task moves onto a declared flow, and keeps them on a reassign within it (D2)", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    // On an open flow anything is stored as sent, a server-owned name included.
    const filed = await file(host, id, { assignee: "ops.helper", goal: "g", input: { ticket: "ENG-7", requestedBy: "u_admin" }, held: true });
    expect(await update(host, id, { id: filed.taskId, assignee: "ops.intern" })).toMatchObject({ ok: true });
    expect((await host.row("jane", partition, filed.taskId!))?.input).toEqual({ ticket: "ENG-7", severity: "low", requestedBy: "u_jane", audit: { by: "filing" } });
    // A reassign within the flow is an edit: the stored values stay, and the check runs for the new worker.
    expect(await update(host, id, { id: filed.taskId, assignee: "ops.triager" })).toMatchObject({ ok: true });
    expect((await host.row("jane", partition, filed.taskId!))?.input).toMatchObject({ requestedBy: "u_jane" });
    // A move onto another declared flow is a filing for it.
    expect(await update(host, id, { id: filed.taskId, assignee: "ops.intake" })).toMatchObject({ ok: false, error: expect.stringContaining('unrecognized keys "severity", "audit"') });
    expect((await host.row("jane", partition, filed.taskId!))?.assignee).toBe("ops.triager");
  });

  it("refuses a move onto a declared flow that the task's input doesn't fit", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const filed = await file(host, id, { assignee: "ops.helper", goal: "g", input: { anything: true }, held: true });
    expect((await update(host, id, { id: filed.taskId, assignee: "ops.triager" })).error).toMatch(/^input_refused: .*"ops.triager".*Nothing was filed\.$/);
    expect((await host.row("jane", partition, filed.taskId!))?.assignee).toBe("ops.helper");
  });
});

describe("the claim", () => {
  /** File a held stored, rewrite it as a test needs, release it, and wait for the board. */
  async function claimAfter(h: Host, rewrite: (stored: any) => any, input: Record<string, unknown> = { ticket: "ENG-9" }) {
    const { id, partition } = await conversation(h);
    const filed = await file(h, id, { assignee: "ops.triager", goal: "g", input, held: true });
    const stored = (await h.row("jane", partition, filed.taskId!))!;
    await h.writeRow("jane", partition, rewrite(stored));
    expect(await update(h, id, { id: filed.taskId, status: "pending" })).toMatchObject({ ok: true });
    await h.settled();
    return { taskId: filed.taskId!, stored: await h.row("jane", partition, filed.taskId!) };
  }

  it("hands the block the parsed input, and trusts the stored server-owned values under a matching stamp", async () => {
    host = boot();
    const { taskId } = await claimAfter(host, (stored) => stored);
    expect(seen).toEqual([{ flow: "triage", taskId, input: { ticket: "ENG-9", severity: "low", requestedBy: "u_jane", audit: { by: "filing" } } }]);
  });

  it("fills the server-owned values again, at claim, when the stamp names another declaration", async () => {
    host = boot();
    const { taskId } = await claimAfter(host, (stored) => ({
      ...stored,
      input: { ...stored.input, requestedBy: "u_admin" },
      metadata: { ...stored.metadata, [FILLED_FOR]: { flow: "triage", declaration: "an-older-one" } }
    }));
    expect(seen).toEqual([{ flow: "triage", taskId, input: { ticket: "ENG-9", severity: "low", requestedBy: "u_jane", audit: { by: "claim" } } }]);
  });

  it("runs a task stored in an old shape on what the flow's stored read maps it to", async () => {
    host = boot();
    const { taskId } = await claimAfter(host, (stored) => ({ ...stored, input: { ticketId: "ENG-9", requestedBy: "u_jane", audit: { by: "filing" } } }));
    expect(seen).toEqual([{ flow: "triage", taskId, input: { ticket: "ENG-9", severity: "low", requestedBy: "u_jane", audit: { by: "filing" } } }]);
  });

  it("fails the attempt of a task that no longer fits, naming the field, and never runs the block", async () => {
    host = boot();
    const { stored } = await claimAfter(host, (filed) => ({ ...filed, input: { ...filed.input, ticket: 9 } }));
    expect(seen).toEqual([]);
    expect(stored?.status).toBe("errored");
    expect(JSON.stringify(stored?.error)).toContain('input_refused: this task\'s input no longer fits what flow \\"triage\\" takes: at \\"ticket\\", expected string, received number. Nothing ran.');
  });
});

describe("the raw handle a task session is handed", () => {
  it("refuses what the tool refuses, and keeps a stored server-owned value on an edit", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const target = await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-142" }, held: true });
    raw.writes.push(
      ((tasks: any) => tasks.createTask({ assignee: "ops.triager", goal: "raw", input: { ticket: 142 } })) as never,
      ((tasks: any) => tasks.patchSettings(target.taskId, { input: { ticket: "ENG-150", requestedBy: "u_admin", audit: { by: "u_admin" } } })) as never,
      ((tasks: any) => tasks.createTask({ assignee: "ops.helper", goal: "forged", input: {}, metadata: { [FILLED_FOR]: { flow: "triage", declaration: triage.fingerprint } } })) as never
    );
    await file(host, id, { assignee: "ops.raw", goal: "write through the raw handle", input: {} });
    await host.settled();
    expect(raw.outcomes[0]).toMatch(/^input_refused: .*at "ticket", expected string, received number/);
    expect(raw.outcomes.slice(1)).toEqual(["ok", "ok"]);
    expect((await host.row("jane", partition, target.taskId!))?.input).toEqual({ ticket: "ENG-150", severity: "low", requestedBy: "u_jane", audit: { by: "filing" } });
    const forged = (await tasksOf(host)).find((stored) => stored.goal === "forged");
    expect(forged?.metadata?.[FILLED_FOR]).toBeUndefined();
    expect((await tasksOf(host)).some((stored) => stored.goal === "raw")).toBe(false);
  });
});

describe("a stamp nothing checked is never trusted", () => {
  // Codex P1: a worker that stops resolving made an input edit take the open
  // path with the stamp kept, so a filer's server-owned value was trusted at claim.
  it("refuses an input edit while its worker can't be resolved, and the claim runs on the filler's values", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const filed = await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-5" }, held: true });
    expect((await host.act("jane", id, "removeDelegate", { worker: "ops.triager" }, "filer")).error).toBeUndefined();
    const edited = await update(host, id, { id: filed.taskId, input: { ticket: "ENG-5", requestedBy: "u_admin", audit: { by: "u_admin" } } });
    expect(edited).toMatchObject({ ok: false, error: expect.stringMatching(/^input_unchecked: /) });
    expect((await host.act("jane", id, "addDelegate", { worker: "ops.triager" }, "filer")).error).toBeUndefined();
    expect(await update(host, id, { id: filed.taskId, status: "pending" })).toMatchObject({ ok: true });
    await host.settled();
    expect(seen).toEqual([{ flow: "triage", taskId: filed.taskId, input: { ticket: "ENG-5", severity: "low", requestedBy: "u_jane", audit: { by: "filing" } } }]);
    expect((await host.row("jane", partition, filed.taskId!))?.input).toMatchObject({ requestedBy: "u_jane" });
  });

  // Codex P1: a move onto an open flow skipped the check, so it kept the stamp,
  // and an unchecked edit there was trusted after the move back.
  it("clears the stamp on a move to an open flow, so declared → open → declared fills again", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const target = await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-6" }, held: true });
    raw.writes.push(
      ((tasks: any) => tasks.setAssignee(target.taskId, "ops.helper")) as never,
      (async (tasks: any) => `stamp ${JSON.stringify(tasks.get(target.taskId)?.metadata?.[FILLED_FOR] ?? null)}`) as never,
      ((tasks: any) => tasks.patchSettings(target.taskId, { input: { ticket: "ENG-6", requestedBy: "u_admin", audit: { by: "u_admin" } } })) as never,
      ((tasks: any) => tasks.setAssignee(target.taskId, "ops.triager")) as never
    );
    // The raw writer checks a stamp in between, through the stored task.
    await file(host, id, { assignee: "ops.raw", goal: "move it through the raw handle", input: {} });
    await host.settled();
    expect(raw.outcomes).toEqual(["ok", "stamp null", "ok", "ok"]);
    const moved = await host.row("jane", partition, target.taskId!);
    expect(moved).toMatchObject({ assignee: "ops.triager", input: { ticket: "ENG-6", severity: "low", requestedBy: "u_jane", audit: { by: "filing" } } });
    expect(moved?.metadata?.[FILLED_FOR]).toEqual({ flow: "triage", declaration: triage.fingerprint });
  });

  it("clears the stamp when a task moves to an open flow through the tool's board too", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const filed = await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-7" }, held: true });
    expect(await update(host, id, { id: filed.taskId, assignee: "ops.helper" })).toMatchObject({ ok: true });
    expect((await host.row("jane", partition, filed.taskId!))?.metadata?.[FILLED_FOR]).toBeNull();
  });
});

describe("the project a raw-handle edit is checked for", () => {
  // Greptile: the raw handle read the running session's project, not the edited task's.
  it("is the edited task's own: an edit from a session with no project keeps a task that has one", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const named = { project: { visibility: "private", id: "storefront" } };
    const filed = await file(host, id, { assignee: "ops.proj", goal: "in a project", input: named, held: true });
    expect(filed).toMatchObject({ ok: true });
    const task = (await host.row("jane", partition, filed.taskId!))!;
    await host.writeRow("jane", partition, { ...task, metadata: { ...task.metadata, filedInProject: "private/storefront" } });
    raw.writes.push(((tasks: any) => tasks.patchSettings(filed.taskId, { input: {} })) as never);
    await file(host, id, { assignee: "ops.raw", goal: "edit a project's task through the raw handle", input: {} });
    await host.settled();
    expect(raw.outcomes).toEqual(["ok"]);
    expect((await host.row("jane", partition, filed.taskId!))?.input).toEqual({});
  });
});

describe("a null input", () => {
  // Codex P2: `input: null` was read as no input, so an edit kept the old input unchecked.
  it("is checked as the input sent, and refused, through the raw handle", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const target = await file(host, id, { assignee: "ops.triager", goal: "g", input: { ticket: "ENG-17" }, held: true });
    raw.writes.push(
      ((tasks: any) => tasks.patchSettings(target.taskId, { input: null })) as never,
      ((tasks: any) => tasks.createTask({ assignee: "ops.triager", goal: "null input", input: null })) as never
    );
    await file(host, id, { assignee: "ops.raw", goal: "send a null input", input: {} });
    await host.settled();
    expect(raw.outcomes[0]).toMatch(/^input_refused: .*the input is not an object/);
    expect(raw.outcomes[1]).toMatch(/^input_refused: .*the input is not an object/);
    expect((await host.row("jane", partition, target.taskId!))?.input).toMatchObject({ ticket: "ENG-17" });
    expect((await tasksOf(host)).some((task) => task.goal === "null input")).toBe(false);
  });
});

describe("an unassigned filing's worker", () => {
  // Codex P1: the default worker was read once for the check and again for the
  // store, so a roster change between them stored B with A's checked values.
  it("is read once: the task is stored for the worker it was checked for, never another", async () => {
    host = boot();
    const { id, partition } = await conversation(host, "jane.solo");
    behaviour.check = "swap";
    // High severity passes only for an on-call worker: ops.triager is, ops.intern isn't.
    const filed = await file(host, id, { goal: "g", input: { ticket: "ENG-8", severity: "high" }, held: true });
    expect(filed).toMatchObject({ ok: true });
    expect(await host.row("jane", partition, filed.taskId!)).toMatchObject({ assignee: "ops.triager", input: { severity: "high" } });
  });
});

describe("the worker a task is checked for is the worker it is stored for", () => {
  /** A completed task for ops.triager, the root of the follow-ups below. */
  async function completedRoot(h: Host, conv: string, partition: string) {
    const filed = await file(h, conv, { assignee: "ops.triager", goal: "root", input: { ticket: "ENG-10" } });
    await h.settled();
    expect((await h.row("jane", partition, filed.taskId!))?.status).toBe("completed");
    return filed.taskId!;
  }

  // Codex P1: a follow-up was checked for its root's worker and stored for the one it named.
  it("refuses a follow-up naming another worker than its root's", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const rootId = await completedRoot(host, id, partition);
    // The task tools refuse it first (`follow_up_takes_no_assignee`); code filing through the board itself reaches the board's own rule.
    expect((await file(host, id, { followUpOf: rootId, assignee: "ops.intern", goal: "more", input: { ticket: "ENG-11" } })).error).toMatch(/^follow_up_takes_no_assignee: /);
    const out = (await host.act("jane", id, "batch", { tasks: [{ followUpOf: rootId, assignee: "ops.intern", goal: "more", input: { ticket: "ENG-11" }, held: true }] }, "filer")).output as Output;
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^follow_up_takes_its_root_worker: /) });
    expect((await tasksOf(host)).some((task) => task.goal === "more")).toBe(false);
  });

  it("refuses the same follow-up through the raw handle a task session is handed", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const rootId = await completedRoot(host, id, partition);
    raw.writes.push(
      ((tasks: any) => tasks.createTask({ followUpOf: rootId, assignee: "ops.intern", goal: "raw more", input: { ticket: "ENG-15" } })) as never
    );
    await file(host, id, { assignee: "ops.raw", goal: "follow up through the raw handle", input: {} });
    await host.settled();
    expect(raw.outcomes[0]).toMatch(/^follow_up_takes_its_root_worker: /);
    expect((await tasksOf(host)).some((task) => task.goal === "raw more")).toBe(false);
  });

  it("stores a follow-up naming no worker for its root's, checked for it", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const rootId = await completedRoot(host, id, partition);
    const out = await file(host, id, { followUpOf: rootId, goal: "more", input: { ticket: "ENG-11", severity: "high" }, held: true });
    expect(out).toMatchObject({ ok: true });
    expect(await host.row("jane", partition, out.taskId!)).toMatchObject({ assignee: "ops.triager", input: { severity: "high", requestedBy: "u_jane" } });
  });

  it("leaves a filing with several delegates unassigned and unchecked, and checks it for the worker it is then assigned to (D2)", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const filed = await file(host, id, { goal: "g", input: { ticket: "ENG-16", requestedBy: "u_admin" }, held: true });
    const waiting = await host.row("jane", partition, filed.taskId!);
    expect(waiting?.assignee).toBeUndefined();
    expect(waiting?.input).toEqual({ ticket: "ENG-16", requestedBy: "u_admin" });
    expect(await update(host, id, { id: filed.taskId, assignee: "ops.triager" })).toMatchObject({ ok: true });
    expect(await host.row("jane", partition, filed.taskId!)).toMatchObject({
      assignee: "ops.triager",
      input: { ticket: "ENG-16", severity: "low", requestedBy: "u_jane", audit: { by: "filing" } }
    });
  });

  it("pins a batch row's default worker before its check, as a single filing's", async () => {
    host = boot();
    const { id, partition } = await conversation(host, "jane.solo");
    behaviour.check = "swap";
    const out = (await host.act("jane", id, "batch", { tasks: [{ goal: "g", input: { ticket: "ENG-12", severity: "high" }, held: true }] }, "filer")).output as { ok: boolean; ids?: string[] };
    expect(out).toMatchObject({ ok: true });
    expect(await host.row("jane", partition, out.ids![0]!)).toMatchObject({ assignee: "ops.triager", input: { severity: "high" } });
  });

  it("checks a routed filing for the worker it names, and stores it for that worker", async () => {
    host = boot();
    const { id, partition } = await conversation(host);
    const refused = (await host.act("jane", id, "routed", { id: "task_routed_bad", assignee: "ops.triager", input: { ticket: 1 } }, "filer")).output as Output;
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/^input_refused: /) });
    expect(((await host.act("jane", id, "routed", { id: "task_routed_ok", assignee: "ops.triager", input: { ticket: "ENG-13", requestedBy: "u_admin" } }, "filer")).output as Output).ok).toBe(true);
    const stored = await host.row("jane", partition, "task_routed_ok");
    expect(stored).toMatchObject({ assignee: "ops.triager", input: { ticket: "ENG-13", requestedBy: "u_jane" } });
    expect(stored?.metadata?.[FILLED_FOR]).toEqual({ flow: "triage", declaration: triage.fingerprint });
  });

  it("checks a step filed session: \"new\" against the worker's own flow, stored for the worker itself", async () => {
    host = boot();
    const created = await host.create("jane", "planner", { state: { workerId: "ops.planner" } });
    planner.steps.push({ input: { ticket: 14 } }, { input: { ticket: "ENG-14", requestedBy: "u_admin" } });
    const run = await host.act("jane", created.body.session!.id, "respond", { message: "plan it" }, "planner");
    expect(run.error).toBeUndefined();
    expect(planner.outcomes[0]).toMatch(/^input_refused: .*"ops.planner" takes \(flow "planner"\): at "ticket", expected string/);
    expect(planner.outcomes[1]).toEqual({
      assignee: "ops.planner",
      input: { ticket: "ENG-14", severity: "low", requestedBy: "u_jane", audit: { by: "filing" } },
      stamp: { flow: "planner", declaration: triage.fingerprint }
    });
  });
});

describe("what listDelegates shows", () => {
  it("shows each delegate's input as inlined draft-07 JSON Schema without its server-owned fields, and null for an open flow (D3)", async () => {
    host = boot();
    const { id } = await conversation(host);
    const listed = (await host.act("jane", id, "listDelegates", {}, "filer")).output as { delegates: Array<{ worker: string; inputSchema: any }> };
    const byWorker = Object.fromEntries(listed.delegates.map((stored) => [stored.worker, stored.inputSchema]));
    expect(byWorker["ops.helper"]).toBeNull();
    const shown = byWorker["ops.triager"];
    expect(shown.project).toBe("optional");
    expect(shown.jsonSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(Object.keys(shown.jsonSchema.properties).sort()).toEqual(["meta", "severity", "ticket"]);
    expect(shown.jsonSchema.required).toEqual(["ticket"]);
    expect(shown.jsonSchema.additionalProperties).toBe(false);
    expect(shown.jsonSchema.properties.ticket).toEqual({ type: "string", pattern: "^ENG-\\d+$" });
    expect(shown.jsonSchema.properties.severity).toMatchObject({ enum: ["low", "high"], default: "low", description: expect.stringContaining("on call") });
    expect(JSON.stringify(shown.jsonSchema)).not.toMatch(/\$ref|definitions/);
    expect(byWorker["ops.proj"].project).toBe("required");
  });
});

describe("the declaration, when the flow is built", () => {
  it("refuses a schema the JSON round trip can break, naming the entry, the step and where", () => {
    const build = (schema: z.ZodTypeAny) => () =>
      workerTaskEntry({ name: "triage-work", turn: handler({ name: "t", inputSchema: z.unknown(), execute: () => "" }), inputSchema: taskInputSchema(schema as never) });
    expect(build(z.object({ n: z.string().transform(Number) }))).toThrow('workerTaskEntry "triage-work": a task input may not use .transform (at "n").');
    expect(build(z.object({ due: z.date() }))).toThrow("Use an ISO string: z.string().datetime().");
    expect(build(z.object({ n: z.coerce.number() }))).toThrow("z.coerce.number");
    expect(build(z.object({ tags: z.array(z.set(z.string())) }))).toThrow('z.set (at "tags.[]")');
    expect(build(z.object({ n: z.number().catch(0) }))).toThrow(".catch");
    // `.refine`, `.default` and `.describe` keep the round trip.
    expect(build(z.object({ n: z.number().refine((v) => v > 0).default(1).describe("n") }))).not.toThrow();
  });

  // Codex P2: a union or intersection keeps its fields under anyOf/allOf, where
  // the filer's view can't drop the server-owned ones, so only an object is taken.
  it("refuses a schema that isn't an object (z.object or z.record), naming the entry", () => {
    const build = (schema: z.ZodTypeAny) => () =>
      workerTaskEntry({ name: "triage-work", turn: handler({ name: "t", inputSchema: z.unknown(), execute: () => "" }), inputSchema: taskInputSchema(schema as never) });
    const a = z.object({ ticket: z.string(), requestedBy: z.string() });
    const b = z.object({ issue: z.string(), requestedBy: z.string() });
    expect(build(z.union([a, b]))).toThrow('workerTaskEntry "triage-work": a task input is an object schema (z.object or z.record), and this is a z.union.');
    expect(build(z.intersection(a, b))).toThrow("this is a z.intersection");
    expect(build(z.string())).toThrow("this is a z.string");
    // An object, a record, and either refined, are objects.
    expect(build(a.refine(() => true))).not.toThrow();
    expect(build(z.record(z.string(), z.unknown()))).not.toThrow();
  });

  it("refuses the removed needsProject option by name", () => {
    expect(() => workerFlow(() => undefined, { needsProject: true } as never)).toThrow("needsProject` is gone");
    expect(() => resolveWorkerFlows({ coder: { flow: (() => undefined) as never, needsProject: true } as never })).toThrow("needsProject` is gone");
  });
});
