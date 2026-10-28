/**
 * A held row and the release that starts it (FIX-1875 S3; `release` since
 * FIX-2080 D1, the one release since `dispatchTask` went, FIX-2083).
 *
 * A row filed held doesn't start until something releases it, and no claimer
 * takes it before. No caller-patchable surface reaches the status.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  type Task,
  type TaskChangeEvent,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

type Backing = { tasks: TaskCollectionRef; events: TaskChangeEvent[] };

async function sequencerBacking(): Promise<Backing> {
  const events: TaskChangeEvent[] = [];
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  const tasks = createStateBackedTaskCollection({
    collectionId: "tasks",
    state: sequencer,
    onChange: (event) => events.push(event),
    now: () => 1000,
  });
  return { tasks, events };
}

async function resourceBacking(): Promise<Backing> {
  const events: TaskChangeEvent[] = [];
  const tasks = await createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: createFakeResourceCollection(),
    onChange: (event) => events.push(event),
    now: () => 1000,
  });
  return { tasks, events };
}

const BACKINGS = [
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
] as const;

describe.each(BACKINGS)("a held row (%s)", (_name, makeBacking) => {
  it("files held only when asked, so a plain add is ready as before", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "ready", goal: "g", assignee: "ops" });
    await tasks.createTask({ id: "held", goal: "g", assignee: "ops", held: true });
    expect(tasks.get("ready")!.status).toBe("pending");
    expect(tasks.get("held")!.status).toBe("held");
  });

  it("keeps the status out of reach of every caller-patchable write", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "g", assignee: "ops", held: true });
    await tasks.patchMetadata("t", { status: "pending" });
    await tasks.setAssignee("t", "writer");
    const row = tasks.get("t") as Task;
    expect(row.status).toBe("held");
    expect(row.assignee).toBe("writer");
    expect(row.metadata).toEqual({ status: "pending" });
  });
});

// A held row gates every claimer of the collection, not only the board that
// files it: a plain drain or a row action claims through the substrate's
// admission, and one that took a held row would start work nobody released.
describe.each(BACKINGS)("a claimer with no start test of its own (%s)", (_name, makeBacking) => {
  it("never claims a held row, and claims it once it is released", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "g", assignee: "ops", held: true });
    expect(await tasks.claim("w", { leaseDurationMs: 10_000 })).toBeNull();
    expect(tasks.get("t")!.status).toBe("held");

    expect(await tasks.release("t")).toEqual({ outcome: "recorded" });
    expect((await tasks.claim("w", { leaseDurationMs: 10_000 }))?.id).toBe("t");
  });

  it("claims a row filed ready, as every row was before holds (BP-030)", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "legacy", goal: "g", assignee: "ops" });
    expect((await tasks.claim("w", { leaseDurationMs: 10_000 }))?.id).toBe("legacy");
  });
});
