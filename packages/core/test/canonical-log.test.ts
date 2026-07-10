/**
 * Canonical item-log view (FIX-811). These cases encode the *intent* of each
 * collapse rule — which superseded copies a resumed/continued request's history
 * must hide — not just the filtering mechanics.
 */
import { describe, it, expect } from "vitest";
import { collapseToCanonicalLog } from "../src/items/canonical-log";
import type { OutputItem } from "../src/items/types";
import { buildBlockInstanceId } from "../src/blocks/internal/block-instance-id";

const REQ = "req1";
const GATE = buildBlockInstanceId(REQ, "root/step[0]", 0);

/** Minimal block_trace row (RuntimeItem; absent from the public union). */
function trace(id: string, itemIndex: number, status: string, instanceId = GATE): OutputItem {
  return {
    id,
    type: "block_trace",
    status,
    itemIndex,
    provenance: { blockInstanceId: instanceId },
  } as unknown as OutputItem;
}

/** Minimal assistant message owned by a logical block. */
function message(id: string, itemIndex: number, instanceId = GATE): OutputItem {
  return {
    id,
    type: "message",
    role: "assistant",
    content: [],
    itemIndex,
    provenance: { blockInstanceId: instanceId },
  } as unknown as OutputItem;
}

const messageIds = (items: OutputItem[]) =>
  items.filter((i) => i.type === "message").map((i) => i.id);
const traceIds = (items: OutputItem[]) =>
  items.filter((i) => (i.type as string) === "block_trace").map((i) => i.id);

describe("collapseToCanonicalLog", () => {
  it("leaves a single-run request untouched (one trace, one emission)", () => {
    const items = [trace("t1", 0, "completed"), message("m1", 1)];
    const out = collapseToCanonicalLog(items);
    expect(messageIds(out)).toEqual(["m1"]);
    expect(traceIds(out)).toEqual(["t1"]);
  });

  it("drops the crash-recovery run-1 emission, keeping the re-run copy (Rule 3)", () => {
    // The `continue` path re-runs the interrupted block with NO suspension /
    // suspension_resume marker, so only the second block_trace signals the
    // re-run. The run-1 message must collapse; the re-emitted run-2 copy stays.
    const items = [
      trace("t1", 0, "in_progress"), // interrupted run
      message("m1", 1), // run-1 emission (superseded)
      trace("t2", 2, "completed"), // continuation re-run
      message("m2", 3), // run-2 re-emission (canonical)
    ];
    const out = collapseToCanonicalLog(items);
    expect(messageIds(out)).toEqual(["m2"]);
    // Only the canonical (completed) trace survives.
    expect(traceIds(out)).toEqual(["t2"]);
  });

  it("does not collapse a completed sibling block injected from the log on replay", () => {
    // A different logical path that ran exactly once (one trace) is canonical as
    // is — crash-recovery replay injects it without re-running, so its single
    // emission must survive even though another block re-ran.
    const sibling = buildBlockInstanceId(REQ, "root/step[1]", 0);
    const items = [
      trace("t1", 0, "in_progress"),
      message("m1", 1), // re-run block, run-1 (superseded)
      trace("s1", 2, "completed", sibling),
      message("sm1", 3, sibling), // sibling, single run (canonical)
      trace("t2", 4, "completed"),
      message("m2", 5), // re-run block, run-2 (canonical)
    ];
    const out = collapseToCanonicalLog(items);
    expect(messageIds(out).sort()).toEqual(["m2", "sm1"]);
  });

  it("retains generator_step artifacts even when their generator path re-ran (FIX-814)", () => {
    // A suspending generator re-runs on resume (two traces on its path → a
    // supersession boundary), but its replay-only `generator_step` artifacts
    // are the substrate a later resume cycle reconstructs from — they must
    // survive collapse like the audit pair, at any itemIndex.
    const genStep = (id: string, itemIndex: number, stepNumber: number): OutputItem =>
      ({
        id,
        type: "generator_step",
        status: "completed",
        itemIndex,
        stepNumber,
        blockInstanceId: GATE,
        provenance: { blockInstanceId: GATE },
      }) as unknown as OutputItem;

    const items = [
      trace("t1", 0, "in_progress"),
      genStep("gs0", 1, 0), // run-1 artifact, below the boundary
      message("m1", 2), // run-1 emission — superseded
      trace("t2", 3, "completed"),
      message("m2", 4), // run-2 emission — canonical
    ];
    const out = collapseToCanonicalLog(items);
    // The superseded run-1 message is dropped, but the generator_step survives.
    expect(messageIds(out)).toEqual(["m2"]);
    expect(out.some((i) => (i.type as string) === "generator_step" && i.id === "gs0")).toBe(true);
  });

  it("keeps a completed sibling tool_output but supersedes a gate's failed one per callId (FIX-814, Rule 4)", () => {
    // A generator suspended inside a two-tool step, then re-ran on resume (two
    // traces → a boundary on the generator path). `tool_output`s carry the
    // GENERATOR's blockInstanceId as provenance, so the boundary would drop the
    // completed sibling (`s1`) that settled on run 1 and is only injected — not
    // re-emitted — on resume. Rule 4 dedups per callId instead: the sibling
    // survives; the gate's run-1 failed(SUSPENSION) record is superseded by its
    // run-2 completed result.
    const toolOutput = (
      id: string,
      itemIndex: number,
      callId: string,
      status: string
    ): OutputItem =>
      ({
        id,
        type: "tool_output",
        status,
        itemIndex,
        blockName: callId === "s1" ? "sibling" : "gate",
        output: status === "completed" ? { via: callId } : undefined,
        provenance: { blockInstanceId: GATE },
        toolCall: { callId, name: callId === "s1" ? "sibling" : "gate" },
      }) as unknown as OutputItem;

    const items = [
      trace("t1", 0, "in_progress"), // run-1 generator (suspended)
      toolOutput("s1c", 1, "s1", "completed"), // completed sibling — must survive
      toolOutput("g1f", 2, "g1", "failed"), // gate's suspended record — superseded
      trace("t2", 3, "completed"), // run-2 generator (resumed)
      toolOutput("g1c", 4, "g1", "completed"), // gate's approved result — canonical
    ];
    const out = collapseToCanonicalLog(items);
    const toolIds = out.filter((i) => i.type === "tool_output").map((i) => i.id);
    expect(toolIds).toEqual(["s1c", "g1c"]);
  });

  it("keeps both tool_outputs when two steps reuse one callId (FIX-814, Rule 4 step key)", () => {
    // Two steps of one generator reuse provider call id "c1". Rule 4 folds the
    // persisted stepNumber into the key, so they don't collapse into one; a
    // same-step failed→completed pair still dedups.
    const stepped = (
      id: string,
      itemIndex: number,
      status: string,
      stepNumber: number
    ): OutputItem =>
      ({
        id,
        type: "tool_output",
        status,
        itemIndex,
        blockName: "t",
        output: status === "completed" ? { step: stepNumber } : undefined,
        provenance: { blockInstanceId: GATE },
        toolCall: { callId: "c1", name: "t", stepNumber },
      }) as unknown as OutputItem;

    const items = [
      trace("t1", 0, "completed"),
      stepped("s0", 1, "completed", 0), // step 0 — distinct key
      stepped("s1f", 2, "failed", 1), // step 1 failed — superseded within step 1
      stepped("s1c", 3, "completed", 1), // step 1 completed — canonical for step 1
    ];
    const ids = collapseToCanonicalLog(items)
      .filter((i) => i.type === "tool_output")
      .map((i) => i.id);
    expect(ids).toEqual(["s0", "s1c"]);
  });
});
