/**
 * A row stored as `ask` still reads as waited on (retired-name-refusal: WR-8).
 * A collection casts the row, and `taskSchema` would strip the unknown key.
 * Miss it and the ending never resumes the turn.
 */
import { describe, expect, it } from "vitest";
import { withMigratedWait } from "../../src/tasks/schema/task";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  type TaskCollectionRef
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

const MARK = { gateId: "ask:tasks:t#1", deadline: 9_000_000_000_000, requestId: "r1" };

/** A board plus a way to put the old mark back on a stored row. */
interface LegacyBacking {
  collection: TaskCollectionRef;
  storeUnderOldName: (id: string) => Promise<void>;
}

async function sequencerBacking(): Promise<LegacyBacking> {
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  const collection = createStateBackedTaskCollection({ collectionId: "tasks", state: sequencer });
  return {
    collection,
    async storeUnderOldName(id) {
      const raw = sequencer.__raw();
      const { wait, ...rest } = raw.tasks[id] as Record<string, unknown>;
      raw.tasks[id] = { ...rest, ask: wait }; // retired-name-refusal: WR-8, the shape the build before the rename stored
    }
  };
}

async function resourceBacking(): Promise<LegacyBacking> {
  const resources = createFakeResourceCollection();
  const collection = await createResourceBackedTaskCollection({ collectionId: "tasks", collection: resources });
  return {
    collection,
    async storeUnderOldName(id) {
      for (const ref of await resources.list()) {
        if ((ref.state as { id?: string }).id !== id) continue;
        const { wait, ...rest } = ref.state as Record<string, unknown>;
        await ref.setState({ ...rest, ask: wait } as never); // retired-name-refusal: WR-8, the shape the build before the rename stored
      }
    }
  };
}

const BACKINGS = [
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking]
] as const;

describe("a row stored with its wait mark under the old name", () => {
  for (const [name, backing] of BACKINGS) {
    describe(name, () => {
      it("reads as waited on, with the same gate and deadline", async () => {
        const { collection, storeUnderOldName } = await backing();
        await collection.createTask({ id: "t", goal: "find out" });
        await collection.markWait!("t", MARK);
        await storeUnderOldName("t");

        expect(collection.get("t")?.wait).toEqual(MARK);
        expect(collection.get("t")).not.toHaveProperty("ask");
      });

      it("owes its waiting turn a resume when it ends, as a row written today does", async () => {
        const { collection, storeUnderOldName } = await backing();
        await collection.createTask({ id: "t", goal: "find out" });
        await collection.markWait!("t", MARK);
        await storeUnderOldName("t");
        await collection.claim("w");
        await collection.complete("t", "yes");

        expect(collection.get("t")).toMatchObject({ status: "completed", resumeOwed: true, wait: MARK });
      });
    });
  }

  it("leaves a row with no old mark as it is, allocating nothing", () => {
    const row = { id: "t", wait: MARK };
    expect(withMigratedWait(row)).toBe(row);
  });
});
