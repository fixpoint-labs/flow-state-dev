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
});
