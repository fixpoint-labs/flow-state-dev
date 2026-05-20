/**
 * Verifies the `investigate` capability preset's gating contract (FIX-612).
 * The preset must:
 *
 *   1. Return the `fetch` tool only when `costPreset === "full"`.
 *   2. Return the `INVESTIGATION_CLAUSE` string only when full; `null`
 *      otherwise — so the `<investigation>` tag is suppressed entirely
 *      from the prompt on the cheap preset, rather than rendered empty.
 *
 * The preset's resolvers are part of its definition, which DefineCapability
 * stores under `__presetDefs`. We call them directly here rather than
 * routing through a full flow — those resolvers are the contract.
 */
import { describe, expect, it } from "vitest";
import { tradingDesk } from "../src/flows/trading-desk/services/trading-desk-capability";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCap = any;
const investigate = (tradingDesk as AnyCap).__presetDefs.investigate;

function ctxFor(costPreset: "fast" | "full") {
  return {
    session: { state: { costPreset } },
    // The resolver implementations below only touch session.state.costPreset,
    // so we can stub the rest.
    resources: {},
  };
}

describe("investigate preset", () => {
  it("exposes the fetch tool on the full preset", async () => {
    const tools = await investigate.tools(ctxFor("full"));
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(1);
    expect(typeof tools[0].name).toBe("string");
  });

  it("exposes no tools on the fast preset", async () => {
    const tools = await investigate.tools(ctxFor("fast"));
    expect(tools).toEqual([]);
  });

  it("injects the INVESTIGATION_CLAUSE only on full", () => {
    const onFull = investigate.context.investigation({}, ctxFor("full"));
    const onFast = investigate.context.investigation({}, ctxFor("fast"));
    expect(typeof onFull).toBe("string");
    expect(onFull).toContain("<investigation>");
    expect(onFull).toContain("citations");
    // Null on fast suppresses the <investigation> tag entirely.
    expect(onFast).toBeNull();
  });
});
