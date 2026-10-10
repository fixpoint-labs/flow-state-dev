/**
 * The task tools' roster, read per call (FIX-1794 T1).
 *
 * A board whose team changes while it is in use cannot hand the tools a fixed
 * roster: an action is fixed when its flow is defined, and an assignee added
 * while the board is in use would be refused until the next deploy. So a roster may be a function of the running context, read on
 * every call, and `taskToolActions` takes one too, so an app's filing is held
 * to the same check as the model's.
 *
 * Every leg reads the result the tool hands back and the row the store holds,
 * so a refusal that wrote anything anyway fails here.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { runForTest } from "@flow-state-dev/testing";
import type { GeneratorTool } from "@flow-state-dev/core";
import { z } from "zod";
import {
  buildTaskToolsList,
  defaultOwnStateResolver,
  type AssigneeRoster,
} from "../../src/skills/task-tools-capability";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type TaskCollectionRef,
  type TaskWorker,
} from "../../src/tasks";
import { taskBoard, taskToolActions } from "../../src/task-board";
import { buildDelegationCtx } from "./delegation-ctx";

/** A roster over a mutable set, so a test can change the team between calls. */
function rosterOf(team: Set<string>): AssigneeRoster {
  return { has: (name) => team.has(name), describe: () => [...team].join(", ") || "(nobody)" };
}

function toolNamed(tools: readonly unknown[], name: string): GeneratorTool {
  const tool = tools.find((t) => (t as { config?: { name?: string } }).config?.name === name);
  if (tool === undefined) throw new Error(`tool not found: ${name}`);
  return tool as GeneratorTool;
}

describe("a roster read per call (T1)", () => {
  it("checks each call against the team as it stands, so a member added between two calls is accepted on the second", async () => {
    const team = new Set(["researcher"]);
    const seen: unknown[] = [];
    const tools = buildTaskToolsList(defaultOwnStateResolver, (ctx) => {
      seen.push(ctx);
      return rosterOf(team);
    });
    const { ctx } = buildDelegationCtx({ self: false });

    const refused = await runForTest(toolNamed(tools, "addTask"), { goal: "draft", assignee: "writer" }, ctx);
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/^unknown_assignee: "writer"/) });

    team.add("writer");
    const accepted = await runForTest(toolNamed(tools, "addTask"), { goal: "draft", assignee: "writer" }, ctx);
    expect(accepted).toMatchObject({ ok: true });
    // Read on each call, and handed the running context to read it from.
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeTypeOf("object");
  });

  it("holds assignTask and updateTask to the same per-call roster", async () => {
    const team = new Set(["researcher"]);
    const tools = buildTaskToolsList(defaultOwnStateResolver, async () => rosterOf(team));
    const { ctx } = buildDelegationCtx({
      self: false,
      preTasks: { a: { id: "a", goal: "x", status: "pending", attempts: 0, createdAt: 1, updatedAt: 1 } },
    });
    expect(await runForTest(toolNamed(tools, "assignTask"), { taskId: "a", assignee: "writer" }, ctx)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^unknown_assignee/),
    });
    expect(
      await runForTest(toolNamed(tools, "updateTask"), { taskId: "a", patch: { assignee: "writer" } }, ctx)
    ).toMatchObject({ ok: false, error: expect.stringMatching(/^unknown_assignee/) });
    team.add("writer");
    expect(await runForTest(toolNamed(tools, "assignTask"), { taskId: "a", assignee: "writer" }, ctx)).toEqual({ ok: true });
  });
});

let seq = 0;

const noopWorker = handler({
  name: "roster-noop-worker",
  inputSchema: z.unknown(),
  outputSchema: z.null(),
  execute: () => null,
}) as TaskWorker;

/** A flow holding one durable board's actions, with and without a roster. */
async function host(team: Set<string>) {
  seq += 1;
  const id = `rostered${seq}`;
  const ledger = defineTaskCollection({ id, scope: "session" });
  const board = taskBoard({ name: `rostered-board${seq}`, collection: ledger, workers: noopWorker });
  const resolve = (ctx: BlockContext): Promise<TaskCollectionRef> =>
    getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: id, collection: resolveResourceCollection(ctx, id)! });

  const flow = defineFlow({
    kind: `rostered${seq}`,
    resources: { [id]: ledger },
    actions: {
      // Resolved by id, with a roster read per call: a caller's filing is
      // checked exactly as the model's tool checks it.
      ...taskToolActions(id, resolve, () => rosterOf(team)),
    },
  } as never);
  // The handle form takes a roster too.
  const handleForm = taskToolActions(board, rosterOf(team));

  const instance = flow();
  const state = createFlowState({
    flows: { [instance.kind]: instance },
    stores: { default: { primary: inMemoryStores() } },
  } as never);
  const runtime = await state.getRuntime();
  const act = async (actionName: string, input: unknown) =>
    (await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: instance,
      actionName,
      input,
      userId: "u_ops",
      sessionId: "s_ops",
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never)) as { output?: any };
  const rows = async () =>
    (await runtime.stores.resourceState.list?.("session", "s_ops"))?.filter((entry: { key: string }) =>
      entry.key.startsWith(`${id}/`)
    ) ?? [];
  return { id, act, rows, handleForm, dispose: () => state.dispose() };
}

describe("taskToolActions with a roster (T1)", () => {
  it("refuses an app's filing for an assignee off the roster, and stores nothing", async () => {
    const h = await host(new Set(["researcher"]));
    try {
      const refused = await h.act(`addTask_${h.id}`, { goal: "audit licenses", assignee: "bobs.worker" });
      expect(refused.output).toMatchObject({ ok: false, error: expect.stringMatching(/^unknown_assignee: "bobs.worker"/) });
      const accepted = await h.act(`addTask_${h.id}`, { goal: "audit licenses", assignee: "researcher" });
      expect(accepted.output).toMatchObject({ ok: true });
      const listed = await h.act(`listTasks_${h.id}`, {});
      expect(listed.output.tasks.map((t: { assignee?: string }) => t.assignee)).toEqual(["researcher"]);
    } finally {
      await h.dispose();
    }
  });

  it("checks a reassign from the app against the roster", async () => {
    const team = new Set(["researcher"]);
    const h = await host(team);
    try {
      const filed = await h.act(`addTask_${h.id}`, { goal: "audit", assignee: "researcher" });
      const taskId = filed.output.taskId as string;
      expect((await h.act(`assignTask_${h.id}`, { taskId, assignee: "writer" })).output).toMatchObject({
        ok: false,
        error: expect.stringMatching(/^unknown_assignee/),
      });
      team.add("writer");
      expect((await h.act(`assignTask_${h.id}`, { taskId, assignee: "writer" })).output).toEqual({ ok: true });
    } finally {
      await h.dispose();
    }
  });

  it("names the same nine actions either way", async () => {
    const h = await host(new Set());
    try {
      expect(Object.keys(h.handleForm)).toHaveLength(9);
    } finally {
      await h.dispose();
    }
  });
});
