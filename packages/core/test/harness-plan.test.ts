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
  harnessConversationNamespace,
  planConversationPrefix,
  planKeySegment,
  planRowsPrefix,
  readPlanTarget,
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
    .map(([key, state]): { place: number; [field: string]: unknown } => ({
      place: Number(key.slice(namespace.length + 1)),
      ...state,
    }))
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
    expect(observedPlanItemStateSchema.parse(stored)).toEqual({ ...stored, requestId: null });
    // An older row missing fields still parses, with nulls rather than guesses.
    expect(observedPlanItemStateSchema.parse({ title: "Old row" })).toEqual({
      title: "Old row",
      status: null,
      previousStatus: null,
      lastOutcome: null,
      lastTouchedAt: null,
      requestId: null,
    });
    expect(OBSERVED_PLAN).toBe("observed-plan");
    expect(observedPlanCollection.pattern).toBe("observed-plan/**");
    // A row written before rows named their request reads with a null one, not a parse error.
    expect(observedPlanItemStateSchema.parse(stored).requestId).toBeNull();
  });

  it("shows a page which request last changed a row, and where a run's plan went", () => {
    // Without these exposed, the panel can't label the turn that changed the
    // plan, and Shift Manager can't follow a run to its conversation.
    expect(observedPlanCollection.client?.expose).toContain("requestId");
    expect(observedPlanListCollection.client?.expose).toContain("conversation");
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
      conversation: null,
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

  it("ignores a stored count that is not a place count, so a bad marker can never stall a write", async () => {
    // Markers are a shared, persisted resource another harness can write. A
    // count the trim loop cannot walk (Infinity would never end) is read as no
    // previous list; any row it leaves sits past the new count, which a
    // reader never shows.
    for (const bad of [Number.POSITIVE_INFINITY, -1, 1.5, Number.NaN]) {
      const plan = fakeCollection();
      const marker = fakeCollection();
      marker.rows.set(RUN, { status: "complete", count: bad, reason: null });

      const result = await replacePlanList(plan, marker, RUN, [item("A", "pending")]);

      expect(result).toEqual({ status: "complete" });
      expect(marker.rows.get(RUN)).toEqual({ status: "complete", count: 1, reason: null });
    }
    expect(observedPlanListStateSchema.safeParse({ count: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(observedPlanListStateSchema.safeParse({ count: -1 }).success).toBe(false);
    expect(observedPlanListStateSchema.safeParse({ count: 1.5 }).success).toBe(false);
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

describe("finding one request's rows", () => {
  // A reader selects a request's rows by prefix. If its prefix is not the
  // writer's escaping of the request id, a request id holding a `/` reads as
  // no plan at all, or as another request's plan.
  it("escapes the request id the way a writer keys it, one segment, injectively", () => {
    const ids = ["req_1", "a/b", "a%2Fb", "a\\b", "..", ".", "...", "line\nbreak"];
    const segments = ids.map(planKeySegment);
    for (const segment of segments) {
      expect(segment).not.toContain("/");
      expect(segment).not.toContain("\\");
      expect(segment).not.toBe("..");
      expect(segment).not.toMatch(/[\x00-\x1f]/);
    }
    expect(new Set(segments).size).toBe(ids.length);
    // A plain id is its own segment, so rows written before escaping still match.
    expect(planKeySegment("req_1")).toBe("req_1");
    expect(planKeySegment(".")).toBe(".");
  });

  it("prefixes the plan rows by default, and the list markers when asked", () => {
    expect(planRowsPrefix("a/b")).toBe(`${OBSERVED_PLAN}/a%2Fb/`);
    expect(planRowsPrefix("a/b", OBSERVED_PLAN_LIST)).toBe(`${OBSERVED_PLAN_LIST}/a%2Fb/`);
    // A request id that is a prefix of another selects only its own rows.
    expect(`${OBSERVED_PLAN}/req_10/0#0/1`.startsWith(planRowsPrefix("req_1"))).toBe(false);
  });
});

describe("a conversation's plan", () => {
  it("names one namespace per conversation id, which a run namespace can never be", () => {
    expect(harnessConversationNamespace("9c1d74d")).toBe("conversation/9c1d74d");
    // Escaped like every key segment, so an id holding a "/" stays one segment.
    expect(harnessConversationNamespace("a/b")).toBe("conversation/a%2Fb");
    expect(harnessConversationNamespace("a")).not.toBe(harnessConversationNamespace("b"));
    // A request literally named "conversation" still keys its runs by
    // "<path>#<attempt>", which no conversation segment ends in.
    expect(planConversationPrefix("9c1d74d")).toBe(`${OBSERVED_PLAN}/conversation/9c1d74d/`);
  });

  it("is one list across turns: a later turn's whole list replaces the earlier one in place", async () => {
    const plan = fakeCollection();
    const marker = fakeCollection();
    const ns = harnessConversationNamespace("agent-1");
    await replacePlanList(plan, marker, ns, [item3("a", "pending"), item3("b", "pending"), item3("c", "pending")], {
      requestId: "req_1",
    });
    // Turn 2 updates the same conversation: the plan is still three steps, one done.
    await replacePlanList(plan, marker, ns, [item3("a", "completed"), item3("b", "pending"), item3("c", "pending")], {
      requestId: "req_2",
    });
    const rows = placesOf(plan, ns);
    expect(rows.map((r) => [r.title, r.status, r.requestId])).toEqual([
      ["a", "completed", "req_2"],
      ["b", "pending", "req_2"],
      ["c", "pending", "req_2"],
    ]);
    expect(rows[0]?.previousStatus).toBe("pending");
    expect(marker.rows.get(ns)).toMatchObject({ status: "complete", count: 3 });
  });
});

describe("readPlanTarget", () => {
  it("follows a run's pointer to its conversation's plan", () => {
    const target = readPlanTarget("req_2", [
      { topic: "req_2/agent#0", conversation: "conversation/agent-1" },
    ]);
    expect(target).toEqual({ kind: "conversation", namespace: "conversation/agent-1", rowsPrefix: `${OBSERVED_PLAN}/conversation/agent-1/` });
  });

  it("takes the last attempt's pointer when a retried block left two", () => {
    const target = readPlanTarget("req_2", [
      { topic: "req_2/agent#1", conversation: "conversation/second" },
      { topic: "req_2/agent#0", conversation: "conversation/first" },
    ]);
    expect(target.kind === "conversation" && target.namespace).toBe("conversation/second");
  });

  it("reads a request recorded before plans were per conversation by its own rows", () => {
    // BP-030: a run marker with no pointer (an older write, or a status-only marker).
    expect(readPlanTarget("a/b", [{ topic: "a%2Fb/agent#0", conversation: null }])).toEqual({
      kind: "run",
      rowsPrefix: planRowsPrefix("a/b"),
    });
    expect(readPlanTarget("req_1", []).kind).toBe("run");
  });
});

function item3(title: string, status: string): PlanListItem {
  return { title, status };
}
