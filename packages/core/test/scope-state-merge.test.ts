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

describe("a leaf is never rebuilt, and a factory is never called", () => {
  const merge = (...schemas: z.ZodTypeAny[]) =>
    mergeScopeStateSchemas(
      "Flow \"f\"",
      "session",
      schemas.map((schema, i) => decl(schema, `block "b${i}"`))
    ) as z.AnyZodObject;
  // Shared item schemas, as two declarers reach one module's export.
  let minted = 0;
  const nanoid = () => `id-${++minted}`;
  const Item = z.object({ id: z.string().default(nanoid), title: z.string() });

  const cases: Array<{
    name: string;
    schemas: () => z.ZodTypeAny[];
    expect: (merged: () => z.AnyZodObject) => void;
  }> = [
    {
      name: "a default an outer .optional() suppresses stays suppressed (n is not filled)",
      schemas: () => [
        z.object({ n: z.number().default(7).optional(), a: z.string().default("a") }),
        z.object({ n: z.number().default(7).optional(), b: z.string().default("b") })
      ],
      expect: (merged) => expect(merged().shape.n.safeParse(undefined).data).toBeUndefined()
    },
    {
      name: "a constrained number and a plain one are refused, not merged in declaration order",
      schemas: () => [z.object({ n: z.number().min(10) }), z.object({ n: z.number().default(0) })],
      expect: (merged) => expect(merged).toThrow(/session\.state\.n is declared twice with different types[\s\S]*share one schema/)
    },
    {
      name: "one item schema with a dynamic default, wrapped in each declarer's own array, merges",
      schemas: () => [
        z.object({ items: z.array(Item).default([]) }),
        z.object({ items: z.array(Item), other: z.number().default(1) })
      ],
      expect: (merged) => expect(Object.keys(merged().shape).sort()).toEqual(["items", "other"])
    },
    {
      name: "two different dynamic defaults are refused as dynamic, not as two defaults",
      schemas: () => [
        z.object({ id: z.string().default(() => "x") }),
        z.object({ id: z.string().default(() => "x") })
      ],
      expect: (merged) => expect(merged).toThrow(/declared twice with a dynamic default[\s\S]*Share one schema for the field\./)
    },
    {
      name: "one shared dynamic default merges",
      schemas: () => {
        const at = () => `at-${++minted}`;
        return [
          z.object({ at: z.string().default(at), a: z.number().default(1) }),
          z.object({ at: z.string().default(at), b: z.number().default(2) })
        ];
      },
      expect: (merged) => expect(Object.keys(merged().shape).sort()).toEqual(["a", "at", "b"])
    }
  ];

  for (const c of cases) {
    it(c.name, () => {
      const before = minted;
      c.expect(() => merge(...c.schemas()));
      // No factory ran while the declarations were compared.
      expect(minted).toBe(before);
    });
  }

  it("keeps the declared leaf object itself in the merged schema", () => {
    const leaf = z.number().min(1).default(5);
    const merged = merge(z.object({ n: leaf }), z.object({ n: leaf, m: z.number().default(0) }));
    expect(merged.shape.n).toBe(leaf);
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
