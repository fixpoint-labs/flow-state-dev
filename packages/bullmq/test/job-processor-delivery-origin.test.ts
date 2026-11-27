// FIX-2942 D1; BP-031.
/**
 * A queue worker never takes a delivery origin from the job it is handed.
 *
 * Why this matters: the fence that keeps a webhook-started turn out of other
 * sessions keys on the mark, so a job that can claim it, or shed it, decides
 * what the fence does. `BullmqRuntime.enqueueAction` queues whatever
 * `FlowJobData` its caller shapes, `source` and `metadata` included, and a job
 * queued before the mark existed carries none of the host's provenance. The
 * worker replays through the public `runAction`, which drops the key from the
 * job and keeps only the origin the host recorded when it accepted the request
 * (covered on the engine side in `delivery-origin.test.ts`). On the real
 * engine, end to end.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Job } from "bullmq";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowRegistry } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { createFlowJobProcessor } from "../src/job-processor";
import type { FlowJobData } from "../src/types";

const ORG = "org-a";

const svc = defineFlow({
  kind: "svc",
  actions: { noop: { block: handler({ name: "noop", inputSchema: z.object({}), execute: () => ({}) }) } },
  internal: { actions: { deliver: { block: handler({ name: "deliver", inputSchema: z.object({}), execute: () => ({}) }) } } }
} as never)() as never;

function jobOf(data: FlowJobData): Job<FlowJobData> {
  return { id: `job_${data.requestId}`, data, attemptsMade: 0, opts: { attempts: 1 }, updateData: async () => undefined } as unknown as Job<FlowJobData>;
}

describe("a delivery origin on a queue worker", () => {
  it("is dropped from a job enqueued around the host, though it claims an internal source and the mark", async () => {
    const registry = createFlowRegistry();
    registry.register(svc);
    const stores = createInMemoryStores();
    const process = createFlowJobProcessor({ registry, stores, runtimeConfig: {} });

    // What a direct `enqueueAction` (or a job from before the mark) can queue: no host record under its id.
    await process(
      jobOf({
        flowKind: "svc",
        actionName: "deliver",
        input: {},
        userId: "alice",
        orgId: ORG,
        sessionId: "s-direct",
        requestId: "req_direct",
        source: "internal",
        metadata: { deliveryOrigin: "webhook", kept: true }
      })
    );

    const record = await stores.request.get("req_direct");
    expect(record?.status).toBe("completed");
    expect(record?.metadata?.deliveryOrigin).toBeUndefined();
    // Only the mark is dropped: the rest of the job's metadata rides as before.
    expect(record?.metadata?.kept).toBe(true);
  });
});
