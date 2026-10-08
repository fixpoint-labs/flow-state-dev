/**
 * `hireWorkforce`: one copy per worker flow, and the roster flow (BR-26, V9).
 *
 * Workers are data, so hiring the installation registers the same copies
 * however many workers it holds: one per flow, at the flow's kind, none per
 * worker and none pinned to an owner. A flow that doesn't declare the
 * installation's session is refused by name, since its sessions would run no
 * checked worker.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowRegistry } from "@flow-state-dev/engine";
import { z } from "zod";
import { createWorkerInstallation, hireWorkforce, ROSTER_FLOW_KIND, workerFlow, type WorkerInstallation } from "../src/index";
import { workerConfigSchema } from "../src/worker-config";

const door = z.object({ message: z.string() });

function researchFlow(installation: WorkerInstallation | undefined) {
  return defineFlow({
    kind: "research",
    configSchema: workerConfigSchema(),
    ...(installation !== undefined ? { session: installation.session(), resources: { ...installation.resources } } : {}),
    actions: {
      run: {
        inputSchema: door,
        userMessage: (input: { message: string }) => input.message,
        block: handler({ name: "research-run", inputSchema: door, execute: (input) => input })
      }
    }
  });
}

function installation(workers: number, bound = true) {
  let flows: Record<string, unknown> = {};
  const made = createWorkerInstallation({
    standardWorkers: Array.from({ length: workers }, (_, i) => ({
      id: `desk.w${i}`,
      declared: i % 2 === 0 ? {} : { flow: "research" },
      body: `Worker ${i}.`
    })),
    workerFlows: () => flows as never
  });
  flows = { research: researchFlow(bound ? made : undefined) };
  return made;
}

describe("hireWorkforce", () => {
  it("registers one copy per flow and the roster flow, the same for two workers as for forty, with no pin", () => {
    for (const count of [2, 40]) {
      const registry = createFlowRegistry();
      for (const copy of hireWorkforce(installation(count))) registry.register(copy);
      expect(registry.list().map((flow) => flow.id).sort()).toEqual(["agent", "research", ROSTER_FLOW_KIND]);
      expect(registry.list().map((flow) => registry.pinOf(flow.id))).toEqual([undefined, undefined, undefined]);
    }
  });

  it("registers the built-in agent bound to the installation when the app passes none", () => {
    const made = installation(2);
    const agent = hireWorkforce(made).find((copy) => copy.id === "agent")!;
    expect((agent.session as { createCheck?: unknown } | undefined)?.createCheck).toBe(made.createCheck);
  });

  it("refuses a worker flow that doesn't declare the installation's session, naming it", () => {
    expect(() => hireWorkforce(installation(2, false))).toThrow(
      /worker flow "research" doesn't declare this installation's session/
    );
  });

  it("registers nothing while a standard worker would be refused on its first turn, naming it", () => {
    // A short roster that still runs is the failure: the one worker's unknown
    // tool refuses the whole installation, by the worker's id and the tool.
    let flows: Record<string, unknown> = {};
    const made = createWorkerInstallation({
      standardWorkers: [
        { id: "desk.ok", declared: {}, body: "Fine." },
        { id: "desk.typo", declared: { tools: ["no-such-tool"] }, body: "Names a tool nothing registers." }
      ],
      workerFlows: () => flows as never
    });
    flows = { research: researchFlow(made) };
    expect(() => hireWorkforce(made)).toThrow(/nothing was registered[\s\S]*worker "desk\.typo"[\s\S]*no-such-tool/);
    expect(made.standardWorkerProblems()).toHaveLength(1);
  });

  it("refuses a worker flow that misses the contract, even with no worker on it, naming it", () => {
    let flows: Record<string, unknown> = {};
    const made = createWorkerInstallation({
      standardWorkers: [{ id: "desk.ok", declared: { flow: "research" }, body: "Fine." }],
      workerFlows: () => flows as never
    });
    const doorless = defineFlow({
      kind: "doorless",
      configSchema: workerConfigSchema(),
      session: made.session(),
      resources: { ...made.resources },
      actions: { work: { inputSchema: door, block: handler({ name: "doorless-work", inputSchema: door, execute: (input) => input }) } }
    });
    flows = { research: researchFlow(made), doorless };
    expect(() => hireWorkforce(made)).toThrow(/refused 1 worker flow \("doorless"\); nothing was hired[\s\S]*no door/);
  });

  it("builds a workerFlow(...) entry on its installation, once, and registers it like any flow", () => {
    // A flow in its own file has no installation to import: its module
    // exports a builder, and the installation builds it with itself.
    const builds: WorkerInstallation[] = [];
    const research = workerFlow((installation) => {
      builds.push(installation);
      return researchFlow(installation);
    });
    const made = createWorkerInstallation({
      standardWorkers: [{ id: "desk.r", declared: { flow: "research" }, body: "Research." }],
      workerFlows: { research }
    });
    const copies = hireWorkforce(made);
    expect(copies.map((copy) => copy.id).sort()).toEqual(["agent", "research", ROSTER_FLOW_KIND]);
    const copy = copies.find((c) => c.id === "research")!;
    expect((copy.session as { createCheck?: unknown } | undefined)?.createCheck).toBe(made.createCheck);
    expect(made.workerFlows().research!.flow).toBe(made.workerFlows().research!.flow);
    expect(builds).toEqual([made]);
  });
});
