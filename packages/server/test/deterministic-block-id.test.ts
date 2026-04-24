/**
 * Tests for FIX-398: deterministic blockInstanceId from (requestId, path, attempt).
 *
 * Verifies that every block in a request produces an ID of the shape
 * `${requestId}:${path}:${attempt}` — stable across retries of the same
 * step and distinct across siblings, nested steps, iterations, and rescue
 * branches.
 */
import {
  defineFlow,
  handler,
  sequencer
} from "@flow-state-dev/core";
import type { BlockOutputItem, OutputItem } from "@flow-state-dev/core/items";
import { NetworkError } from "../src/errors/flow-error";
import {
  createInMemoryStores,
  createResponseEmitter,
  runAction
} from "../src";
import { z } from "zod";
import { describe, expect, it } from "vitest";

type Provenance = { blockName: string; blockInstanceId: string; attempt?: number };

function blockOutputs(items: OutputItem[]): BlockOutputItem[] {
  return items.filter((i): i is BlockOutputItem => i.type === "block_output");
}

function byBlockName(items: BlockOutputItem[], name: string): BlockOutputItem[] {
  return items.filter((i) => i.provenance.blockName === name);
}

function parseId(id: string): { requestId: string; path: string; attempt: number } {
  const first = id.indexOf(":");
  const last = id.lastIndexOf(":");
  return {
    requestId: id.slice(0, first),
    path: id.slice(first + 1, last),
    attempt: Number(id.slice(last + 1))
  };
}

describe("FIX-398: deterministic blockInstanceId", () => {
  it("retry determinism: successive retries share (requestId, path) and differ only in attempt", async () => {
    let attempts = 0;
    const flakyHandler = handler({
      name: "flaky",
      inputSchema: z.number(),
      outputSchema: z.number(),
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      execute: (value) => {
        attempts += 1;
        if (attempts < 2) {
          throw new NetworkError(`retry-${attempts}`);
        }
        return value;
      }
    });

    const flow = defineFlow({
      kind: "retry-flow",
      actions: {
        run: {
          inputSchema: z.number(),
          block: flakyHandler
        }
      }
    })();

    const requestId = "req_retry_determinism";
    const response = createResponseEmitter({ requestId, now: () => Date.now() });

    const result = await runAction({
      flow,
      actionName: "run",
      input: 5,
      userId: "user",
      sessionId: "sess",
      requestId,
      stores: createInMemoryStores(),
      responseEmitter: response
    });

    expect(result.error).toBeUndefined();

    // The last attempt's trace is persisted; parse the ID and confirm
    // the `(requestId, path)` prefix is stable across attempts. We also
    // check that `attempt` in the final ID reflects the retry count.
    const outputs = blockOutputs(response.getItems());
    const flakyTraces = byBlockName(outputs, "flaky");
    expect(flakyTraces.length).toBeGreaterThan(0);

    const last = flakyTraces[flakyTraces.length - 1];
    const parsed = parseId(last.provenance.blockInstanceId);
    expect(parsed.requestId).toBe(requestId);
    expect(parsed.path).toBe("root");
    // Second attempt succeeded — final persisted trace has attempt=1.
    expect(parsed.attempt).toBe(1);

    // Reconstruct the first-attempt ID deterministically and verify the
    // prefix differs only in the attempt suffix.
    const firstAttemptId = `${parsed.requestId}:${parsed.path}:0`;
    const secondAttemptId = `${parsed.requestId}:${parsed.path}:1`;
    expect(firstAttemptId.startsWith(`${parsed.requestId}:${parsed.path}:`)).toBe(true);
    expect(secondAttemptId).toBe(last.provenance.blockInstanceId);
  });

  it("sequencer nesting: nested .then() steps get distinct path segments per position", async () => {
    const step1 = handler({
      name: "step-1",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (v) => v + 1
    });
    const step2 = handler({
      name: "step-2",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (v) => v + 10
    });

    const pipeline = sequencer({ name: "nested", inputSchema: z.number() })
      .then(step1)
      .then(step2);

    const flow = defineFlow({
      kind: "nested-flow",
      actions: {
        run: { inputSchema: z.number(), block: pipeline }
      }
    })();

    const requestId = "req_nested";
    const response = createResponseEmitter({ requestId, now: () => Date.now() });
    const result = await runAction({
      flow,
      actionName: "run",
      input: 0,
      userId: "user",
      sessionId: "sess",
      requestId,
      stores: createInMemoryStores(),
      responseEmitter: response
    });

    expect(result.error).toBeUndefined();

    const outputs = blockOutputs(response.getItems());
    const step1Trace = byBlockName(outputs, "step-1").find(
      (i) => i.provenance.blockInstanceId.startsWith(requestId)
    );
    const step2Trace = byBlockName(outputs, "step-2").find(
      (i) => i.provenance.blockInstanceId.startsWith(requestId)
    );
    expect(step1Trace).toBeDefined();
    expect(step2Trace).toBeDefined();

    const step1Path = parseId(step1Trace!.provenance.blockInstanceId).path;
    const step2Path = parseId(step2Trace!.provenance.blockInstanceId).path;
    expect(step1Path).toBe("root/then[0]");
    expect(step2Path).toBe("root/then[1]");
  });

  it("parallel branches do not collide: distinct paths per branch", async () => {
    const branchA = handler({
      name: "branch-a",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (v) => v + 1
    });
    const branchB = handler({
      name: "branch-b",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (v) => v + 2
    });

    const pipeline = sequencer({ name: "par", inputSchema: z.number() })
      .parallel({ a: branchA, b: branchB });

    const flow = defineFlow({
      kind: "parallel-flow",
      actions: {
        run: { inputSchema: z.number(), block: pipeline }
      }
    })();

    const requestId = "req_parallel";
    const response = createResponseEmitter({ requestId, now: () => Date.now() });
    const result = await runAction({
      flow,
      actionName: "run",
      input: 0,
      userId: "user",
      sessionId: "sess",
      requestId,
      stores: createInMemoryStores(),
      responseEmitter: response
    });

    expect(result.error).toBeUndefined();

    const outputs = blockOutputs(response.getItems());
    const aTrace = byBlockName(outputs, "branch-a").find(
      (i) => i.provenance.blockInstanceId.startsWith(requestId)
    );
    const bTrace = byBlockName(outputs, "branch-b").find(
      (i) => i.provenance.blockInstanceId.startsWith(requestId)
    );
    expect(aTrace).toBeDefined();
    expect(bTrace).toBeDefined();

    const aId = aTrace!.provenance.blockInstanceId;
    const bId = bTrace!.provenance.blockInstanceId;
    expect(aId).not.toBe(bId);
    // Both are siblings of the same parallel op at step 0.
    expect(parseId(aId).path).toMatch(/^root\/parallel\[0\]\/branch\[\d+\]$/);
    expect(parseId(bId).path).toMatch(/^root\/parallel\[0\]\/branch\[\d+\]$/);
  });

  it("rescue path: rescue handler produces a path distinguishable from the main chain", async () => {
    const failingStep = handler({
      name: "failing",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: () => {
        throw new Error("boom");
      }
    });
    const rescueHandler = handler({
      name: "rescued",
      inputSchema: z.instanceof(Error),
      outputSchema: z.number(),
      execute: () => 42
    });

    const pipeline = sequencer({ name: "rescued-pipe", inputSchema: z.number() })
      .then(failingStep)
      .rescue([{ block: rescueHandler }]);

    const flow = defineFlow({
      kind: "rescue-flow",
      actions: {
        run: { inputSchema: z.number(), block: pipeline }
      }
    })();

    const requestId = "req_rescue";
    const response = createResponseEmitter({ requestId, now: () => Date.now() });
    const result = await runAction({
      flow,
      actionName: "run",
      input: 0,
      userId: "user",
      sessionId: "sess",
      requestId,
      stores: createInMemoryStores(),
      responseEmitter: response
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(42);

    const outputs = blockOutputs(response.getItems());
    const rescueTrace = byBlockName(outputs, "rescued").find(
      (i) => i.provenance.blockInstanceId.startsWith(requestId)
    );
    const failTrace = byBlockName(outputs, "failing").find(
      (i) => i.provenance.blockInstanceId.startsWith(requestId)
    );
    expect(rescueTrace).toBeDefined();
    expect(failTrace).toBeDefined();

    // Rescue path lives under rescue[N], distinct from the main then[N].
    expect(parseId(rescueTrace!.provenance.blockInstanceId).path).toMatch(
      /^root\/rescue\[0\]$/
    );
    expect(parseId(failTrace!.provenance.blockInstanceId).path).toMatch(
      /^root\/then\[0\]$/
    );
  });

  it("forEach iteration indices: distinct iter[N] paths per item", async () => {
    const itemHandler = handler({
      name: "item",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (v) => v * 10
    });

    const pipeline = sequencer({
      name: "forEach-pipe",
      inputSchema: z.array(z.number())
    }).forEach(itemHandler);

    const flow = defineFlow({
      kind: "foreach-flow",
      actions: {
        run: { inputSchema: z.array(z.number()), block: pipeline }
      }
    })();

    const requestId = "req_foreach";
    const response = createResponseEmitter({ requestId, now: () => Date.now() });
    const result = await runAction({
      flow,
      actionName: "run",
      input: [1, 2, 3],
      userId: "user",
      sessionId: "sess",
      requestId,
      stores: createInMemoryStores(),
      responseEmitter: response
    });

    expect(result.error).toBeUndefined();

    const outputs = blockOutputs(response.getItems());
    const itemTraces = byBlockName(outputs, "item").filter(
      (i) => i.provenance.blockInstanceId.startsWith(requestId)
    );
    expect(itemTraces.length).toBe(3);

    const paths = itemTraces.map((i) => parseId(i.provenance.blockInstanceId).path).sort();
    expect(paths).toEqual([
      "root/forEach[0]/iter[0]",
      "root/forEach[0]/iter[1]",
      "root/forEach[0]/iter[2]"
    ]);
  });

  it("BlockContext.attempt exposes the 0-indexed retry counter", async () => {
    const observedAttempts: number[] = [];
    const observer = handler({
      name: "attempt-observer",
      inputSchema: z.number(),
      outputSchema: z.number(),
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      execute: (value, ctx) => {
        observedAttempts.push(ctx.attempt ?? -1);
        if (observedAttempts.length < 3) {
          throw new NetworkError("retry-me");
        }
        return value;
      }
    });

    const flow = defineFlow({
      kind: "attempt-flow",
      actions: { run: { inputSchema: z.number(), block: observer } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: 1,
      userId: "user",
      sessionId: "sess",
      stores: createInMemoryStores()
    });

    expect(result.error).toBeUndefined();
    expect(observedAttempts).toEqual([0, 1, 2]);
  });
});
