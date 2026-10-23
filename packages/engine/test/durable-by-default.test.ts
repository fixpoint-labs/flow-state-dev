/**
 * Durable execution is on by default wherever stores persist (FIX-2063 D2).
 *
 * A stop for a person is held only where it survives the process. So a host
 * on persisting stores gets the checkpoint provider without asking, a host on
 * in-memory stores gets none unless it asks with `durable: true`, and
 * `durable: false` turns it off everywhere. A host with none refuses the stop
 * itself, by an error that names the rule and the setting to change.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { createFlowState, filesystemStores, inMemoryStores, runAction } from "../src";
import type { FlowStateOptions } from "../src/flowstate/types";

const dirs: string[] = [];
function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "durable-default-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A flow that counts its first step, stops for an approval, then answers. */
function stoppingFlow() {
  let before = 0;
  const count = handler({
    name: "count",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (input) => {
      before += 1;
      return input;
    }
  });
  const approve = handler({
    name: "approve",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => ctx.suspend!({ reason: "human_approval", message: "Ship it?" })
  });
  const flow = defineFlow({
    kind: "durable-default",
    actions: { go: { block: sequencer({ name: "seq" }).step(count).step(approve), inputSchema: z.any() } }
  })();
  return { flow, runsBefore: () => before };
}

async function runtimeOf(options: Partial<FlowStateOptions> & Pick<FlowStateOptions, "stores">) {
  const { flow } = stoppingFlow();
  const state = createFlowState({ flows: { "durable-default": flow }, ...options } as FlowStateOptions);
  const runtime = await state.getRuntime();
  return { state, runtime };
}

describe("createFlowState: durable by default wherever stores persist", () => {
  it("a host on persisting stores that never mentions `durable` holds a stop", async () => {
    const { state, runtime } = await runtimeOf({
      stores: { default: { primary: filesystemStores({ rootDir: dataDir(), developmentOnly: true }) } }
    });
    try {
      expect(runtime.runtimeConfig.durabilityProvider).toBeDefined();
    } finally {
      await state.dispose();
    }
  });

  it("`durable: false` turns it off on persisting stores", async () => {
    const { state, runtime } = await runtimeOf({
      stores: { default: { primary: filesystemStores({ rootDir: dataDir(), developmentOnly: true }) } },
      durable: false
    });
    try {
      expect(runtime.runtimeConfig.durabilityProvider).toBeUndefined();
    } finally {
      await state.dispose();
    }
  });

  it("in-memory stores get none by default: a stop held there would be lost with the process", async () => {
    const { state, runtime } = await runtimeOf({ stores: { default: { primary: inMemoryStores() } } });
    try {
      expect(runtime.runtimeConfig.durabilityProvider).toBeUndefined();
    } finally {
      await state.dispose();
    }
  });

  it("in-memory stores opt in with `durable: true`, as tests do", async () => {
    const { state, runtime } = await runtimeOf({ stores: { default: { primary: inMemoryStores() } }, durable: true });
    try {
      expect(runtime.runtimeConfig.durabilityProvider).toBeDefined();
    } finally {
      await state.dispose();
    }
  });
});

describe("a host without durable execution refuses at the stop", () => {
  it("names the rule and the setting, records the request failed, and holds nothing", async () => {
    const { flow, runsBefore } = stoppingFlow();
    const state = createFlowState({
      flows: { "durable-default": flow },
      stores: { default: { primary: filesystemStores({ rootDir: dataDir(), developmentOnly: true }) } },
      durable: false
    } as FlowStateOptions);
    try {
      const runtime = await state.getRuntime();
      const result = await runAction({
        flow,
        actionName: "go",
        input: { n: 1 },
        userId: "u1",
        orgId: DEFAULT_ORG_ID,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig
      });
      expect(runsBefore()).toBe(1);
      const message = result.error?.message ?? "";
      // The rule: where durable execution is on, and why this host has none.
      expect(message).toMatch(/durable execution/);
      expect(message).toMatch(/wherever stores persist/);
      // The settings to change.
      expect(message).toMatch(/durable: false/);
      expect(message).toMatch(/durable: true/);
      const request = await runtime.stores.request.get(result.requestId!);
      expect(request?.status).toBe("failed");
      expect(await runtime.stores.suspensions.list({})).toEqual([]);
    } finally {
      await state.dispose();
    }
  });
});
