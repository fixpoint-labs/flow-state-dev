/**
 * Tests for the `.with()` builder — the normalized consumer surface that
 * collapses `.config()` and `.presets()` into one flat call. Covers the
 * bag split (preset-named keys vs. config), equivalence to the two-call chain,
 * config-only / presets-only / scalar-config routing, the config-less fail-loud
 * path, and the definition-time preset/config collision guard.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, getBaseCapability, mergeCapabilities } from "../src/capability";

// A skills-like capability: a flag preset plus config, resolver reads the active
// preset set to decide how the config value is applied — the motivating case.
const skills = defineCapability({
  name: "skills-like",
  presets: { dynamicActivation: {}, default: [] },
  config: {
    // `.default({})` at the top makes the capability usable without config keys
    // (presets-only binding), matching the real skills library schema.
    schema: z.object({ allowed: z.array(z.string()).default([]) }).default({}),
    resolve: (cfg, ctx) => ({
      context: [
        `${ctx.presets.has("dynamicActivation") ? "dynamic" : "static"}:${cfg.allowed.join(",")}`,
      ],
    }),
  },
});

describe(".with() — bag split & equivalence", () => {
  it("routes preset-named keys to presets and the rest to config", () => {
    const merged = mergeCapabilities(
      [skills.with({ allowed: ["research"], dynamicActivation: true })],
      "generator",
    );
    expect(merged.contextEntries).toContain("dynamic:research");
  });

  it("is equivalent to the .config().presets() chain", () => {
    const viaWith = mergeCapabilities(
      [skills.with({ allowed: ["research"], dynamicActivation: true })],
      "generator",
    );
    const viaChain = mergeCapabilities(
      [skills.config({ allowed: ["research"] }).presets({ dynamicActivation: true })],
      "generator",
    );
    expect(viaWith.contextEntries).toEqual(viaChain.contextEntries);
  });

  it("carries both carriers, one hop from base (like the chain)", () => {
    const ref = skills.with({ allowed: ["research"], dynamicActivation: true });
    expect(getBaseCapability(ref as never)).toBe(skills);
    expect(Object.prototype.hasOwnProperty.call(ref, "__config")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(ref, "__presetOverrides")).toBe(true);
  });

  it("does not mutate the base capability", () => {
    skills.with({ allowed: ["research"], dynamicActivation: true });
    expect("__config" in skills).toBe(false);
    expect("__presetOverrides" in skills).toBe(false);
  });
});

describe(".with() — config-only and presets-only", () => {
  it("config-only bag: no preset active, config applied", () => {
    const merged = mergeCapabilities([skills.with({ allowed: ["research"] })], "generator");
    expect(merged.contextEntries).toContain("static:research");
  });

  it("presets-only bag: preset active, config falls back to its schema default", () => {
    const merged = mergeCapabilities([skills.with({ dynamicActivation: true })], "generator");
    // `allowed` defaults to [] via the schema, so the resolver still runs.
    expect(merged.contextEntries).toContain("dynamic:");
  });

  it("presets-only capability (no config) accepts preset overrides", () => {
    const presetsOnly = defineCapability({
      name: "presets-only",
      presets: { extra: { context: ["EXTRA"] }, default: [] },
    });
    const merged = mergeCapabilities([presetsOnly.with({ extra: true })], "generator");
    expect(merged.contextEntries).toContain("EXTRA");
  });
});

describe(".with() — scalar config routed wholesale", () => {
  const scalar = defineCapability({
    name: "scalar-config",
    config: {
      schema: z.string(),
      resolve: (cfg) => ({ context: [`v:${cfg}`] }),
    },
  });

  it("passes a non-object config value straight to config", () => {
    const merged = mergeCapabilities([scalar.with("hello")], "generator");
    expect(merged.contextEntries).toContain("v:hello");
  });

  it("is equivalent to .config() for a scalar value", () => {
    const viaWith = mergeCapabilities([scalar.with("hello")], "generator");
    const viaConfig = mergeCapabilities([scalar.config("hello")], "generator");
    expect(viaWith.contextEntries).toEqual(viaConfig.contextEntries);
  });
});

describe(".with() — empty bag & passthrough config", () => {
  it("`.with({})` configures with an empty object (=== `.config({})`) for an optional object schema", () => {
    // Schema accepts `{}` but not `undefined`, so `.config({})` works and bare
    // use errors — `.with({})` must match `.config({})`, not hit that error.
    const optional = defineCapability({
      name: "optional-config",
      config: {
        schema: z.object({ note: z.string().optional() }),
        resolve: (cfg) => ({ context: [`note:${cfg.note ?? "none"}`] }),
      },
    });
    const viaWith = mergeCapabilities([optional.with({})], "generator");
    const viaConfig = mergeCapabilities([optional.config({})], "generator");
    expect(viaWith.contextEntries).toEqual(viaConfig.contextEntries);
    expect(viaWith.contextEntries).toContain("note:none");
  });

  it("passes through unexpected keys for a passthrough config schema", () => {
    const passthrough = defineCapability({
      name: "passthrough-config",
      config: {
        schema: z.object({ a: z.string() }).passthrough(),
        resolve: (cfg) => ({ context: [`keys:${Object.keys(cfg).sort().join(",")}`] }),
      },
    });
    const merged = mergeCapabilities([passthrough.with({ a: "x", extra: "y" })], "generator");
    expect(merged.contextEntries).toContain("keys:a,extra");
  });
});

describe(".with() — fail-loud paths", () => {
  it("throws on a non-preset key when the capability declares no config", () => {
    const presetsOnly = defineCapability({
      name: "presets-only-2",
      presets: { extra: {}, default: [] },
    });
    expect(() => presetsOnly.with({ notAPreset: true } as never)).toThrow(
      /neither a preset nor a config field/,
    );
  });

  it("throws on a typo'd preset name when config is a closed object schema", () => {
    // `skills` has preset `dynamicActivation` + a closed object config {allowed}.
    // A misspelled preset name matches neither, so it throws instead of silently
    // routing into config and being stripped by Zod's default key policy.
    expect(() => skills.with({ dynammicActivation: true } as never)).toThrow(
      /neither a preset nor a config field/,
    );
  });

  it("preset name colliding with a config field is a definition-time error", () => {
    expect(() =>
      defineCapability({
        name: "colliding",
        presets: { allowed: {}, default: [] },
        config: {
          schema: z.object({ allowed: z.array(z.string()).default([]) }),
          resolve: () => ({}),
        },
      }),
    ).toThrow(/collide with config field/);
  });
});
