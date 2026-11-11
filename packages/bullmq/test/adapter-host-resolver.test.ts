/**
 * The host resolver reaches the queue worker through the adapter (FIX-2624).
 *
 * `createFlowState({ resolvePrincipal: R, worker: bullmqWorker(...) })` must
 * give the worker R, with no caller handing it to `startWorker`: the worker
 * holds the default write flow, which decides whether two declarations of one
 * resource agree by their resolvers. One flow inheriting R beside one naming R
 * agree on the host; they must agree on the worker too, or a queued write is
 * refused. Only the Redis-backed pieces are faked; `createFlowState`, the
 * adapter and the job processor are real.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Job } from "bullmq";
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { FlowJobData, FlowWorkerDeps } from "../src/types";

// Some test runner (the CLI, CI) can set this to a value core refuses; these
// flows run no model.
delete process.env.FSDEV_DEFAULT_MODEL;

const captured: { deps?: FlowWorkerDeps } = {};

vi.mock("../src/runtime", async () => ({
  createBullmqRuntime: vi.fn(() => ({
    queue: { name: "fsd-flows" },
    enqueueAction: vi.fn(),
    createWorker: vi.fn((deps: FlowWorkerDeps) => {
      captured.deps = deps;
      return { close: vi.fn().mockResolvedValue(undefined) };
    }),
    close: vi.fn().mockResolvedValue(undefined)
  }))
}));
vi.mock("../src/stream-bridge", () => ({
  createRedisStreamBridge: vi.fn(() => ({ createPublisher: vi.fn(() => ({ publish: vi.fn(), close: vi.fn() })), createSubscriber: vi.fn() }))
}));
vi.mock("../src/runner", () => ({ createWorkerRunner: vi.fn(() => ({ dispatch: vi.fn(), close: vi.fn() })) }));
vi.mock("../src/lease-backend", () => ({
  createRedisLeaseBackend: vi.fn(() => ({ leaseMs: 10_000, close: vi.fn().mockResolvedValue(undefined) }))
}));

const { bullmqWorker } = await import("../src/flowstate-adapter");
const { createFlowJobProcessor } = await import("../src/worker");

const ORG = "org-a";
const pins = defineResource({
  ref: "pins",
  scope: "user",
  stateSchema: z.object({ pinned: z.array(z.string()).default([]) }),
  client: { expose: ["pinned"] },
  runBy: "default"
});

/** The app's host-level resolver. */
const signIn = () => ({ userId: "alice", orgId: ORG });

function declaring(kind: string, ownResolver: boolean) {
  return defineFlow({
    kind,
    resources: { pins },
    ...(ownResolver ? { authentication: { resolvePrincipal: signIn } } : {}),
    actions: { noop: { block: handler({ name: `noop-${kind}`, inputSchema: z.object({}), execute: () => ({}) }) } }
  } as never)() as never;
}

async function aliceWriteSession(): Promise<string> {
  const { createHash } = await import("node:crypto");
  const target = Buffer.from(JSON.stringify(["user", "pins", "fsd-default-write"]), "utf8").toString("base64url");
  const digest = createHash("sha256")
    .update(JSON.stringify(["", ORG, "alice", "user", "pins", "fsd-default-write"]), "utf8")
    .digest("base64url")
    .slice(0, 32);
  return `fsd-write.${target}.${digest}`;
}

describe("the host resolver on a worker started by createFlowState", () => {
  it("lands a queued default write when one declarer inherits the host resolver and the other names it", async () => {
    const state = createFlowState({
      flows: [declaring("threads", true), declaring("digest", false)],
      stores: { default: { primary: inMemoryStores() } },
      resolvePrincipal: signIn,
      worker: bullmqWorker({ connection: "redis://localhost:6379" })
    } as never);
    const runtime = await state.getRuntime();
    expect(captured.deps).toBeDefined();
    // The deps the adapter built, run as the BullMQ worker would run them (no stream bridge: no Redis here).
    const process = createFlowJobProcessor({ ...captured.deps!, bridge: undefined });
    const job = {
      id: "job_adapter",
      data: {
        flowKind: "fsd-default-write",
        actionName: "set",
        input: { state: { pinned: ["t1"] }, version: 0 },
        userId: "alice",
        orgId: ORG,
        sessionId: await aliceWriteSession(),
        requestId: "req_adapter",
        source: "http"
      },
      attemptsMade: 0,
      opts: { attempts: 1 },
      updateData: async () => undefined
    } as unknown as Job<FlowJobData>;
    await process(job);
    const record = await runtime.stores.request.get("req_adapter");
    expect(record?.status, JSON.stringify(record?.result)).toBe("completed");
    await state.dispose();
  });
});
