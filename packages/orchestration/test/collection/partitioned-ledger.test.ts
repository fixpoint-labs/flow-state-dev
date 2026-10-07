/**
 * A task ledger kept per partition (`defineTaskCollection({ partitionBy })`):
 * what a ref resolved at one partition reaches, how its rows are keyed, and
 * which declarations and resolutions are refused.
 *
 * The end-to-end proof, two conversations and two users across two flows, is
 * `test/task-board/hand-off-cross-flow.test.ts`. These pin the layer under it.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  type DefinedTaskCollection,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
import { resolveTaskPartition } from "../../src/tasks/collection/partition";
import { createFakeResourceCollection } from "../helpers";

const LEDGER = "convo-tasks";

/** Minimal block context: the factory reads only `emit` and identity. */
function ctxFor(userId = "alice"): BlockContext {
  return {
    emit: { component: () => undefined },
    session: { identity: { type: "session", id: "s_1", userId } },
    request: { identity: { type: "request", id: "r_1" } },
  } as unknown as BlockContext;
}

/** A fake resource collection that reports `declared` as its config, as the engine's handle does. */
function storeFor(declared: DefinedTaskCollection): ResourceCollectionRef<JsonObject> {
  const store = createFakeResourceCollection<JsonObject>(`${LEDGER}/**`);
  return Object.assign(store, { config: declared }) as ResourceCollectionRef<JsonObject>;
}

const partitioned = () =>
  defineTaskCollection({ id: LEDGER, scope: "user", partitionBy: () => "unused" });

function at(store: ResourceCollectionRef<JsonObject>, partition: string): Promise<TaskCollectionRef> {
  return getOrCreateTaskCollection({
    ctx: ctxFor(),
    backing: "resource",
    collectionId: LEDGER,
    collection: store,
    partition,
  });
}

describe("defineTaskCollection({ partitionBy })", () => {
  it("is accepted at user scope and carried on the declaration", () => {
    const partitionBy = () => "p";
    const ledger = defineTaskCollection({ id: LEDGER, scope: "user", partitionBy });
    expect(ledger.__taskCollection.partitionBy).toBe(partitionBy);
  });

  it.each(["session", "org"] as const)("refuses %s scope", (scope) => {
    expect(() => defineTaskCollection({ id: LEDGER, scope, partitionBy: () => "p" })).toThrow(
      /partitionBy .* must be scope: "user"/
    );
  });

  it("refuses maxInstances, a cap the resource layer counts across every partition", () => {
    expect(() =>
      defineTaskCollection({ id: LEDGER, scope: "user", partitionBy: () => "p", maxInstances: 10 })
    ).toThrow(/cannot be combined with maxInstances/);
  });

  it("refuses a partitionBy that is not a function", () => {
    expect(() =>
      defineTaskCollection({ id: LEDGER, scope: "user", partitionBy: "p" as never })
    ).toThrow(/partitionBy must be a function/);
  });
});

describe("resolving a partitioned ledger", () => {
  it("is refused with no partition: the ledger is never read whole", async () => {
    await expect(
      getOrCreateTaskCollection({
        ctx: ctxFor(),
        backing: "resource",
        collectionId: LEDGER,
        collection: storeFor(partitioned()),
      })
    ).rejects.toThrow(/keeps its rows per partition .* never read whole/);
  });

  it("refuses a partition on a ledger declared without one", async () => {
    const plain = defineTaskCollection({ id: LEDGER, scope: "user" });
    await expect(at(storeFor(plain), "p")).rejects.toThrow(/was not declared with partitionBy/);
  });

  it("reports the partition it was resolved at", async () => {
    expect((await at(storeFor(partitioned()), "conv-a")).partition).toBe("conv-a");
  });
});

describe("a ref resolved at one partition", () => {
  it("keys each row <partition segment>/<task id>, under the collection id", async () => {
    const store = storeFor(partitioned());
    const a = await at(store, "Conv A/1");
    await a.addTask({ id: "t1", goal: "g" });
    // The segment is the injective one-segment encoding: a "/" in the
    // partition value cannot make the row nest.
    const keys = (await store.list()).map((ref) => ref.path);
    expect(keys).toEqual([`${encodeUserSegment("Conv A/1")}/t1`]);
    expect(encodeUserSegment("Conv A/1")).not.toContain("/");
  });

  it("refuses a task id that would nest under the partition", async () => {
    const a = await at(storeFor(partitioned()), "p");
    await expect(a.addTask({ id: "parent/child", goal: "g" })).rejects.toThrow(/one path segment/);
    await expect(a.addTask({ id: "parent\\child", goal: "g" })).rejects.toThrow(/one path segment/);
  });

  it("adopts only its partition's direct children", async () => {
    const store = storeFor(partitioned());
    const a = await at(store, "p");
    await a.addTask({ id: "mine", goal: "g" });
    // A row nested a level deeper, written past the partitioned ref, is not
    // the partition's: no read of the partition finds it.
    const nested = (await a.get("mine")) as Task;
    await store.create(`${encodeUserSegment("p")}/deeper/row`, { ...nested, id: "deeper" } as never);
    const again = await at(store, "p");
    expect(again.list().map((task) => task.id)).toEqual(["mine"]);
  });

  it("BR-11 · reads, counts, claims and settles only its own rows", async () => {
    const store = storeFor(partitioned());
    await (await at(store, "conv-a")).addTask({ id: "a1", goal: "a's" });
    const filer = await at(store, "conv-b");
    await filer.addTask({ id: "b1", goal: "b's" });
    // One task id in both: two rows, one per partition.
    await filer.addTask({ id: "a1", goal: "b's a1" });

    // Resolved after the rows exist, so each reads the store, not what it added.
    const a = await at(store, "conv-a");
    const b = await at(store, "conv-b");
    expect(a.list().map((task) => task.id)).toEqual(["a1"]);
    expect(a.get("a1")?.goal).toBe("a's");
    expect(a.get("b1")).toBeUndefined();
    // The drain's wake and exit read counts.
    expect(a.count({ status: ["pending"] })).toBe(1);
    expect(b.count({ status: ["pending"] })).toBe(2);

    const claimed = await a.claim("w");
    expect(claimed?.id).toBe("a1");
    expect(await a.claim("w")).toBeNull();
    await a.complete("a1", { done: true });

    const fresh = await at(store, "conv-b");
    expect(fresh.list().map((task) => [task.id, task.status, task.goal])).toEqual([
      ["b1", "pending", "b's"],
      ["a1", "pending", "b's a1"],
    ]);
  });

  it("does not take a partition whose encoded segment starts with another's", async () => {
    const store = storeFor(partitioned());
    await (await at(store, "conv")).addTask({ id: "short", goal: "g" });
    await (await at(store, "conv2")).addTask({ id: "long", goal: "g" });
    expect((await at(store, "conv")).list().map((task) => task.id)).toEqual(["short"]);
  });

  it("emits change events for its own rows only", async () => {
    const store = storeFor(partitioned());
    const seen: string[] = [];
    const ctx = {
      ...ctxFor(),
      emit: { component: (_type: string, data: { taskId: string }) => void seen.push(data.taskId) },
    } as unknown as BlockContext;
    const a = await getOrCreateTaskCollection({
      ctx,
      backing: "resource",
      collectionId: LEDGER,
      collection: store,
      partition: "conv-a",
    });
    await (await at(store, "conv-b")).addTask({ id: "b1", goal: "g" });
    await a.addTask({ id: "a1", goal: "g" });
    expect(seen).toEqual(["a1"]);
  });
});

describe("a partition function", () => {
  it("runs with no parent block, so it has no input to read", async () => {
    const ctx = { ...ctxFor(), parent: { name: "caller", kind: "handler", input: { partition: "theirs" } } };
    const seen: unknown[] = [];
    const partition = await resolveTaskPartition(
      LEDGER,
      (view) => {
        seen.push((view as { parent?: unknown }).parent, "parent" in view);
        return view.session.identity.id;
      },
      ctx as unknown as BlockContext
    );
    expect(partition).toBe("s_1");
    expect(seen).toEqual([undefined, false]);
  });

  it.each([[""], [undefined], [42]])("refuses a returned %j", async (value) => {
    await expect(
      resolveTaskPartition(LEDGER, () => value as never, ctxFor())
    ).rejects.toThrow(/Return a non-empty string/);
  });
});
