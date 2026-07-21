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
 * Fork-mode skills are dispatch routes, not context injections. They install
 * per generator via the `fork` preset (`with({ allowed, fork: true })`), which
 * adds a `forkSkill` tool: calling it spawns a child that inherits the
 * conversation to the fork point, works in isolation, and returns only its
 * result. Pattern-mode skills stay on the `runSkill` router
 * (`createSkillsCapability`) pending their own migration. The inline binding
 * surface (`active` / `allowed` + `dynamicActivation`) is inline-only by
 * construction; `allowed` names a fork set only when the `fork` preset is on.
 */

import { z } from "zod";
import { defineCapability, type DefinedCapability } from "@flow-state-dev/core";
import type {
  DeclaredResourceEntry,
  MessageLimit,
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
import { buildForkCatalogContext, createForkSkillTool } from "./fork-tool";
import { parseSkillMd, validateSkillName } from "./skill-md";

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
  /**
   * Model the `fork` preset's child subagent runs on. This is NOT the host
   * generator's resolved model — a capability tool can't reach it — so a fork
   * child runs on a library-configured model. Default: `intent/chat`.
   */
  forkModelId?: string;
  /**
   * Bound on the history a `fork` child inherits. Whole turns, never split
   * mid-tool-pair. Omitted = inherit all history up to the fork point; set a
   * limit for apps with long conversations where the (uncached) child prompt
   * cost matters.
   */
  forkHistoryLimit?: MessageLimit;
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
      const parsed = parseSkillMd(skill.skillMd);
      index.set(skill.name, {
        allowedTools: parsed.state.allowedTools,
        contextMode: parsed.state.contextMode ?? "inline",
        disableModelInvocation: parsed.state.disableModelInvocation,
      });
    } catch {
      // A malformed or invalidly-named bundled skill is a seeding-time concern;
      // skip it here so config resolution fails loud on a binding to it (via
      // the "unknown skill" path) rather than silently accepting it.
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
        `skills.with({ ${where}: [...] }) binds "${name}" by name, but no bundled ` +
          `skills are available to validate against. Pass valid \`initialSkills\` to ` +
          `createSkillsLibrary() (an empty index also means every bundled skill failed to parse).`,
      );
    }
    const entry = index.get(name);
    if (!entry) {
      throw new Error(
        `skills.with({ ${where}: [...] }): unknown skill "${name}". ` +
          `Known skills: ${[...index.keys()].join(", ") || "(none)"}.`,
      );
    }
    if (entry.contextMode !== "inline") {
      const redirect =
        entry.contextMode === "fork"
          ? `fork skills install via the \`fork\` preset (skills.with({ ${where}: [...], fork: true }))`
          : `pattern skills dispatch through the runSkill router (createSkillsCapability)`;
      throw new Error(
        `skills.with({ ${where}: [...] }): "${name}" is a ${entry.contextMode}-mode ` +
          `skill. Only inline skills can be bound here — ${redirect}.`,
      );
    }
  };

  // Assert a name is a known fork skill (fail loud on typos / wrong mode). The
  // mirror of `assertInline` for the `fork` preset: `allowed` names a fork set
  // there, not an inline one, so the inline check would reject valid fork skills.
  const assertFork = (name: string): void => {
    if (index.size === 0) {
      throw new Error(
        `skills.with({ allowed: [...], fork: true }) binds "${name}" by name, but no ` +
          `bundled skills are available to validate against. Pass valid \`initialSkills\` to ` +
          `createSkillsLibrary() (an empty index also means every bundled skill failed to parse).`,
      );
    }
    const entry = index.get(name);
    if (!entry) {
      throw new Error(
        `skills.with({ allowed: [...], fork: true }): unknown skill "${name}". ` +
          `Known skills: ${[...index.keys()].join(", ") || "(none)"}.`,
      );
    }
    if (entry.contextMode !== "fork") {
      throw new Error(
        `skills.with({ allowed: [...], fork: true }): "${name}" is a ${entry.contextMode}-mode ` +
          `skill. Only fork skills can be bound to the fork preset.`,
      );
    }
  };

  // Validate a bound skill's declared `allowed-tools` all exist in the catalog.
  // Author feedback only — it does NOT scope what gets registered. Tool
  // registration is a safe superset (the whole catalog), like the legacy
  // capability: the reader renders the LIVE manifest, which an admin can edit
  // after seeding, so freezing a per-skill tool subset at build time would let
  // the rendered `allowed-tools` restriction note reference a tool the
  // generator never registered. The per-skill restriction stays a soft,
  // prompt-level scope via the rendered note.
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
      assertInline(name, "active");
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

    const dynamic = resolveCtx.presets.has("dynamicActivation");
    const fork = resolveCtx.presets.has("fork");

    // Validate `allowed` names up front so a typo fails loud regardless of
    // which path consumes them. The `fork` preset reads `allowed` as a fork
    // set; every other path reads it as an inline set — validate accordingly.
    if (cfg.allowed) {
      for (const name of cfg.allowed) {
        if (fork) {
          assertFork(name);
        } else {
          assertInline(name, "allowed");
          validateDeclaredTools(name);
        }
      }
    }

    const hasActivationPath = dynamic || Boolean(cfg.activeState);

    // Whole-catalog mode (activation path + no `allowed`): any bundled inline
    // skill is loadable/activatable, so validate each one's declared tools —
    // the `allowed` loop above only covers an explicit list. Skip fork/pattern
    // skills (can't render/load inline) and `disable-model-invocation` skills
    // (omitted from the catalog and renderer, so never exposed) — validating
    // those would fail construction over a skill that can't reach the model.
    if (hasActivationPath && !cfg.allowed) {
      for (const [name, entry] of index) {
        if (entry.contextMode !== "inline" || entry.disableModelInvocation) continue;
        validateDeclaredTools(name);
      }
    }

    // Whenever a skill body can render — statically preloaded (`active`) or
    // activated at runtime (load tool / upstream matcher / code) — register the
    // whole catalog as a safe superset. The skill's own `allowed-tools` scopes
    // the model softly via the rendered restriction note; registering the
    // superset keeps a live post-seeding edit to that list from pointing the
    // model at an unregistered tool.
    if (active.length > 0 || hasActivationPath) tools.push(...fullCatalog());

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

    // `fork` preset → install the fork tool + fork catalog listing. The tool
    // spawns a child that inherits history to the fork point; the child's tools
    // go to the child, so — unlike inline activation — we do NOT push the full
    // catalog onto the host here. Only the `forkSkill` tool reaches the host.
    if (fork) {
      tools.push(
        createForkSkillTool({
          collectionKey,
          catalog,
          mountPath,
          ...(cfg.allowed ? { allowed: cfg.allowed } : {}),
          ...(initialSkills ? { initialSkills } : {}),
          ...(options.forkModelId !== undefined ? { forkModelId: options.forkModelId } : {}),
          ...(options.forkHistoryLimit !== undefined
            ? { forkHistoryLimit: options.forkHistoryLimit }
            : {}),
        }),
      );
      contextEntries.push(
        buildForkCatalogContext({
          collectionKey,
          ...(cfg.allowed ? { allowed: cfg.allowed } : {}),
          ...(initialSkills ? { initialSkills } : {}),
        }),
      );
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
    if (location.kind === "block" && dynamic) {
      contributions.stateSchema = z.object({ activeSkills: activeSkillsArraySchema });
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
      // Flag-only presets; the resolver reads `ctx.presets` to install the
      // matching tool. `fork` installs the `forkSkill` tool for the binding's
      // `allowed` fork skills.
      dynamicActivation: {},
      fork: {},
      default: [],
    },
    config: {
      schema: bindingConfigSchema,
      resolve,
    },
  });
}
