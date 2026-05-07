import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineResourceCollection, isDefinedResourceCollection } from "../src/types/resource-collection";
import {
  normalizeResourcePath,
  resolveCollectionKey,
  matchesPattern,
  getPatternPrefix,
  extractPatternParams,
  isParameterizedPattern,
  isDeepWildcard,
  isSingleWildcard,
} from "../src/types/collection-patterns";
import { defineResource } from "../src/types/resource";
import { handler, sequencer } from "../src";
import { extractDeclaredResources, mergeDeclaredResources } from "../src/blocks/internal/build-block";
import { createMockContext, runForTest } from "./helpers";
// ---------------------------------------------------------------------------
// defineResourceCollection()
// ---------------------------------------------------------------------------

describe("defineResourceCollection", () => {
  it("creates a collection with single-level wildcard pattern", () => {
    const coll = defineResourceCollection({
      pattern: "files/*",
      scope: "session",
      stateSchema: z.object({ language: z.string() }),
    });

    expect(coll.pattern).toBe("files/*");
    expect(coll.__brand).toBe("ResourceCollection");
  });

  it("creates a collection with deep wildcard pattern", () => {
    const coll = defineResourceCollection({
      pattern: "files/**",
      scope: "session",
      stateSchema: z.object({ language: z.string() }),
      maxInstances: 200,
      eviction: "lru",
    });

    expect(coll.pattern).toBe("files/**");
    expect(coll.maxInstances).toBe(200);
    expect(coll.eviction).toBe("lru");
  });

  it("creates a collection with parameterized pattern", () => {
    const coll = defineResourceCollection({
      pattern: "[topic]/observations",
      scope: "session",
      stateSchema: z.object({ entries: z.array(z.string()).default([]) }),
      maxInstances: 50,
    });

    expect(coll.pattern).toBe("[topic]/observations");
    expect(coll.maxInstances).toBe(50);
  });

  it("requires an explicit scope", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "files/*",
        // @ts-expect-error: scope is required
        stateSchema: z.object({}),
      })
    ).toThrow("requires an explicit scope");
  });

  it("rejects flowIsolation:true on session-scoped collections", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "files/*",
        scope: "session",
        flowIsolation: true,
        stateSchema: z.object({}),
      })
    ).toThrow("flowIsolation:true on session-scoped");
  });

  it("allows flowIsolation:true on user-scoped collections", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "files/*",
        scope: "user",
        flowIsolation: true,
        stateSchema: z.object({}),
      })
    ).not.toThrow();
  });

  it("throws on invalid pattern (empty)", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "",
        scope: "session",
        stateSchema: z.object({}),
      })
    ).toThrow("non-empty");
  });

  it("throws when ** is not the last segment", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "files/**/extra",
        scope: "session",
        stateSchema: z.object({}),
      })
    ).toThrow("last segment");
  });

  it("throws when maxInstances is < 1", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "files/*",
        scope: "session",
        stateSchema: z.object({}),
        maxInstances: 0,
      })
    ).toThrow("maxInstances must be >= 1");
  });

  it("throws when eviction is set without maxInstances", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "files/*",
        scope: "session",
        stateSchema: z.object({}),
        eviction: "lru",
      })
    ).toThrow("eviction requires maxInstances");
  });

  it("allows eviction: 'none' without maxInstances", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "files/*",
        scope: "session",
        stateSchema: z.object({}),
        eviction: "none",
      })
    ).not.toThrow();
  });

  it("accepts prefetchWindow when set to a non-negative integer", () => {
    const coll = defineResourceCollection({
      pattern: "files/*",
      scope: "session",
      stateSchema: z.object({}),
      prefetchWindow: 20,
    });
    expect(coll.prefetchWindow).toBe(20);
  });

  it("accepts prefetchWindow: 0 (explicit lazy)", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "files/*",
        scope: "session",
        stateSchema: z.object({}),
        prefetchWindow: 0,
      })
    ).not.toThrow();
  });

  it("rejects negative prefetchWindow", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "files/*",
        scope: "session",
        stateSchema: z.object({}),
        prefetchWindow: -1,
      })
    ).toThrow("prefetchWindow must be a non-negative integer");
  });

  it("rejects non-integer prefetchWindow", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "files/*",
        scope: "session",
        stateSchema: z.object({}),
        prefetchWindow: 1.5,
      })
    ).toThrow("prefetchWindow must be a non-negative integer");
  });

  it("warns (does not throw) when prefetchWindow exceeds 100", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const coll = defineResourceCollection({
        pattern: "files/*",
        scope: "session",
        stateSchema: z.object({}),
        prefetchWindow: 250,
      });
      expect(coll.prefetchWindow).toBe(250);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain("prefetchWindow=250 is large");
    } finally {
      warn.mockRestore();
    }
  });

  it("accepts client.state.read on collection client config", () => {
    const coll = defineResourceCollection({
      pattern: "files/*",
      scope: "session",
      stateSchema: z.object({}),
      client: {
        content: { read: true },
        state: { read: true },
      },
    });
    expect(coll.client?.state?.read).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isDefinedResourceCollection
// ---------------------------------------------------------------------------

describe("isDefinedResourceCollection", () => {
  it("returns true for collection definitions", () => {
    const coll = defineResourceCollection({
      pattern: "files/*",
      scope: "session",
      stateSchema: z.object({}),
    });
    expect(isDefinedResourceCollection(coll)).toBe(true);
  });

  it("returns false for static resource definitions", () => {
    const res = defineResource({
      scope: "session",
      stateSchema: z.object({ value: z.string() }),
    });
    expect(isDefinedResourceCollection(res)).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isDefinedResourceCollection(null)).toBe(false);
    expect(isDefinedResourceCollection(undefined)).toBe(false);
    expect(isDefinedResourceCollection("string")).toBe(false);
    expect(isDefinedResourceCollection(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pattern utilities
// ---------------------------------------------------------------------------

describe("extractPatternParams", () => {
  it("extracts param names from parameterized patterns", () => {
    expect(extractPatternParams("[topic]/observations")).toEqual(["topic"]);
    expect(extractPatternParams("[a]/[b]/data")).toEqual(["a", "b"]);
  });

  it("returns empty array for wildcard patterns", () => {
    expect(extractPatternParams("files/*")).toEqual([]);
    expect(extractPatternParams("files/**")).toEqual([]);
  });
});

describe("isParameterizedPattern", () => {
  it("identifies parameterized patterns", () => {
    expect(isParameterizedPattern("[topic]/observations")).toBe(true);
    expect(isParameterizedPattern("files/*")).toBe(false);
  });
});

describe("isDeepWildcard", () => {
  it("identifies deep wildcard patterns", () => {
    expect(isDeepWildcard("files/**")).toBe(true);
    expect(isDeepWildcard("files/*")).toBe(false);
  });
});

describe("isSingleWildcard", () => {
  it("identifies single-level wildcard patterns", () => {
    expect(isSingleWildcard("files/*")).toBe(true);
    expect(isSingleWildcard("files/**")).toBe(false);
  });
});

describe("getPatternPrefix", () => {
  it("extracts prefix from wildcard patterns", () => {
    expect(getPatternPrefix("files/*")).toBe("files");
    expect(getPatternPrefix("files/**")).toBe("files");
    expect(getPatternPrefix("a/b/*")).toBe("a/b");
  });

  it("returns empty string for parameterized patterns starting with param", () => {
    expect(getPatternPrefix("[topic]/observations")).toBe("");
  });

  it("extracts prefix before first param", () => {
    expect(getPatternPrefix("data/[topic]/observations")).toBe("data");
  });
});

// ---------------------------------------------------------------------------
// matchesPattern
// ---------------------------------------------------------------------------

describe("matchesPattern", () => {
  describe("single-level wildcard (*)", () => {
    const pattern = "files/*";

    it("matches single-segment paths", () => {
      expect(matchesPattern(pattern, "files/readme.md")).toBe(true);
      expect(matchesPattern(pattern, "files/utils.ts")).toBe(true);
    });

    it("does not match nested paths", () => {
      expect(matchesPattern(pattern, "files/src/utils.ts")).toBe(false);
    });

    it("does not match prefix alone", () => {
      expect(matchesPattern(pattern, "files")).toBe(false);
    });

    it("does not match empty segment", () => {
      expect(matchesPattern(pattern, "files/")).toBe(false);
    });
  });

  describe("deep wildcard (**)", () => {
    const pattern = "files/**";

    it("matches single-segment paths", () => {
      expect(matchesPattern(pattern, "files/readme.md")).toBe(true);
    });

    it("matches nested paths", () => {
      expect(matchesPattern(pattern, "files/src/utils.ts")).toBe(true);
      expect(matchesPattern(pattern, "files/src/deep/nested.ts")).toBe(true);
    });

    it("does not match prefix alone", () => {
      expect(matchesPattern(pattern, "files")).toBe(false);
    });
  });

  describe("parameterized patterns", () => {
    const pattern = "[topic]/observations";

    it("matches substituted paths", () => {
      expect(matchesPattern(pattern, "react/observations")).toBe(true);
      expect(matchesPattern(pattern, "rust/observations")).toBe(true);
    });

    it("does not match with extra segments", () => {
      expect(matchesPattern(pattern, "react/deep/observations")).toBe(false);
    });

    it("does not match if literal doesn't match", () => {
      expect(matchesPattern(pattern, "react/notes")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveCollectionKey
// ---------------------------------------------------------------------------

describe("resolveCollectionKey", () => {
  it("resolves string key for wildcard patterns", () => {
    expect(resolveCollectionKey("files/*", "readme.md")).toBe("files/readme.md");
    expect(resolveCollectionKey("files/**", "src/utils.ts")).toBe("files/src/utils.ts");
  });

  it("resolves object key for parameterized patterns", () => {
    expect(resolveCollectionKey("[topic]/observations", { topic: "react" }))
      .toBe("react/observations");
  });

  it("throws on missing parameter", () => {
    expect(() => resolveCollectionKey("[topic]/observations", {}))
      .toThrow('Missing parameter "topic"');
  });

  it("throws on object key for non-parameterized pattern", () => {
    expect(() => resolveCollectionKey("files/*", { key: "test" }))
      .toThrow("no parameters");
  });

  it("throws on string key for parameterized pattern", () => {
    expect(() => resolveCollectionKey("[topic]/observations", "react"))
      .toThrow("requires an object key");
  });
});

// ---------------------------------------------------------------------------
// normalizeResourcePath
// ---------------------------------------------------------------------------

describe("normalizeResourcePath", () => {
  it("normalizes backslashes to forward slashes", () => {
    expect(normalizeResourcePath("files\\src\\init.ts")).toBe("files/src/init.ts");
  });

  it("strips leading and trailing slashes", () => {
    expect(normalizeResourcePath("/files/src/")).toBe("files/src");
  });

  it("rejects path traversal", () => {
    expect(() => normalizeResourcePath("../../../etc/passwd")).toThrow("path traversal");
  });

  it("rejects null bytes", () => {
    expect(() => normalizeResourcePath("file\x00.ts")).toThrow("null bytes");
  });

  it("rejects control characters", () => {
    expect(() => normalizeResourcePath("file\x01.ts")).toThrow("null bytes or control");
  });

  it("rejects empty string", () => {
    expect(() => normalizeResourcePath("")).toThrow("non-empty");
  });

  it("allows spaces and unicode in filenames", () => {
    expect(normalizeResourcePath("docs/my guide.md")).toBe("docs/my guide.md");
    expect(normalizeResourcePath("docs/日本語.md")).toBe("docs/日本語.md");
  });

  it("collapses consecutive slashes", () => {
    expect(normalizeResourcePath("files//src///utils.ts")).toBe("files/src/utils.ts");
  });
});

// ---------------------------------------------------------------------------
// DeclaredResources integration
// ---------------------------------------------------------------------------

const fileSchema = z.object({ language: z.string() });
const filesCollection = defineResourceCollection({
  pattern: "files/**",
  scope: "session",
  stateSchema: fileSchema,
  maxInstances: 200,
});

const observationsResource = defineResource({
  scope: "session",
  stateSchema: z.object({
    entries: z.array(z.object({ text: z.string(), score: z.number() }))
  })
});

describe("DeclaredResources with collections", () => {
  it("extractDeclaredResources handles collection alongside static resource", () => {
    const result = extractDeclaredResources({
      resources: {
        observations: observationsResource,
        files: filesCollection,
      },
    });

    expect(result).toBeDefined();
    expect(result!.observations).toBe(observationsResource);
    expect(result!.files).toBe(filesCollection);
  });

  it("mergeDeclaredResources works with collections", () => {
    const target = { observations: observationsResource as any };
    const source = { files: filesCollection as any };
    const result = mergeDeclaredResources(target, source);

    expect(result).toEqual({
      observations: observationsResource,
      files: filesCollection,
    });
  });

  it("detects conflict when different collection refs share an accessor key", () => {
    const otherCollection = defineResourceCollection({
      pattern: "files/*",
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
    });

    const target = { files: filesCollection as any };
    const source = { files: otherCollection as any };
    expect(() => mergeDeclaredResources(target, source)).toThrow("Resource conflict");
  });

  it("allows same collection reference across blocks (no conflict)", () => {
    const target = { files: filesCollection as any };
    const source = { files: filesCollection as any };
    expect(() => mergeDeclaredResources(target, source)).not.toThrow();
  });
});

describe("handler with collection resources", () => {
  it("surfaces declaredResources from a flat resources map with collection", () => {
    const block = handler({
      name: "with-coll-resources",
      inputSchema: z.string(),
      outputSchema: z.string(),
      resources: {
        files: filesCollection,
        observations: observationsResource,
      },
      execute: (input) => input,
    });

    expect(block.declaredResources).toEqual({
      files: filesCollection,
      observations: observationsResource,
    });
  });

  it("still executes normally with collection in declaredResources", async () => {
    const block = handler({
      name: "exec-with-coll",
      inputSchema: z.string(),
      outputSchema: z.string(),
      resources: { files: filesCollection },
      execute: (input) => `processed:${input}`,
    });

    const ctx = createMockContext();
    await expect(runForTest(block, "test", ctx)).resolves.toBe("processed:test");
  });
});

describe("sequencer with collection resources", () => {
  it("collects collection resources from child blocks", () => {
    const blockA = handler({
      name: "a",
      resources: { files: filesCollection },
      execute: (v) => v,
    });
    const blockB = handler({
      name: "b",
      resources: { observations: observationsResource },
      execute: (v) => v,
    });

    const seq = sequencer({ name: "coll-seq" }).then(blockA).then(blockB);
    expect(seq.declaredResources).toEqual({
      files: filesCollection,
      observations: observationsResource,
    });
  });

  it("bubbles collection resources from nested sequencers", () => {
    const block = handler({
      name: "inner-step",
      resources: { files: filesCollection },
      execute: (v) => v,
    });
    const inner = sequencer({ name: "inner" }).then(block);
    const outer = sequencer({ name: "outer" }).then(inner);

    expect(outer.declaredResources).toEqual({ files: filesCollection });
  });
});

// ---------------------------------------------------------------------------
// Lifecycle hooks config
// ---------------------------------------------------------------------------

describe("lifecycle hooks", () => {
  it("accepts lifecycle hooks in config", () => {
    const created: string[] = [];
    const updated: string[] = [];
    const deleted: string[] = [];

    const coll = defineResourceCollection({
      pattern: "files/**",
      scope: "session",
      stateSchema: z.object({ lang: z.string().default("text") }),
      onInstanceCreated: (key) => { created.push(key); },
      onInstanceUpdated: (key) => { updated.push(key); },
      onInstanceDeleted: (key) => { deleted.push(key); },
    });

    expect(coll.onInstanceCreated).toBeDefined();
    expect(coll.onInstanceUpdated).toBeDefined();
    expect(coll.onInstanceDeleted).toBeDefined();
  });
});
