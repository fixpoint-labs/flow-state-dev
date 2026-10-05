/**
 * A ledger over one key prefix of a durable task collection.
 *
 * Many ledgers share one declared collection, each holding only the tasks
 * under its own prefix. The property that matters is isolation: a ledger never
 * lists, claims or completes a task another prefix holds, and two prefixes
 * where one is the start of the other (`a` and `ab`) stay apart.
 *
 * The read is bounded by the prefix where the store is asked, not filtered
 * after a full listing: the `list` the collection receives carries the prefix.
 */
import { describe, expect, it, vi } from "vitest";
import { createResourceBackedTaskCollection } from "../../src/tasks";
import { createFakeResourceCollection } from "../helpers";

async function ledgerAt(backing: ReturnType<typeof createFakeResourceCollection>, keyPrefix: string) {
  return createResourceBackedTaskCollection({
    collectionId: `lists.${keyPrefix}`,
    collection: backing,
    keyPrefix,
    now: () => 1000,
  });
}

describe("a ledger over one key prefix", () => {
  it("lists, claims and completes only its own tasks when two prefixes share a collection", async () => {
    const backing = createFakeResourceCollection();
    const login = await ledgerAt(backing, "platform.login/tasks");
    const outage = await ledgerAt(backing, "support.outage/tasks");

    await login.addTask({ id: "t1", goal: "login page" });
    await outage.addTask({ id: "t1", goal: "outage report" });

    // Same task id under two prefixes: two rows, one per ledger.
    expect(login.list().map((task) => task.goal)).toEqual(["login page"]);
    expect(outage.list().map((task) => task.goal)).toEqual(["outage report"]);

    const claimed = await login.claim("w1");
    expect(claimed?.goal).toBe("login page");
    // The other ledger's row is untouched by the claim.
    expect(outage.get("t1")?.status).toBe("pending");
    // And it has nothing left for a second claim on the first ledger.
    expect(await login.claim("w2")).toBeNull();

    await login.complete("t1", { done: true });
    expect(login.get("t1")?.status).toBe("completed");
    expect(outage.get("t1")?.status).toBe("pending");
  });

  it("keeps a prefix apart from a longer one it starts", async () => {
    const backing = createFakeResourceCollection();
    const short = await ledgerAt(backing, "eng.a/tasks");
    const long = await ledgerAt(backing, "eng.a/tasksx");

    await long.addTask({ id: "t", goal: "long" });
    const reread = await ledgerAt(backing, "eng.a/tasks");
    expect(short.list()).toEqual([]);
    expect(reread.list()).toEqual([]);
  });

  it("stores each task under the prefix and asks the collection for that prefix only", async () => {
    const backing = createFakeResourceCollection();
    const list = vi.spyOn(backing, "list");
    const ledger = await ledgerAt(backing, "platform.login/tasks");
    await ledger.addTask({ id: "t1", goal: "g" });

    expect(list.mock.calls).toEqual([["platform.login/tasks/"]]);
    expect((await backing.getOptional("platform.login/tasks/t1"))?.state).toMatchObject({ id: "t1" });
  });

  it("sees, in a later resolution, a task an earlier resolution of the same prefix added", async () => {
    const backing = createFakeResourceCollection();
    const first = await ledgerAt(backing, "p/tasks");
    const second = await ledgerAt(backing, "p/tasks");
    await first.addTask({ id: "t1", goal: "g" });
    expect(second.count()).toBe(1);
  });

  it("refuses a prefix that is empty or carries a leading or trailing slash", async () => {
    const backing = createFakeResourceCollection();
    for (const bad of ["", "/p", "p/"]) {
      await expect(ledgerAt(backing, bad)).rejects.toThrow(/keyPrefix/);
    }
  });
});

describe("nested key prefixes", () => {
  it("keeps a ledger apart from one nested under its prefix", async () => {
    const backing = createFakeResourceCollection();
    const team = await ledgerAt(backing, "team");
    const project = await ledgerAt(backing, "team/project");

    await project.addTask({ id: "t1", goal: "inner" });
    await team.addTask({ id: "t2", goal: "outer" });

    // A fresh resolution reads the store, where the inner row is listed under "team/" too.
    const reread = await ledgerAt(backing, "team");
    expect(reread.list().map((task) => task.goal)).toEqual(["outer"]);
    expect(await reread.claim("w1")).toMatchObject({ goal: "outer" });
    expect(await reread.claim("w2")).toBeNull();
    expect(project.get("t1")?.status).toBe("pending");
  });

  it("refuses a task id carrying a slash, which would be a nested ledger's key", async () => {
    const backing = createFakeResourceCollection();
    const team = await ledgerAt(backing, "team");
    await expect(team.addTask({ id: "project/t1", goal: "g" })).rejects.toThrow(/carries a "\/"/);
  });
});
