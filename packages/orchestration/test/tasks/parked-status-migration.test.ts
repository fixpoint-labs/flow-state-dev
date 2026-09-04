/**
 * FIX-1245 — the shipped task status is `parked`, and the legacy
 * `awaiting_review` still reads.
 *
 * The rename is not cosmetic on the read path, and the read path has two
 * halves that need pinning separately.
 *
 * Where a stored row is **parsed**, `normalizeResourceState` never surfaces a
 * value that fails its schema — it substitutes the resource's default. An enum
 * that no longer accepted `awaiting_review` would not mislabel such a row; it
 * would reset that state to empty. `persistedTaskStatusSchema` covers this,
 * and has to be a **fixed point**: `assertStableResourceState` re-parses any
 * value a schema rewrote and rejects the write when the second parse moves it
 * again, so mapping legacy → `parked` is only safe because parsing `parked`
 * yields `parked`.
 *
 * Where a stored row is **cast** — a task collection instance, which is what
 * the task board actually runs on — no schema runs at all. That half is
 * `withMigratedStatus` at the read boundary, and it is the half that matters
 * for the state machine.
 */

import { describe, it, expect } from "vitest";
import { taskSchema } from "../../src/tasks/schema/task";
import {
  isTransitionAllowed,
  taskStatusSchema,
  type TaskStatus
} from "../../src/tasks/schema/task-status";
import {
  createResourceBackedTaskCollection,
  createSequencerBackedTaskCollection,
  type TaskCollectionRef
} from "../../src/tasks";
import {
  createFakeResourceCollection,
  createFakeSequencerState
} from "../helpers";

/** A persisted task row at the given status, with every required field present. */
function rowAt(status: string): Record<string, unknown> {
  return {
    id: "ask",
    goal: "wait for a person",
    status,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000
  };
}

describe("FIX-1245 parked status", () => {
  it("is the status the enum ships", () => {
    expect(taskStatusSchema.safeParse("parked").success).toBe(true);
  });

  it("no longer accepts the old name as a value callers may write", () => {
    expect(taskStatusSchema.safeParse("awaiting_review").success).toBe(false);
  });

  it("reads a persisted row still carrying awaiting_review, as parked", () => {
    const parsed = taskSchema.safeParse(rowAt("awaiting_review"));
    expect(parsed.success).toBe(true);
    expect((parsed.data as { status: TaskStatus }).status).toBe("parked");
  });

  it("is a fixed point: re-parsing the migrated row does not move it again", () => {
    const once = taskSchema.parse(rowAt("awaiting_review"));
    const twice = taskSchema.parse(once);
    expect(twice).toEqual(once);
  });

  it("leaves a row already written at parked alone", () => {
    const parsed = taskSchema.parse(rowAt("parked"));
    expect((parsed as { status: TaskStatus }).status).toBe("parked");
  });
});

/** The legacy value as it sits on a row written before the rename. */
const LEGACY = "awaiting_review";

/**
 * A board plus a way to put a legacy status back on a stored row — the state a
 * pre-rename deploy leaves behind. Both fakes store rows the way the engine
 * does for collections: written through, read back unparsed.
 */
interface LegacyBacking {
  collection: TaskCollectionRef;
  setLegacyStatus: (id: string) => Promise<void>;
}

async function sequencerBacking(): Promise<LegacyBacking> {
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
    tasks: {}
  });
  const collection = createSequencerBackedTaskCollection({
    collectionId: "tasks",
    sequencer
  });
  return {
    collection,
    async setLegacyStatus(id) {
      const raw = sequencer.__raw();
      const row = raw.tasks[id] as Record<string, unknown>;
      raw.tasks[id] = { ...row, status: LEGACY };
    }
  };
}

async function resourceBacking(): Promise<LegacyBacking> {
  const resources = createFakeResourceCollection();
  const collection = await createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: resources
  });
  return {
    collection,
    async setLegacyStatus(id) {
      for (const ref of await resources.list()) {
        if ((ref.state as { id?: string }).id !== id) continue;
        await ref.setState({ ...ref.state, status: LEGACY });
      }
    }
  };
}

const BACKINGS = [
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking]
] as const;

/**
 * The durable path. A collection instance is NOT parsed through `taskSchema`
 * when it is read — `normalizeScopeResources` skips collection configs and
 * copies their instances through verbatim, and both backings' read helpers
 * (`readTaskState`, `readTasks`) cast the stored row. So a row persisted
 * before the rename reaches board logic still carrying the legacy value, and
 * the schema shim above never sees it.
 *
 * That is the path the rename actually has to survive, so it is pinned here.
 */
describe("FIX-1245 legacy rows on the durable read path", () => {
  it("does not throw when the state machine is asked about the legacy status", () => {
    // `ALLOWED_TRANSITIONS` is keyed by the shipped enum, so an unmapped
    // `from` indexes to `undefined` and the guard dies on `.includes` —
    // a TypeError instead of the typed refusal callers handle.
    expect(() =>
      isTransitionAllowed("awaiting_review" as TaskStatus, "pending")
    ).not.toThrow();
  });

  for (const [name, seedLegacy] of BACKINGS) {
    describe(name, () => {
      it("resumes a task parked before the rename", async () => {
        const { collection, setLegacyStatus } = await seedLegacy();
        await collection.addTask({ id: "t", goal: "wait for a person" });
        await collection.claim("w");
        await collection.awaitReview("t");
        await setLegacyStatus("t");

        await expect(collection.resumeFromReview("t")).resolves.toBeDefined();
        expect(collection.get("t")?.status).toBe("pending");
      });

      it("counts a task parked before the rename as parked", async () => {
        const { collection, setLegacyStatus } = await seedLegacy();
        await collection.addTask({ id: "t", goal: "wait for a person" });
        await collection.claim("w");
        await collection.awaitReview("t");
        await setLegacyStatus("t");

        expect(collection.get("t")?.status).toBe("parked");
        expect(collection.count({ status: "parked" })).toBe(1);
      });
    });
  }
});
