/**
 * The board store's one assignee decision on a model's turn (FIX-2877 D2): it
 * is decided once per call, and the worker it decides then gets every check an
 * assignee normally gets. Driven through the board's own turn resolver, from a
 * fixture flow whose turn runs the writes a test hands it, so each path is hit
 * directly: a batch, an edit on a workstream's row, and a call whose decision
 * was already recorded. Read back from the stored rows.
 *
 * A workstream's session is resolved here as found (`resolveWorkstreamTarget`
 * stubbed), so a filing naming a target reaches the ledger write without a
 * project host behind it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/projects/project-coordinator", async (actual) => ({
  ...(await actual<typeof import("../src/projects/project-coordinator")>()),
  resolveWorkstreamTarget: async () => ({ sessionId: "sess_workstream" })
}));
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { toolCallOf } from "@flow-state-dev/orchestration/internal";
import { z } from "zod";
import { bootBoardHost, boardWorkers, messageOf, type BoardHost } from "./conversation-board-harness";
import { defineSessionBoard } from "../src/conversation-board/session-board";
import { workerConfigSchema } from "../src/worker-config";
import type { WorkerInstallation } from "../src/workers/installation";
import type { NoPickAssignee } from "../src/workers/worker-flow";

type Op = (ref: TaskCollectionRef, ctx: BlockContext) => Promise<unknown>;

/** A worker flow whose turn runs `ops` against its own board, as a model's turn reaches it, and keeps each outcome. */
function scriptedFlow(installation: WorkerInstallation, ops: Op[], outcomes: Array<{ ok?: unknown; error?: string }>) {
  const sb = defineSessionBoard({ installation, flowKind: "scripted" });
  const door = handler({
    name: "scripted-run",
    inputSchema: z.object({ message: z.string() }),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => {
      await installation.resolveWorker(ctx, "scripted");
      const ref = (await sb.board.turnResolver(ctx as never)) as TaskCollectionRef;
      for (const op of ops.splice(0)) {
        outcomes.push(await op(ref, ctx as never).then((ok) => ({ ok }), (error: Error) => ({ error: error.message })));
      }
      return "done";
    }
  });
  return defineFlow({
    kind: "scripted",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(sb.sessionStateShape), serverOwned: [...sb.serverOwned] },
    resources: { ...installation.resources, ...sb.resources },
    actions: { respond: { block: door, userMessage: (i: { message: string }) => i.message }, ...sb.actions },
    internal: { actions: { ...sb.entries(door) } }
  } as never);
}

/** A host with the scripted flow and its worker, which hands tasks to eng.tasker and eng.writer; the tasker flow's rule answers `pick`. */
function boot(pick: () => string | undefined) {
  const ops: Op[] = [];
  const outcomes: Array<{ ok?: unknown; error?: string }> = [];
  const noPickAssignee: NoPickAssignee = async () => pick();
  const host = bootBoardHost({
    standard: [...boardWorkers(), { id: "scripter", declared: { flow: "scripted", delegates: ["eng.tasker", "eng.writer"] }, body: "", skills: [] }],
    flows: (installation) => ({ scripted: { flow: scriptedFlow(installation, ops, outcomes), roles: ["manager"] } }),
    registration: { tasker: { noPickAssignee } }
  });
  /** Open scripter's conversation. */
  const open = async () => {
    const created = await host.create("alice", "scripted", { state: { workerId: "scripter" } });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    return created.body.session!.id;
  };
  /** Run `next` on scripter's turn in `conv`; its outcomes. */
  const turn = async (conv: string, next: Op[]) => {
    ops.push(...next);
    const ran = await host.act("alice", conv, "respond", { message: "go" }, "scripted");
    expect(ran.error, messageOf(ran.error)).toBeUndefined();
    await host.settled();
    return outcomes.splice(0);
  };
  return { host, open, turn };
}

/** Give `conv` the delegate records a workstream writes: eng.tasker leads ws-billing only, eng.writer takes plain tasks. */
async function withWorkstream(host: BoardHost, conv: string) {
  const stored = await host.session(conv);
  const store = (await host.state.getRuntime()).stores.session;
  await store.set(
    conv,
    { ...stored, state: { ...stored.state, delegates: [{ worker: "eng.tasker", target: "ws-billing" }, { worker: "eng.writer" }] }, version: stored.version + 1, updatedAt: Date.now() } as never,
    "any"
  );
}

describe("the board store's assignee on a model's turn", () => {
  it("refuses a batch row naming a worker outside the filer's delegates, filing nothing", async () => {
    const { host, open, turn } = boot(() => "eng.writer");
    try {
      const conv = await open();
      // eng.helper is on the roster, but scripter doesn't hand it tasks.
      const [out] = await turn(conv, [(ref) => ref.createTasks([{ goal: "Write the notes", assignee: "eng.helper", held: true }])]);
      expect(out?.error).toMatch(/"eng\.helper", which is not one of this conversation's delegates/);
      expect(await host.rows("alice")).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("gates the assignee a workstream's target fills in, at the ledger write, like any other", async () => {
    // The batch names a target and no assignee; the target fills in its lead, eng.tasker. The rule answers eng.writer.
    const asked: string[] = [];
    const { host, open, turn } = boot(() => {
      asked.push("asked");
      return "eng.writer";
    });
    try {
      const conv = await open();
      const stored = await host.session(conv);
      const store = (await host.state.getRuntime()).stores.session;
      // eng.tasker leads ws-billing and is this conversation's only delegate, so the target fills it in.
      await store.set(
        conv,
        { ...stored, state: { ...stored.state, delegates: [{ worker: "eng.tasker", target: "ws-billing" }] }, version: stored.version + 1, updatedAt: Date.now() } as never,
        "any"
      );
      const [out] = await turn(conv, [(ref) => ref.createTasks([{ goal: "Bill it", target: "ws-billing", held: true }])]);
      // The rule was asked, and its worker isn't one of this conversation's delegates: refused, nothing stored.
      expect(asked.length).toBeGreaterThan(0);
      expect(out?.error).toMatch(/"eng\.writer", which is not one of this conversation's delegates/);
      expect(await host.rows("alice")).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("checks a rewritten edit against the row's workstream rule, and refuses one its worker can't take", async () => {
    // The rule sends the task to eng.tasker, which leads only workstream ws-billing here.
    const { host, open, turn } = boot(() => "eng.tasker");
    try {
      const conv = await open();
      const [filed] = await host
        .act("alice", conv, "createTask_tasks", { goal: "Write the notes", assignee: "eng.writer", held: true }, "scripted")
        .then((r) => [r.output as { taskId: string }]);
      await withWorkstream(host, conv);
      const [out] = await turn(conv, [(ref) => ref.patchSettings(filed!.taskId, { assignee: "eng.writer" })]);
      expect(out?.error).toMatch(/^"eng\.tasker" leads a workstream here \(ws-billing\)/);
      expect((await host.rows("alice")).map((task) => task.assignee)).toEqual(["eng.writer"]);
    } finally {
      await host.dispose();
    }
  });

  it("stores the decision already recorded for the call, not a fresh one, so the same-work check and the row agree", async () => {
    let answer = "eng.writer";
    const { host, open, turn } = boot(() => answer);
    try {
      const conv = await open();
      const [out] = await turn(conv, [
        async (ref, ctx) => {
          // The task tools decided eng.writer for this call and recorded it; the rule now answers otherwise.
          const call = toolCallOf(ctx);
          if (call === undefined || ctx.runOnce === undefined) throw new Error("setup: the turn has no call to record against");
          await ctx.runOnce(`fsd.decide.server-assignee:${call.logicalId}`, async () => ({ assignee: "eng.writer" }));
          answer = "eng.tasker";
          return ref.createTask({ goal: "Write the notes", assignee: "eng.writer", held: true });
        }
      ]);
      expect(out?.error).toBeUndefined();
      expect((await host.rows("alice")).map((task) => task.assignee)).toEqual(["eng.writer"]);
    } finally {
      await host.dispose();
    }
  });
});
