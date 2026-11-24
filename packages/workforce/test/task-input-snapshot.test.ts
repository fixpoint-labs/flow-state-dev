/**
 * One check reads one worker record (FIX-2894): the declaration it checks
 * against, the configuration its hooks are handed and the stamp it writes all
 * come from one read of the worker, so a roster row that moves between two
 * reads can't mix two flows' answers. And a server-owned value that can't be
 * copied refuses the filing, so no hook can reach the baseline it is compared
 * with.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { taskInput } from "../src/task-input/declaration";
import { checkFiledInput, type InputLookup } from "../src/task-input/checked-ledger";
import { checkFiling, claimInput, FILLED_FOR } from "../src/task-input/filing-check";

const ctx = {} as BlockContext;

const triage = taskInput(z.object({ ticket: z.string(), severity: z.enum(["low", "high"]) }).strict(), {
  check: (input, { worker }) => {
    if (input.severity === "high" && worker.config.onCall !== true) throw new Error(`not on call: ${JSON.stringify(worker.config)}`);
    return input;
  }
});
const intake = taskInput(z.object({ ticket: z.string(), queue: z.string() }).strict());

describe("one check, one worker record", () => {
  it("checks, hands the hooks and stamps from the one record it read, even when the roster row moves right after", async () => {
    // ops.x is on call on "triage"; the first read of it lands, then its row moves to "intake", off call.
    const roster: Record<string, { flow: string; config: Record<string, unknown> }> = { "ops.x": { flow: "triage", config: { onCall: true } } };
    let reads = 0;
    const read = (id: string) => {
      reads += 1;
      const record = roster[id];
      roster[id] = { flow: "intake", config: { onCall: false } };
      return record;
    };
    const lookup: InputLookup = {
      worker: async (id) => {
        const record = read(id);
        return record === undefined ? undefined : { id, ...record };
      },
      declarationOf: (flow) => (flow === "triage" ? triage : flow === "intake" ? intake : undefined),
      hasProject: async () => true,
      noProject: () => ""
    };
    const checked = await checkFiledInput(lookup, ctx, "ops.x", { ticket: "ENG-1", severity: "high" });
    expect(checked?.filledFor).toEqual({ flow: "triage", declaration: triage.fingerprint });
    expect(reads).toBe(1);
  });
});

describe("at claim, the running entry is the authority", () => {
  const decl = taskInput(z.object({ ticket: z.string(), by: z.string() }).strict(), {
    serverOwned: ["by"],
    fill: ({ worker }) => ({ by: String(worker.config.name) })
  });
  const stale = { assignee: "ops.x", input: { ticket: "ENG-1" }, metadata: {} };

  // Codex P1: the refill read the roster again, after the session was verified, and filled from the record it moved to.
  it("fails the attempt when the worker, read once at claim, has moved off the running entry's flow, and never fills from it", async () => {
    const fills: unknown[] = [];
    const watched = taskInput(z.object({ ticket: z.string(), by: z.string() }).strict(), {
      serverOwned: ["by"],
      fill: ({ worker }) => {
        fills.push(worker.config);
        return { by: String(worker.config.name) };
      }
    });
    await expect(
      claimInput({ ctx, declaration: watched, runningFlow: "triage", recordedFlow: "triage", task: stale, worker: { id: "ops.x", flow: "intake", config: { name: "B" } } })
    ).rejects.toMatchObject({ code: "input_refused", message: expect.stringMatching(/now runs on flow "intake"\. Nothing ran\.$/) });
    expect(fills).toEqual([]);
    // On the running flow, it fills from that one read.
    expect(
      await claimInput({ ctx, declaration: watched, runningFlow: "triage", recordedFlow: "triage", task: stale, worker: { id: "ops.x", flow: "triage", config: { name: "A" } } })
    ).toEqual({ ticket: "ENG-1", by: "A" });
  });

  // Codex P1: the session's state said A while B's entry ran, and an identical fingerprint let B trust A's stamp.
  it("fails the attempt when the flow the hand-over recorded isn't the running entry's, whatever the stamp says", async () => {
    const stamped = { assignee: "ops.x", input: { ticket: "ENG-1", by: "A" }, metadata: { [FILLED_FOR]: { flow: "triage", declaration: decl.fingerprint } } };
    await expect(
      claimInput({ ctx, declaration: decl, runningFlow: "intake", recordedFlow: "triage", task: stamped, worker: { id: "ops.x", flow: "intake", config: {} } })
    ).rejects.toMatchObject({ code: "input_refused", message: expect.stringContaining('handed over for flow "triage", and this is flow "intake"') });
  });

  it("fails the attempt when the worker can't be read at claim", async () => {
    await expect(claimInput({ ctx, declaration: decl, runningFlow: "triage", task: stale, worker: undefined })).rejects.toMatchObject({ code: "input_refused" });
  });
});

describe("a server-owned value with no copy", () => {
  it("refuses the filing, so a check can't change it in place behind its baseline", async () => {
    const declaration = taskInput(z.object({ ticket: z.string(), meta: z.unknown() }), {
      serverOwned: ["meta"],
      fill: () => ({ meta: { by: "server", note: () => "no structured copy" } }),
      check: (input) => {
        const meta = input.meta as { by: string; note?: unknown };
        meta.by = "u_admin";
        delete meta.note;
        return input;
      }
    });
    await expect(
      checkFiling({ ctx, declaration, worker: { id: "ops.x", flow: "triage", config: {} }, sent: { ticket: "ENG-2" } })
    ).rejects.toMatchObject({ code: "input_refused", message: expect.stringContaining("can't be copied") });
  });
});
