/**
 * `createSkillsLibrary()` — the Skills v2 surface (FIX-911).
 *
 * A **library** is a shared catalog of skills (the resource collection plus its
 * bundled defaults, installed once). A generator then **binds** to it per
 * generator via `.config({ active, allowed, activeState })` and
 * `.presets({ dynamicActivation })`. The binding carries the skills — there is
 * no session-global `activeSkills` bag, so a skill given to one generator never
 * appears in another's context, and a runtime activation is request-scoped by
 * default (it does not carry into the next turn).
 *
 * Two binding surfaces:
 *   - `config({ active })` — statically preload these skills' bodies (and their
 *     declared `allowed-tools`) into the generator. Inline-mode only; a
 *     missing/typo'd name fails loud at build time.
 *   - `config({ allowed }).presets({ dynamicActivation: true })` — install the
 *     model-facing load tool, letting the agent pull any `allowed` skill into
 *     context mid-turn. Storage defaults to the generator's own block state
 *     (FIX-914); set `config({ activeState: { scope, field } })` to store it at
 *     a named, shareable, or durable scope instead.
 *
 * The library owns **seeding**: bundled `initialSkills` are seeded on the
 * binding's first render, so even a static-only binding sees a populated
 * catalog on turn 1.
 *
 * Fork- and pattern-mode skills are dispatch routes, not context injections;
 * they stay on the `runSkill` router (`createSkillsCapability`). This surface
 * is inline-only by construction.
 */

import { z } from "zod";
import { defineCapability, type DefinedCapability } from "@flow-state-dev/core";
import type {
  DeclaredResourceEntry,
  ResourceScope,
} from "@flow-state-dev/core/types";
import type { CapabilityConfigResolveCtx } from "@flow-state-dev/core/capability";
import type {
  GeneratorTool,
  InitialSkill,
  ItemVisibility,
  PresetDef,
  SkillContextMode,
  ToolCatalog,
} from "@flow-state-dev/core";
import { activeSkillsArraySchema } from "./active-skill-state";
import type { ActivationLocation } from "./activation-store";
import { buildSkillBindingReader } from "./binding-reader";
import {
  defineSkillsCollection,
  type DefineSkillsCollectionOptions,
} from "./collection";
import { buildLoadCatalogContext, createLoadSkillTool } from "./load-tool";
import { parseSkillMd } from "./skill-md";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface SkillsLibraryOptions {
  /** Resource registry key for the skills collection. Default `"skills"`. */
  collection?: string;
  /** Tool catalog. Skills reference these by string key via `allowed-tools`. */
  catalog?: ToolCatalog;
  /** Bundled defaults — seeded on a binding's first render. */
  initialSkills?: InitialSkill[];
  /**
   * Scope the skills collection lives at. Default `"org"` so seeded skills are
   * shared across users. `"user"` for personal libraries; `"session"` for tests.
   */
  scope?: ResourceScope;
  /** Optional collection sizing / mount-prefix overrides. */
  collectionConfig?: Pick<DefineSkillsCollectionOptions, "maxInstances" | "prefix">;
  /**
   * Restrict this library's bindings to blocks with a matching
   * `itemVisibility`. See `createSkillsCapability` for the multi-agent rationale.
   */
  itemVisibility?: ItemVisibility | readonly ItemVisibility[];
}

/** The per-generator binding configuration (`skills.config({ ... })`). */
export interface SkillsBindingConfig {
  /**
   * Statically-preloaded skill names. Their bodies + declared `allowed-tools`
   * are injected from the start. Inline-mode only; unknown names fail loud.
   */
  active?: string[];
  /**
   * Skill names the load tool (`dynamicActivation`) may pull from. Omit for the
   * whole catalog. Contributes these skills' declared `allowed-tools` too.
   */
  allowed?: string[];
  /**
   * Where dynamic activations live. Omit to use the generator's own block
   * state (request-scoped, private, non-persistent). Set an explicit
   * `{ scope, field }` to share across generators or persist across turns, and
   * whenever an upstream matcher (which runs before the generator) writes it.
   */
  activeState?: {
    scope: "request" | "session" | "user" | "org";
    field: string;
  };
}

// ---------------------------------------------------------------------------
// Build-time skill index (from bundled defaults)
// ---------------------------------------------------------------------------

interface IndexedSkill {
  allowedTools?: string[];
  contextMode: SkillContextMode;
}

function indexInitialSkills(
  initialSkills: InitialSkill[] | undefined,
): Map<string, IndexedSkill> {
  const index = new Map<string, IndexedSkill>();
  for (const skill of initialSkills ?? []) {
    try {
      const parsed = parseSkillMd(skill.skillMd);
      index.set(skill.name, {
        allowedTools: parsed.state.allowedTools,
        contextMode: parsed.state.contextMode ?? "inline",
      });
    } catch {
      // A malformed bundled skill is a seeding-time concern; skip it here so
      // config resolution doesn't hard-fail on an unrelated skill's typo.
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

const bindingConfigSchema = z
  .object({
    active: z.array(z.string()).optional(),
    allowed: z.array(z.string()).optional(),
    activeState: z
      .object({
        scope: z.enum(["request", "session", "user", "org"]),
        field: z.string().min(1),
      })
      .optional(),
  })
  // `.default({})` makes the config usable without an explicit `.config()`
  // call, so `presets({ dynamicActivation: true })` alone still resolves.
  .default({});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a shared skills library. Install it once (`uses: [skills]`), then bind
 * per generator via `skills.config({ ... })` / `skills.presets({ ... })`.
 */
export function createSkillsLibrary(
  options: SkillsLibraryOptions = {},
): DefinedCapability {
  const collectionKey = options.collection ?? "skills";
  const catalog: ToolCatalog = options.catalog ?? {};
  const scope: ResourceScope = options.scope ?? "org";
  const initialSkills = options.initialSkills;
  const index = indexInitialSkills(initialSkills);

  const collectionPrefix = options.collectionConfig?.prefix ?? collectionKey;
  const mountPath = collectionPrefix;

  const skillsCollection = defineSkillsCollection({
    prefix: collectionPrefix,
    maxInstances: options.collectionConfig?.maxInstances,
    scope,
  });

  const resources: Record<string, DeclaredResourceEntry> = {
    [collectionKey]: skillsCollection,
  };

  // Assert a name is a known inline skill (fail loud on typos). Binding by name
  // requires a bundled catalog to validate against — if none parsed (no
  // `initialSkills`, or every bundled skill was malformed), that's an author
  // error, not a reason to silently skip validation and widen the tool surface.
  const assertInline = (name: string, where: "active" | "allowed"): void => {
    if (index.size === 0) {
      throw new Error(
        `skills.config({ ${where}: [...] }) binds "${name}" by name, but no bundled ` +
          `skills are available to validate against. Pass valid \`initialSkills\` to ` +
          `createSkillsLibrary() (an empty index also means every bundled skill failed to parse).`,
      );
    }
    const entry = index.get(name);
    if (!entry) {
      throw new Error(
        `skills.config({ ${where}: [...] }): unknown skill "${name}". ` +
          `Known skills: ${[...index.keys()].join(", ") || "(none)"}.`,
      );
    }
    if (entry.contextMode !== "inline") {
      throw new Error(
        `skills.config({ ${where}: [...] }): "${name}" is a ${entry.contextMode}-mode ` +
          `skill. Only inline skills can be bound here — fork/pattern skills dispatch ` +
          `through the runSkill router (createSkillsCapability).`,
      );
    }
  };

  // Resolve a set of skills' declared catalog tools. Any skill that omits
  // `allowed-tools` is unrestricted, so the effective contribution becomes the
  // full catalog. A declared tool absent from the catalog is a config error.
  const declaredTools = (names: readonly string[]): GeneratorTool[] => {
    if (names.length === 0) return [];
    const keys = new Set<string>();
    let unrestricted = false;
    // Scan every name — validate each skill's declared tools against the
    // catalog even once we know an earlier skill was unrestricted, so a bad
    // declaration on a later skill still fails loud instead of being masked by
    // the full-catalog fallback.
    for (const name of names) {
      const declared = index.get(name)?.allowedTools;
      if (!declared || declared.length === 0) {
        unrestricted = true;
        continue;
      }
      for (const key of declared) {
        if (!(key in catalog)) {
          throw new Error(
            `skills: skill "${name}" declares tool "${key}", which is not in the catalog`,
          );
        }
        keys.add(key);
      }
    }
    // Any unrestricted skill widens the effective contribution to the whole catalog.
    if (unrestricted) return Object.values(catalog) as GeneratorTool[];
    return [...keys].map((k) => catalog[k]!) as GeneratorTool[];
  };

  const resolve = (
    cfg: z.output<typeof bindingConfigSchema>,
    resolveCtx: CapabilityConfigResolveCtx,
  ): Partial<PresetDef> => {
    const active = cfg.active ?? [];
    for (const name of active) assertInline(name, "active");

    const location: ActivationLocation = cfg.activeState
      ? {
          kind: "explicit",
          scope: cfg.activeState.scope,
          field: cfg.activeState.field,
        }
      : { kind: "block" };

    const contributions: Partial<PresetDef> = {};
    const tools: GeneratorTool[] = [];
    const contextEntries: PresetDef["context"] = [];

    // Reader — always contributed (renders static `active` + dynamic activeState).
    contextEntries.push(
      buildSkillBindingReader({
        collectionKey,
        mountPath,
        active,
        location,
        ...(initialSkills ? { initialSkills } : {}),
      }),
    );

    // Static `active` skills contribute their declared tools.
    if (active.length > 0) tools.push(...declaredTools(active));

    // Validate `allowed` names up front so a typo fails loud regardless of
    // which activation path (load tool / upstream matcher / code) feeds it.
    if (cfg.allowed) for (const name of cfg.allowed) assertInline(name, "allowed");

    const dynamic = resolveCtx.presets.has("dynamicActivation");
    // A runtime activation can arrive from the load tool (`dynamicActivation`)
    // or from an upstream matcher / code writing an explicit `activeState`
    // field. Any such path can render a skill body, so register the tools those
    // bodies may reference: the `allowed` skills' declared tools when scoped, or
    // the whole catalog when the activatable set is unbounded (no `allowed`).
    const hasActivationPath = dynamic || Boolean(cfg.activeState);
    if (hasActivationPath) {
      tools.push(
        ...(cfg.allowed
          ? declaredTools(cfg.allowed)
          : (Object.values(catalog) as GeneratorTool[])),
      );
    }

    // `dynamicActivation` preset → install the load tool + catalog listing.
    if (dynamic) {
      tools.push(
        createLoadSkillTool({
          collectionKey,
          location,
          ...(cfg.allowed ? { allowed: cfg.allowed } : {}),
          ...(initialSkills ? { initialSkills } : {}),
        }),
      );
      contextEntries.push(
        buildLoadCatalogContext({
          collectionKey,
          ...(cfg.allowed ? { allowed: cfg.allowed } : {}),
          ...(initialSkills ? { initialSkills } : {}),
        }),
      );
    }

    // Explicit activeState → contribute the field schema at the chosen scope so
    // the reader/writer/matcher share a validated shape.
    if (cfg.activeState) {
      const schemaKey = `${cfg.activeState.scope}StateSchema` as const;
      (contributions as Record<string, unknown>)[schemaKey] = z.object({
        [cfg.activeState.field]: activeSkillsArraySchema,
      });
    }

    // Group the reader + catalog under a single `<skills>` tag.
    contributions.context = [{ skills: contextEntries } as never];
    if (tools.length > 0) {
      // De-dupe by identity so a tool declared by both `active` and `allowed`
      // is contributed once.
      contributions.tools = [...new Set(tools)];
    }
    return contributions;
  };

  return defineCapability({
    name: "skills",
    itemVisibility: options.itemVisibility,
    resources,
    presets: {
      // Flag-only preset; the resolver reads `ctx.presets` to install the tool.
      dynamicActivation: {},
      default: [],
    },
    config: {
      schema: bindingConfigSchema,
      resolve,
    },
  });
}
