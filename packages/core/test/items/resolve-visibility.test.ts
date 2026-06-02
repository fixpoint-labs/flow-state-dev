/**
 * Truth-table test for `resolveItemVisibility` after the agentType → itemVisibility
 * rename (FIX-713). Every row of the §4.2 value map is asserted, including
 * trace-by-type, the new {false,true} corner, structural defaults, and
 * handler-emit fallback.
 */
import { describe, expect, it } from "vitest";
import type { OutputItem, ItemVisibility } from "../../src/items/types";
import { resolveItemVisibility } from "../../src/items/resolve-visibility";

const baseProv = {
  blockName: "test",
  blockInstanceId: "test#1",
  phase: "main" as const,
};

function makeItem(
  overrides: Partial<OutputItem> & { type: string },
): OutputItem {
  return {
    id: "item-1",
    status: "completed",
    requestId: "req-1",
    itemIndex: 0,
    provenance: baseProv,
    ts: Date.now(),
    ...overrides,
  } as OutputItem;
}

describe("resolveItemVisibility", () => {
  describe("trace types keyed by item.type", () => {
    for (const traceType of ["block_trace", "router_decision", "state_snapshot"]) {
      it(`${traceType} → {client:false, history:false}`, () => {
        const item = makeItem({ type: traceType });
        expect(resolveItemVisibility(item)).toEqual({ client: false, history: false });
      });

      it(`${traceType} ignores any itemVisibility stamp`, () => {
        const item = makeItem({
          type: traceType,
          itemVisibility: { client: true, history: true },
        });
        expect(resolveItemVisibility(item)).toEqual({ client: false, history: false });
      });
    }
  });

  describe("conversational types with itemVisibility stamp", () => {
    for (const convType of ["message", "reasoning", "tool_output"]) {
      it(`${convType} with {client:true, history:true} (primary)`, () => {
        const item = makeItem({
          type: convType,
          itemVisibility: { client: true, history: true },
        } as any);
        expect(resolveItemVisibility(item)).toEqual({ client: true, history: true });
      });

      it(`${convType} with {client:true, history:false} (sub)`, () => {
        const item = makeItem({
          type: convType,
          itemVisibility: { client: true, history: false },
        } as any);
        expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
      });

      it(`${convType} with {client:false, history:false} (trace)`, () => {
        const item = makeItem({
          type: convType,
          itemVisibility: { client: false, history: false },
        } as any);
        expect(resolveItemVisibility(item)).toEqual({ client: false, history: false });
      });

      it(`${convType} with {client:false, history:true} (fourth corner)`, () => {
        const item = makeItem({
          type: convType,
          itemVisibility: { client: false, history: true },
        } as any);
        expect(resolveItemVisibility(item)).toEqual({ client: false, history: true });
      });
    }
  });

  describe("conversational types with no itemVisibility (handler-emit fallback)", () => {
    for (const convType of ["message", "reasoning", "tool_output"]) {
      it(`${convType} defaults to {client:true, history:true}`, () => {
        const item = makeItem({ type: convType } as any);
        expect(resolveItemVisibility(item)).toEqual({ client: true, history: true });
      });
    }
  });

  describe("structural types", () => {
    for (const structType of [
      "status",
      "state_change",
      "resource_change",
      "component",
      "container",
      "error",
      "source",
    ]) {
      it(`${structType} → {client:true, history:false}`, () => {
        const item = makeItem({ type: structType } as any);
        expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
      });

      it(`${structType} ignores itemVisibility stamp`, () => {
        const item = makeItem({
          type: structType,
          itemVisibility: { client: false, history: true },
        } as any);
        expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
      });
    }
  });
});
