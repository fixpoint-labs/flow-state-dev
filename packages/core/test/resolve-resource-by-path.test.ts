import { describe, it, expect } from "vitest";
import { resolveResourceByPath } from "../src/tools/resource-tools";
import type { BlockContext } from "../src/types/block";

function makeCtx(
  singleResources: Array<{ path: string }>,
  collections: Array<{
    pattern: string;
    instances: Record<string, { path: string }>;
  }> = [],
): BlockContext {
  const entries: any[] = [];

  for (const r of singleResources) {
    entries.push({
      path: r.path,
      scope: "org",
      uri: `org/${r.path}`,
      state: {},
      readContent: async () => `content of ${r.path}`,
    });
  }

  for (const c of collections) {
    entries.push({
      pattern: c.pattern,
      scope: "org",
      create: async () => {},
      get: async (key: string) => {
        const inst = c.instances[key];
        if (!inst) throw new Error(`Not found: ${key}`);
        return {
          path: inst.path,
          scope: "org",
          state: {},
          readContent: async () => `content of ${inst.path}`,
        };
      },
      list: async () =>
        Object.values(c.instances).map((i) => ({
          path: i.path,
          scope: "org",
          state: {},
        })),
    });
  }

  return {
    resources: {
      list: () => entries,
      get: ((name: string) => entries.find((e: any) => e.path === name)) as any,
    },
  } as unknown as BlockContext;
}

describe("resolveResourceByPath", () => {
  it("resolves a single resource by path", async () => {
    const ctx = makeCtx([{ path: "persona-analyst" }]);
    const ref = await resolveResourceByPath("persona-analyst", ctx);
    expect(ref).toBeDefined();
    expect(ref!.path).toBe("persona-analyst");
  });

  it("resolves a collection instance by path", async () => {
    const ctx = makeCtx([], [
      {
        pattern: "personas/*",
        instances: {
          analyst: { path: "personas/analyst" },
        },
      },
    ]);
    const ref = await resolveResourceByPath("personas/analyst", ctx);
    expect(ref).toBeDefined();
    expect(ref!.path).toBe("personas/analyst");
  });

  it("returns undefined when no match", async () => {
    const ctx = makeCtx([{ path: "other" }]);
    const ref = await resolveResourceByPath("nonexistent", ctx);
    expect(ref).toBeUndefined();
  });

  it("returns undefined when ctx.resources is undefined", async () => {
    const ctx = {} as BlockContext;
    const ref = await resolveResourceByPath("anything", ctx);
    expect(ref).toBeUndefined();
  });

  it("prefers single resources over collection matches", async () => {
    const ctx = makeCtx(
      [{ path: "personas/analyst" }],
      [
        {
          pattern: "personas/*",
          instances: {
            analyst: { path: "personas/analyst" },
          },
        },
      ],
    );
    const ref = await resolveResourceByPath("personas/analyst", ctx);
    expect(ref).toBeDefined();
    const content = await ref!.readContent();
    expect(content).toBe("content of personas/analyst");
  });
});
