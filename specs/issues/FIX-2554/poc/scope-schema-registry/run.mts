/**
 * POC harness · runs the seven checks against variants A, B and C and prints
 * what each showed. Throwaway evidence for the FIX-2554 follow-up.
 *
 * Run from apps/kitchen-sink (check 6 loads the kitchen-sink's real flows, and
 * their `@/` imports resolve from there):
 *
 *   cd apps/kitchen-sink && ../../node_modules/.bin/tsx ../../specs/issues/FIX-2554/poc/scope-schema-registry/run.mts
 */
import { z } from "zod";
import { defineCapability, defineFlow, handler } from "../../../../../packages/core/src/index";
import { SchemaRegistry, readStateA } from "./variant-a-registry.mts";
import { checkServerB, mergeFlowSchemas, readStateB, type MergedSchemas } from "./variant-b-flow-walk.mts";
import { checkFlowC, readStateC } from "./variant-c-baseline.mts";
import { blockDeclarations, flowOwnDeclarations, reachableBlocks } from "./collect.mts";
import { reconcile, toSchema } from "./reconcile.mts";
import { applyScopeStateDefaults } from "./fill.mts";

const any = z.any();
const block = (name: string, extra: Record<string, unknown>) =>
  handler({ name, inputSchema: any, outputSchema: any, execute: async () => null, ...extra } as any);
const flowOf = (kind: string, blocks: any[], scopes: Record<string, unknown> = {}) =>
  defineFlow({
    kind,
    ...scopes,
    actions: Object.fromEntries(blocks.map((b, i) => [`a${i}`, { inputSchema: any, block: b }]))
  } as any)();

/** Run fn, return "ok" or the error message. */
const attempt = (fn: () => unknown): string => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return `THROWS: ${(e as Error).message}`;
  }
};
const show = (label: string, v: unknown) => console.log(`  ${label.padEnd(5)} ${typeof v === "string" ? v : JSON.stringify(v)}`);
const head = (t: string) => console.log(`\n## ${t}`);

// ---------------------------------------------------------------------------
head("0 · characterization: where block and capability schemas live at runtime");
{
  const cap = defineCapability({ name: "featuresCap", sessionStateSchema: z.object({ capField: z.number().default(3) }) } as any);
  const b = block("b0", { sessionStateSchema: z.object({ own: z.string().default("x") }), uses: [cap] });
  const cfg = (b as any).config;
  show("own", `block.config.sessionStateSchema keys = ${JSON.stringify(Object.keys(cfg.sessionStateSchema.shape))}`);
  show("cap", `capability field on block.config? ${"capField" in cfg.sessionStateSchema.shape}; on __resolvedCapabilities? ${cfg.__resolvedCapabilities?.[0]?.sessionStateSchema?.shape?.capField !== undefined}`);
  show("decl", blockDeclarations(b).map((d) => d.source));
}

// ---------------------------------------------------------------------------
head("1 · a block-declared default is present on a fresh session");
{
  const cap = defineCapability({ name: "skills", sessionStateSchema: z.object({ activeSkills: z.array(z.string()).default([]) }) } as any);
  const b = block("pickMode", { sessionStateSchema: z.object({ mode: z.enum(["ask", "plan"]).default("ask") }), uses: [cap] });
  const flow = flowOf("one", [b], { session: { stateSchema: z.object({ requestCount: z.number().default(0) }) } });
  const reg = new SchemaRegistry();
  reg.registerBlock(b); // what buildBlock would do
  reg.registerFlow(flow); // what defineFlow would do
  show("A", readStateA(reg, "session", {}));
  show("B", readStateB(mergeFlowSchemas(flow), "session", {}));
  show("C", readStateC(flow, "session", {}));
  show("C chk", attempt(() => checkFlowC(flow)));
}

// ---------------------------------------------------------------------------
head("2 · type conflict and default conflict between two blocks: the error names both");
for (const [label, x, y] of [
  ["type", z.object({ mode: z.string().default("ask") }), z.object({ mode: z.number().default(1) })],
  ["default", z.object({ mode: z.enum(["ask", "plan"]).default("ask") }), z.object({ mode: z.enum(["ask", "plan"]).default("plan") })]
] as const) {
  console.log(` (${label})`);
  const bx = block("blockX", { sessionStateSchema: x });
  const by = block("blockY", { sessionStateSchema: y });
  const flow = flowOf(`conflict-${label}`, [bx, by]);
  const reg = new SchemaRegistry();
  show("A", attempt(() => { reg.registerBlock(bx); reg.registerBlock(by); }));
  show("B", attempt(() => mergeFlowSchemas(flow)));
  show("C", attempt(() => checkFlowC(flow)));
}
{
  console.log(" (same two blocks, but in two DIFFERENT flows — sessions never share a record)");
  const bx = block("blockX", { sessionStateSchema: z.object({ mode: z.enum(["ask", "plan"]).default("ask") }) });
  const by = block("blockY", { sessionStateSchema: z.object({ mode: z.enum(["ask", "plan"]).default("plan") }) });
  const f1 = flowOf("flow-one", [bx]);
  const f2 = flowOf("flow-two", [by]);
  const reg = new SchemaRegistry();
  show("A", attempt(() => { reg.registerBlock(bx); reg.registerBlock(by); }));
  show("B", attempt(() => { mergeFlowSchemas(f1); mergeFlowSchemas(f2); }));
}
{
  console.log(" (a dev edits a block's default and the module re-evaluates: HMR / vitest watch)");
  const reg = new SchemaRegistry();
  reg.registerBlock(block("pickMode", { sessionStateSchema: z.object({ mode: z.enum(["ask", "plan"]).default("ask") }) }));
  const edited = block("pickMode", { sessionStateSchema: z.object({ mode: z.enum(["ask", "plan"]).default("plan") }) });
  show("A", attempt(() => reg.registerBlock(edited)));
  show("B", attempt(() => mergeFlowSchemas(flowOf("hmr", [edited]))));
}

// ---------------------------------------------------------------------------
head("3 · non-colliding fields from two blocks union");
{
  const b1 = block("b1", { sessionStateSchema: z.object({ a: z.string().default("one") }) });
  const b2 = block("b2", { sessionStateSchema: z.object({ b: z.number().default(2), shared: z.boolean().default(true) }) });
  const b3 = block("b3", { sessionStateSchema: z.object({ shared: z.boolean().default(true) }) }); // identical: merges
  const flow = flowOf("union", [b1, b2, b3]);
  const reg = new SchemaRegistry();
  [b1, b2, b3].forEach((b) => reg.registerBlock(b));
  show("A", readStateA(reg, "session", {}));
  show("B", readStateB(mergeFlowSchemas(flow), "session", {}));
  show("C", readStateC(flow, "session", {}));
}

// ---------------------------------------------------------------------------
head("4 · nested paths: a block declares features.search, the flow declares features");
{
  const flowFeatures = z.object({ features: z.object({ biasCheck: z.boolean().default(false) }).default({}) });
  const cases: Array<[string, z.ZodTypeAny]> = [
    ["adds features.search", z.object({ features: z.object({ search: z.boolean().default(true) }) })],
    ["defaults features.biasCheck differently", z.object({ features: z.object({ biasCheck: z.boolean().default(true) }) })],
    ["types features as a record", z.object({ features: z.record(z.boolean()) })]
  ];
  for (const [label, schema] of cases) {
    console.log(` (block ${label})`);
    const b = block("searchToggle", { sessionStateSchema: schema });
    const flow = flowOf("nested", [b], { session: { stateSchema: flowFeatures } });
    const reg = new SchemaRegistry();
    show("A", attempt(() => { reg.registerFlow(flow); reg.registerBlock(b); }) === "ok" ? readStateA(reg, "session", { features: {} }) : attempt(() => { const r = new SchemaRegistry(); r.registerFlow(flow); r.registerBlock(b); }));
    let merged: MergedSchemas | undefined;
    const b_ = attempt(() => (merged = mergeFlowSchemas(flow)));
    show("B", merged ? readStateB(merged, "session", { features: {} }) : b_);
    show("C", readStateC(flow, "session", { features: {} }));
  }
  console.log(" (no declarer defaults the `features` container itself)");
  const b = block("searchToggle", { sessionStateSchema: z.object({ features: z.object({ search: z.boolean().default(true) }) }) });
  show("B {}", readStateB(mergeFlowSchemas(flowOf("nested-nodefault", [b])), "session", {}));
  show("B {f}", readStateB(mergeFlowSchemas(flowOf("nested-nodefault2", [b])), "session", { features: {} }));
}

// ---------------------------------------------------------------------------
head("5 · cross-flow shared user records: no strip, no leakage");
{
  const p = flowOf("flow-p", [block("pBlock", { userStateSchema: z.object({ theme: z.string().default("dark") }) })]);
  const q = flowOf("flow-q", [block("qBlock", {})], { user: { stateSchema: z.object({ locale: z.string().default("en") }) } });
  const stored = { written: "by another flow", locale: "fr" };
  const reg = new SchemaRegistry();
  for (const f of [p, q]) {
    reg.registerFlow(f);
    reachableBlocks(f).forEach((b) => reg.registerBlock(b));
  }
  console.log(" (flow-q reads a user record; flow-p declares `theme`, flow-q never does)");
  show("A", readStateA(reg, "user", stored));
  show("B", readStateB(mergeFlowSchemas(q), "user", stored));
  show("C", readStateC(q, "user", stored));
  console.log(" (flow-r types user.theme as a number, on the same server as flow-p)");
  const r = flowOf("flow-r", [block("rBlock", { userStateSchema: z.object({ theme: z.number().default(0) }) })]);
  const reg2 = new SchemaRegistry();
  show("A", attempt(() => [p, r].forEach((f) => reachableBlocks(f).forEach((b) => reg2.registerBlock(b)))));
  show("B", attempt(() => [p, r].forEach((f) => mergeFlowSchemas(f))) + "  (per flow)");
  show("B srv", attempt(() => checkServerB([p, r].map((flow) => ({ flow, merged: mergeFlowSchemas(flow) })))));
  show("C", "ok (nothing compares flows; the shared record holds a string for one flow and a number for the other)");
}

// ---------------------------------------------------------------------------
head("6 · overhead on the kitchen-sink's real flows");
const time = (n: number, fn: () => unknown) => {
  for (let i = 0; i < Math.min(n, 50); i++) fn();
  const t = performance.now();
  for (let i = 0; i < n; i++) fn();
  return ((performance.now() - t) / n) * 1000; // µs
};
{
  const t0 = performance.now();
  const chat = (await import("../../../../../apps/kitchen-sink/flows/chat-agent/flow")).default as any;
  const rich = (await import("../../../../../apps/kitchen-sink/flows/rich-text-component/flow")).default as any;
  const digest = (await import("../../../../../apps/kitchen-sink/flows/weekly-digest/flow")).default as any;
  const { buildKitchenSinkWorkforce } = await import("../../../../../apps/kitchen-sink/workforce/hire");
  const wf = await buildKitchenSinkWorkforce();
  const flows = [chat, rich, digest, ...wf.copies];
  console.log(`  loaded ${flows.length} flows in ${(performance.now() - t0).toFixed(0)} ms (module load, for scale)`);

  /** Fold declarations one at a time, skipping (and recording) each one that conflicts. */
  const lenient = (decls: ReturnType<typeof blockDeclarations>) => {
    let roots = {} as ReturnType<typeof reconcile>;
    const conflicts: string[] = [];
    for (const d of decls) {
      try { roots = reconcile([d], roots); } catch (e) { conflicts.push((e as Error).message.replace(/ Share one schema.*$/, "")); }
    }
    return { roots, conflicts };
  };
  const declsOf = (f: any) => [...flowOwnDeclarations(f), ...reachableBlocks(f).flatMap(blockDeclarations)];

  for (const f of [chat, wf.copies.find((c: any) => c.kind === "coordinator") ?? wf.copies[0]]) {
    const blocks = reachableBlocks(f);
    const decls = declsOf(f);
    const distinct = new Set(decls.map((d) => d.schema)).size;
    console.log(` flow "${f.kind}": ${blocks.length} reachable blocks, ${decls.length} scope-schema declarations (${distinct} distinct)`);
    show("B", `strict merge: ${attempt(() => mergeFlowSchemas(f)) === "ok" ? "ok" : "refused"}`);
    const { roots, conflicts } = lenient(decls);
    for (const c of conflicts) show("B", `conflict: ${c}`);
    const merged: MergedSchemas = Object.fromEntries(
      Object.entries(roots).map(([k, v]) => [k, toSchema(v!)])
    );
    show("B", `walk only: ${time(200, () => reachableBlocks(f)).toFixed(0)} µs · walk+collect+merge (strict, per defineFlow): ${time(200, () => attempt(() => mergeFlowSchemas(f))).toFixed(0)} µs`);
    const flowOnly = f.session?.stateSchema;
    const filledFull = readStateB(merged, "session", {});
    const flowFilled = readStateC(f, "session", {});
    const onlyFromBlocks = Object.keys(filledFull).filter((k) => !(k in flowFilled));
    show("B", `session fields only the merge fills on a fresh session: ${JSON.stringify(onlyFromBlocks)} (of ${Object.keys(filledFull).length})`);
    show("C chk", attempt(() => checkFlowC(f)).replace(/ Share one schema.*$/, ""));
    const full = { ...filledFull };
    show("fill", `per load, stored {}: C ${time(20000, () => applyScopeStateDefaults(flowOnly, {})).toFixed(1)} µs · B ${time(20000, () => readStateB(merged, "session", {})).toFixed(1)} µs`);
    show("fill", `per load, full record: C ${time(20000, () => applyScopeStateDefaults(flowOnly, full)).toFixed(1)} µs · B ${time(20000, () => readStateB(merged, "session", full)).toFixed(1)} µs`);
  }

  console.log(" variant A: one registry, every block of every flow on the kitchen-sink server");
  const all = flows.flatMap(declsOf);
  const reg = new SchemaRegistry();
  show("A", `register ${all.length} declarations (${new Set(all.map((d) => d.schema)).size} distinct): ${attempt(() => { for (const d of all) reg.register(d); }).replace(/ Share one schema.*$/, "")}`);
  const globalLenient = lenient(all);
  for (const c of globalLenient.conflicts) show("A", `conflict: ${c}`);
  show("A", `register only (decls already collected): ${time(200, () => lenient(all)).toFixed(0)} µs`);
  const globalSession = toSchema(globalLenient.roots.session!);
  show("A", `global session schema has ${Object.keys((globalSession as any)._def.innerType?.shape ?? (globalSession as any).shape ?? {}).length || "?"} fields; a fresh chat-agent session under A: ${JSON.stringify(applyScopeStateDefaults(globalSession, {})).slice(0, 300)}`);
  show("fill", `A per load, stored {}: ${time(20000, () => applyScopeStateDefaults(globalSession, {})).toFixed(1)} µs`);
  const perFlow: Array<{ flow: any; merged: MergedSchemas }> = [];
  const refused: string[] = [];
  for (const flow of flows) {
    try { perFlow.push({ flow, merged: mergeFlowSchemas(flow) }); } catch { refused.push(flow.kind); }
  }
  show("B", `${perFlow.length}/${flows.length} flows merge strictly; refused: ${JSON.stringify(refused)}`);
  show("B srv", attempt(() => checkServerB(perFlow)));
}
