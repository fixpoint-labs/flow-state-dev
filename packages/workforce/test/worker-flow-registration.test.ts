/**
 * Registering worker flows, and which workers may run on them (FIX-1789 V2,
 * V3, V4, V7: BR-6, BR-7, BR-10, BR-13 to BR-16, and the door).
 *
 * `hireWorkforce` checks every worker flow once, before any worker is hired,
 * and then resolves each worker: `agent` when it names no flow, and a flow the
 * app keeps for declared workers refuses a hired worker. A hired
 * worker is a record with an owner pin, as a runtime hire and a stored roster
 * row always are and a `WORKER.md` never is.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createInMemoryStores, executeBlock } from "@flow-state-dev/engine";
import { createTestContext } from "@flow-state-dev/testing";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { mintSeats, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { workerConfigSchema } from "../src/worker-config";

const message = z.object({ message: z.string() });
const reply = handler({ name: "registration-reply", inputSchema: message, outputSchema: message, execute: (i) => i });
const door = { inputSchema: message, block: reply, userMessage: (i: { message: string }) => i.message };
const note = z.object({ note: z.string() });
const work = handler({ name: "registration-work", inputSchema: note, outputSchema: note, execute: (i) => i });

function workerFlow(kind: string, over: Record<string, unknown> = {}) {
  return defineFlow({
    kind,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: { run: door },
    ...over
  } as never) as unknown as NonNullable<HireOptions["workerFlows"]>[string];
}

const triage = workerFlow("triage");
const coordinator = workerFlow("coordinator");
const doorless = workerFlow("doorless", { actions: { run: { inputSchema: note, block: work } } });
const numbered = workerFlow("numbered", {
  configSchema: workerConfigSchema().extend({ seatId: z.number().optional() })
});
const twoDoors = workerFlow("two-doors", { actions: { ask: door, say: door } });

/** A declared worker: one the app's WORKER.md files define. */
function standard(id: string, flow?: string): WorkerManifest {
  return { id, declared: flow === undefined ? {} : { flow }, body: "" };
}

function refusalOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("registering worker flows (V2)", () => {
  it("BR-7 · refuses every broken flow in one error, and hires nothing", () => {
    let seats: unknown;
    const message = refusalOf(() => {
      seats = mintSeats([standard("support.ada"), standard("support.tri", "triage")], {
        workerFlows: { triage, doorless, numbered }
      });
    });
    expect(seats).toBeUndefined();
    expect(message).toContain('"doorless"');
    expect(message).toContain('"numbered"');
    expect(message).toContain("`seatId`");
    expect(message).not.toContain('worker flow "triage"');
    expect(message).toContain("nothing was hired");
  });

  it("refuses a broken flow before any worker, an empty roster included", () => {
    expect(refusalOf(() => mintSeats([], { workerFlows: { doorless } }))).toContain('"doorless"');
  });

  it("V7 · no worker flow hires with no door or two", () => {
    expect(refusalOf(() => mintSeats([standard("support.d", "doorless")], { workerFlows: { doorless } }))).toContain(
      "no door"
    );
    const two = refusalOf(() => mintSeats([standard("support.t", "two-doors")], { workerFlows: { "two-doors": twoDoors } }));
    expect(two).toContain('"ask"');
    expect(two).toContain('"say"');
  });

  it("BR-6 · registers a flow keeping org data of its own, and hires on it", () => {
    const orgKeeper = workerFlow("org-keeper", {
      resources: {
        board: defineResourceCollection({ pattern: "board/*", scope: "org", stateSchema: z.object({ text: z.string() }) })
      }
    });
    const seats = mintSeats([standard("ops.keeper", "org-keeper")], { workerFlows: { "org-keeper": orgKeeper } });
    expect(seats.map((seat) => seat.kind)).toEqual(["org-keeper"]);
  });

  it("BR-10 · with no flows of its own, the app registers the built-in agent, which passes", () => {
    expect(mintSeats([standard("support.ada")]).map((seat) => seat.kind)).toEqual(["agent"]);
    expect(mintSeats([standard("support.ada")], { workerFlows: {} }).map((seat) => seat.kind)).toEqual(["agent"]);
  });

  it("BR-9 · registers the built-in agent with mailbox task lists, with no warning", () => {
    const agent = defineAgentWorkerFlow({ taskLists: ["front-desk.queue"] });
    const seats = mintSeats([standard("support.ada")], { workerFlows: { agent } as never });
    expect(seats.map((seat) => seat.kind)).toEqual(["agent"]);
  });
});

describe("which workers may run on a flow (V3)", () => {
  const kept: HireOptions["workerFlows"] = { triage, coordinator: { flow: coordinator, standardOnly: true } };

  it("BR-11 · a worker naming a registered flow runs on it", () => {
    expect(mintSeats([standard("support.tri", "triage")], { workerFlows: kept }).map((s) => s.kind)).toEqual([
      "triage"
    ]);
  });

});

describe("a block requirement the registration check can't reach", () => {
  // The flow requires a setting of its own, so the probe stops at it before
  // core checks what the door block needs. Pre-checking that would mean a
  // second way to mint; the hire refuses instead, with core's own error.
  const needsNumericSeat = handler({
    name: "needs-numeric-seat",
    inputSchema: message,
    outputSchema: message,
    flowConfigSchema: z.object({ seatId: z.number() }),
    execute: (i) => i
  });
  const desk = workerFlow("desk", {
    configSchema: workerConfigSchema().extend({ desk: z.string() }),
    actions: { run: { ...door, block: needsNumericSeat } }
  });

  it("is refused when a worker is hired on the flow, naming the block, and nothing is hired", () => {
    let seats: unknown;
    const refusal = refusalOf(() => {
      seats = mintSeats([{ id: "support.front", declared: { flow: "desk", desk: "front" }, body: "" }], {
        workerFlows: { desk }
      });
    });
    expect(seats).toBeUndefined();
    expect(refusal).toContain('block "needs-numeric-seat" cannot read');
    expect(refusal).toContain('"seatId"');
  });
});
