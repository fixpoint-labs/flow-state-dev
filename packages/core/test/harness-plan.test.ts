/**
 * The run's plan record, as core publishes it: the shape every harness writes,
 * and `replacePlanList`, the one writer for a harness whose plan arrives as the
 * whole list each time.
 *
 * What these protect is a promise to packages outside this one. Rows written
 * before the shape moved into core must still read; a whole-list plan
 * must land as exactly that list, with nothing stale past its end; an
 * empty plan must read differently from no plan at all; and a write
 * that fails partway must never read as the plan.
 */
import { describe, expect, it } from "vitest";
import {
  OBSERVED_PLAN,
  OBSERVED_PLAN_LIST,
  observedPlanCollection,
  observedPlanItemStateSchema,
  observedPlanListCollection,
  observedPlanListStateSchema,
  replacePlanList,
  type PlanListItem,
} from "@flow-state-dev/core";

/**
 * An in-memory stand-in for a collection ref, with the three methods the
 * helper is allowed to use. `list` and `count` are present only so the test
 * can prove the helper never calls them: on a lazy collection they load every
 * row under the prefix, which is the cost the lazy declaration exists to avoid.
 */
function fakeCollection(options: { failOnWrite?: number } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const calls = { list: 0, count: 0, writes: 0 };
  const collection = {
    rows,
    calls,
    async getOptional(key: string) {
      const state = rows.get(key);
      return state === undefined ? undefined : { state };
    },
    async upsert(key: string, update: Record<string, unknown>) {
      calls.writes += 1;
      if (options.failOnWrite !== undefined && calls.writes === options.failOnWrite) {
        throw new Error("store unavailable");
      }
      rows.set(key, { ...(rows.get(key) ?? {}), ...update });
      return { state: rows.get(key) };
    },
    async delete(key: string) {
      rows.delete(key);
    },
    async list() {
      calls.list += 1;
      return [];
    },
    async count() {
      calls.count += 1;
      return rows.size;
    },
  };
  return collection;
}

/** The rows under one run namespace, by place, as a reader would see them. */
function placesOf(plan: ReturnType<typeof fakeCollection>, namespace: string) {
  return [...plan.rows.entries()]
    .filter(([key]) => key.startsWith(`${namespace}/`))
    .map(([key, state]) => ({ place: Number(key.slice(namespace.length + 1)), ...state }))
    .sort((a, b) => a.place - b.place);
}

const RUN = "req_1/agent#0";

describe("the plan record in core", () => {
  it("keeps the storage key and reads a row written before the move", () => {
    // Written by the Claude Code recorder before the shape moved. If a field
    // is renamed here, this row stops reading and every stored plan goes blank.
    const stored = {
      title: "Write the tests",
      status: "in_progress",
      previousStatus: "pending",
      lastOutcome: "applied",
      lastTouchedAt: 1_700_000_000_000,
    };
    expect(observedPlanItemStateSchema.parse(stored)).toEqual(stored);
    // An older row missing fields still parses, with nulls rather than guesses.
    expect(observedPlanItemStateSchema.parse({ title: "Old row" })).toEqual({
      title: "Old row",
      status: null,
      previousStatus: null,
      lastOutcome: null,
      lastTouchedAt: null,
    });
    expect(OBSERVED_PLAN).toBe("observed-plan");
    expect(observedPlanCollection.pattern).toBe("observed-plan/**");
  });

  it("streams plan rows and list markers to an open page", () => {
    expect(observedPlanCollection.client?.live).toBe(true);
    expect(observedPlanListCollection.client?.live).toBe(true);
    expect(OBSERVED_PLAN_LIST).toBe("observed-plan-list");
    expect(observedPlanListCollection.pattern).toBe("observed-plan-list/**");
    // Every field nullable: a marker from a newer or older writer still reads.
    expect(observedPlanListStateSchema.parse({})).toEqual({
      status: null,
      count: null,
      reason: null,
    });
  });
});

describe("replacePlanList", () => {
  const item = (title: string, status: string): PlanListItem => ({ title, status });

  it("holds each list exactly, keeps an unchanged item's history, and trims the end", async () => {
    const plan = fakeCollection();
    const marker = fakeCollection();

    await replacePlanList(plan, marker, RUN, [
      item("Read the spec", "pending"),
      item("Write the tests", "pending"),
      item("Ship it", "pending"),
    ]);
    await replacePlanList(plan, marker, RUN, [
      item("Read the spec", "completed"), // same wording, new status
      item("Write the failing tests", "in_progress"), // reworded
      item("Ship it", "pending"), // same wording, same status
    ]);

    let rows = placesOf(plan, RUN);
    expect(rows.map((r) => [r.place, r.title, r.status, r.previousStatus, r.lastOutcome])).toEqual([
      [0, "Read the spec", "completed", "pending", "applied"],
      [1, "Write the failing tests", "in_progress", null, "applied"],
      [2, "Ship it", "pending", null, "applied"],
    ]);

    // A repeated status is not a move: the earlier previousStatus stays.
    await replacePlanList(plan, marker, RUN, [
      item("Read the spec", "completed"),
      item("Write the failing tests", "completed"),
    ]);

    rows = placesOf(plan, RUN);
    expect(rows.map((r) => [r.place, r.title, r.status, r.previousStatus])).toEqual([
      [0, "Read the spec", "completed", "pending"],
      [1, "Write the failing tests", "completed", "in_progress"],
    ]);
    // The third place is gone, not left behind as a stale item.
    expect(plan.rows.has(`${RUN}/000002`)).toBe(false);
    expect(marker.rows.get(RUN)).toEqual({ status: "complete", count: 2, reason: null });

    // It never lists the prefix: that is a full load on a lazy collection.
    expect(plan.calls.list + plan.calls.count + marker.calls.list + marker.calls.count).toBe(0);
  });

  it("keeps runs apart: one run's list never touches another's", async () => {
    const plan = fakeCollection();
    const marker = fakeCollection();
    await replacePlanList(plan, marker, "req_1/a#0", [item("A", "pending")]);
    await replacePlanList(plan, marker, "req_1/b#0", []);
    expect(placesOf(plan, "req_1/a#0").map((r) => r.title)).toEqual(["A"]);
  });

  it("records a confirmed empty list as complete with no places", async () => {
    const plan = fakeCollection();
    const marker = fakeCollection();
    await replacePlanList(plan, marker, RUN, [item("Something", "pending")]);

    const result = await replacePlanList(plan, marker, RUN, []);

    expect(result).toEqual({ status: "complete" });
    expect(placesOf(plan, RUN)).toEqual([]);
    // A reader tells this apart from a run that reported nothing, which has
    // no marker at all.
    expect(marker.rows.get(RUN)).toEqual({ status: "complete", count: 0, reason: null });
    expect(marker.rows.has("req_other/agent#0")).toBe(false);
  });

  it("marks the list incomplete, with the error, when a write fails partway", async () => {
    // The second write fails: the first place landed, the second did not.
    const plan = fakeCollection({ failOnWrite: 2 });
    const marker = fakeCollection();

    const result = await replacePlanList(plan, marker, RUN, [
      item("One", "pending"),
      item("Two", "pending"),
      item("Three", "pending"),
    ]);

    expect(result).toEqual({ status: "incomplete", reason: expect.stringContaining("store unavailable") });
    const written = marker.rows.get(RUN);
    expect(written?.status).toBe("incomplete");
    expect(written?.count).toBe(3);
    expect(written?.reason).toMatch(/store unavailable/);
    // The place that did land is there, and the marker is what says it is not the plan.
    expect(placesOf(plan, RUN).map((r) => r.title)).toEqual(["One"]);
  });

  it("marks the list writing before any row lands, so a run killed mid-write never reads complete", async () => {
    const plan = fakeCollection();
    const marker = fakeCollection();
    const seen: unknown[] = [];
    const watchingPlan = {
      ...plan,
      upsert: async (key: string, update: Record<string, unknown>) => {
        seen.push(marker.rows.get(RUN)?.status);
        return plan.upsert(key, update);
      },
    };

    await replacePlanList(watchingPlan, marker, RUN, [item("One", "pending")]);

    expect(seen).toEqual(["writing"]);
    expect(marker.rows.get(RUN)?.status).toBe("complete");
  });

  it("never throws, even when the marker itself cannot be written", async () => {
    const plan = fakeCollection();
    const marker = fakeCollection({ failOnWrite: 1 });
    await expect(replacePlanList(plan, marker, RUN, [item("One", "pending")])).resolves.toEqual({
      status: "incomplete",
      reason: expect.stringContaining("store unavailable"),
    });
  });
});
