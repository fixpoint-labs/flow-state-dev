/**
 * Type-level tests for open config on capabilities (FIX-915).
 *
 * These validate that:
 * - `.config()` accepts a well-typed value and rejects a mistyped one.
 * - The `.config()` argument is `z.input` (a `.default()` field is optional at
 *   the call site) while the resolver's `config` param is `z.output` (that field
 *   is present/required).
 * - The `.config()` argument shape is preserved across `.presets()` chaining.
 * - The `sessionStateType` escape-hatch survives `.config().presets()`.
 * - `.config()` on a config-less capability is a compile error.
 */
import { z } from "zod";
import { defineCapability } from "../../capability/define-capability";
import type { InferCapabilitySessionState } from "../../capability/types";

// ── A capability with a defaulted config field ───────────────────────

const banner = defineCapability({
  name: "banner",
  config: {
    schema: z.object({ note: z.string(), loud: z.boolean().default(false) }),
    resolve: (cfg) => {
      // Resolver sees z.output: `loud` is present as `boolean`, not optional.
      const loud: boolean = cfg.loud;
      void loud;
      return { context: [cfg.note] };
    },
  },
});

// ── .config() argument is z.input (defaulted field optional) ─────────

banner.config({ note: "x" }); // ok — `loud` optional at the call site
banner.config({ note: "x", loud: true }); // ok

// @ts-expect-error - `note` is required
banner.config({ loud: true });

// @ts-expect-error - `note` must be a string
banner.config({ note: 123 });

// ── Argument shape preserved across .presets() chaining ──────────────

banner.presets({}).config({ note: "x" }); // ok after chaining

// @ts-expect-error - `note` still required after chaining
banner.presets({}).config({ loud: true });

// ── Escape-hatch carrier survives .config().presets() ────────────────

const escaped = defineCapability({
  name: "escaped",
  sessionStateSchema: z.record(z.string(), z.any()),
  // The inferred type from z.record is too loose; assert the exact ctx shape.
  sessionStateType: {} as { exact: string },
  config: {
    schema: z.object({ n: z.string() }),
    resolve: () => ({}),
  },
});

const chained = escaped.config({ n: "x" }).presets({});
type ChainedSessionState = InferCapabilitySessionState<readonly [typeof chained]>;

// The escape-hatch type survives the chain — resolves to `{ exact: string }`.
const _survives: ChainedSessionState = { exact: "hello" };
void _survives;

// @ts-expect-error - the escape-hatch shape is preserved (a number is wrong)
const _wrong: ChainedSessionState = { exact: 123 };
void _wrong;

// ── .config() on a config-less capability is a compile error ─────────

const noConfig = defineCapability({ name: "noconfig" });

// @ts-expect-error - the capability declares no config
noConfig.config({ anything: true });

// ── Schemaless config types the argument from the resolver param ─────

const schemaless = defineCapability({
  name: "schemaless",
  config: { resolve: (cfg: { id: string }) => ({ context: [cfg.id] }) },
});

schemaless.config({ id: "a" }); // ok

// @ts-expect-error - `id` must be a string
schemaless.config({ id: 1 });
