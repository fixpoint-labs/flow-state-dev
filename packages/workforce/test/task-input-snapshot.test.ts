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
import { checkFiling } from "../src/task-input/filing-check";

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
