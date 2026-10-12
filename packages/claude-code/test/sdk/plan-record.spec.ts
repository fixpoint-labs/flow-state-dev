/**
 * Claude Code's side of the shared plan record.
 *
 * The shape lives in `@flow-state-dev/core` now. Code that imported it from
 * this package before the move must get the very same objects, or two
 * definitions would be two storage slots that look like one. And when a plan
 * row fails to write, the run's list marker must say the plan is incomplete,
 * so a reader never shows the rows that did land as the plan.
 */
import { describe, expect, it } from "vitest";
import * as core from "@flow-state-dev/core";
import * as sdk from "../../src/sdk";
import { createWorkRecorder, type UpsertableCollection } from "../../src/sdk/work-recorder";
import type { TranslatedEvent } from "../../src/sdk/types";

describe("the plan record, imported from Claude Code", () => {
  it("is core's record, the same objects", () => {
    expect(sdk.OBSERVED_PLAN).toBe(core.OBSERVED_PLAN);
    expect(sdk.observedPlanCollection).toBe(core.observedPlanCollection);
    expect(sdk.observedPlanItemStateSchema).toBe(core.observedPlanItemStateSchema);
    expect(sdk.OBSERVED_PLAN_LIST).toBe(core.OBSERVED_PLAN_LIST);
    expect(sdk.observedPlanListCollection).toBe(core.observedPlanListCollection);
  });

  it("is declared, with its list marker, wherever recordWork declares its records", () => {
    expect(sdk.workRecorderResources[core.OBSERVED_PLAN]).toBe(core.observedPlanCollection);
    expect(sdk.workRecorderResources[core.OBSERVED_PLAN_LIST]).toBe(core.observedPlanListCollection);
  });
});

describe("a plan row that fails to write", () => {
  function collection(fail = false) {
    const rows = new Map<string, Record<string, unknown>>();
    const ref: UpsertableCollection & { rows: typeof rows } = {
      rows,
      async upsert(key, update) {
        if (fail) throw new Error("store unavailable");
        rows.set(key, { ...rows.get(key), ...update });
      },
    };
    return ref;
  }

  const created: TranslatedEvent = {
    kind: "plan_item_observed",
    callId: "call:create:1",
    itemId: "1",
    title: "Write the tests",
    outcome: "applied",
  };

  it("marks the run's plan incomplete, with the reason, beside its gap row", async () => {
    const planList = collection();
    const gaps = collection();
    const recorder = createWorkRecorder({
      runId: "req_1/agent#0",
      files: collection(),
      plan: collection(true),
      planList,
      gaps,
    });

    recorder.observe(created);
    await recorder.stop();

    const marker = planList.rows.get("req_1/agent#0");
    expect(marker?.status).toBe("incomplete");
    expect(String(marker?.reason)).toContain("store unavailable");
    // The gap row stays the durable record of which row was lost.
    expect([...gaps.rows.values()].map((g) => g.kind)).toEqual(["plan"]);
  });

  it("writes no marker while the plan writes cleanly", async () => {
    // Claude Code's plan arrives item by item, so there is no "complete"
    // moment to mark; a marker here could only be one a reader misreads.
    const planList = collection();
    const recorder = createWorkRecorder({
      runId: "req_1/agent#0",
      files: collection(),
      plan: collection(),
      planList,
    });

    recorder.observe(created);
    await recorder.stop();

    expect(planList.rows.size).toBe(0);
  });
});
