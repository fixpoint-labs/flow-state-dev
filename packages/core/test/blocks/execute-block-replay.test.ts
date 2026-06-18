/**
 * Tests for the per-block replay check in core `executeBlock` (FIX-811).
 *
 * `executeBlock` is the single seam every child block dispatches through. When
 * a request resumes under its own id, a block whose logical path already holds
 * a committed output must be *injected*, not re-executed: its body never runs,
 * it emits no trace, and downstream sees the recorded output. A path with no
 * committed output executes normally. These tests pin both directions.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { BlockContext } from "../../src/types/block";
import { handler } from "../../src";
import { executeBlock } from "../../src/blocks/sequencer";
import { buildReplayLog } from "../../src/blocks/internal/replay-log";
import type { RuntimeItem } from "../../src/items/internal";
import { createMockContext } from "../helpers";

const REQ = "req_1"; // createMockContext's request id

function completedTrace(path: string, output: unknown): RuntimeItem {
  const blockInstanceId = `${REQ}:${path}:0`;
  return {
    id: `trace_${path}`,
    type: "block_trace",
    status: "completed",
    blockName: "h",
    blockKind: "handler",
    blockInstanceId,
    requestId: REQ,
    itemIndex: 0,
    provenance: { blockName: "h", blockInstanceId, phase: "main" },
    ts: 0,
    output: { kind: "inline", value: output },
  } as RuntimeItem;
}

describe("executeBlock resume replay", () => {
  it("executes the block when no ReplayLog is present", async () => {
    const execute = vi.fn(async () => "fresh");
    const block = handler({ name: "h", inputSchema: z.any(), outputSchema: z.any(), execute });
    const ctx = createMockContext();

    const out = await executeBlock(block, "in", ctx, "root/step[0]");

    expect(out).toBe("fresh");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("injects the recorded output without running the block body on replay", async () => {
    const execute = vi.fn(async () => "fresh");
    const block = handler({ name: "h", inputSchema: z.any(), outputSchema: z.any(), execute });
    const emit = vi.fn(async () => undefined);
    const ctx = createMockContext({ response: { emit, getItems: () => [], subscribeToItems: () => () => undefined } });
    (ctx as any)._replayLog = buildReplayLog([completedTrace("root/step[0]", "cached")]);

    const out = await executeBlock(block, "in", ctx, "root/step[0]");

    expect(out).toBe("cached");
    expect(execute).not.toHaveBeenCalled();
    // No duplicate trace: the recorded output is already canonical.
    expect(emit).not.toHaveBeenCalled();
  });

  it("executes a block whose path has no committed output, even under a ReplayLog", async () => {
    const execute = vi.fn(async () => "fresh");
    const block = handler({ name: "h", inputSchema: z.any(), outputSchema: z.any(), execute });
    const ctx = createMockContext();
    // ReplayLog only covers step[0]; step[1] must execute.
    (ctx as any)._replayLog = buildReplayLog([completedTrace("root/step[0]", "cached")]);

    const out = await executeBlock(block, "in", ctx, "root/step[1]");

    expect(out).toBe("fresh");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("short-circuits before the execution-scope hook on replay", async () => {
    const execute = vi.fn(async () => "fresh");
    const block = handler({ name: "h", inputSchema: z.any(), outputSchema: z.any(), execute });
    const ctx = createMockContext();
    const withScope = vi.fn(
      async (_parent: unknown, run: (c: BlockContext) => Promise<unknown>) => run(ctx),
    );
    (ctx as any)._withExecutionScope = withScope;
    (ctx as any)._replayLog = buildReplayLog([completedTrace("root/step[0]", "cached")]);

    const out = await executeBlock(block, "in", ctx, "root/step[0]");

    expect(out).toBe("cached");
    expect(withScope).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
