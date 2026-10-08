/**
 * `createSkillsLibrary()` — the Skills v2 surface (FIX-911).
 *
 * A **library** is a shared catalog of skills (the resource collection plus its
 * bundled defaults, installed once). A generator then **binds** to it per
 * generator via `.with({ active, allowed, activeState, dynamicActivation })` —
 * the flat builder that collapses config (`active`/`allowed`/`activeState`) and
 * the `dynamicActivation` preset into one call. The binding carries the skills —
 * there is no session-global `activeSkills` bag, so a skill given to one
 * generator never appears in another's context, and a runtime activation is
 * request-scoped by default (it does not carry into the next turn).
 *
 * Two binding surfaces:
 *   - `with({ active })` — statically preload these skills' bodies (and their
 *     declared `allowed-tools`) into the generator. Inline-mode only; a
 *     missing/typo'd name fails loud at build time.
 *   - `with({ allowed, dynamicActivation: true })` — install the model-facing
 *     load tool, letting the agent pull any `allowed` skill into context
 *     mid-turn. Storage defaults to the generator's own block state, which the
 *     binding installs for you (FIX-914 PR2 — no hand-declared `stateSchema`
 *     needed); set `with({ activeState: { scope, field } })` to store it at a
 *     named, shareable, or durable scope instead.
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
import type { SkillsPartitionFn } from "./partition";
import {
  isInitialSkillsResolver,
  type InitialSkillsSource,
} from "./initial-skills";
import { buildLoadCatalogContext, createLoadSkillTool } from "./load-tool";
import { parseSkillMd, SkillAgentsRemovedError, validateSkillName } from "./skill-md";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface SkillsLibraryOptions {
  /** Resource registry key for the skills collection. Default `"skills"`. */
  collection?: string;
  /** Tool catalog. Skills reference these by string key via `allowed-tools`. */
  catalog?: ToolCatalog;
  /**
   * Whether a bound skill's whole `catalog` registers on the generator
   * (`fullCatalog()`, the safe-superset path below `validateDeclaredTools`).
   * Default `true`, preserving today's behaviour: a bound skill's declared
   * `allowed-tools` are still validated against `catalog` either way — this
   * only gates the second, separable job, registration. Set `false` when a
   * caller already owns tool registration through its own means (e.g. a
   * worker's own `tools:` fence) and wants `catalog` validated but not
   * granted.
   */
  registerCatalogTools?: boolean;
  /**
   * Bundled defaults — seeded on a binding's first render.
   *
   * A **function** makes the catalog per-execution instead of per-library (see
   * {@link InitialSkillsSource}). Everything that seeds resolves it against its
   * own context; what changes for the caller is that binding a skill BY NAME
   * (`with({ active })` / `with({ allowed })`) then throws, because there is no
   * build-time catalog to validate the name against.
   */
  initialSkills?: InitialSkillsSource;
  /**
   * Scope the skills collection lives at. Default `"org"` so seeded skills are
   * shared across users. `"user"` for personal libraries; `"session"` for tests.
   */
  scope?: ResourceScope;
  /**
   * Optional collection sizing / mount-prefix overrides, plus `flowIsolation`
   * — set it when every registered copy of the declaring flow should hold its
   * own catalog rather than share one bucket.
   */
  collectionConfig?: Pick<
    DefineSkillsCollectionOptions,
    "maxInstances" | "prefix" | "flowIsolation"
  >;
  /**
   * Keep one catalog per partition, named per run: a function of the running
   * context the composing layer supplies, returning a value derived from data
   * only the server writes. A run it returns `undefined` for reads no
   * partition's skills and writes none. Use it when several
   * parties run through one registered copy of the declaring flow and each
   * must hold its own catalog; `flowIsolation` separates copies, not parties.
   */
  partitionBy?: SkillsPartitionFn;
  /**
   * Restrict this library's bindings to blocks with a matching
   * `itemVisibility`. See `createSkillsCapability` for the multi-agent rationale.
   */
  itemVisibility?: ItemVisibility | readonly ItemVisibility[];
}

/** The per-generator binding configuration (`skills.with({ ... })`). */
export interface SkillsBindingConfig {
  /**
   * Statically-preloaded skill names. Their bodies + declared `allowed-tools`
   * are injected from the start. Inline-mode only; unknown names fail loud.
   */
  active?: string[];
  /**
   * Skill names the load tool (`dynamicActivation`) may pull from. Omit for the
   * whole catalog.
   *
   * It does NOT contribute these skills' declared `allowed-tools` — nothing
   * does; `allowed-tools` renders as an intent note and grants nothing. What it
   * does contribute is the catalog registration on the `activeState` path:
   * `activeState` + `allowed` sets `contributesRuntimeTools` below, and an
   * `activeState` binding with neither `allowed` nor `dynamicActivation`
   * registers no catalog tools at all.
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
  /** `disable-model-invocation` — the skill can't be exposed to the model. */
  disableModelInvocation?: boolean;
}

function indexInitialSkills(
  initialSkills: InitialSkill[] | undefined,
): Map<string, IndexedSkill> {
  const index = new Map<string, IndexedSkill>();
  for (const skill of initialSkills ?? []) {
    try {
      // Apply the same name validation runtime seeding does. An invalid or
      // reserved name (`BadName`, `_meta`) is skipped by the seeder, so it must
      // not enter the index either — otherwise an `active` binding to it would
      // pass build validation but never get seeded, and the reader would omit
      // the skill, leaving the generator without its instructions.
      validateSkillName(skill.name);
      const parsed = parseSkillMd(skill.skillMd, { expectedName: skill.name });
      index.set(skill.name, {
        allowedTools: parsed.state.allowedTools,
        contextMode: parsed.state.contextMode ?? "inline",
        disableModelInvocation: parsed.state.disableModelInvocation,
      });
    } catch (err) {
      // A skill that declares `agents:` is refused here, at construction: the
      // seeder would only warn and retry on every hydrate, and a skill that
      // never seeds reads to its author as one that silently vanished.
      if (err instanceof SkillAgentsRemovedError) {
        throw new Error(`createSkillsLibrary(): bundled skill "${skill.name}": ${err.message}`, {
          cause: err,
        });
      }
      // Any other malformed or invalidly-named bundled skill is a seeding-time
      // concern; skip it here so config resolution fails loud on a binding to
      // it (via the "unknown skill" path) rather than silently accepting it.
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
      .strict()
      .optional(),
  })
  // `.strict()` so a typo'd key (`actve`) fails loud instead of being silently
  // stripped and building a generator without the intended binding.
  .strict()
  // `.default({})` makes the config usable without config keys, so
  // `with({ dynamicActivation: true })` (preset only) still resolves.
  .default({});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a shared skills library. Install it once (`uses: [skills]`), then bind
 * per generator via `skills.with({ ... })`.
 */
export function createSkillsLibrary(
  options: SkillsLibraryOptions = {},
): DefinedCapability {
  const collectionKey = options.collection ?? "skills";
  const catalog: ToolCatalog = options.catalog ?? {};
  const registerCatalogTools = options.registerCatalogTools ?? true;
  const scope: ResourceScope = options.scope ?? "org";
  const initialSkills = options.initialSkills;
  // A resolver has no build-time catalog, so there is nothing to index. The
  // empty index is NOT treated as "no bundled skills" — `assertKnownSkill`
  // below refuses first, naming the resolver, so the two cases never blur.
  const perExecutionCatalog = isInitialSkillsResolver(initialSkills);
  const index = indexInitialSkills(perExecutionCatalog ? undefined : initialSkills);

  const collectionPrefix = options.collectionConfig?.prefix ?? collectionKey;
  const mountPath = collectionPrefix;

  const skillsCollection = defineSkillsCollection({
    prefix: collectionPrefix,
    maxInstances: options.collectionConfig?.maxInstances,
    scope,
    ...(options.collectionConfig?.flowIsolation !== undefined
      ? { flowIsolation: options.collectionConfig.flowIsolation }
      : {}),
    ...(options.partitionBy !== undefined ? { partitionBy: options.partitionBy } : {}),
  });

  const resources: Record<string, DeclaredResourceEntry> = {
    [collectionKey]: skillsCollection,
  };

  // Assert a name is a known skill (fail loud on typos). Binding by name
  // requires a bundled catalog to validate against — if none parsed (no
  // `initialSkills`, or every bundled skill was malformed), that's an author
  // error, not a reason to silently skip validation and widen the tool surface.
  // After FIX-918 every skill is inline, so there is no non-inline mode to
  // reject here — the surface is inline-by-construction.
  const assertKnownSkill = (name: string, where: "active" | "allowed"): void => {
    // Refused LOUDLY rather than skipped. Validation is what keeps a binding
    // from widening the tool surface with a name nothing answers to, and under
    // a resolver there is no catalog here to check the name against — the sets
    // differ per execution, which is the whole point of a resolver. Falling
    // through to "unvalidated" would make the guard silently absent exactly
    // where the catalog is least predictable.
    if (perExecutionCatalog) {
      throw new Error(
        `skills.with({ ${where}: [...] }) binds "${name}" by name, but ` +
          `createSkillsLibrary() was given \`initialSkills\` as a per-execution resolver, ` +
          `so there is no build-time catalog to validate the name against. Bindings under a ` +
          `resolver cannot name skills statically — activate them at runtime instead ` +
          `(an upstream matcher, the load tool, or code writing the binding's \`activeState\`).`,
      );
    }
    if (index.size === 0) {
      throw new Error(
        `skills.with({ ${where}: [...] }) binds "${name}" by name, but no bundled ` +
          `skills are available to validate against. Pass valid \`initialSkills\` to ` +
          `createSkillsLibrary() (an empty index also means every bundled skill failed to parse).`,
      );
    }
    if (!index.has(name)) {
      throw new Error(
        `skills.with({ ${where}: [...] }): unknown skill "${name}". ` +
          `Known skills: ${[...index.keys()].join(", ") || "(none)"}.`,
      );
    }
  };

  // Validate a bound skill's declared `allowed-tools` all exist in the catalog.
  // Author feedback only — it does NOT scope what gets registered. Tool
  // registration is a safe superset (the whole catalog), like the legacy
  // capability: the reader renders the LIVE manifest, which an admin can edit
  // after seeding, so freezing a per-skill tool subset at build time would let
  // the rendered `allowed-tools` note name a tool the generator never
  // registered. On THIS path the declared list never becomes a restriction —
  // nothing here narrows the generator to it, so the rendered note states it
  // as the skill's intent and disclaims any read as a grant (FIX-1451).
  const validateDeclaredTools = (name: string): void => {
    const declared = index.get(name)?.allowedTools;
    if (!declared) return;
    for (const key of declared) {
      if (!(key in catalog)) {
        throw new Error(
          `skills: skill "${name}" declares tool "${key}", which is not in the catalog`,
        );
      }
    }
  };

  const fullCatalog = (): GeneratorTool[] => Object.values(catalog) as GeneratorTool[];

  const resolve = (
    cfg: z.output<typeof bindingConfigSchema>,
    resolveCtx: CapabilityConfigResolveCtx,
  ): Partial<PresetDef> => {
    const active = cfg.active ?? [];
    for (const name of active) {
      assertKnownSkill(name, "active");
      validateDeclaredTools(name);
    }

    const location: ActivationLocation = cfg.activeState
      ? {
          kind: "explicit",
          scope: cfg.activeState.scope,
          field: cfg.activeState.field,
        }
      : { kind: "block" };

    const contributions: Partial<PresetDef> = {};
    // Two buckets (FIX-1393): `tools` is the app-catalog grant, which a
    // consuming block's `tools:` fences. `controlTools` are the framework
    // controls a block only holds because its own config asked for them — the
    // loader — which the fence never touches.
    const tools: GeneratorTool[] = [];
    const controlTools: GeneratorTool[] = [];
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

    // Validate `allowed` names up front so a typo fails loud regardless of
    // which activation path (load tool / upstream matcher / code) feeds it.
    if (cfg.allowed) {
      for (const name of cfg.allowed) {
        assertKnownSkill(name, "allowed");
        validateDeclaredTools(name);
      }
    }

    const dynamic = resolveCtx.presets.has("dynamicActivation");
    const contributesRuntimeTools = dynamic || Boolean(cfg.activeState && cfg.allowed);

    // Whole-catalog dynamic mode (no `allowed`): the load tool can select any
    // bundled inline skill, so validate each one's declared tools. An unscoped
    // explicit activeState alone intentionally contributes no tools: exposing
    // an unbounded catalog without a model-controlled activation path would
    // make every catalog tool callable before any skill is selected.
    if (dynamic && !cfg.allowed) {
      for (const [name, entry] of index) {
        if (entry.contextMode !== "inline" || entry.disableModelInvocation) continue;
        validateDeclaredTools(name);
      }
    }

    // Whenever a skill body can render — statically preloaded (`active`) or
    // activated at runtime (load tool / upstream matcher / code) — register the
    // whole catalog as a safe superset. The skill's own `allowed-tools` does
    // not scope this registration — it renders as an intent note (FIX-1451),
    // not a fence; registering the superset keeps a live post-seeding edit to
    // that list from pointing the model at an unregistered tool.
    //
    // `registerCatalogTools: false` opts out of this registration only —
    // `validateDeclaredTools` above still runs unconditionally, so a caller
    // on this path gets author-feedback validation with no tool grant, and
    // owns registration itself (e.g. a worker's own `tools:` fence).
    if (registerCatalogTools && (active.length > 0 || contributesRuntimeTools)) {
      tools.push(...fullCatalog());
    }

    // `dynamicActivation` preset → install the load tool + catalog listing.
    if (dynamic) {
      // The loader is a CONTROL, not a catalog grant (FIX-1393): a seat gets it
      // by setting `skills.activateTool` in its own config, which is the
      // declaration. It is built here and never exported, so a `tools:` fence
      // could not name it back in — fencing it would leave the seat advertising
      // a tool in its prompt that it cannot call. The catalog registered above
      // stays in `tools`, where the fence can see it.
      // The loader's own description names where the skill names come from,
      // so it has to know which of the two places that is (FIX-817).
      const catalogInContext = resolveCtx.presets.has("catalogContext");
      controlTools.push(
        createLoadSkillTool({
          collectionKey,
          location,
          catalogInContext,
          ...(cfg.allowed ? { allowed: cfg.allowed } : {}),
          ...(initialSkills ? { initialSkills } : {}),
        }),
      );
      // The ambient catalog listing, behind a preset that ships ON (FIX-817).
      //
      // Default-on is the whole point rather than a convenience: an app that
      // upgrades and finds its model no longer knows its skills exist has been
      // broken by a refactor it did not ask for. Turning it off is what an app
      // with a long catalog does once it has installed the discovery door, so
      // the names are fetched when the model goes looking instead of being
      // paid for on every step of every turn.
      //
      // Gated inside `dynamic` because the listing only ever made sense beside
      // the load tool: it names `loadSkill` and lists what that tool accepts.
      // A binding with no loader contributes no listing with the preset on or
      // off, exactly as before.
      if (catalogInContext) {
        contextEntries.push(
          buildLoadCatalogContext({
            collectionKey,
            ...(cfg.allowed ? { allowed: cfg.allowed } : {}),
            ...(initialSkills ? { initialSkills } : {}),
          }),
        );
      }
    }

    // Block-state default: contribute the generator's own `activeSkills` field
    // (FIX-914 PR2). The load tool runs as a child and writes it via `ctx.parent`;
    // the reader runs in the generator's scope and reads `ctx.self`. Because a
    // config resolver's returned surface now flows through the own-state merge
    // (`mergeCapabilityOwnStateWithBlock`), the generator no longer needs to
    // hand-declare `stateSchema: { activeSkills }` — the binding installs it. A
    // consumer that still declares it keeps working: both reference the shared
    // `activeSkillsArraySchema`, so the duplicate field dedups instead of colliding.
    //
    // An explicit `activeState` (scope/field) is deliberately NOT contributed
    // here — it lives at a session/user/org scope, declared where it is written:
    // the upstream matcher (`createApplySkillActivation`) declares its scope
    // schema on its own block, and a code/generator writer declares the field on
    // its own `sessionStateSchema`. The reader tolerates an absent field.
    const ownStateFields: Record<string, z.ZodTypeAny> = {};
    if (location.kind === "block" && dynamic) {
      ownStateFields.activeSkills = activeSkillsArraySchema;
    }

    if (Object.keys(ownStateFields).length > 0) {
      contributions.stateSchema = z.object(ownStateFields);
    }

    // De-dupe by identity so a tool declared by both `active` and `allowed`
    // is contributed once.
    if (tools.length > 0) contributions.tools = [...new Set(tools)];
    if (controlTools.length > 0) contributions.controlTools = [...new Set(controlTools)];

    // Group the reader + catalog under a single `<skills>` tag.
    contributions.context = [{ skills: contextEntries } as never];
    return contributions;
  };

  return defineCapability({
    name: "skills",
    itemVisibility: options.itemVisibility,
    resources,
    presets: {
      // Flag-only preset; the resolver reads `ctx.presets` to install the tool.
      dynamicActivation: {},
      /**
       * The ambient catalog listing in the prompt (FIX-817). Flag-only, and
       * **on by default** — an app that upgrades sees turn 1 unchanged.
       *
       * Turn it off (`library.presets({ catalogContext: false })`) once the
       * discovery door is installed, and the model finds skills by asking
       * rather than by being told on every step.
       */
      catalogContext: {},
      default: ["catalogContext"],
    },
    config: {
      schema: bindingConfigSchema,
      resolve,
    },
  });
}
