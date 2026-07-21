/**
 * defineCapability() factory — creates a branded capability descriptor.
 *
 * Follows the defineResource() pattern: returns the config object branded
 * with phantom types for downstream type inference. The same reference is
 * reused across blocks, enabling diamond-dependency deduplication via ===.
 */
import type { DeclaredResourceEntry } from "../types/block";
import {
  getZodObjectShape,
  getZodObjectUnknownKeysMode,
  unwrapToZodObject,
} from "../helpers/zod-introspect";
import { getBaseCapability } from "./merge";
import type {
  CapabilityConfig,
  CapabilityConfigResolveCtx,
  ConfiguredCapability,
  DefinedCapability,
  InferSessionState,
  PresetDef,
  PresetOverrides,
} from "./types";

export function defineCapability<
  const TName extends string,
  const TFns extends Record<string, (...args: any[]) => any> = Record<string, never>,
  const TSessionStateSchema extends import("zod").ZodTypeAny | undefined = undefined,
  const TResources extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  const TTargetSchemas extends Record<string, import("zod").ZodTypeAny> | undefined = undefined,
  const TSequencerStateSchema extends import("zod").ZodTypeAny | undefined = undefined,
  const TPresetKeys extends string = never,
  const TSessionStateType = unknown,
  const TResourcesType = unknown,
  const TTargetStatesType = unknown,
  const TSequencerStateType = unknown,
  const TConfigSchema extends import("zod").ZodTypeAny | undefined = undefined,
  const TConfigExplicit = never,
  // FIX-914 PR2 — appended at the end so existing explicit type-argument
  // usages (e.g. pinning TPresetKeys) keep their positional slots.
  const TOwnStateSchema extends import("zod").ZodTypeAny | undefined = undefined,
  const TOwnStateType = unknown,
>(
  config: Omit<CapabilityConfig<
    TName,
    TFns,
    TSessionStateSchema,
    TResources,
    TTargetSchemas,
    TSequencerStateSchema,
    TOwnStateSchema
  >, "config"> & {
    presets?: { [K in TPresetKeys]: PresetDef<InferSessionState<TSessionStateSchema>> | string[] } & { default?: string[] };
    // Capture the literal override type via const generics so the
    // InferCapability* utilities can read it via `infer O`. Without this,
    // the field on CapabilityConfig is typed `unknown` and `infer` widens
    // to `unknown`, which makes the override branch a no-op.
    sessionStateType?: TSessionStateType;
    resourcesType?: TResourcesType;
    targetStatesType?: TTargetStatesType;
    sequencerStateType?: TSequencerStateType;
    stateSchemaType?: TOwnStateType;
    // Open config. `schema` types the resolver's `config` param as z.output
    // (parsed) and the `.config()` argument as z.input. Schemaless: both are
    // the explicit type inferred from the resolver's `config` annotation.
    config?: {
      schema?: TConfigSchema;
      resolve: (
        config: TConfigSchema extends import("zod").ZodTypeAny
          ? import("zod").output<TConfigSchema>
          : TConfigExplicit,
        ctx: CapabilityConfigResolveCtx
      ) => Partial<PresetDef<InferSessionState<TSessionStateSchema>>>;
    };
  }
): DefinedCapability<
  TName,
  TFns,
  TPresetKeys,
  Record<string, PresetDef>,
  TSessionStateSchema,
  TResources,
  TTargetSchemas,
  TSequencerStateSchema,
  TOwnStateSchema
> & {
  readonly sessionStateType?: TSessionStateType;
  readonly resourcesType?: TResourcesType;
  readonly targetStatesType?: TTargetStatesType;
  readonly sequencerStateType?: TSequencerStateType;
  readonly stateSchemaType?: TOwnStateType;
  // z.input at the call site (a `.default()` field is optional here); `never`
  // when no config is declared, which makes `.config()` a compile error.
  readonly __configInType?: TConfigSchema extends import("zod").ZodTypeAny
    ? import("zod").input<TConfigSchema>
    : TConfigExplicit;
} {
  if (!config.name || config.name.trim() === "") {
    throw new Error("defineCapability() requires a non-empty name");
  }

  // `.with()` routes a flat bag by preset-name membership: a key that names a
  // preset is a preset override, everything else is config. That is only
  // unambiguous when preset names and config field names are disjoint, so a
  // collision is a definition-time error rather than a silent mis-route.
  if (config.config?.schema && config.presets) {
    const configKeys = getConfigObjectKeys(config.config.schema);
    if (configKeys) {
      const presetNames = Object.keys(config.presets).filter((k) => k !== "default");
      const overlap = presetNames.filter((k) => configKeys.includes(k));
      if (overlap.length > 0) {
        throw new Error(
          `defineCapability("${config.name}"): preset name(s) [${overlap.join(", ")}] ` +
            `collide with config field name(s). .with() routes a flat bag by ` +
            `preset-name membership, so the two sets must be disjoint — rename ` +
            `the preset or the config field.`
        );
      }
    }
  }

  // Build the runtime object: copy config fields, move presets to __presetDefs,
  // replace presets with the builder method.
  const capability: any = {
    __brand: "Capability" as const,
    name: config.name,
    resources: config.resources,
    sessionStateSchema: config.sessionStateSchema,
    requestStateSchema: config.requestStateSchema,
    userStateSchema: config.userStateSchema,
    orgStateSchema: config.orgStateSchema,
    sequencerStateSchema: config.sequencerStateSchema,
    stateSchema: config.stateSchema,
    targetStateSchemas: config.targetStateSchemas,
    uses: config.uses,
    itemVisibility: config.itemVisibility,
    fns: config.fns,
    __presetDefs: config.presets,
    __configDef: config.config,
  };

  // Both builders route through createConfiguredRef so a single Object.create()
  // clone (one hop from the base) carries both __presetOverrides and __config.
  // getBaseCapability() recovers the base via Object.getPrototypeOf() for
  // diamond-dependency deduplication regardless of chain order.
  capability.presets = function presetsBuilder(
    this: any,
    overrides: PresetOverrides<string, Record<string, PresetDef>>
  ): ConfiguredCapability {
    return createConfiguredRef(this, { __presetOverrides: overrides });
  };
  capability.config = function configBuilder(this: any, value: unknown): ConfiguredCapability {
    return createConfiguredRef(this, { __config: value });
  };
  // `.with()` — the normalized consumer builder. Collapses `.config()` and
  // `.presets()` into one flat call: preset-named keys become preset overrides,
  // the rest become the config value. Pure sugar over the same two carriers, so
  // `.with({ allowed, dynamicActivation: true })` is exactly
  // `.config({ allowed }).presets({ dynamicActivation: true })`.
  //
  // Fail-loud: a key that is neither a preset nor a known config field throws at
  // the call site. For a config-less capability every non-preset key is unknown;
  // for a capability whose config is a *closed* object schema (strip/strict), a
  // key outside the schema's fields is unknown too — so a misspelled preset name
  // (which would otherwise route silently into the config bag and be dropped by
  // Zod's default key-stripping) is caught. Schemaless, scalar, and passthrough
  // configs can't enumerate valid keys, so their non-preset keys pass through.
  capability.with = function withBuilder(this: any, bag: unknown): ConfiguredCapability {
    // A non-object bag is a scalar/array config value (schema config that isn't
    // object-shaped) — route it wholesale to config; it can carry no presets.
    if (bag === null || typeof bag !== "object" || Array.isArray(bag)) {
      return createConfiguredRef(this, { __config: bag });
    }

    const presetNames = new Set(
      Object.keys(this.__presetDefs ?? {}).filter((k) => k !== "default")
    );
    const configDef = this.__configDef;
    // Known config field names — only when the schema is a *closed* object
    // (strip/strict). `null` for no-config / schemaless / non-object / passthrough
    // configs, where an "unknown" non-preset key can't be judged and passes through.
    const closedConfigKeys = configDef?.schema ? getClosedConfigKeys(configDef.schema) : null;

    const presetPart: Record<string, unknown> = {};
    const configPart: Record<string, unknown> = {};
    const unknownKeys: string[] = [];
    let hasConfigKeys = false;
    for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
      if (presetNames.has(k)) {
        presetPart[k] = v;
      } else if (!configDef || (closedConfigKeys && !closedConfigKeys.has(k))) {
        unknownKeys.push(k);
      } else {
        configPart[k] = v;
        hasConfigKeys = true;
      }
    }

    if (unknownKeys.length > 0) {
      const presets = [...presetNames].join(", ") || "(none)";
      const fields = closedConfigKeys
        ? [...closedConfigKeys].join(", ")
        : configDef
          ? "(open — any key)"
          : "(none — no config)";
      throw new Error(
        `.with() on capability "${this.name}" received key(s) [${unknownKeys.join(", ")}] ` +
          `that match neither a preset nor a config field — a misspelled preset name ` +
          `would otherwise route silently into config. Presets: [${presets}]. ` +
          `Config fields: [${fields}].`
      );
    }

    let ref: any = this;
    if (Object.keys(presetPart).length > 0) {
      ref = createConfiguredRef(ref, { __presetOverrides: presetPart });
    }
    // Write `__config` when there are config keys, or for an empty bag on a
    // config-capable capability so `.with({})` === `.config({})` (an optional
    // object schema that accepts `{}` but not `undefined` must not hit the
    // mandatory-config error). A presets-only non-empty bag leaves config unset,
    // matching `.presets(...)` alone.
    if (hasConfigKeys || (configDef && Object.keys(bag as object).length === 0)) {
      ref = createConfiguredRef(ref, { __config: configPart });
    }
    return ref;
  };

  return capability;
}

/**
 * Extract a config schema's declared object keys, peeling the wrappers a config
 * schema commonly carries (`.default({})`, `.optional()`, `.strict()`, effects).
 * Returns the key list, or `null` when the schema isn't object-shaped (scalar/
 * array config). Used for the definition-time preset/config collision check.
 */
function getConfigObjectKeys(schema: import("zod").ZodTypeAny): string[] | null {
  const obj = unwrapToZodObject(schema);
  const shape = obj ? getZodObjectShape(obj) : undefined;
  return shape ? Object.keys(shape) : null;
}

/**
 * The field names of a *closed* config object (unknown-key policy `strip` or
 * `strict`), as a Set. Returns `null` for a non-object schema or a `passthrough`
 * object — cases where the key set isn't exhaustive, so `.with()` can't treat an
 * unexpected key as unknown.
 */
function getClosedConfigKeys(schema: import("zod").ZodTypeAny): Set<string> | null {
  const obj = unwrapToZodObject(schema);
  if (!obj || getZodObjectUnknownKeysMode(obj) === "passthrough") return null;
  const shape = getZodObjectShape(obj);
  return shape ? new Set(Object.keys(shape)) : null;
}

/**
 * Produce a configured capability reference one hop from the base.
 *
 * `receiver` is the ref the builder was called on (`this`) — the base itself,
 * or an already-configured clone. The result always prototypes off the base
 * (single hop, so diamond dedup by identity still works) and copies forward any
 * sibling carrier the receiver already had, so `.config().presets()` and
 * `.presets().config()` both end with one clone holding both fields.
 */
function createConfiguredRef(
  receiver: any,
  patch: { __presetOverrides?: unknown } | { __config?: unknown }
): any {
  const base = getBaseCapability(receiver);
  const configured = Object.create(base);
  if ("__presetOverrides" in receiver) {
    configured.__presetOverrides = receiver.__presetOverrides;
  }
  if ("__config" in receiver) {
    configured.__config = receiver.__config;
  }
  Object.assign(configured, patch);
  return configured;
}
