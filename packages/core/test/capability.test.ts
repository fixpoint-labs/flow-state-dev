/**
 * Unit tests for the capability system: defineCapability(), flatten, resolve,
 * merge, and block-resource merging.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineCapability,
  flattenCapabilities,
  getBaseCapability,
  resolveActivePresets,
  mergeSurfaceInto,
  mergeCapabilities,
  mergeWithBlockResources,
  extractMergedResources,
} from "../src/capability";
import { createEmptyMergedSurface } from "../src/capability/merge";
import type { MergedCapabilitySurface } from "../src/capability";
import type { BlockKind } from "../src/types/block";
import { defineResource } from "../src/types/resource";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const testResource = defineResource({
  scope: "session",
  stateSchema: z.object({ value: z.string() }),
});

const otherResource = defineResource({
  scope: "user",
  stateSchema: z.object({ count: z.number() }),
});

// ---------------------------------------------------------------------------
// defineCapability()
// ---------------------------------------------------------------------------

describe("defineCapability", () => {
  it("returns a branded object with __brand === 'Capability'", () => {
    const cap = defineCapability({ name: "test" });
    expect(cap.__brand).toBe("Capability");
  });

  it("preserves the name", () => {
    const cap = defineCapability({ name: "my-cap" });
    expect(cap.name).toBe("my-cap");
  });

  it("throws on empty name", () => {
    expect(() => defineCapability({ name: "" })).toThrow(
      "defineCapability() requires a non-empty name"
    );
  });

  it("throws on whitespace-only name", () => {
    expect(() => defineCapability({ name: "   " })).toThrow(
      "defineCapability() requires a non-empty name"
    );
  });

  it("preserves flat resources map", () => {
    const cap = defineCapability({
      name: "res-cap",
      resources: { data: testResource },
    });
    expect(cap.resources).toEqual({ data: testResource });
  });

  it("preserves fns factory", () => {
    const fnFactory = () => ({ doThing: () => 42 });
    const cap = defineCapability({
      name: "fns-cap",
      fns: fnFactory,
    });
    expect(cap.fns).toBe(fnFactory);
  });

  it(".presets() returns a new object via Object.create (does not mutate original)", () => {
    const cap = defineCapability({
      name: "preset-cap",
      presets: {
        alpha: { resources: { data: testResource } },
      },
    });

    const configured = cap.presets({ alpha: false });
    expect(configured).not.toBe(cap);
    // Original should not have __presetOverrides
    expect("__presetOverrides" in cap).toBe(false);
    expect("__presetOverrides" in configured).toBe(true);
  });

  it("getBaseCapability() recovers original reference via Object.getPrototypeOf()", () => {
    const cap = defineCapability({
      name: "base-test",
      presets: {
        beta: { resources: { data: testResource } },
      },
    });

    const configured = cap.presets({ beta: true });
    const base = getBaseCapability(configured);
    expect(base).toBe(cap);
  });

  it("getBaseCapability() returns the same ref for an unconfigured capability", () => {
    const cap = defineCapability({ name: "plain" });
    expect(getBaseCapability(cap)).toBe(cap);
  });

  it("stores raw presets in __presetDefs", () => {
    const presetDef = { resources: { data: testResource } };
    const cap = defineCapability({
      name: "preset-store",
      presets: { alpha: presetDef },
    });
    expect(cap.__presetDefs).toBeDefined();
    expect((cap.__presetDefs as any).alpha).toBe(presetDef);
  });
});

// ---------------------------------------------------------------------------
// flattenCapabilities()
// ---------------------------------------------------------------------------

describe("flattenCapabilities", () => {
  it("flattens a single capability", () => {
    const cap = defineCapability({ name: "solo" });
    const result = flattenCapabilities([cap]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(cap);
  });

  it("flattens multiple capabilities with no overlap", () => {
    const a = defineCapability({ name: "a" });
    const b = defineCapability({ name: "b" });
    const result = flattenCapabilities([a, b]);
    expect(result).toHaveLength(2);
  });

  it("deduplicates diamond dependencies (A uses B, C uses B → B appears once)", () => {
    const shared = defineCapability({ name: "shared" });
    const a = defineCapability({ name: "a", uses: [shared] });
    const c = defineCapability({ name: "c", uses: [shared] });

    const result = flattenCapabilities([a, c]);
    const names = result.map((r) => getBaseCapability(r).name);
    expect(names.filter((n) => n === "shared")).toHaveLength(1);
    expect(names).toContain("a");
    expect(names).toContain("c");
  });

  it("returns dependencies before dependents (dependency order)", () => {
    const dep = defineCapability({ name: "dep" });
    const main = defineCapability({ name: "main", uses: [dep] });
    const result = flattenCapabilities([main]);
    const names = result.map((r) => getBaseCapability(r).name);
    expect(names.indexOf("dep")).toBeLessThan(names.indexOf("main"));
  });

  it("throws on cycles (A uses B, B uses A)", () => {
    // Because uses is readonly, we have to build the cycle manually.
    const a: any = defineCapability({ name: "a" });
    const b: any = defineCapability({ name: "b", uses: [a] });
    // Patch 'a' to have uses: [b]
    a.uses = [b];

    expect(() => flattenCapabilities([a])).toThrow(
      'Capability cycle detected: "a" depends on itself (transitively)'
    );
  });

  it("throws on same-name collision from different defineCapability() calls", () => {
    const first = defineCapability({ name: "clash" });
    const second = defineCapability({ name: "clash" });

    expect(() => flattenCapabilities([first, second])).toThrow(
      "Capability name collision"
    );
  });

  it("allows the same configured capability in multiple spots (diamond with .presets())", () => {
    const shared = defineCapability({
      name: "shared",
      presets: { x: { resources: { data: testResource } } },
    });
    const configuredShared = shared.presets({ x: true });
    const a = defineCapability({ name: "a", uses: [configuredShared] });
    const b = defineCapability({ name: "b", uses: [shared] });

    // Both reference the same base capability — should not throw
    const result = flattenCapabilities([a, b]);
    const names = result.map((r) => getBaseCapability(r).name);
    expect(names.filter((n) => n === "shared")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolveActivePresets()
// ---------------------------------------------------------------------------

describe("resolveActivePresets", () => {
  it("returns empty array when capability has no presets", () => {
    const cap = defineCapability({ name: "no-presets" });
    expect(resolveActivePresets(cap)).toEqual([]);
  });

  it("activates all presets by default (no default array)", () => {
    const cap = defineCapability({
      name: "all-default",
      presets: {
        alpha: { resources: { a: testResource } },
        beta: { resources: { b: otherResource } },
      },
    });

    const active = resolveActivePresets(cap);
    const names = active.map((a) => a.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });

  it("respects explicit default array", () => {
    const cap = defineCapability({
      name: "explicit-default",
      presets: {
        alpha: { resources: { a: testResource } },
        beta: { resources: { b: otherResource } },
        default: ["alpha"],
      },
    });

    const active = resolveActivePresets(cap);
    const names = active.map((a) => a.name);
    expect(names).toContain("alpha");
    expect(names).not.toContain("beta");
  });

  it("boolean override turns preset off", () => {
    const cap = defineCapability({
      name: "bool-off",
      presets: {
        alpha: { resources: { a: testResource } },
        beta: { resources: { b: otherResource } },
      },
    });

    const configured = cap.presets({ alpha: false });
    const active = resolveActivePresets(configured);
    const names = active.map((a) => a.name);
    expect(names).not.toContain("alpha");
    expect(names).toContain("beta");
  });

  it("boolean override turns non-default preset on", () => {
    const cap = defineCapability({
      name: "bool-on",
      presets: {
        alpha: { resources: { a: testResource } },
        beta: { resources: { b: otherResource } },
        default: ["alpha"],
      },
    });

    const configured = cap.presets({ beta: true });
    const active = resolveActivePresets(configured);
    const names = active.map((a) => a.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });

  it("function-form override transforms preset", () => {
    const extraResource = defineResource({
      scope: "session",
      stateSchema: z.object({ extra: z.boolean() }),
    });

    const cap = defineCapability({
      name: "fn-override",
      presets: {
        alpha: { resources: { a: testResource } },
      },
    });

    const configured = cap.presets({
      alpha: (preset) => ({
        ...preset,
        resources: { ...preset.resources, extra: extraResource },
      }),
    });

    const active = resolveActivePresets(configured);
    expect(active).toHaveLength(1);
    expect(active[0].preset.resources).toHaveProperty("a");
    expect(active[0].preset.resources).toHaveProperty("extra");
    expect(active[0].preset.resources!.extra).toBe(extraResource);
  });

  it("throws on unknown preset name in overrides", () => {
    const cap = defineCapability({
      name: "unknown-preset",
      presets: {
        alpha: { resources: { a: testResource } },
      },
    });

    const configured = cap.presets({ nonexistent: true } as any);
    expect(() => resolveActivePresets(configured)).toThrow(
      'Unknown preset "nonexistent" on capability "unknown-preset"'
    );
  });
});

// ---------------------------------------------------------------------------
// mergeSurfaceInto()
// ---------------------------------------------------------------------------

describe("mergeSurfaceInto", () => {
  function makeSurface(): MergedCapabilitySurface {
    return createEmptyMergedSurface();
  }

  it("merges resources from a flat resources map", () => {
    const acc = makeSurface();
    mergeSurfaceInto(
      acc,
      { resources: { data: testResource } },
      "handler",
      "test-cap",
      "preset-a"
    );
    expect(acc.resources).toEqual({ data: testResource });
  });

  it("merges multiple disjoint accessor keys", () => {
    const acc = makeSurface();
    mergeSurfaceInto(
      acc,
      { resources: { data: testResource } },
      "handler",
      "cap",
      "p1"
    );
    mergeSurfaceInto(
      acc,
      { resources: { other: otherResource } },
      "handler",
      "cap",
      "p2"
    );
    expect(acc.resources).toEqual({
      data: testResource,
      other: otherResource,
    });
  });

  it("deduplicates same resource reference", () => {
    const acc = makeSurface();
    mergeSurfaceInto(
      acc,
      { resources: { data: testResource } },
      "handler",
      "cap",
      "p1"
    );
    // Same name, same reference — should not throw
    mergeSurfaceInto(
      acc,
      { resources: { data: testResource } },
      "handler",
      "cap",
      "p2"
    );
    expect(acc.resources!.data).toBe(testResource);
  });

  it("throws on different resource references with same accessor key", () => {
    const acc = makeSurface();
    mergeSurfaceInto(
      acc,
      { resources: { data: testResource } },
      "handler",
      "cap",
      "p1"
    );
    expect(() =>
      mergeSurfaceInto(
        acc,
        { resources: { data: otherResource } },
        "handler",
        "cap",
        "p2"
      )
    ).toThrow("Resource conflict");
  });

  it("extends session state schema using .extend()", () => {
    const acc = makeSurface();
    const schema1 = z.object({ a: z.string() });
    const schema2 = z.object({ b: z.number() });
    mergeSurfaceInto(
      acc,
      { sessionStateSchema: schema1 },
      "handler",
      "cap",
      "p1"
    );
    mergeSurfaceInto(
      acc,
      { sessionStateSchema: schema2 },
      "handler",
      "cap",
      "p2"
    );
    // The merged schema should accept both a and b
    const result = acc.sessionStateSchema!;
    const parsed = (result as any).parse({ a: "hello", b: 42 });
    expect(parsed).toEqual({ a: "hello", b: 42 });
  });

  it("extends request state schema", () => {
    const acc = makeSurface();
    const schema1 = z.object({ x: z.string() });
    const schema2 = z.object({ y: z.number() });
    mergeSurfaceInto(
      acc,
      { requestStateSchema: schema1 },
      "handler",
      "cap",
      "p1"
    );
    mergeSurfaceInto(
      acc,
      { requestStateSchema: schema2 },
      "handler",
      "cap",
      "p2"
    );
    const parsed = (acc.requestStateSchema as any).parse({ x: "hi", y: 7 });
    expect(parsed).toEqual({ x: "hi", y: 7 });
  });

  // --- sequencerStateSchema block-kind compat ---

  it("allows sequencerStateSchema on sequencer blocks", () => {
    const acc = makeSurface();
    const schema = z.object({ step: z.number() });
    expect(() =>
      mergeSurfaceInto(
        acc,
        { sequencerStateSchema: schema },
        "sequencer",
        "cap",
        "p1"
      )
    ).not.toThrow();
    expect(acc.sequencerStateSchema).toBeDefined();
  });

  it("throws sequencerStateSchema on handler", () => {
    const acc = makeSurface();
    expect(() =>
      mergeSurfaceInto(
        acc,
        { sequencerStateSchema: z.object({ step: z.number() }) },
        "handler",
        "my-cap",
        "bad-preset"
      )
    ).toThrow("sequencerStateSchema");
    // Check it includes cap and preset name in the error
  });

  it("throws sequencerStateSchema on generator", () => {
    const acc = makeSurface();
    expect(() =>
      mergeSurfaceInto(
        acc,
        { sequencerStateSchema: z.object({ step: z.number() }) },
        "generator",
        "my-cap",
        "bad-preset"
      )
    ).toThrow('Capability "my-cap" preset "bad-preset"');
  });

  it("throws sequencerStateSchema on router", () => {
    const acc = makeSurface();
    expect(() =>
      mergeSurfaceInto(
        acc,
        { sequencerStateSchema: z.object({ step: z.number() }) },
        "router",
        "my-cap",
        "bad-preset"
      )
    ).toThrow("sequencerStateSchema is only valid on sequencer blocks");
  });

  // --- context block-kind compat ---

  it("allows context on generator blocks", () => {
    const acc = makeSurface();
    const ctxEntry = () => "context string";
    expect(() =>
      mergeSurfaceInto(
        acc,
        { context: ctxEntry },
        "generator",
        "cap",
        "p1"
      )
    ).not.toThrow();
    expect(acc.contextEntries).toHaveLength(1);
    expect(acc.contextEntries[0]).toBe(ctxEntry);
  });

  it("accepts array-form context", () => {
    const acc = makeSurface();
    const entry1 = () => "a";
    const entry2 = () => "b";
    mergeSurfaceInto(
      acc,
      { context: [entry1, entry2] },
      "generator",
      "cap",
      "p1"
    );
    expect(acc.contextEntries).toHaveLength(2);
  });

  it("throws context on non-generator", () => {
    for (const kind of ["handler", "sequencer", "router"] as BlockKind[]) {
      const acc = makeSurface();
      expect(() =>
        mergeSurfaceInto(
          acc,
          { context: () => "ctx" },
          kind,
          "ctx-cap",
          "ctx-preset"
        )
      ).toThrow(`context is only valid on generator blocks`);
    }
  });

  it("context error includes capability and preset name", () => {
    const acc = makeSurface();
    expect(() =>
      mergeSurfaceInto(
        acc,
        { context: () => "ctx" },
        "handler",
        "my-cap",
        "my-preset"
      )
    ).toThrow('Capability "my-cap" preset "my-preset"');
  });

  // --- tools block-kind compat ---

  it("allows tools on generator blocks", () => {
    const acc = makeSurface();
    const tools = [{ name: "tool1" }] as any;
    expect(() =>
      mergeSurfaceInto(
        acc,
        { tools },
        "generator",
        "cap",
        "p1"
      )
    ).not.toThrow();
    expect(acc.toolEntries).toHaveLength(1);
  });

  it("throws tools on non-generator", () => {
    for (const kind of ["handler", "sequencer", "router"] as BlockKind[]) {
      const acc = makeSurface();
      expect(() =>
        mergeSurfaceInto(
          acc,
          { tools: [] },
          kind,
          "tool-cap",
          "tool-preset"
        )
      ).toThrow(`tools is only valid on generator blocks`);
    }
  });

  it("tools error includes capability and preset name", () => {
    const acc = makeSurface();
    expect(() =>
      mergeSurfaceInto(
        acc,
        { tools: [] },
        "handler",
        "my-cap",
        "my-preset"
      )
    ).toThrow('Capability "my-cap" preset "my-preset"');
  });

  // --- block-kind-agnostic fields work on every kind ---

  it("resources work on every block kind", () => {
    for (const kind of ["handler", "generator", "sequencer", "router"] as BlockKind[]) {
      const acc = makeSurface();
      expect(() =>
        mergeSurfaceInto(
          acc,
          { resources: { data: testResource } },
          kind,
          "cap",
          "p1"
        )
      ).not.toThrow();
      expect(acc.resources).toEqual({ data: testResource });
    }
  });

  it("sessionStateSchema works on every block kind", () => {
    for (const kind of ["handler", "generator", "sequencer", "router"] as BlockKind[]) {
      const acc = makeSurface();
      const schema = z.object({ x: z.string() });
      expect(() =>
        mergeSurfaceInto(
          acc,
          { sessionStateSchema: schema },
          kind,
          "cap",
          "p1"
        )
      ).not.toThrow();
      expect(acc.sessionStateSchema).toBeDefined();
    }
  });

  it("targetStateSchemas work on every block kind", () => {
    for (const kind of ["handler", "generator", "sequencer", "router"] as BlockKind[]) {
      const acc = makeSurface();
      const schema = z.object({ val: z.number() });
      expect(() =>
        mergeSurfaceInto(
          acc,
          { targetStateSchemas: { myTarget: schema } },
          kind,
          "cap",
          "p1"
        )
      ).not.toThrow();
      expect(acc.targetStateSchemas).toEqual({ myTarget: schema });
    }
  });

  it("throws on target state schema conflict (different references, same name)", () => {
    const acc = makeSurface();
    const schema1 = z.object({ val: z.number() });
    const schema2 = z.object({ val: z.string() });
    mergeSurfaceInto(
      acc,
      { targetStateSchemas: { target: schema1 } },
      "handler",
      "cap",
      "p1"
    );
    expect(() =>
      mergeSurfaceInto(
        acc,
        { targetStateSchemas: { target: schema2 } },
        "handler",
        "cap",
        "p2"
      )
    ).toThrow("Target conflict");
  });

  it("deduplicates same target schema reference", () => {
    const acc = makeSurface();
    const schema = z.object({ val: z.number() });
    mergeSurfaceInto(
      acc,
      { targetStateSchemas: { target: schema } },
      "handler",
      "cap",
      "p1"
    );
    expect(() =>
      mergeSurfaceInto(
        acc,
        { targetStateSchemas: { target: schema } },
        "handler",
        "cap",
        "p2"
      )
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// mergeCapabilities()
// ---------------------------------------------------------------------------

describe("mergeCapabilities", () => {
  it("merges required surface from a capability", () => {
    const cap = defineCapability({
      name: "res-cap",
      resources: { data: testResource },
    });

    const surface = mergeCapabilities([cap], "handler");
    expect(surface.resources).toEqual({ data: testResource });
  });

  it("merges active preset surfaces", () => {
    const cap = defineCapability({
      name: "preset-cap",
      presets: {
        alpha: { resources: { other: otherResource } },
      },
    });

    const surface = mergeCapabilities([cap], "handler");
    expect(surface.resources).toEqual({ other: otherResource });
  });

  it("skips disabled preset surfaces", () => {
    const cap = defineCapability({
      name: "skip-cap",
      presets: {
        alpha: { resources: { other: otherResource } },
      },
    });

    const configured = cap.presets({ alpha: false });
    const surface = mergeCapabilities([configured], "handler");
    expect(surface.resources).toBeUndefined();
  });

  it("merges multiple capabilities together", () => {
    const cap1 = defineCapability({
      name: "cap1",
      resources: { data: testResource },
    });
    const cap2 = defineCapability({
      name: "cap2",
      resources: { other: otherResource },
    });

    const surface = mergeCapabilities([cap1, cap2], "handler");
    expect(surface.resources).toEqual({
      data: testResource,
      other: otherResource,
    });
  });

  it("merges state schemas from required surface and presets", () => {
    const cap = defineCapability({
      name: "schema-cap",
      sessionStateSchema: z.object({ a: z.string() }),
      presets: {
        extra: { sessionStateSchema: z.object({ b: z.number() }) },
      },
    });

    const surface = mergeCapabilities([cap], "handler");
    const parsed = (surface.sessionStateSchema as any).parse({
      a: "hello",
      b: 42,
    });
    expect(parsed).toEqual({ a: "hello", b: 42 });
  });

  it("throws when generator-only fields are merged into non-generator", () => {
    const cap = defineCapability({
      name: "gen-cap",
      presets: {
        ctx: { context: () => "data" },
      },
    });

    expect(() => mergeCapabilities([cap], "handler")).toThrow(
      "context is only valid on generator blocks"
    );
  });
});

// ---------------------------------------------------------------------------
// extractMergedResources()
// ---------------------------------------------------------------------------

describe("extractMergedResources", () => {
  it("returns undefined when no resources are set", () => {
    const surface = createEmptyMergedSurface();
    expect(extractMergedResources(surface)).toBeUndefined();
  });

  it("extracts the flat resources map", () => {
    const surface = createEmptyMergedSurface();
    surface.resources = { data: testResource };
    const result = extractMergedResources(surface);
    expect(result).toEqual({ data: testResource });
  });

  it("extracts a multi-scope flat resources map", () => {
    const surface = createEmptyMergedSurface();
    surface.resources = {
      data: testResource,
      other: otherResource,
    };
    const result = extractMergedResources(surface);
    expect(result).toEqual({
      data: testResource,
      other: otherResource,
    });
  });
});

// ---------------------------------------------------------------------------
// mergeWithBlockResources()
// ---------------------------------------------------------------------------

describe("mergeWithBlockResources", () => {
  it("returns blockResources when capResources is undefined", () => {
    const block = { data: testResource };
    expect(mergeWithBlockResources(undefined, block)).toBe(block);
  });

  it("returns capResources when blockResources is undefined", () => {
    const cap = { data: testResource };
    expect(mergeWithBlockResources(cap, undefined)).toBe(cap);
  });

  it("returns undefined when both are undefined", () => {
    expect(mergeWithBlockResources(undefined, undefined)).toBeUndefined();
  });

  it("merges disjoint accessor keys across scopes", () => {
    const cap = { data: testResource };
    const block = { other: otherResource };
    const result = mergeWithBlockResources(cap, block);
    expect(result).toEqual({
      data: testResource,
      other: otherResource,
    });
  });

  it("allows same resource reference under the same accessor (dedup)", () => {
    const cap = { data: testResource };
    const block = { data: testResource };
    expect(() => mergeWithBlockResources(cap, block)).not.toThrow();
    const result = mergeWithBlockResources(cap, block);
    expect(result!.data).toBe(testResource);
  });

  it("throws on different resource references with same accessor", () => {
    const cap = { data: testResource };
    const block = { data: otherResource };
    expect(() => mergeWithBlockResources(cap, block)).toThrow(
      "Resource conflict"
    );
  });

  it("throws with descriptive error on reference mismatch", () => {
    const cap = { data: testResource };
    const block = { data: otherResource };
    expect(() => mergeWithBlockResources(cap, block)).toThrow(
      'different defineResource() references'
    );
  });
});
