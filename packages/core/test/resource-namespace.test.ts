import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineResourceNamespace, isDefinedResourceNamespace } from "../src/types/resource-namespace";
import {
  normalizeResourcePath,
  resolveNamespaceKey,
  matchesPattern,
  getPatternPrefix,
  extractPatternParams,
  isParameterizedPattern,
  isDeepWildcard,
  isSingleWildcard,
} from "../src/types/namespace-patterns";
import { defineResource } from "../src/types/resource";
import { handler, sequencer } from "../src";
import { extractDeclaredResources, mergeDeclaredResources } from "../src/blocks/internal/build-block";
import { createMockContext } from "./helpers";

// ---------------------------------------------------------------------------
// defineResourceNamespace()
// ---------------------------------------------------------------------------

describe("defineResourceNamespace", () => {
  it("creates a namespace with single-level wildcard pattern", () => {
    const ns = defineResourceNamespace({
      pattern: "files/*",
      stateSchema: z.object({ language: z.string() }),
    });

    expect(ns.pattern).toBe("files/*");
    expect(ns.__brand).toBe("ResourceNamespace");
  });

  it("creates a namespace with deep wildcard pattern", () => {
    const ns = defineResourceNamespace({
      pattern: "files/**",
      stateSchema: z.object({ language: z.string() }),
      maxInstances: 200,
      eviction: "lru",
    });

    expect(ns.pattern).toBe("files/**");
    expect(ns.maxInstances).toBe(200);
    expect(ns.eviction).toBe("lru");
  });

  it("creates a namespace with parameterized pattern", () => {
    const ns = defineResourceNamespace({
      pattern: "[topic]/observations",
      stateSchema: z.object({ entries: z.array(z.string()).default([]) }),
      maxInstances: 50,
    });

    expect(ns.pattern).toBe("[topic]/observations");
    expect(ns.maxInstances).toBe(50);
  });

  it("throws on invalid pattern (empty)", () => {
    expect(() =>
      defineResourceNamespace({
        pattern: "",
        stateSchema: z.object({}),
      })
    ).toThrow("non-empty");
  });

  it("throws when ** is not the last segment", () => {
    expect(() =>
      defineResourceNamespace({
        pattern: "files/**/extra",
        stateSchema: z.object({}),
      })
    ).toThrow("last segment");
  });

  it("throws when maxInstances is < 1", () => {
    expect(() =>
      defineResourceNamespace({
        pattern: "files/*",
        stateSchema: z.object({}),
        maxInstances: 0,
      })
    ).toThrow("maxInstances must be >= 1");
  });

  it("throws when eviction is set without maxInstances", () => {
    expect(() =>
      defineResourceNamespace({
        pattern: "files/*",
        stateSchema: z.object({}),
        eviction: "lru",
      })
    ).toThrow("eviction requires maxInstances");
  });

  it("allows eviction: 'none' without maxInstances", () => {
    expect(() =>
      defineResourceNamespace({
        pattern: "files/*",
        stateSchema: z.object({}),
        eviction: "none",
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isDefinedResourceNamespace
// ---------------------------------------------------------------------------

describe("isDefinedResourceNamespace", () => {
  it("returns true for namespace definitions", () => {
    const ns = defineResourceNamespace({
      pattern: "files/*",
      stateSchema: z.object({}),
    });
    expect(isDefinedResourceNamespace(ns)).toBe(true);
  });

  it("returns false for static resource definitions", () => {
    const res = defineResource({
      stateSchema: z.object({ value: z.string() }),
    });
    expect(isDefinedResourceNamespace(res)).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isDefinedResourceNamespace(null)).toBe(false);
    expect(isDefinedResourceNamespace(undefined)).toBe(false);
    expect(isDefinedResourceNamespace("string")).toBe(false);
    expect(isDefinedResourceNamespace(42)).toBe(false);
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
// resolveNamespaceKey
// ---------------------------------------------------------------------------

describe("resolveNamespaceKey", () => {
  it("resolves string key for wildcard patterns", () => {
    expect(resolveNamespaceKey("files/*", "readme.md")).toBe("files/readme.md");
    expect(resolveNamespaceKey("files/**", "src/utils.ts")).toBe("files/src/utils.ts");
  });

  it("resolves object key for parameterized patterns", () => {
    expect(resolveNamespaceKey("[topic]/observations", { topic: "react" }))
      .toBe("react/observations");
  });

  it("throws on missing parameter", () => {
    expect(() => resolveNamespaceKey("[topic]/observations", {}))
      .toThrow('Missing parameter "topic"');
  });

  it("throws on object key for non-parameterized pattern", () => {
    expect(() => resolveNamespaceKey("files/*", { key: "test" }))
      .toThrow("no parameters");
  });

  it("throws on string key for parameterized pattern", () => {
    expect(() => resolveNamespaceKey("[topic]/observations", "react"))
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
const filesNamespace = defineResourceNamespace({
  pattern: "files/**",
  stateSchema: fileSchema,
  maxInstances: 200,
});

const observationsResource = defineResource({
  stateSchema: z.object({
    entries: z.array(z.object({ text: z.string(), score: z.number() }))
  })
});

describe("DeclaredResources with namespaces", () => {
  it("extractDeclaredResources handles namespace alongside static resource", () => {
    const result = extractDeclaredResources({
      sessionResources: {
        observations: observationsResource,
        files: filesNamespace,
      },
    });

    expect(result).toBeDefined();
    expect(result!.session!.observations).toBe(observationsResource);
    expect(result!.session!.files).toBe(filesNamespace);
  });

  it("mergeDeclaredResources works with namespaces", () => {
    const target = { session: { observations: observationsResource as any } };
    const source = { session: { files: filesNamespace as any } };
    const result = mergeDeclaredResources(target, source);

    expect(result).toEqual({
      session: { observations: observationsResource, files: filesNamespace },
    });
  });

  it("detects conflict when different namespace refs share a name", () => {
    const otherNamespace = defineResourceNamespace({
      pattern: "files/*",
      stateSchema: z.object({ name: z.string() }),
    });

    const target = { session: { files: filesNamespace as any } };
    const source = { session: { files: otherNamespace as any } };
    expect(() => mergeDeclaredResources(target, source)).toThrow("Resource conflict");
  });

  it("allows same namespace reference across blocks (no conflict)", () => {
    const target = { session: { files: filesNamespace as any } };
    const source = { session: { files: filesNamespace as any } };
    expect(() => mergeDeclaredResources(target, source)).not.toThrow();
  });
});

describe("handler with namespace resources", () => {
  it("surfaces declaredResources from sessionResources with namespace", () => {
    const block = handler({
      name: "with-ns-resources",
      inputSchema: z.string(),
      outputSchema: z.string(),
      sessionResources: {
        files: filesNamespace,
        observations: observationsResource,
      },
      execute: (input) => input,
    });

    expect(block.declaredResources).toEqual({
      session: { files: filesNamespace, observations: observationsResource },
    });
  });

  it("still executes normally with namespace in declaredResources", async () => {
    const block = handler({
      name: "exec-with-ns",
      inputSchema: z.string(),
      outputSchema: z.string(),
      sessionResources: { files: filesNamespace },
      execute: (input) => `processed:${input}`,
    });

    const ctx = createMockContext();
    await expect(block.run("test", ctx)).resolves.toBe("processed:test");
  });
});

describe("sequencer with namespace resources", () => {
  it("collects namespace resources from child blocks", () => {
    const blockA = handler({
      name: "a",
      sessionResources: { files: filesNamespace },
      execute: (v) => v,
    });
    const blockB = handler({
      name: "b",
      sessionResources: { observations: observationsResource },
      execute: (v) => v,
    });

    const seq = sequencer({ name: "ns-seq" }).then(blockA).then(blockB);
    expect(seq.declaredResources).toEqual({
      session: { files: filesNamespace, observations: observationsResource },
    });
  });

  it("bubbles namespace resources from nested sequencers", () => {
    const block = handler({
      name: "inner-step",
      sessionResources: { files: filesNamespace },
      execute: (v) => v,
    });
    const inner = sequencer({ name: "inner" }).then(block);
    const outer = sequencer({ name: "outer" }).then(inner);

    expect(outer.declaredResources).toEqual({
      session: { files: filesNamespace },
    });
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

    const ns = defineResourceNamespace({
      pattern: "files/**",
      stateSchema: z.object({ lang: z.string().default("text") }),
      onInstanceCreated: (key) => { created.push(key); },
      onInstanceUpdated: (key) => { updated.push(key); },
      onInstanceDeleted: (key) => { deleted.push(key); },
    });

    expect(ns.onInstanceCreated).toBeDefined();
    expect(ns.onInstanceUpdated).toBeDefined();
    expect(ns.onInstanceDeleted).toBeDefined();
  });
});
