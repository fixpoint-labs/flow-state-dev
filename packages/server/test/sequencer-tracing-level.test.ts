/**
 * FIX-406 6H: `tracingLevel` controls observability (non-durable) state
 * snapshots. Durable checkpoints are unaffected (they are needed for resume).
 *
 *   - verbose: initial + per-step + terminal snapshots
 *   - normal:  block boundaries only (initial + terminal), no per-step
 *   - minimal: no observability snapshots
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { StateSnapshotItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import { createInMemoryStores, createResponseEmitter, runAction } from "../src";

const STATE_SCHEMA = z.object({ count: z.number().default(0) });

function buildThreeStepFlow() {
  const bump = (name: string) =>
    handler({
      name,
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.literal(true) }),
      execute: async (_input, ctx) => {
        const seq = ctx.sequencer!;
        const current = seq.state as { count: number };
        await seq.setState({ count: (current.count ?? 0) + 1 });
        return { ok: true } as const;
      }
    });

  const seq = sequencer({
    name: "tracing-seq",
    inputSchema: z.object({}),
    stateSchema: STATE_SCHEMA,
    durable: false // exercise the observability path, not the checkpoint path
  })
    .then(bump("a"))
    .then(bump("b"))
    .then(bump("c"));

  return defineFlow({
    kind: "tracing-flow",
    actions: { run: { inputSchema: z.object({}), block: seq } }
  });
}

function getSnapshots(items: unknown[]): StateSnapshotItem[] {
  return (items as StateSnapshotItem[]).filter((i) => i.type === "state_snapshot");
}

async function runWithLevel(level: "verbose" | "normal" | "minimal") {
  const response = createResponseEmitter({ requestId: `req_${level}` });
  await runAction({
    flow: buildThreeStepFlow(),
    actionName: "run",
    input: {},
    userId: "u",
    sessionId: "s",
    stores: createInMemoryStores(),
    responseEmitter: response,
    tracingLevel: level
  });
  return getSnapshots(response.getItems());
}

describe("sequencer tracingLevel", () => {
  beforeEach(() => {
    delete process.env.FSDEV_TRACE_OBSERVABILITY;
    delete process.env.FSDEV_TRACING_LEVEL;
  });
  afterEach(() => {
    delete process.env.FSDEV_TRACE_OBSERVABILITY;
    delete process.env.FSDEV_TRACING_LEVEL;
  });

  it("minimal emits no observability snapshots", async () => {
    const snapshots = await runWithLevel("minimal");
    expect(snapshots).toHaveLength(0);
  });

  it("normal emits only block-boundary snapshots (no per-step)", async () => {
    const snapshots = await runWithLevel("normal");
    const perStep = snapshots.filter((s) => s.terminal !== true && s.stepIndex >= 0);
    expect(perStep).toHaveLength(0);
    // initial (stepIndex -1) + terminal
    expect(snapshots.some((s) => s.stepIndex === -1 && s.terminal !== true)).toBe(true);
    expect(snapshots.some((s) => s.terminal === true)).toBe(true);
  });

  it("verbose emits per-step snapshots", async () => {
    const snapshots = await runWithLevel("verbose");
    const perStep = snapshots.filter((s) => s.terminal !== true && s.stepIndex >= 0);
    expect(perStep.length).toBeGreaterThan(0);
    expect(snapshots.length).toBeGreaterThan((await runWithLevel("normal")).length);
  });
});
