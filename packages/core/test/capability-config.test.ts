/**
 * Tests for open config on capabilities (FIX-915): the `.config(value)` builder,
 * the config resolver, its composition with presets, base-identity preservation,
 * validation/error paths, diamond conflict detection, and the dynamic-uses
 * runtime rejection.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineCapability,
  flattenCapabilities,
  getBaseCapability,
  mergeCapabilities,
} from "../src/capability";
import { generator } from "../src/blocks/generator";
import { handler } from "../src/blocks/handler";

// A representative configured capability: a schema with an optional (defaulted)
// field, and a resolver that maps the parsed value onto generator context.
const banner = defineCapability({
  name: "banner",
  config: {
    schema: z.object({ note: z.string(), loud: z.boolean().default(false) }),
    resolve: (cfg) => ({ context: [cfg.loud ? cfg.note.toUpperCase() : cfg.note] }),
  },
});

// ---------------------------------------------------------------------------
// Builder — base identity & immutability
// ---------------------------------------------------------------------------

describe(".config() builder", () => {
  it("produces a ref one hop from the base, carrying __config as an own prop", () => {
    const configured = banner.config({ note: "hi" });
    expect(Object.getPrototypeOf(configured)).toBe(banner);
    expect(getBaseCapability(configured as never)).toBe(banner);
    expect(Object.prototype.hasOwnProperty.call(configured, "__config")).toBe(true);
    expect((configured as { __config: unknown }).__config).toEqual({ note: "hi" });
  });

  it("does not mutate the base capability", () => {
    banner.config({ note: "hi" });
    expect("__config" in banner).toBe(false);
  });

  it("dedups a base against its configured ref by identity (diamond)", () => {
    const configured = banner.config({ note: "hi" });
    const parentA = defineCapability({ name: "pa", uses: [configured] });
    const parentB = defineCapability({ name: "pb", uses: [configured] });
    const flat = flattenCapabilities([parentA, parentB]);
    // banner appears once despite two paths reaching it.
    expect(flat.filter((c) => getBaseCapability(c as never).name === "banner")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Resolver output reaches the merged surface (the goal)
// ---------------------------------------------------------------------------

describe("config resolver → merged surface", () => {
  it("resolver output merges into contextEntries", () => {
    const merged = mergeCapabilities([banner.config({ note: "hello-915", loud: true })], "generator");
    expect(merged.contextEntries).toContain("HELLO-915");
  });

  it("the parsed (z.output) value is passed to the resolver — defaulted field present", () => {
    // `loud` omitted at the call site; the resolver still sees the default.
    const merged = mergeCapabilities([banner.config({ note: "hello-915" })], "generator");
    expect(merged.contextEntries).toContain("hello-915");
  });

  it("resolver-emitted tools merge into toolEntries", () => {
    const toolCap = defineCapability({
      name: "tooler",
      config: {
        schema: z.object({ id: z.string() }),
        resolve: (cfg) => ({ tools: [{ name: `tool-${cfg.id}` } as never] }),
      },
    });
    const merged = mergeCapabilities([toolCap.config({ id: "a" })], "generator");
    expect(merged.toolEntries).toHaveLength(1);
  });

  it("resolver-contributed sessionStateSchema is merged", () => {
    const stateCap = defineCapability({
      name: "stateful",
      config: {
        schema: z.object({ on: z.boolean() }),
        resolve: () => ({ sessionStateSchema: z.object({ flag: z.boolean() }) }),
      },
    });
    const merged = mergeCapabilities([stateCap.config({ on: true })], "generator");
    expect(merged.sessionStateSchema).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Resolver sees active preset names (owns override-vs-add semantics)
// ---------------------------------------------------------------------------

describe("resolver ctx.presets", () => {
  // A skills-like capability: a flag preset plus config; the resolver reads the
  // active preset set to decide how the config value is applied.
  const skills = defineCapability({
    name: "skills-like",
    presets: {
      dynamicActivation: {},
      default: [],
    },
    config: {
      schema: z.object({ allowed: z.array(z.string()).default([]) }),
      resolve: (cfg, ctx) => ({
        context: [
          `${ctx.presets.has("dynamicActivation") ? "dynamic" : "static"}:${cfg.allowed.join(",")}`,
        ],
      }),
    },
  });

  it("resolver sees no preset active by default", () => {
    const merged = mergeCapabilities([skills.config({ allowed: ["research"] })], "generator");
    expect(merged.contextEntries).toContain("static:research");
  });

  it("resolver sees a preset turned on via .presets()", () => {
    const merged = mergeCapabilities(
      [skills.config({ allowed: ["research"] }).presets({ dynamicActivation: true })],
      "generator",
    );
    expect(merged.contextEntries).toContain("dynamic:research");
  });
});

// ---------------------------------------------------------------------------
// Composition with presets — both chain orders
// ---------------------------------------------------------------------------

describe("chaining .config() and .presets()", () => {
  const both = defineCapability({
    name: "both",
    presets: { extra: {}, default: [] },
    config: {
      schema: z.object({ note: z.string() }),
      resolve: (cfg, ctx) => ({ context: [`${cfg.note}:${ctx.presets.has("extra")}`] }),
    },
  });

  it(".config().presets() carries both fields, one hop from base", () => {
    const ref = both.config({ note: "x" }).presets({ extra: true });
    expect(getBaseCapability(ref as never)).toBe(both);
    expect(Object.prototype.hasOwnProperty.call(ref, "__config")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(ref, "__presetOverrides")).toBe(true);
  });

  it(".presets().config() carries both fields, one hop from base", () => {
    const ref = both.presets({ extra: true }).config({ note: "x" });
    expect(getBaseCapability(ref as never)).toBe(both);
    expect(Object.prototype.hasOwnProperty.call(ref, "__config")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(ref, "__presetOverrides")).toBe(true);
  });

  it("both chain orders produce the same merged surface", () => {
    const a = mergeCapabilities([both.config({ note: "x" }).presets({ extra: true })], "generator");
    const b = mergeCapabilities([both.presets({ extra: true }).config({ note: "x" })], "generator");
    expect(a.contextEntries).toEqual(b.contextEntries);
    expect(a.contextEntries).toContain("x:true");
  });
});

// ---------------------------------------------------------------------------
// Validation & error paths
// ---------------------------------------------------------------------------

describe("config validation errors", () => {
  it("throws on invalid config against the schema", () => {
    expect(() =>
      mergeCapabilities([banner.config({ note: 123 as never })], "generator"),
    ).toThrow(/Invalid config for capability "banner"/);
  });

  it("runs the resolver with defaults when the schema accepts an absent value", () => {
    const defaulted = defineCapability({
      name: "defaulted",
      config: {
        schema: z.object({ label: z.string().default("fallback") }).default({}),
        resolve: (cfg) => ({ context: [cfg.label] }),
      },
    });
    // No .config() call — top-level .default({}) lets the resolver run.
    const merged = mergeCapabilities([defaulted], "generator");
    expect(merged.contextEntries).toContain("fallback");
  });

  it("throws when a schema that rejects undefined is used without .config()", () => {
    // banner's schema requires `note`, so an absent value is a build-time error.
    expect(() => mergeCapabilities([banner], "generator")).toThrow(
      /Capability "banner" requires configuration/,
    );
  });

  it("throws when schemaless config is used without .config()", () => {
    const schemaless = defineCapability({
      name: "schemaless",
      config: { resolve: (cfg: { note: string }) => ({ context: [cfg.note] }) },
    });
    expect(() => mergeCapabilities([schemaless], "generator")).toThrow(
      /declares schemaless config and must be used with .config/,
    );
  });

  it("runs a schemaless resolver when .config() is provided", () => {
    const schemaless = defineCapability({
      name: "schemaless-ok",
      config: { resolve: (cfg: { note: string }) => ({ context: [cfg.note] }) },
    });
    const merged = mergeCapabilities([schemaless.config({ note: "raw" })], "generator");
    expect(merged.contextEntries).toContain("raw");
  });

  it("wraps a resolver throw with the capability name", () => {
    const boom = defineCapability({
      name: "boom",
      config: {
        schema: z.object({}).default({}),
        resolve: () => {
          throw new Error("kaboom");
        },
      },
    });
    expect(() => mergeCapabilities([boom], "generator")).toThrow(
      /Config resolver for capability "boom" threw: kaboom/,
    );
  });

  it("reports a block-kind guard against the config source, not a preset", () => {
    // banner's resolver emits `context`, which is generator-only.
    expect(() => mergeCapabilities([banner.config({ note: "x" })], "handler")).toThrow(
      /Capability "banner" config declares context/,
    );
  });
});

// ---------------------------------------------------------------------------
// Diamond conflict detection
// ---------------------------------------------------------------------------

describe("diamond config conflict", () => {
  const child = defineCapability({
    name: "child",
    config: {
      schema: z.object({ note: z.string() }),
      resolve: (cfg) => ({ context: [cfg.note] }),
    },
  });

  it("identical config on two diamond paths dedups", () => {
    const parentA = defineCapability({ name: "pa", uses: [child.config({ note: "x" })] });
    const parentB = defineCapability({ name: "pb", uses: [child.config({ note: "x" })] });
    expect(() => flattenCapabilities([parentA, parentB])).not.toThrow();
  });

  it("conflicting config on two diamond paths throws", () => {
    const parentA = defineCapability({ name: "pa", uses: [child.config({ note: "x" })] });
    const parentB = defineCapability({ name: "pb", uses: [child.config({ note: "y" })] });
    expect(() => flattenCapabilities([parentA, parentB])).toThrow(
      /Conflicting .config\(\) for capability "child"/,
    );
  });
});

// ---------------------------------------------------------------------------
// Dynamic-uses configured ref — rejected at request time
// ---------------------------------------------------------------------------

describe("configured ref via dynamic uses", () => {
  it("is rejected at runtime through the generator dynamic path", async () => {
    const gen = generator({
      name: "dyn",
      model: "intent/utility",
      prompt: "p",
      uses: [(_ctx) => [banner.config({ note: "x" })]],
    });
    const context = (gen.config as { context: Array<(i: unknown, c: unknown) => unknown> }).context;
    const dynamicResolver = context[context.length - 1];
    await expect(dynamicResolver({}, {} as never)).rejects.toThrow(
      /Capability "banner" was configured with .config\(\) inside a dynamic/,
    );
  });
});
