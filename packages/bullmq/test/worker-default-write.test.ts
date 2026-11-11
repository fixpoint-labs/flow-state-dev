/**
 * A default write run on a queue worker (FIX-2624). The router enqueues a
 * resource send addressed to the default write flow; the worker resolves flows
 * on its own registry and never builds a host, so it must hold the framework's
 * built-in flows itself. End to end on the real engine: the job runs, the
 * write lands in the writer's cell at the next version, and the request
 * settles completed.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Job } from "bullmq";
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import { createFlowRegistry } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { createFlowJobProcessor } from "../src/worker";
import type { FlowJobData } from "../src/types";

const ORG = "org-a";

const pins = defineResource({
  ref: "pins",
  scope: "user",
  stateSchema: z.object({ pinned: z.array(z.string()).default([]) }),
  client: {},
  runBy: "default"
});

/** The write session id the router derives for alice's pins: the target in base64url, then her digest. */
async function aliceWriteSession(): Promise<string> {
  const { createHash } = await import("node:crypto");
  const target = Buffer.from(JSON.stringify(["user", "pins", "fsd-default-write"]), "utf8").toString("base64url");
  const digest = createHash("sha256")
    .update(JSON.stringify(["", ORG, "alice", "user", "pins", "fsd-default-write"]), "utf8")
    .digest("base64url")
    .slice(0, 32);
  return `fsd-write.${target}.${digest}`;
}

describe("a default write on a queue worker", () => {
  it("runs on the worker's own registry and lands in the writer's cell", async () => {
    const registry = createFlowRegistry();
    registry.register(
      defineFlow({
        kind: "threads",
        resources: { pins },
        actions: { noop: { block: handler({ name: "noop", inputSchema: z.object({}), execute: () => ({}) }) } }
      } as never)() as never
    );
    const stores = createInMemoryStores();
    const process = createFlowJobProcessor({ registry, stores, runtimeConfig: {} });
    const sessionId = await aliceWriteSession();
    const job = {
      id: "job_write",
      data: {
        flowKind: "fsd-default-write",
        actionName: "set",
        input: { state: { pinned: ["t1"] }, version: 0 },
        userId: "alice",
        orgId: ORG,
        sessionId,
        requestId: "req_write",
        source: "http"
      },
      attemptsMade: 0,
      opts: { attempts: 1 },
      updateData: async () => undefined
    } as unknown as Job<FlowJobData>;

    await process(job);

    expect((await stores.request.get("req_write"))?.status).toBe("completed");
    const cell = (await stores.resourceState.get("user", `alice:~org:${ORG}`, "pins"))!;
    expect(cell.state).toEqual({ pinned: ["t1"] });
    expect(cell.version).toBe(1);
  });
});
