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
import { defineSessionBoard, filingConversationBoard, taskInput, workerConfigSchema, workerFlow, type WorkerManifest } from "../src";
import { workerTaskEntry, type WorkerTaskBlockInput } from "../src/conversation-board/task-entry";
import { conversationLedgerResources } from "../src/conversation-board/ledger";
import { MESSAGE_RECEIVED_ENTRY } from "../src/messages/keys";
import { workerMessagesResources } from "../src/messages/message-log";
import { messageReceivedEntry } from "../src/messages/message-received-entry";
import type { WorkerInstallation } from "../src/workers/installation";
import { resolveWorkerFlows } from "../src/hire";
import { FILLED_FOR } from "../src/task-input/filing-check";
import { boardWorkers, bootBoardHost } from "./conversation-board-harness";

type Host = ReturnType<typeof bootBoardHost>;
type Output = { ok: boolean; taskId?: string; error?: string };

/** What a test makes the triage flow's hooks do. */
const behaviour: { check?: "rewrite" | "nested" | "date" } = {};
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

const triage = taskInput(triageSchema, {
  // `doneWhen` lies outside the schema: a server-owned name there is only dropped.
  serverOwned: ["requestedBy", "audit", "doneWhen"],
  fill: ({ ctx, at }) => ({ requestedBy: `u_${userOf(ctx)}`, audit: { by: at } }),
  refuse: (sent) => {
    if ("ticketId" in sent) throw new TaskWriteRefusedError("old_key", "ticketId is no longer accepted; send ticket instead. Nothing was filed.");
  },
  check: (input, { assignee, worker }) => {
    if (input.severity === "high" && worker.config.onCall !== true) {
      throw new TaskWriteRefusedError("not_on_call", `"${assignee}" isn't on call, so it takes no high-severity task. Nothing was filed.`);
    }
    if (behaviour.check === "rewrite") return { ...input, requestedBy: "u_admin" };
    if (behaviour.check === "nested") {
      input.audit.by = "u_admin";
      return input;
    }
    if (behaviour.check === "date") return { ...input, meta: { seenAt: new Date(0) } };
    return input;
  },
  stored: (stored) => {
    if (!("ticketId" in stored)) return stored;
    const { ticketId, ...rest } = stored;
    return { ...rest, ticket: ticketId };
  }
});

const intake = taskInput(z.object({ ticket: z.string(), queue: z.string().default("main"), requestedBy: z.string() }).strict(), {
  serverOwned: ["requestedBy"],
  fill: ({ ctx }) => ({ requestedBy: `intake:${userOf(ctx)}` })
});

/** A worker flow whose `work` entry declares `input`, recording what its block is handed. */
function declaredFlow(installation: WorkerInstallation, flowName: string, input: ReturnType<typeof taskInput<any>>) {
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
    task: { actions: { work: workerTaskEntry({ name: `${flowName}-work`, block, input }) } }
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
          await (write as unknown as (tasks: unknown) => Promise<unknown>)(filed!.tasks);
          raw.outcomes.push("ok");
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
      worker("ops.proj", { flow: "projtaker", description: "Works in a project" })
    ],
    flows: (installation) => ({
      filer: { flow: filerFlow(installation), roles: ["manager"] },
      triage: { flow: declaredFlow(installation, "triage", triage), roles: ["contributor"] },
      intake: { flow: declaredFlow(installation, "intake", intake), roles: ["contributor"] },
      rawfiler: { flow: rawFlow(installation), roles: ["contributor"] },
      projtaker: {
        flow: declaredFlow(installation, "projtaker", taskInput(z.record(z.string(), z.unknown()), { project: "required" })),
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

describe("what listDelegates shows", () => {
  it("shows each delegate's input as inlined draft-07 JSON Schema without its server-owned fields, and null for an open flow (D3)", async () => {
    host = boot();
    const { id } = await conversation(host);
    const listed = (await host.act("jane", id, "listDelegates", {}, "filer")).output as { delegates: Array<{ worker: string; input: any }> };
    const byWorker = Object.fromEntries(listed.delegates.map((stored) => [stored.worker, stored.input]));
    expect(byWorker["ops.helper"]).toBeNull();
    const shown = byWorker["ops.triager"];
    expect(shown.project).toBe("optional");
    expect(shown.schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(Object.keys(shown.schema.properties).sort()).toEqual(["meta", "severity", "ticket"]);
    expect(shown.schema.required).toEqual(["ticket"]);
    expect(shown.schema.additionalProperties).toBe(false);
    expect(shown.schema.properties.ticket).toEqual({ type: "string", pattern: "^ENG-\\d+$" });
    expect(shown.schema.properties.severity).toMatchObject({ enum: ["low", "high"], default: "low", description: expect.stringContaining("on call") });
    expect(JSON.stringify(shown.schema)).not.toMatch(/\$ref|definitions/);
    expect(byWorker["ops.proj"].project).toBe("required");
  });
});

describe("the declaration, when the flow is built", () => {
  it("refuses a schema the JSON round trip can break, naming the entry, the step and where", () => {
    const build = (schema: z.ZodTypeAny) => () =>
      workerTaskEntry({ name: "triage-work", turn: handler({ name: "t", inputSchema: z.unknown(), execute: () => "" }), input: taskInput(schema as never) });
    expect(build(z.object({ n: z.string().transform(Number) }))).toThrow('workerTaskEntry "triage-work": a task input may not use .transform (at "n").');
    expect(build(z.object({ due: z.date() }))).toThrow("Use an ISO string: z.string().datetime().");
    expect(build(z.object({ n: z.coerce.number() }))).toThrow("z.coerce.number");
    expect(build(z.object({ tags: z.array(z.set(z.string())) }))).toThrow('z.set (at "tags.[]")');
    expect(build(z.object({ n: z.number().catch(0) }))).toThrow(".catch");
    // `.refine`, `.default` and `.describe` keep the round trip.
    expect(build(z.object({ n: z.number().refine((v) => v > 0).default(1).describe("n") }))).not.toThrow();
  });

  it("refuses the removed needsProject option by name", () => {
    expect(() => workerFlow(() => undefined, { needsProject: true } as never)).toThrow("needsProject` is gone");
    expect(() => resolveWorkerFlows({ coder: { flow: (() => undefined) as never, needsProject: true } as never })).toThrow("needsProject` is gone");
  });
});
