/**
 * `runAction` honours a pre-resolved action core carried on the dispatch
 * options (FIX-838). This is the one event path with no static coordinate —
 * the dynamic schedule, whose handler block is produced at dispatch time by a
 * resolver and cannot be reached from the live flow definition. When
 * `resolvedActionCore` is present, the runtime runs that core directly and
 * never consults `flow.actions` / `resolveActionCore`, so the dispatched
 * `actionName` need not exist on the flow.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createInMemoryStores, createResponseEmitter, runAction } from "../../src";

describe("runAction — carried action core", () => {
  it("runs the carried core's block, bypassing flow.actions resolution", async () => {
    const captured: { value?: string } = {};

    // The flow declares NO action named "dynamic-digest". Without a carried
    // core this dispatch would throw a ValidationError.
    const flow = defineFlow({
      kind: "carried",
      actions: {}
    });

    const dynamicBlock = handler({
      name: "dynamic-digest",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({}),
      execute: (input: { value: string }) => {
        captured.value = input.value;
        return {};
      }
    });

    await runAction({
      flow,
      // Name intentionally absent from flow.actions — proves the carried core
      // wins outright and no named-action lookup happens.
      actionName: "dynamic-digest" as keyof typeof flow.actions & string,
      input: { value: "from-resolver" },
      userId: "system",
      source: "scheduled",
      resolvedActionCore: { block: dynamicBlock },
      stores: createInMemoryStores(),
      responseEmitter: createResponseEmitter({ requestId: "req_carried" }),
      runtimeConfig: {}
    });

    expect(captured.value).toBe("from-resolver");
  });

  it("still throws for an unknown action when no carried core is present", async () => {
    const flow = defineFlow({ kind: "carried", actions: {} });

    await expect(
      runAction({
        flow,
        actionName: "missing" as keyof typeof flow.actions & string,
        input: {},
        userId: "system",
        source: "scheduled",
        stores: createInMemoryStores(),
        responseEmitter: createResponseEmitter({ requestId: "req_missing" }),
        runtimeConfig: {}
      })
    ).rejects.toThrow(/does not define action "missing"/);
  });
});
