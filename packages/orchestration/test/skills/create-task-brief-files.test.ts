/**
 * A task filed during a turn carries that turn's files in its brief (FIX-2522;
 * epic FIX-2516 ER-7). `createTask` keeps a copy of every one of the turn's
 * files through the engine's keeper (`keepAttachmentsForUser`) and files the
 * copies on the row, so the row's files are not the turn's: deleting the
 * conversation can't take the brief's images. Every run of the task is handed
 * them (`packWorkerInput`), and they are fixed once it starts, as `context` is.
 *
 * The keeper here is a stub under the engine's symbol slot; the engine's own
 * copy is `engine/test/blobs/user-kept-attachments.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import type { GeneratorTool } from "@flow-state-dev/core";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import { USER_ATTACHMENT_SEAM } from "@flow-state-dev/core/internal";
import type { FileContent } from "@flow-state-dev/core/items";
import type { BlockContext } from "@flow-state-dev/core/types";
import { getOrCreateTaskCollection, lockedFields, TASK_FIELD_RULES, type TaskCollectionRef } from "../../src/tasks";
import { taskToolsForTurn, type AssigneeRoster } from "../../src/skills/task-tools-capability";
import { packWorkerInput } from "../../src/task-board/blocks/worker-step";
import { createFakeSequencerState } from "../helpers";

const shot: FileContent = { type: "file", mediaType: "image/png", filename: "bug.png", data: toBlobRef("b_turnshot0001") };

/** A turn's context: its files, and a keeper that copies each under a new id (or fails, or is absent). */
function turnCtx(attachments: FileContent[], keeper: "copies" | "fails" | "none" = "copies") {
  const kept: FileContent[][] = [];
  /** What the keeper was asked to drop again, call by call. */
  const discarded: FileContent[][] = [];
  const ctx = {
    emit: { component: () => undefined },
    session: { identity: { type: "session", id: "s_1", userId: "alice" } },
    request: { identity: { type: "request", id: "r_1" }, attachments },
    ...(keeper === "none"
      ? {}
      : {
          [USER_ATTACHMENT_SEAM]: {
            keep: async (files: ReadonlyArray<FileContent>) => {
              if (keeper === "fails") throw new Error("The disk is full.");
              const copies = files.map((file, i) => ({ ...file, data: toBlobRef(`b_kept${kept.length}${i}0000`) }));
              kept.push(copies);
              return copies;
            },
            discard: async (files: ReadonlyArray<FileContent>) => {
              discarded.push([...files]);
            },
          },
        }),
  } as unknown as BlockContext;
  return { ctx, kept, discarded };
}

const board = (maxTotalTasks?: number) =>
  getOrCreateTaskCollection({
    ctx: turnCtx([]).ctx,
    backing: "state",
    state: createFakeSequencerState<Record<string, unknown>>({ tasks: {} }),
    collectionId: "desk",
    ...(maxTotalTasks !== undefined ? { maxTotalTasks } : {}),
  });

const roster: AssigneeRoster = { has: (name) => name === "writer", describe: () => "writer" };

function createTask(collection: TaskCollectionRef): GeneratorTool {
  const tools = taskToolsForTurn(async () => collection, roster, { dispatches: true })({});
  return tools.find((t) => (t as { name?: string }).name === "createTask")!;
}

type Result = { ok: boolean; taskId?: string; error?: string };

describe("a task filed during a turn", () => {
  it("carries copies of every one of the turn's files, not the turn's own references", async () => {
    const collection = await board();
    const other: FileContent = { type: "file", mediaType: "image/jpeg", data: toBlobRef("b_turnshot0002") };
    const { ctx, kept } = turnCtx([shot, other]);
    const result = (await runForTest(createTask(collection) as never, { goal: "Fix the bug in the screenshot", assignee: "writer" } as never, ctx)) as Result;
    expect(result.ok).toBe(true);
    const task = collection.get(result.taskId!)!;
    expect(task.attachments).toEqual(kept[0]);
    expect(task.attachments?.map((f) => f.data)).not.toContain(shot.data);
    expect(task.attachments?.[0]).toMatchObject({ mediaType: "image/png", filename: "bug.png" });
  });

  it("hands them to every run, as the board packs the worker's input", async () => {
    const collection = await board();
    const { ctx, kept } = turnCtx([shot]);
    const result = (await runForTest(createTask(collection) as never, { goal: "Fix it", assignee: "writer" } as never, ctx)) as Result;
    const task = collection.get(result.taskId!)!;
    expect((await packWorkerInput(task, collection)).attachments).toEqual(kept[0]);
  });

  it("keeps nothing, and files no field, for a turn with no files", async () => {
    const collection = await board();
    const { ctx, kept } = turnCtx([]);
    const result = (await runForTest(createTask(collection) as never, { goal: "Fix it", assignee: "writer" } as never, ctx)) as Result;
    expect(kept).toEqual([]);
    expect(collection.get(result.taskId!)!.attachments).toBeUndefined();
  });

  it("is refused by name, and nothing filed, when the files can't be kept", async () => {
    for (const keeper of ["fails", "none"] as const) {
      const collection = await board();
      const { ctx } = turnCtx([shot], keeper);
      const result = (await runForTest(createTask(collection) as never, { goal: "Fix it", assignee: "writer" } as never, ctx)) as Result;
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/^task_files_not_kept: .*Nothing was filed\.$/);
      expect(collection.list()).toHaveLength(0);
    }
  });

  // A kept copy is owned, so nothing sweeps it: a filing the board refuses
  // must drop the copies it kept, or each refusal leaves files nobody reads.
  it("drops the copies it kept when the board refuses the filing, and keeps a filed task's", async () => {
    const collection = await board(1);
    const first = turnCtx([shot]);
    const filed = (await runForTest(createTask(collection) as never, { goal: "Fix it", assignee: "writer" } as never, first.ctx)) as Result;
    expect(filed.ok).toBe(true);
    expect(first.discarded).toEqual([]);

    const second = turnCtx([shot]);
    const refused = (await runForTest(createTask(collection) as never, { goal: "And this", assignee: "writer" } as never, second.ctx)) as Result;
    expect(refused.ok).toBe(false);
    expect(collection.list()).toHaveLength(1);
    expect(second.discarded).toEqual(second.kept);
    expect(collection.get(filed.taskId!)!.attachments).toEqual(first.kept[0]);
  });

  it("takes no files from the model's input", async () => {
    const collection = await board();
    const { ctx } = turnCtx([]);
    const result = (await runForTest(
      createTask(collection) as never,
      { goal: "Fix it", assignee: "writer", attachments: [shot] } as never,
      ctx,
    )) as Result;
    expect(collection.get(result.taskId!)!.attachments).toBeUndefined();
  });
});

describe("the brief's files are fixed when the task starts (D1)", () => {
  it("take context's rule, and no edit sets them", () => {
    expect(TASK_FIELD_RULES.attachments).toBe(TASK_FIELD_RULES.context);
    const base = { id: "t", goal: "g", createdAt: 1, updatedAt: 1 } as const;
    expect(lockedFields({ ...base, status: "pending", attempts: 0 }, ["attachments"])).toEqual([]);
    expect(lockedFields({ ...base, status: "pending", attempts: 1 }, ["attachments"])).toEqual(["attachments"]);
  });
});
