/**
 * The merge `defineFlow` builds each scope's fill schema with.
 *
 * The engine's `scope-state-defaults.test.ts` drives the merge through real
 * flows and reads; these pin the rules that are easy to get subtly wrong: a
 * flow whose blocks add nothing reads exactly what it declared, and a field
 * one declarer may leave out never stops a sibling's default filling.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "../src";
import { mergeScopeStateSchemas, ScopeStateSchemaConflictError } from "../src/helpers/scope-state-merge";

const decl = (schema: z.ZodTypeAny, source: string) => ({ schema, source });

describe("mergeScopeStateSchemas", () => {
  it("returns the one declared schema itself, the same object declared twice counting once", () => {
    const own = z.object({ a: z.string().default("x") });
    expect(mergeScopeStateSchemas("Flow \"f\"", "session", [decl(own, "flow \"f\""), decl(own, "block \"b\"")])).toBe(own);
    expect(mergeScopeStateSchemas("Flow \"f\"", "session", [])).toBeUndefined();
  });

  it("keeps an unmerged field's own schema, refinements included", () => {
    const refined = z.string().refine((v) => v.length > 2).default("abc");
    const merged = mergeScopeStateSchemas("Flow \"f\"", "session", [
      decl(z.object({ code: refined }), "flow \"f\""),
      decl(z.object({ other: z.number().default(1) }), "block \"b\"")
    ]) as z.AnyZodObject;
    expect(merged.shape.code).toBe(refined);
    expect(merged.parse({})).toEqual({ code: "abc", other: 1 });
  });

  it("a field one declarer marks optional stays optional, so its object's other defaults still fill", () => {
    const merged = mergeScopeStateSchemas("Flow \"f\"", "session", [
      decl(z.object({ prefs: z.object({ size: z.number() }) }), "flow \"f\""),
      decl(z.object({ prefs: z.object({ size: z.number().optional(), theme: z.string().default("light") }) }), "block \"b\"")
    ]) as z.AnyZodObject;
    expect(merged.shape.prefs.parse({})).toEqual({ theme: "light" });
  });

  it("refuses two different refinements of one field: what each accepts can't be read", () => {
    expect(() =>
      mergeScopeStateSchemas("Flow \"f\"", "session", [
        decl(z.object({ n: z.number().refine((v) => v > 0) }), "block \"a\""),
        decl(z.object({ n: z.number().refine((v) => v < 0) }), "block \"b\"")
      ])
    ).toThrow(ScopeStateSchemaConflictError);
  });

  it("refuses a non-object state schema it would have to merge", () => {
    expect(() =>
      mergeScopeStateSchemas("Flow \"f\"", "user", [decl(z.record(z.string()), "flow \"f\""), decl(z.object({}), "block \"b\"")])
    ).toThrow(/flow "f" declares a user state schema that is not a z\.object/);
  });
});

describe("defineFlow's merged scope state", () => {
  it("is kept on the instance and the blueprint; the flow's own stateSchema is unchanged", () => {
    const own = z.object({ mode: z.string() });
    const block = handler({
      name: "b",
      inputSchema: z.object({}),
      sessionStateSchema: z.object({ count: z.number().default(0) }),
      execute: () => ({})
    });
    const flow = defineFlow({ kind: "merged", session: { stateSchema: own }, actions: { a: { inputSchema: z.object({}), block } } });
    const merged = flow().scopeStateSchemas?.session as z.AnyZodObject;
    expect(Object.keys(merged.shape).sort()).toEqual(["count", "mode"]);
    expect(flow.scopeStateSchemas?.session).toBeDefined();
    expect(flow().session?.stateSchema).toBe(own);
  });
});
