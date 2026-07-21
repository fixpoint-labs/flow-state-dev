/**
 * Type-level tests for the `.with()` builder.
 *
 * These validate that:
 * - `.with()` accepts a flat bag mixing config fields and preset-named keys.
 * - Config fields keep their config types; preset keys are `boolean | fn`.
 * - `.with()` accepts a config-only bag, a presets-only bag, and (for a
 *   config-less capability) preset overrides alone, rejecting unknown keys.
 * - Scalar config is accepted wholesale and type-checked.
 */
import { z } from "zod";
import { defineCapability } from "../../capability/define-capability";

// ── A skills-like capability: a flag preset + defaulted object config ──

const skills = defineCapability({
  name: "skills-like",
  presets: { dynamicActivation: {}, default: [] },
  config: {
    schema: z.object({ allowed: z.array(z.string()).default([]) }).default({}),
    resolve: () => ({}),
  },
});

skills.with({ allowed: ["x"], dynamicActivation: true }); // ok — mixed bag
skills.with({ allowed: ["x"] }); // ok — config-only
skills.with({ dynamicActivation: true }); // ok — presets-only (allowed defaulted)

// @ts-expect-error - `allowed` must be string[]
skills.with({ allowed: 123 });

// @ts-expect-error - a preset override is `boolean | fn`, not a string
skills.with({ dynamicActivation: "yes" });

// ── A config-less, presets-only capability ────────────────────────────

const presetsOnly = defineCapability({
  name: "presets-only",
  presets: { extra: {}, default: [] },
});

presetsOnly.with({ extra: true }); // ok — preset override alone

// @ts-expect-error - `notAPreset` is neither config nor a known preset
presetsOnly.with({ notAPreset: true });

// ── A config-only capability (no presets) ─────────────────────────────

const banner = defineCapability({
  name: "banner",
  config: {
    schema: z.object({ note: z.string(), loud: z.boolean().default(false) }),
    resolve: (cfg) => ({ context: [cfg.note] }),
  },
});

banner.with({ note: "x" }); // ok — config value alone
banner.with({ note: "x", loud: true }); // ok

// @ts-expect-error - `note` is required
banner.with({ loud: true });

// @ts-expect-error - `note` must be a string
banner.with({ note: 123 });

// ── Scalar config routed wholesale ────────────────────────────────────

const scalar = defineCapability({
  name: "scalar-config",
  config: {
    schema: z.string(),
    resolve: (cfg) => ({ context: [cfg] }),
  },
});

scalar.with("hi"); // ok — scalar value

// @ts-expect-error - config value must be a string
scalar.with(123);
