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
import { deepEqual } from "@flow-state-dev/core/helpers";
import type {
  DeclaredResourceEntry,
  ResourceScope,
} from "@flow-state-dev/core/types";
import type { CapabilityConfigResolveCtx } from "@flow-state-dev/core/capability";
import type {
  BlockDefinition,
  GeneratorTool,
  InitialSkill,
  ItemVisibility,
  PresetDef,
  SkillContextMode,
  SkillFile,
  ToolCatalog,
  WorkerSpec,
} from "@flow-state-dev/core";
import { activeSkillsArraySchema } from "./active-skill-state";
import type { ActivationLocation } from "./activation-store";
import { buildSkillBindingReader } from "./binding-reader";
import {
  defineSkillsCollection,
  type DefineSkillsCollectionOptions,
} from "./collection";
import { buildLoadCatalogContext, createLoadSkillTool } from "./load-tool";
import { parseSkillMd, validateSkillName } from "./skill-md";
import {
  buildDelegationGuidance,
  buildDelegationTools,
  RUN_BOARD_TOOL_NAME,
  type DelegationSurfaceDeps,
  type DelegationWorkerSource,
} from "./delegation-surface";
import {
  DELEGATION_BOARD_FIELD,
  delegationBoardSchema,
} from "./task-tools-capability";

/** Model-facing names the eight `taskTools` handlers register. */
const TASK_TOOL_NAMES = new Set([
  "addTask",
  "assignTask",
  "completeTask",
  "failTask",
  "blockTask",
  "cancelTask",
  "updateTask",
  "listTasks",
]);

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
   * Block registry for delegation workers declared with `block-ref:`. Unknown
   * refs fail loud at bind time.
   */
  blocks?: Record<string, BlockDefinition>;
  /**
   * Model id for delegation worker tools that don't declare their own `model:`.
   * Falls back to a neutral default when omitted.
   */
  workerModelId?: string;
  /**
   * Agent registry for delegation workers declared with `agent-ref:`. Workers
   * materialize at runtime (the tool surface resolves async), so registry
   * lookups can await. A statically-`active` skill with an `agent-ref` worker
   * and no registry fails loud at build time.
   */
  agentRegistry?: import("@flow-state-dev/core").AgentRegistry;
  /** Turns a resolved Agent into a worker generator (pairs with `agentRegistry`). */
  materializeAgent?: import("@flow-state-dev/core").MaterializeAgentFn;
  /** Optional capability catalog forwarded to `materializeAgent`. */
  capabilityCatalog?: Record<string, DefinedCapability>;
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
  /**
   * Force-off delegation even when a bound skill declares `workers:`. Delegation
   * is otherwise derived automatically from the presence of `workers:` (FIX-918).
   */
  delegation?: boolean;
  /**
   * Opt out of the delegation guidance context (the static "how to orchestrate"
   * playbook + live worker roster). Default on when delegation installs.
   */
  guidance?: boolean;
}

// ---------------------------------------------------------------------------
// Build-time skill index (from bundled defaults)
// ---------------------------------------------------------------------------

interface IndexedSkill {
  allowedTools?: string[];
  contextMode: SkillContextMode;
  /** `disable-model-invocation` — the skill can't be exposed to the model. */
  disableModelInvocation?: boolean;
  /** Declared delegation workers (FIX-918). Presence turns on delegation. */
  workers?: Record<string, WorkerSpec>;
  /** Bundled skill files — used to resolve `prompt-ref` worker bodies at build time. */
  files?: SkillFile[];
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
        ...(parsed.state.workers ? { workers: parsed.state.workers } : {}),
        ...(skill.files ? { files: skill.files } : {}),
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
    delegation: z.boolean().optional(),
    guidance: z.boolean().optional(),
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

  // Assert a name is a known skill (fail loud on typos). Binding by name
  // requires a bundled catalog to validate against — if none parsed (no
  // `initialSkills`, or every bundled skill was malformed), that's an author
  // error, not a reason to silently skip validation and widen the tool surface.
  // After FIX-918 every skill is inline, so there is no non-inline mode to
  // reject here — the surface is inline-by-construction.
  const assertKnownSkill = (name: string, where: "active" | "allowed"): void => {
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

    // Validate `allowed` names up front so a typo fails loud regardless of
    // which activation path (load tool / upstream matcher / code) feeds it.
    if (cfg.allowed) {
      for (const name of cfg.allowed) {
        assertKnownSkill(name, "allowed");
        validateDeclaredTools(name);
      }
    }

    const dynamic = resolveCtx.presets.has("dynamicActivation");
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

    // -----------------------------------------------------------------------
    // Delegation (FIX-918) — derived from a bound skill's `workers:`.
    // -----------------------------------------------------------------------
    // A bound skill that declares `workers:` installs the delegation surface:
    // a private own-state task board, the `taskTools` ledger, one direct-call
    // tool per worker, the `runBoard` drain, and (unless opted out) a guidance
    // context. `delegation: false` force-suppresses it.
    //
    // Workers materialize at RUNTIME: the contributed tool surface is an async
    // function the generator resolves per execution with its full context, so
    // `agent-ref` workers (async registry lookups) and runtime-activated
    // worker skills are first-class. Static wiring errors still fail loud at
    // build time via the validation pass below.
    const delegationOn = cfg.delegation !== false;
    const staticWorkerSkills = delegationOn
      ? active
          .map((name) => ({ name, entry: index.get(name)! }))
          .filter((s) => s.entry.workers && Object.keys(s.entry.workers).length > 0)
      : [];

    // Build-time validation for the static set — collisions and missing
    // wiring surface here, not mid-request.
    const reservedToolNames: ReadonlySet<string> = new Set<string>([
      ...TASK_TOOL_NAMES,
      RUN_BOARD_TOOL_NAME,
      ...Object.keys(catalog),
    ]);
    const seenWorkerNames = new Set<string>(reservedToolNames);
    const seenWorkerSpecs = new Map<string, WorkerSpec>();
    for (const { name: skillName, entry } of staticWorkerSkills) {
      for (const [workerKey, spec] of Object.entries(entry.workers!)) {
        if (seenWorkerNames.has(workerKey)) {
          // Two active skills may share a worker (e.g. a common synthesizer).
          // An IDENTICAL spec dedupes into one tool; anything else — a
          // different spec, or a reserved/catalog name — is a real collision.
          const prior = seenWorkerSpecs.get(workerKey);
          if (prior && deepEqual(prior, spec)) continue;
          throw new Error(
            `skills: delegation worker "${workerKey}" (skill "${skillName}") collides ` +
              `with an existing tool name (a taskTools handler, ${RUN_BOARD_TOOL_NAME}, a ` +
              `catalog tool, or a different worker under the same key). Rename the worker key.`,
          );
        }
        seenWorkerNames.add(workerKey);
        seenWorkerSpecs.set(workerKey, spec);
        if (
          spec.agentRef !== undefined &&
          (!options.agentRegistry || !options.materializeAgent)
        ) {
          throw new Error(
            `skills: delegation worker "${workerKey}" (skill "${skillName}") uses ` +
              `agent-ref "${spec.agentRef}", but createSkillsLibrary() was given no ` +
              `\`agentRegistry\`/\`materializeAgent\` to resolve it with.`,
          );
        }
        if (spec.promptRef !== undefined && !hasBundledFile(entry.files, spec.promptRef)) {
          throw new Error(
            `skills: delegation worker "${workerKey}" (skill "${skillName}") declares ` +
              `prompt-ref "${spec.promptRef}", but no such file is bundled with the skill.`,
          );
        }
        if (spec.blockRef !== undefined && !(options.blocks ?? {})[spec.blockRef]) {
          const available = Object.keys(options.blocks ?? {}).join(", ") || "(empty)";
          throw new Error(
            `skills: delegation worker "${workerKey}" (skill "${skillName}") declares ` +
              `block-ref "${spec.blockRef}", which is not in the \`blocks\` registry. ` +
              `Available: ${available}`,
          );
        }
      }
    }

    // Runtime activations can bring workers too: whole-catalog mode admits any
    // bundled (or later-imported) skill, an `allowed` list only its entries.
    // Own-state can't be added mid-run, so the board field is pre-declared for
    // any binding that MIGHT resolve a worker-declaring skill (harmless if
    // unused — it defaults to an empty record).
    const dynamicWorkerEligible =
      hasActivationPath &&
      (cfg.allowed
        ? cfg.allowed.some((name) => {
            const entry = index.get(name);
            return Boolean(entry?.workers && Object.keys(entry.workers).length > 0);
          })
        : true);
    const delegationPossible =
      delegationOn && (staticWorkerSkills.length > 0 || dynamicWorkerEligible);
    if (delegationPossible) {
      ownStateFields[DELEGATION_BOARD_FIELD] = delegationBoardSchema;
    }

    if (Object.keys(ownStateFields).length > 0) {
      contributions.stateSchema = z.object(ownStateFields);
    }

    if (delegationPossible) {
      const surfaceDeps: DelegationSurfaceDeps = {
        catalog,
        ...(options.blocks ? { blocks: options.blocks } : {}),
        ...(options.agentRegistry ? { agentRegistry: options.agentRegistry } : {}),
        ...(options.materializeAgent
          ? { materializeAgent: options.materializeAgent }
          : {}),
        ...(options.capabilityCatalog
          ? { capabilityCatalog: options.capabilityCatalog }
          : {}),
        ...(options.workerModelId !== undefined
          ? { defaultModelId: options.workerModelId }
          : {}),
        collectionKey,
        location,
        staticSources: staticWorkerSkills.map(
          ({ name, entry }): DelegationWorkerSource => ({
            skillName: name,
            workers: entry.workers!,
            ...(entry.files ? { files: entry.files } : {}),
          }),
        ),
        bundledWorkerIndex: buildBundledWorkerIndex(index),
        ...(cfg.allowed ? { allowedNames: cfg.allowed } : {}),
        dynamicEligible: dynamicWorkerEligible,
        reservedToolNames,
      };
      // Static tools (catalog superset + load tool) are known now; the worker
      // tools, taskTools, and runBoard resolve per execution.
      const staticTools = [...new Set(tools)];
      contributions.tools = (async (blockCtx) => [
        ...staticTools,
        ...(await buildDelegationTools(blockCtx as never, surfaceDeps)),
      ]) as PresetDef["tools"];
      // Guidance context — the "how to delegate" playbook + live roster,
      // resolved at render time so runtime activations appear too.
      if (cfg.guidance !== false) {
        contextEntries.push(buildDelegationGuidance(surfaceDeps) as never);
      }
    } else if (tools.length > 0) {
      // De-dupe by identity so a tool declared by both `active` and `allowed`
      // is contributed once.
      contributions.tools = [...new Set(tools)];
    }

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
      default: [],
    },
    config: {
      schema: bindingConfigSchema,
      resolve,
    },
  });
}

// ---------------------------------------------------------------------------
// Delegation helpers (FIX-918)
// ---------------------------------------------------------------------------

/** Whether a skill's bundled files contain the given `prompt-ref` path. */
function hasBundledFile(files: SkillFile[] | undefined, ref: string): boolean {
  const wanted = ref.replace(/^\.\//, "").replace(/^\//, "");
  return (files ?? []).some(
    (f) => f.path === wanted || f.path.replace(/^\.\//, "") === wanted,
  );
}

/**
 * Project the bundled index down to worker-declaring skills, so a runtime
 * activation of a bundled skill materializes without a manifest read.
 */
function buildBundledWorkerIndex(
  index: Map<string, IndexedSkill>,
): Map<string, { workers: Record<string, WorkerSpec>; files?: SkillFile[] }> {
  const out = new Map<string, { workers: Record<string, WorkerSpec>; files?: SkillFile[] }>();
  for (const [name, entry] of index) {
    if (!entry.workers || Object.keys(entry.workers).length === 0) continue;
    out.set(name, {
      workers: entry.workers,
      ...(entry.files ? { files: entry.files } : {}),
    });
  }
  return out;
}
