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
import { getReadonlyStateKeys } from "../src/helpers/zod-introspect";

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

describe("optional, readonly and a default are flags on a field, not its type", () => {
  const merge = (a: z.ZodTypeAny, b: z.ZodTypeAny) =>
    (mergeScopeStateSchemas("Flow \"f\"", "session", [
      decl(z.object({ x: a, onlyA: z.number().default(1) }), "block \"a\""),
      decl(z.object({ x: b, onlyB: z.number().default(2) }), "block \"b\"")
    ]) as z.AnyZodObject).shape.x as z.ZodTypeAny;

  it("a default on one side and .optional() on the other merge, and the default fills; the defaulted leaf is kept", () => {
    const planned = z.string().default("plan");
    for (const x of [merge(planned, z.string().optional()), merge(z.string().optional(), planned)]) {
      expect(x).toBe(planned);
      expect(x.safeParse(undefined).data).toBe("plan");
    }
  });

  it(".readonly() on one side and .optional() on the other merge into a field that is both", () => {
    const core = z.string();
    const x = merge(core.readonly(), core.optional());
    expect(getReadonlyStateKeys(z.object({ x }))).toEqual(["x"]);
    expect(x.safeParse(undefined).success).toBe(true);
  });

  it("a default with .readonly() against .optional(): readonly, and the default fills", () => {
    const x = merge(z.string().default("plan").readonly(), z.string().optional());
    expect(getReadonlyStateKeys(z.object({ x }))).toEqual(["x"]);
    expect(x.safeParse(undefined).data).toBe("plan");
  });

  it("a rebuilt field keeps its core schema object, so constraints survive", () => {
    const code = z.string().min(3);
    const x = merge(code.readonly(), code.optional());
    expect(x.safeParse("ab").success).toBe(false);
    expect(x.safeParse("abc").success).toBe(true);
  });

  it("still refuses two different defaults, and a nullable on one side only", () => {
    expect(() => merge(z.string().default("a").optional(), z.string().default("b"))).not.toThrow();
    expect(() => merge(z.string().default("a"), z.string().default("b").readonly())).toThrow(/different defaults/);
    expect(() => merge(z.string().nullable(), z.string().optional())).toThrow(/different types/);
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

describe("the merge never makes a default unfillable", () => {
  it("a field only one side of a merged object declares, with no default, doesn't stop the object's default filling", () => {
    const merged = mergeScopeStateSchemas("Flow \"f\"", "session", [
      decl(z.object({ prefs: z.object({ theme: z.string().default("light") }).default({}) }), "flow \"f\""),
      decl(z.object({ prefs: z.object({ name: z.string() }) }), "block \"b\"")
    ]) as z.AnyZodObject;
    expect(merged.shape.prefs.safeParse(undefined).data).toEqual({ theme: "light" });
    // A stored value still fills, and keeps what it holds.
    expect(merged.shape.prefs.safeParse({ name: "Ada" }).data).toEqual({ name: "Ada", theme: "light" });
  });

  it("a field both sides require stays required: each side's own default already failed on it", () => {
    const merged = mergeScopeStateSchemas("Flow \"f\"", "session", [
      decl(z.object({ prefs: z.object({ id: z.string(), theme: z.string().default("light") }) }), "flow \"f\""),
      decl(z.object({ prefs: z.object({ id: z.string(), size: z.number().default(1) }) }), "block \"b\"")
    ]) as z.AnyZodObject;
    expect(merged.shape.prefs.safeParse({}).success).toBe(false);
  });
});

describe("a default JSON and deepEqual can't read never crashes defineFlow", () => {
  class Foo {
    constructor(readonly n = 1) {}
  }
  let deep: Record<string, unknown> = { leaf: 1 };
  for (let i = 0; i < 40; i++) deep = { next: deep };
  const cases: Array<[string, () => z.ZodTypeAny]> = [
    ["a Map default", () => z.map(z.string(), z.number()).default(new Map([["a", 1]]))],
    ["a class-instance default", () => z.instanceof(Foo).default(new Foo())],
    ["a Set inside an array default", () => z.array(z.set(z.string())).default([new Set(["a"])])],
    ["a 40-deep nested default", () => z.record(z.unknown()).default(deep)]
  ];
  const merge = (...fields: z.ZodTypeAny[]) =>
    mergeScopeStateSchemas(
      "Flow \"f\"",
      "session",
      fields.map((f, i) => decl(z.object({ x: f, [`only${i}`]: z.number().default(i) }), `block "b${i}"`))
    );

  for (const [name, make] of cases) {
    it(`${name}: one shared schema merges with itself, in a field and nested in an array`, () => {
      const field = make();
      expect(() => merge(field, field)).not.toThrow();
      const nested = z.array(z.object({ v: field }));
      expect(() => merge(nested, z.array(z.object({ v: field })))).not.toThrow();
    });
  }

  it("two different Map defaults are refused, not crashed on", () => {
    const map = () => z.map(z.string(), z.number()).default(new Map([["a", 1]]));
    expect(() => merge(z.array(map()), z.array(map()))).toThrow(ScopeStateSchemaConflictError);
  });

  it("two declarations of one Map core with different Map defaults are refused, not crashed on", () => {
    const core = z.map(z.string(), z.number());
    expect(() => merge(core.default(new Map([["a", 1]])), core.default(new Map([["a", 2]])))).toThrow(
      ScopeStateSchemaConflictError
    );
  });
});

describe("a static default is told from a factory by behaviour, not only by its text", () => {
  const merge = (a: z.ZodTypeAny, b: z.ZodTypeAny) =>
    mergeScopeStateSchemas("Flow \"f\"", "session", [
      decl(z.object({ x: a }), "block \"a\""),
      decl(z.object({ x: b }), "block \"b\"")
    ]);

  it("a closure with zod's thunk text that recomputes each call is a factory, compared by identity", () => {
    let n = 0;
    Object.defineProperty(globalThis, "def", { get: () => ++n, configurable: true });
    try {
      // The same source text zod gives `.default(value)`'s thunk.
      const one = new Function("return () => def")() as () => number;
      const two = new Function("return () => def")() as () => number;
      expect(() => merge(z.number().default(one), z.number().default(two))).toThrow(/a dynamic default/);
    } finally {
      delete (globalThis as { def?: unknown }).def;
    }
  });

  it("two separate .default(value) declarations still merge, primitive or not", () => {
    expect(() => merge(z.string().default("plan"), z.string().default("plan"))).not.toThrow();
    expect(() => merge(z.array(z.string()).default([]), z.array(z.string()).default([]))).not.toThrow();
  });
});

describe("a static default's fingerprint ignores key order, not array order", () => {
  const item = (prefs: unknown) =>
    z.array(z.object({ prefs: z.record(z.string()).default(prefs as Record<string, string>) }));
  const merge = (a: z.ZodTypeAny, b: z.ZodTypeAny) =>
    mergeScopeStateSchemas("Flow \"f\"", "session", [
      decl(z.object({ items: a, onlyA: z.number().default(1) }), "block \"a\""),
      decl(z.object({ items: b, onlyB: z.number().default(2) }), "block \"b\"")
    ]);

  it("two equal defaults listing their keys in another order merge, nested in an array item", () => {
    expect(() => merge(item({ theme: "dark", lang: "en" }), item({ lang: "en", theme: "dark" }))).not.toThrow();
  });

  it("two defaults listing an array in another order are still refused", () => {
    const list = (v: string[]) => z.array(z.object({ tags: z.array(z.string()).default(v) }));
    expect(() => merge(list(["a", "b"]), list(["b", "a"]))).toThrow(ScopeStateSchemaConflictError);
  });
});

describe("a fingerprint has no delimiter ambiguity", () => {
  // Each pair accepts different values, so it must fingerprint apart.
  const pairs: Array<[string, z.ZodTypeAny, z.ZodTypeAny]> = [
    ["an enum value holding the separator", z.enum(["read|write"]), z.enum(["read", "write"])],
    // In an array, so the object is a leaf the fingerprint reads (a field's own object merges by field).
    [
      "an object key holding the separators",
      z.array(z.object({ "a:string,b": z.string() })),
      z.array(z.object({ a: z.string(), b: z.string() }))
    ],
    [
      "a union option holding the separator",
      z.union([z.literal("x"), z.literal("y"), z.literal("z")]),
      z.union([z.literal("x"), z.union([z.literal("y"), z.literal("z")])])
    ],
    ["a record's key type holding the separator", z.record(z.enum(["a,b"]), z.string()), z.record(z.enum(["a", "b"]), z.string())],
    // Values JSON can't round-trip: each encodes as `null`.
    ["a literal undefined against a literal null", z.literal(undefined), z.literal(null)],
    ["a literal NaN against a literal null", z.literal(Number.NaN), z.literal(null)],
    [
      "a nested static default JSON can't round-trip",
      z.array(z.object({ n: z.number().nullable().default(Number.NaN) })),
      z.array(z.object({ n: z.number().nullable().default(null) }))
    ]
  ];
  for (const [name, a, b] of pairs) {
    it(`refuses ${name}`, () => {
      expect(() =>
        mergeScopeStateSchemas("Flow \"f\"", "session", [
          decl(z.object({ f: a }), "block \"a\""),
          decl(z.object({ f: b }), "block \"b\"")
        ])
      ).toThrow(/session\.state\.f is declared twice with different types/);
    });
  }
});
