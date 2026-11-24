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
import { taskInputSchema } from "../src/task-input/declaration";
import { checkFiledInput, type InputLookup } from "../src/task-input/checked-ledger";
import { assertClaimAuthority, checkFiling, claimInput, FILLED_FOR } from "../src/task-input/filing-check";
import { handedFlowOrRefuse, handoverFlowReader } from "../src/conversation-board/handover-flow";

const ctx = {} as BlockContext;

const triage = taskInputSchema(z.object({ ticket: z.string(), severity: z.enum(["low", "high"]) }).strict(), {
  check: (input, { worker }) => {
    if (input.severity === "high" && worker.config.onCall !== true) throw new Error(`not on call: ${JSON.stringify(worker.config)}`);
    return input;
  }
});
const intake = taskInputSchema(z.object({ ticket: z.string(), queue: z.string() }).strict());

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
  const decl = taskInputSchema(z.object({ ticket: z.string(), by: z.string() }).strict(), {
    serverOwned: ["by"],
    fill: ({ worker }) => ({ by: String(worker.config.name) })
  });
  const stale = { assignee: "ops.x", input: { ticket: "ENG-1" }, metadata: {} };

  // Codex P1: the refill read the roster again, after the session was verified, and filled from the record it moved to.
  it("fails the attempt when the worker, read once at claim, has moved off the running entry's flow, and never fills from it", async () => {
    const fills: unknown[] = [];
    const watched = taskInputSchema(z.object({ ticket: z.string(), by: z.string() }).strict(), {
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

  // Greptile: a stored `null` input read as `{}` at claim, where a filing refuses it.
  it("fails the attempt of a task stored with a null input, as a filing refuses one", async () => {
    const open = taskInputSchema(z.record(z.string(), z.unknown()));
    const nulled = { assignee: "ops.x", input: null, metadata: {} };
    await expect(
      claimInput({ ctx, declaration: open, runningFlow: "triage", recordedFlow: "triage", task: nulled, worker: { id: "ops.x", flow: "triage", config: {} } })
    ).rejects.toMatchObject({ code: "input_refused", message: expect.stringContaining("the input is not an object") });
  });

  it("fails the attempt when the worker can't be read at claim", async () => {
    await expect(claimInput({ ctx, declaration: decl, runningFlow: "triage", task: stale, worker: undefined })).rejects.toMatchObject({ code: "input_refused" });
  });
});

describe("the claim's authority, for every work entry", () => {
  // Codex P1: an entry that declares no input skipped the check, so flow A's `work` ran a task handed over for B.
  it("fails an open flow's claim when the hand-over or the worker names another flow", () => {
    const task = { assignee: "ops.x" };
    expect(() => assertClaimAuthority({ runningFlow: "agent", recordedFlow: "helper", task, worker: { id: "ops.x", flow: "agent", config: {} } })).toThrow(
      'handed over for flow "helper", and this is flow "agent"\'s entry'
    );
    expect(() => assertClaimAuthority({ runningFlow: "agent", recordedFlow: "agent", task, worker: { id: "ops.x", flow: "helper", config: {} } })).toThrow(
      'now runs on flow "helper"'
    );
    expect(assertClaimAuthority({ runningFlow: "agent", recordedFlow: "agent", task, worker: { id: "ops.x", flow: "agent", config: {} } })).toMatchObject({ flow: "agent" });
  });
});

describe("a task session with no recorded flow", () => {
  const task = { assignee: "ops.x" };
  const worker = { id: "ops.x", flow: "agent", config: {} };
  // Codex P2: a missing `taskFlow` was read as compatible.
  it("fails the claim, unless the session is a workstream's", () => {
    expect(() => assertClaimAuthority({ runningFlow: "agent", task, worker })).toThrow("names no flow it was handed over for");
    // A workstream's session is born by its opener, bound by the engine to the flow it runs on.
    expect(assertClaimAuthority({ runningFlow: "agent", workstream: true, task, worker })).toMatchObject({ flow: "agent" });
  });
});

describe("a hand-over's flow", () => {
  it("refuses the hand-over by name when no flow resolves, so no session is born without one", () => {
    expect(() => handedFlowOrRefuse({ flow: undefined, unavailable: "it was fired" }, "t1", "ops.x")).toThrow(
      'Task "t1" wasn\'t handed to "ops.x": it was fired.'
    );
    expect(handedFlowOrRefuse({ flow: "agent", unavailable: undefined }, "t1", "ops.x")).toBe("agent");
  });

  // Codex: dispatch read the flow it sends to and the flow the session is born naming in two reads.
  it("is read once per hand-over: the flow dispatched to and the flow recorded can't disagree when the roster moves between them", async () => {
    let reads = 0;
    const flows = ["triage", "intake"];
    const reach = async () => {
      const flow = flows[Math.min(reads, flows.length - 1)]!;
      reads += 1;
      return { available: new Map([["ops.x", flow]]), unavailable: new Map(), records: [] } as never;
    };
    const handed = handoverFlowReader(reach);
    const request = { request: {} } as never;
    const dispatchedTo = await handed(request, "t1", "ops.x");
    const recorded = await handed(request, "t1", "ops.x");
    expect(recorded.flow).toBe(dispatchedTo.flow);
    expect(reads).toBe(1);
    // Another hand-over reads again.
    expect((await handed({ request: {} } as never, "t1", "ops.x")).flow).toBe("intake");
  });
});

describe("a server-owned value with no copy", () => {
  it("refuses the filing, so a check can't change it in place behind its baseline", async () => {
    const declaration = taskInputSchema(z.object({ ticket: z.string(), meta: z.unknown() }), {
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
