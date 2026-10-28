/**
 * Registering worker flows, and which workers may run on them (FIX-1789 V2,
 * V3, V4, V7: BR-6, BR-7, BR-10, BR-13 to BR-16, and the door).
 *
 * `hireWorkforce` checks every worker flow once, before any worker is hired,
 * and then resolves each worker: `agent` when it names no flow, and a flow the
 * app keeps for declared workers refuses a hired worker. A hired
 * worker is a record that names the worker's owner, as a runtime hire and a stored roster
 * row always are and a `WORKER.md` never is.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createInMemoryStores, executeBlock } from "@flow-state-dev/engine";
import { createTestContext } from "@flow-state-dev/testing";
import { mintWorkers, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { workerConfigSchema } from "../src/worker-config";

const message = z.object({ message: z.string() });
const reply = handler({ name: "registration-reply", inputSchema: message, outputSchema: message, execute: (i) => i });
const door = { inputSchema: message, block: reply, userMessage: (i: { message: string }) => i.message };
const note = z.object({ note: z.string() });
const work = handler({ name: "registration-work", inputSchema: note, outputSchema: note, execute: (i) => i });

function workerFlow(flow: string, over: Record<string, unknown> = {}) {
  return defineFlow({
    kind: flow,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: { respond: door },
    ...over
  } as never) as unknown as NonNullable<HireOptions["workerFlows"]>[string];
}

const triage = workerFlow("triage");
const coordinator = workerFlow("coordinator");
const doorless = workerFlow("doorless", { actions: { run: { inputSchema: note, block: work } } });
const numbered = workerFlow("numbered", {
  configSchema: workerConfigSchema().extend({ workerId: z.number().optional() })
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
    let workers: unknown;
    const message = refusalOf(() => {
      workers = mintWorkers([standard("support.ada"), standard("support.tri", "triage")], {
        workerFlows: { triage, doorless, numbered }
      });
    });
    expect(workers).toBeUndefined();
    expect(message).toContain('"doorless"');
    expect(message).toContain('"numbered"');
    expect(message).toContain("`workerId`");
    expect(message).not.toContain('worker flow "triage"');
    expect(message).toContain("nothing was hired");
  });

  it("refuses a broken flow before any worker, an empty roster included", () => {
    expect(refusalOf(() => mintWorkers([], { workerFlows: { doorless } }))).toContain('"doorless"');
  });

  it("V7 · no worker flow hires with no door or two", () => {
    expect(refusalOf(() => mintWorkers([standard("support.d", "doorless")], { workerFlows: { doorless } }))).toContain(
      "no door"
    );
    const two = refusalOf(() => mintWorkers([standard("support.t", "two-doors")], { workerFlows: { "two-doors": twoDoors } }));
    expect(two).toContain('"ask"');
    expect(two).toContain('"say"');
  });

  it("BR-6 · registers a flow keeping org data of its own, and hires on it", () => {
    const orgKeeper = workerFlow("org-keeper", {
      resources: {
        board: defineResourceCollection({ pattern: "board/*", scope: "org", stateSchema: z.object({ text: z.string() }) })
      }
    });
    const workers = mintWorkers([standard("ops.keeper", "org-keeper")], { workerFlows: { "org-keeper": orgKeeper } });
    expect(workers.map((worker) => worker.kind)).toEqual(["org-keeper"]);
  });

  it("BR-10 · with no flows of its own, the app registers the built-in agent, which passes", () => {
    expect(mintWorkers([standard("support.ada")]).map((worker) => worker.kind)).toEqual(["agent"]);
    expect(mintWorkers([standard("support.ada")], { workerFlows: {} }).map((worker) => worker.kind)).toEqual(["agent"]);
  });
});

describe("which workers may run on a flow (V3)", () => {
  const kept: HireOptions["workerFlows"] = { triage, coordinator: { flow: coordinator, standardOnly: true } };

  it("BR-11 · a worker naming a registered flow runs on it", () => {
    expect(mintWorkers([standard("support.tri", "triage")], { workerFlows: kept }).map((s) => s.kind)).toEqual([
      "triage"
    ]);
  });

});

describe("a block requirement the registration check can't reach", () => {
  // The flow requires a setting of its own, so the probe stops at it before
  // core checks what the door block needs. Pre-checking that would mean a
  // second way to mint; the hire refuses instead, with core's own error.
  const needsNumericWorker = handler({
    name: "needs-numeric-worker",
    inputSchema: message,
    outputSchema: message,
    flowConfigSchema: z.object({ workerId: z.number() }),
    execute: (i) => i
  });
  const desk = workerFlow("desk", {
    configSchema: workerConfigSchema().extend({ desk: z.string() }),
    actions: { respond: { ...door, block: needsNumericWorker } }
  });

  it("is refused when a worker is hired on the flow, naming the block, and nothing is hired", () => {
    let workers: unknown;
    const refusal = refusalOf(() => {
      workers = mintWorkers([{ id: "support.front", declared: { flow: "desk", desk: "front" }, body: "" }], {
        workerFlows: { desk }
      });
    });
    expect(workers).toBeUndefined();
    expect(refusal).toContain('block "needs-numeric-worker" cannot read');
    expect(refusal).toContain('"workerId"');
  });
});
