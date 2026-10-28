/**
 * A partitioned ledger's id index (FIX-2160 D1): a bare task id finds the
 * partitions that hold it without reading any partition's rows.
 *
 * Why it matters: a message addressed `{ task: id }` names a row the sender
 * can't place, since rows live at `<partition>/<id>`. Listing the whole ledger
 * per send would load every conversation's rows; the index answers from one
 * prefix read, and is written by the ledger's own add so no filing path can
 * skip it.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  defineTaskCollection,
  findTaskPartitions,
  getOrCreateTaskCollection,
  taskIdIndexKey,
  taskLedgerResources,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeResourceCollection } from "../helpers";

const LEDGER = "convo-tasks";

function setup(options: { installIndex?: boolean } = {}) {
  const declared = defineTaskCollection({ id: LEDGER, scope: "user", partitionBy: () => "unused" });
  const rows = Object.assign(createFakeResourceCollection<JsonObject>(`${LEDGER}/**`), {
    config: declared,
  }) as ResourceCollectionRef<JsonObject>;
  const index = createFakeResourceCollection<JsonObject>(`${taskIdIndexKey(LEDGER)}/**`);
  const ctx = {
    emit: { component: () => undefined },
    resources: options.installIndex === false ? {} : { [taskIdIndexKey(LEDGER)]: index },
    session: { identity: { type: "session", id: "s_1", userId: "alice" } },
    request: { identity: { type: "request", id: "r_1" } },
  } as unknown as BlockContext;
  const at = (partition: string): Promise<TaskCollectionRef> =>
    getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: LEDGER, collection: rows, partition });
  return { declared, rows, index, ctx, at };
}

describe("a partitioned ledger's id index", () => {
  it("finds the partition an add filed the id in", async () => {
    const { ctx, at } = setup();
    await (await at("conv-a")).addTask({ id: "t1", goal: "g" });

    expect(await findTaskPartitions(ctx, LEDGER, "t1")).toEqual(["conv-a"]);
  });

  it("finds every id of a batch add", async () => {
    const { ctx, at } = setup();
    await (await at("conv-a")).addTasks([
      { id: "t1", goal: "g" },
      { id: "t2", goal: "g" },
    ]);

    expect(await findTaskPartitions(ctx, LEDGER, "t2")).toEqual(["conv-a"]);
  });

  it("keeps both partitions of an id filed twice, never one over the other", async () => {
    // Ids a caller picks are unique per partition only, so the lookup must
    // see both and let the caller refuse the ambiguity.
    const { ctx, at } = setup();
    await (await at("conv-a")).addTask({ id: "t1", goal: "g" });
    await (await at("conv-b")).addTask({ id: "t1", goal: "g" });

    expect((await findTaskPartitions(ctx, LEDGER, "t1")).sort()).toEqual(["conv-a", "conv-b"]);
  });

  it("answers nothing for an id no add filed, or an id that only prefixes one", async () => {
    const { ctx, at } = setup();
    await (await at("conv-a")).addTask({ id: "t10", goal: "g" });

    expect(await findTaskPartitions(ctx, LEDGER, "t1")).toEqual([]);
    expect(await findTaskPartitions(ctx, LEDGER, "")).toEqual([]);
  });

  it("reads the index, not the rows: a row with no marker is not found", async () => {
    // The control for the tests above: a row written straight to the store,
    // past the add, has no marker, so the lookup cannot be scanning rows.
    const { ctx, rows } = setup();
    await rows.create("conv-a/t1", { id: "t1" } as JsonObject);

    expect(await findTaskPartitions(ctx, LEDGER, "t1")).toEqual([]);
  });

  it("refuses an add on a flow that installs the ledger without its index, before the row", async () => {
    const { at, rows } = setup({ installIndex: false });
    const ref = await at("conv-a");

    await expect(ref.addTask({ id: "t1", goal: "g" })).rejects.toThrow(/without its id index/);
    expect(await rows.list()).toEqual([]);
  });

  it("is installed beside the ledger by taskLedgerResources", () => {
    const { declared } = setup();
    const resources = taskLedgerResources(declared);

    expect(Object.keys(resources).sort()).toEqual([LEDGER, taskIdIndexKey(LEDGER)].sort());
    expect(taskLedgerResources(defineTaskCollection({ id: "plain", scope: "user" }))).toEqual({
      plain: expect.anything(),
    });
  });
});
