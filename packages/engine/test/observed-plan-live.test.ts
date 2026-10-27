/**
 * The run's plan record streams to an open page while the run works.
 *
 * A plan panel beside a running session reads `observed-plan` rows and the
 * run's list marker. They are declared `prefetchMode: "lazy"`, because a
 * session keeps every earlier run's rows, and `client.live: true`, so a change
 * ships as an inline delta mid-request instead of a refetch when the request
 * ends. This proves the two together: an upsert through the lazy accessor
 * reaches the response stream as a `resource_change` carrying the row's
 * projected fields.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORG_ID,
  OBSERVED_PLAN,
  OBSERVED_PLAN_LIST,
  defineFlow,
  handler,
  observedPlanCollection,
  observedPlanListCollection,
  replacePlanList,
  type PlanListCollection,
} from "@flow-state-dev/core";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { z } from "zod";
import { createExecutionContext, createInMemoryStores, createResponseEmitter } from "../src";
import type { RequestStreamEventWithId } from "../src/streaming/response-emitter";

const flow = defineFlow({
  kind: "plan-live",
  resources: {
    [OBSERVED_PLAN]: observedPlanCollection,
    [OBSERVED_PLAN_LIST]: observedPlanListCollection,
  },
  actions: {
    run: { inputSchema: z.object({}), block: handler({ name: "noop", execute: () => "ok" }) },
  },
})();

const noModels = ((id: string) => {
  throw new Error(`no model ${id} in this test`);
}) as unknown as ModelResolver;

/** The resource_change items the stream carried, as a client would receive them. */
function resourceChanges(events: RequestStreamEventWithId[]) {
  return events.flatMap((event) => {
    const item = (event as { item?: { type?: string; resourcePath?: string; delta?: unknown } }).item;
    return item?.type === "resource_change" ? [item] : [];
  });
}

describe("the plan record on the response stream", () => {
  it("streams a plan row upserted mid-run, and the list marker, as live deltas", async () => {
    const wired: RequestStreamEventWithId[] = [];
    const response = createResponseEmitter({
      requestId: "req_plan",
      onEvent: (event) => {
        wired.push(event);
      },
    });
    const ctx = await createExecutionContext({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      requestId: "req_plan",
      sessionId: "s1",
      userId: "u1",
      stores: createInMemoryStores(),
      modelResolver: noModels,
      response,
    });
    const resources = ctx.resources as unknown as Record<string, PlanListCollection>;

    await replacePlanList(resources[OBSERVED_PLAN]!, resources[OBSERVED_PLAN_LIST]!, "req_plan/agent#0", [
      { title: "Write the tests", status: "in_progress" },
    ]);
    // The emit is fire-and-forget; let it land.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const changes = resourceChanges(wired);
    const row = changes.find((c) => c.resourcePath === "observed-plan/req_plan/agent#0/000000");
    expect(row?.delta).toMatchObject({
      title: "Write the tests",
      status: "in_progress",
      lastOutcome: "applied",
    });
    const marker = changes.filter((c) => c.resourcePath === "observed-plan-list/req_plan/agent#0");
    expect(marker.at(-1)?.delta).toEqual({ status: "complete", count: 1, reason: null, conversation: null });
  });
});
