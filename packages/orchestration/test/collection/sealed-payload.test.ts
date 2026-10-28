/**
 * A row's `sealed` payload: written once by the server code that files the
 * row, kept as filed, and matched by `list({ sealed })` on its plain values.
 * A row filed without one has none.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createCapturedChanges, createFakeResourceCollection, createFakeSequencerState } from "../helpers";

async function sequencerBacking(): Promise<TaskCollectionRef> {
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  return createStateBackedTaskCollection({ collectionId: "tasks", state: sequencer, onChange: createCapturedChanges().onChange });
}

async function resourceBacking(): Promise<TaskCollectionRef> {
  return createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: createFakeResourceCollection(),
    onChange: createCapturedChanges().onChange,
  });
}

describe.each([
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
] as const)("a row's sealed payload (%s)", (_name, makeBacking) => {
  it("keeps the payload as filed, and only a filed one", async () => {
    const tasks = await makeBacking();
    const sealed = { kind: "post", postId: "p1", round: 0, delegate: { worker: "eng.a" } };
    await tasks.addTask({ id: "post-1", goal: "post", sealed });
    await tasks.addTask({ id: "plain", goal: "plain" });
    expect(tasks.get("post-1")?.sealed).toEqual(sealed);
    expect(tasks.get("plain")?.sealed).toBeUndefined();
  });

  it("matches list({ sealed }) on every key it names, and nothing on a row without one", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "a", goal: "a", sealed: { kind: "post", postId: "p1", round: 0 } });
    await tasks.addTask({ id: "b", goal: "b", sealed: { kind: "post", postId: "p1", round: 1 } });
    await tasks.addTask({ id: "c", goal: "c", sealed: { kind: "post", postId: "p2", round: 0 } });
    await tasks.addTask({ id: "d", goal: "d" });
    const ids = (filter: Record<string, string | number | boolean>) => tasks.list({ sealed: filter }).map((task) => task.id).sort();
    expect(ids({ kind: "post" })).toEqual(["a", "b", "c"]);
    expect(ids({ kind: "post", postId: "p1", round: 0 })).toEqual(["a"]);
    expect(ids({ round: 1 })).toEqual(["b"]);
    expect(ids({ kind: "task" })).toEqual([]);
  });
});
