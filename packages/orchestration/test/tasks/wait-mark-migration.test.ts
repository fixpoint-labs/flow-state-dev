/**
 * A row stored before the wait rename still reads as waited on (WR-8).
 *
 * A row the build before the rename filed for a waiting turn carries its mark
 * as `ask: { gateId, deadline }` (retired-name-refusal: WR-8). Stored rows reach board logic two ways, and
 * both have to read the old mark as `wait`:
 *
 * - **Cast**, on a task collection instance (the durable board): no schema
 *   runs, so `withMigratedWait` at each backing's read boundary maps it.
 * - **Parsed**, through the delegation board field: `taskSchema` would strip
 *   the unknown key, so the field's schema maps it before parsing.
 *
 * If either dropped the old mark, the row's ending would never resume the
 * turn parked on it: the answer would be lost.
 */
import { describe, expect, it } from "vitest";
import { delegationBoardSchema } from "../../src/skills/task-tools-capability";
import { withMigratedWait } from "../../src/tasks/schema/task";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  type TaskCollectionRef
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

const MARK = { gateId: "ask:tasks:t#1", deadline: 9_000_000_000_000 };

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
        await collection.addTask({ id: "t", goal: "find out", wait: MARK });
        await storeUnderOldName("t");

        expect(collection.get("t")?.wait).toEqual(MARK);
        expect(collection.get("t")).not.toHaveProperty("ask");
      });

      it("owes its waiting turn a resume when it ends, as a row written today does", async () => {
        const { collection, storeUnderOldName } = await backing();
        await collection.addTask({ id: "t", goal: "find out", wait: MARK });
        await storeUnderOldName("t");
        await collection.claim("w");
        await collection.complete("t", "yes");

        expect(collection.get("t")).toMatchObject({ status: "completed", resumeOwed: true, wait: MARK });
      });
    });
  }

  it("reads as waited on through the delegation board field, which parses its rows", () => {
    const now = 1_700_000_000_000;
    const row = { id: "t", goal: "find out", status: "pending", attempts: 0, createdAt: now, updatedAt: now };
    const parsed = delegationBoardSchema.parse({ t: { ...row, ask: MARK } }); // retired-name-refusal: WR-8, a row stored before the rename
    expect(parsed.t?.wait).toEqual(MARK);
    // A fixed point: parsing the migrated board again moves nothing.
    expect(delegationBoardSchema.parse(parsed)).toEqual(parsed);
  });

  it("leaves a row with no old mark as it is, allocating nothing", () => {
    const row = { id: "t", wait: MARK };
    expect(withMigratedWait(row)).toBe(row);
  });
});
