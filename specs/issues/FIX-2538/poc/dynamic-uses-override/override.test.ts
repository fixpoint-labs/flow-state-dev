/** THROWAWAY POC (FIX-2538 D2): can a dynamic `uses` entry replace a static same-named createTask? */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, generator, handler } from "../src";
import type { CapabilityRef } from "../src";
import { createMockContext, runForTest } from "./helpers";

const calls: string[] = [];
const mk = (label: string) =>
  handler({
    name: "createTask",
    inputSchema: z.object({}),
    outputSchema: z.object({ who: z.string() }),
    execute: async () => { calls.push(label); return { who: label }; },
  });

// Static board tools: a fence-exempt controlTools preset, like createTaskToolsCapability.
const staticBoard = (t: any) =>
  defineCapability({ name: "taskTools", presets: { tools: { controlTools: [t] }, default: ["tools"] } });
// Dynamic wrapper: same shape, request dependent.
const wrapperCap = (t: any, asCatalog = false) =>
  defineCapability({
    name: "filingWrapper",
    presets: { p: asCatalog ? { tools: [t] } : { controlTools: [t] }, default: ["p"] },
  });

const base = { model: "m", prompt: "p", outputSchema: z.object({ ok: z.boolean() }) } as const;

/** Model records its tool set, then runs the createTask it was offered. */
function ctxFor(seen: { names: string[]; ran: string[] }) {
  return createMockContext({
    resolveModel: () => ({
      modelId: "m",
      async generate(o: any) {
        seen.names = (o.tools ?? []).map((t: any) => t.name);
        const t = (o.tools ?? []).find((x: any) => x.name === "createTask");
        if (t) {
          const before = calls.length;
          const fn = t.execute ?? t.run;
          await fn.call(t, {}, undefined);
          seen.ran = calls.slice(before);
        }
        return { structuredOutput: { ok: true } };
      },
    }),
  });
}
const fresh = () => ({ names: [] as string[], ran: [] as string[] });

describe("dynamic uses vs static same-named createTask", () => {
  it("A: static controlTools createTask + dynamic controlTools createTask -> THROWS (no override)", async () => {
    const block = generator({ name: "A", ...base, tools: [],
      uses: [staticBoard(mk("static")), (): CapabilityRef[] => [wrapperCap(mk("wrapped"))]] });
    await expect(runForTest(block, {}, ctxFor(fresh()))).rejects.toThrow(/two tools named "createTask"/);
  });

  it("A-control: distinct name -> no throw (the check can pass)", async () => {
    const other = handler({ name: "createTaskWrapped", inputSchema: z.object({}), outputSchema: z.object({}), execute: async () => ({}) });
    const block = generator({ name: "A2", ...base, tools: [],
      uses: [staticBoard(mk("static")), (): CapabilityRef[] => [wrapperCap(other)]] });
    const seen = fresh();
    await runForTest(block, {}, ctxFor(seen));
    console.log("A-control seen:", seen.names);
    expect([...seen.names].sort()).toEqual(["createTask", "createTaskWrapped"]);
  });

  it("B: static controlTools + dynamic CATALOG createTask behind a declared tools fence -> wrapper silently dropped, static runs", async () => {
    const block = generator({ name: "B", ...base, tools: [],
      uses: [staticBoard(mk("static")), (): CapabilityRef[] => [wrapperCap(mk("wrapped"), true)]] });
    const seen = fresh();
    await runForTest(block, {}, ctxFor(seen));
    console.log("B seen:", seen.names, "ran:", seen.ran);
    expect(seen.names).toEqual(["createTask"]);
    expect(seen.ran).toEqual(["static"]);
  });

  it("C: dynamic-only (no static board) -> exactly one createTask, the wrapped one, runs", async () => {
    const block = generator({ name: "C", ...base, tools: [],
      uses: [(): CapabilityRef[] => [wrapperCap(mk("wrapped"))]] });
    const seen = fresh();
    await runForTest(block, {}, ctxFor(seen));
    console.log("C seen:", seen.names, "ran:", seen.ran);
    expect(seen.names).toEqual(["createTask"]);
    expect(seen.ran).toEqual(["wrapped"]);
  });

  it("D: fallback - generator with its own fixed tools:[wrapped], no board cap -> one wrapped createTask", async () => {
    const block = generator({ name: "D", ...base, tools: [mk("wrapped")] });
    const seen = fresh();
    await runForTest(block, {}, ctxFor(seen));
    console.log("D seen:", seen.names, "ran:", seen.ran);
    expect(seen.names).toEqual(["createTask"]);
    expect(seen.ran).toEqual(["wrapped"]);
  });

  it("E: static controlTools createTask + fixed tools:[wrapped] -> throws too", async () => {
    const block = generator({ name: "E", ...base, tools: [mk("wrapped")],
      uses: [staticBoard(mk("static"))] });
    await expect(runForTest(block, {}, ctxFor(fresh()))).rejects.toThrow(/two tools named "createTask"/);
  });
});
