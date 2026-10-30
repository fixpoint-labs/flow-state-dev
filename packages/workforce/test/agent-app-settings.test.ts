/**
 * The app's own settings on the built-in `agent` flow (`settings`): a worker's
 * file may set them, and paired with `showSettings` they ride on the worker's
 * roster row. Without the option the flow's settings are fixed, so a worker
 * that sets one is refused and no registration can show it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { checkWorkerFlows, resolveWorkerFlows } from "../src/hire";
import { standardWorkerRow } from "../src/workers/standard-workers";
import type { WorkerManifest } from "../src/manifest";

const LOOKS = { icon: z.string().optional(), color: z.string().optional() };

const scout: WorkerManifest = { id: "desk.scout", declared: { name: "Scout", icon: "🔎", color: "teal", tone: "dry" }, body: "You are Scout." };

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
};

describe("an app's settings on the agent flow", () => {
  it("a worker sets them in its file, and a registration that shows them puts their values on its row", () => {
    const agent = defineAgentWorkerFlow({ settings: LOOKS });
    expect(() => agent({ id: "scout", config: { icon: "🔎", color: "teal" } })).not.toThrow();

    const flows = resolveWorkerFlows({ agent: { flow: agent, showSettings: ["icon", "color"] } });
    expect(refusal(() => checkWorkerFlows(flows))).toBe("");
    // Only the shown keys: `tone` is in the file but no flow shows it.
    expect(standardWorkerRow(scout, "agent", (flow) => flows[flow]?.showSettings ?? []).settings).toEqual({ icon: "🔎", color: "teal" });
  });

  it("without them the flow's settings are fixed: a worker setting one is refused, and so is a registration showing it", () => {
    const agent = defineAgentWorkerFlow();
    expect(refusal(() => agent({ id: "scout", config: { icon: "🔎" } }))).toMatch(/icon/);
    expect(refusal(() => checkWorkerFlows(resolveWorkerFlows({ agent: { flow: agent, showSettings: ["icon"] } })))).toContain(
      '"icon" is not a setting flow "agent" declares'
    );
  });

  it("refuses an app setting named like one the flow already declares", () => {
    expect(refusal(() => defineAgentWorkerFlow({ settings: { model: z.string() } }))).toContain('declares "model", which the agent flow already declares');
  });
});
