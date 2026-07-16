/**
 * Tests for `TaskHandle.items()` (FIX-480 §3.1).
 *
 * Both backings expose `list` / `get` as `TaskHandle` returns. The
 * `items()` accessor reads a snapshot of the configured `getItems` log at
 * call time and slices it to the task's claim window.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { ComponentItem, MessageItem, OutputItem } from "@flow-state-dev/core/items";
import {
  createResourceBackedTaskCollection,
  createSequencerBackedTaskCollection,
  getOrCreateTaskCollection,
  type TaskCollectionRef,
} from "../../src";
import {
  createCapturedChanges,
  createFakeResourceCollection,
  createFakeSequencerState,
} from "../helpers";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

function taskChange(args: {
  collectionId: string;
  taskId: string;
  kind: string;
  ts: number;
}): ComponentItem {
  return {
    id: nextId("c"),
    type: "component",
    status: "completed",
    requestId: "req",
    itemIndex: 0,
    provenance: { blockName: "tb", blockInstanceId: "tb#1", phase: "main" },
    ts: args.ts,
    component: "task-change",
    data: {
      collectionId: args.collectionId,
      taskId: args.taskId,
      kind: args.kind,
    },
  };
}

function message(args: { ts: number; text: string; taskId?: string }): MessageItem {
  return {
    id: nextId("m"),
    type: "message",
    role: "assistant",
    status: "completed",
    requestId: "req",
    itemIndex: 0,
    provenance: { blockName: "w", blockInstanceId: "w#1", phase: "main" },
    ts: args.ts,
    taskId: args.taskId,
    content: [{ type: "output_text", text: args.text }],
  };
}

type Factory = () => Promise<{
  collection: TaskCollectionRef;
  itemLog: OutputItem[];
}>;

const factories: Array<{ name: string; build: Factory }> = [
  {
    name: "sequencer-backed",
    build: async () => {
      const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
      const captured = createCapturedChanges();
      const itemLog: OutputItem[] = [];
      const collection = createSequencerBackedTaskCollection({
        collectionId: "c1",
        sequencer,
        onChange: captured.onChange,
        getItems: () => itemLog,
        now: () => 1000,
      });
      return { collection, itemLog };
    },
  },
  {
    name: "resource-backed",
    build: async () => {
      const collectionRef = createFakeResourceCollection();
      const captured = createCapturedChanges();
      const itemLog: OutputItem[] = [];
      const collection = await createResourceBackedTaskCollection({
        collectionId: "c1",
        collection: collectionRef,
        onChange: captured.onChange,
        getItems: () => itemLog,
        now: () => 1000,
      });
      return { collection, itemLog };
    },
  },
];

for (const { name, build } of factories) {
  describe(`TaskHandle.items (${name})`, () => {
    it("returns [] for a task that has not been claimed", async () => {
      const { collection } = await build();
      const t = await collection.addTask({ id: "t1", goal: "do the thing" });
      const handle = collection.get(t.id);
      expect(handle).toBeDefined();
      expect(handle!.items()).toEqual([]);
    });

    it("returns items in the task's claim window after worker emissions", async () => {
      const { collection, itemLog } = await build();
      await collection.addTask({ id: "t1", goal: "g" });

      // Synthesize the substrate's task-change events directly into the log.
      // Real lifecycle events are emitted via ctx.emit.component, and worker
      // items carry the emit-time `taskId` stamp; here we mock the log to
      // assert attribution. An item with no `taskId` was emitted outside any
      // task scope and is excluded.
      itemLog.push(
        taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 100 }),
        message({ ts: 150, text: "in-window", taskId: "t1" }),
        taskChange({ collectionId: "c1", taskId: "t1", kind: "completed", ts: 200 }),
        message({ ts: 250, text: "after-window" }),
      );

      const handle = collection.get("t1");
      const items = handle!.items();
      expect(items).toHaveLength(1);
      expect((items[0] as MessageItem).content[0]).toEqual({
        type: "output_text",
        text: "in-window",
      });
    });

    it("list returns TaskHandles each scoped to their own taskId", async () => {
      const { collection, itemLog } = await build();
      await collection.addTasks([
        { id: "t1", goal: "a" },
        { id: "t2", goal: "b" },
      ]);

      itemLog.push(
        taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 100 }),
        message({ ts: 110, text: "t1-emit", taskId: "t1" }),
        taskChange({ collectionId: "c1", taskId: "t1", kind: "completed", ts: 120 }),
        taskChange({ collectionId: "c1", taskId: "t2", kind: "claimed", ts: 200 }),
        message({ ts: 210, text: "t2-emit", taskId: "t2" }),
        taskChange({ collectionId: "c1", taskId: "t2", kind: "completed", ts: 220 }),
      );

      const handles = collection.list();
      const byId = Object.fromEntries(handles.map((h) => [h.id, h]));
      expect(byId.t1.items().map((i) => (i as MessageItem).content[0])).toEqual([
        { type: "output_text", text: "t1-emit" },
      ]);
      expect(byId.t2.items().map((i) => (i as MessageItem).content[0])).toEqual([
        { type: "output_text", text: "t2-emit" },
      ]);
    });

    it("snapshots at call time — late-arriving items appear on subsequent reads", async () => {
      const { collection, itemLog } = await build();
      await collection.addTask({ id: "t1", goal: "g" });

      itemLog.push(
        taskChange({ collectionId: "c1", taskId: "t1", kind: "claimed", ts: 100 }),
      );
      const earlyItems = collection.get("t1")!.items();
      expect(earlyItems).toEqual([]);

      itemLog.push(
        message({ ts: 150, text: "later", taskId: "t1" }),
        taskChange({ collectionId: "c1", taskId: "t1", kind: "completed", ts: 200 }),
      );
      const lateItems = collection.get("t1")!.items();
      expect(lateItems).toHaveLength(1);
    });

    it("returns [] when no getItems was configured (test-mode default)", async () => {
      let collection: TaskCollectionRef;
      if (name === "sequencer-backed") {
        const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
        collection = createSequencerBackedTaskCollection({
          collectionId: "c1",
          sequencer,
          now: () => 1000,
        });
      } else {
        const collectionRef = createFakeResourceCollection();
        collection = await createResourceBackedTaskCollection({
          collectionId: "c1",
          collection: collectionRef,
          now: () => 1000,
        });
      }

      await collection.addTask({ id: "t1", goal: "g" });
      const handle = collection.get("t1");
      expect(handle!.items()).toEqual([]);
    });
  });
}

// Regression: `getOrCreateTaskCollection` reads `ctx.response` to capture
// the item-log accessor. A test that supplies a BlockContext without a
// `response` field must not crash — `items()` should fall through to [].
describe("getOrCreateTaskCollection items() — undefined ctx.response", () => {
  it("does not throw when ctx.response is missing", async () => {
    const sequencerState = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
    const ctx = {
      response: undefined,
      emit: { component: () => undefined },
      request: { state: { plan: {} } },
    } as unknown as BlockContext;

    const collection = await getOrCreateTaskCollection({
      ctx,
      backing: "sequencer",
      collectionId: "plan",
      sequencer: sequencerState,
      now: () => 1000,
    });

    await collection.addTask({ id: "t1", goal: "g" });
    const handle = collection.get("t1");
    expect(handle).toBeDefined();
    expect(() => handle!.items()).not.toThrow();
    expect(handle!.items()).toEqual([]);
  });
});
