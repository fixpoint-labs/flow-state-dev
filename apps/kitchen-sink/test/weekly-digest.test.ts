import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { testFlow } from "@flow-state-dev/testing";
import flow from "../flows/weekly-digest/flow";
import { scheduleIndex } from "../lib/schedule-index";

afterEach(() => vi.restoreAllMocks());

it("reschedules the same digest and removes its index entry when cleared", async () => {
  const run = { flow, userId: "reader", stores: createInMemoryStores() };
  const upsert = vi.spyOn(scheduleIndex, "upsert");
  const remove = vi.spyOn(scheduleIndex, "remove");
  for (const cron of ["0 9 * * 1", "0 15 * * 5"]) {
    const result = await testFlow({ ...run, action: "scheduleDigest", input: { cron, enabled: false } });
    expect(result.output).toEqual({ key: "digest" });
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ key: "digest", cron }));
  }
  const [{ cell, key }] = upsert.mock.calls[0]!;
  const digest = await run.stores.resourceState.get("user", cell, "schedules/digest");
  expect(digest?.state).toEqual({ cron: "0 15 * * 5", kind: "sendWeeklySummary", enabled: true, orgId: DEFAULT_ORG_ID });
  const cleared = await testFlow({ ...run, action: "clearSchedules", input: {} });
  expect(cleared.output).toEqual({ cleared: 1 });
  expect(remove).toHaveBeenCalledWith({ cell, key });
});
