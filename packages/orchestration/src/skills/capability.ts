/**
 * `createSkillsCapability()` — the public API surface for wiring a skills
 * system into a generator.
 *
 * Returns a `DefinedCapability` exposing:
 *   - **Resources**: the skills collection, registered at the chosen scope
 *     (default `org`).
 *   - **Session state**: an `activeSkills` array fragment used by the
 *     dynamic context formatter to read which skills are currently active.
 *   - **Preset `tools`** (default-on): the catalog of skill-referenceable
 *     tools, registered for AI SDK schema awareness.
 *   - **Preset `context`** (default-on): the active-skill body formatter —
 *     required for any matched skill to actually appear in the system
 *     prompt, regardless of which activation path matched it.
 *   - **Preset `runSkill`** (default-on): the mid-flow activation path —
 *     the `runSkill` tool plus the catalog listing the model reads to
 *     decide when to call it. Drop with `cap.presets({ runSkill: false })`
 *     when using up-front activation via `createSkillActivator`.
 */

import { defineCapability, type DefinedCapability } from "@flow-state-dev/core";
import type {
  BlockDefinition,
  DeclaredResourceEntry,
  ResourceScope,
} from "@flow-state-dev/core/types";
import type {
  AgentRegistry,
  DefinedCapability as DefCap,
  InitialSkill,
  ItemVisibility,
  MaterializeAgentFn,
  ToolCatalog,
} from "@flow-state-dev/core";
import {
  defineSkillsCollection,
  type DefineSkillsCollectionOptions,
} from "./collection";
import { activeSkillStateSchema } from "./active-skill-state";
import {
  buildActiveSkillsContext,
  buildSkillsCatalogContext,
} from "./context-fn";
import { createRunSkillTool } from "./run-skill-tool";
import type { PatternRegistry } from "./pattern-registry";
import { taskTools as taskToolsCapability } from "./task-tools-capability";

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

export interface SkillsCapabilityOptions {
  /** Resource registry key for the skills collection. Default `"skills"`. */
  collection?: string;
  /** Tool catalog. Skills reference these by string key via `allowed-tools`. */
  catalog?: ToolCatalog;
  /** Bundled defaults — seeded into the collection on first runSkill call. */
  initialSkills?: InitialSkill[];
  /**
   * Scope to register the skills collection at. Default `"org"` so
   * seeded skills are shared across users. Use `"user"` for personal
   * skill libraries; `"session"` is mainly for tests.
   */
  scope?: ResourceScope;
  /**
   * Optional collection sizing overrides. The `prefix` here doubles as the
   * skills workspace mount path: `${SKILL_DIR}` resolves to
   * `/workspace/<prefix>/<skill-name>/` when the skills collection is
   * mounted via the bash capability (the default mount setup).
   */
  collectionConfig?: Pick<DefineSkillsCollectionOptions, "maxInstances" | "prefix">;
  /** Optional override of the model fork-mode subagents run on. */
  forkModelId?: string;
  /**
   * Restrict this capability to blocks with a matching `itemVisibility`.
   *
   * Omitted (default): every generator that declares skills via `uses:`
   * gets the full body + runSkill tool.
   * Set to `{ client: true, history: true }` in multi-agent patterns so
   * only the main agent (planner, supervisor, blackboard synthesizer)
   * coordinates with skills; workers
   * (`itemVisibility: { client: true, history: false }`) don't duplicate
   * the skill body into their context on every step.
   * See CapabilityConfig.itemVisibility.
   */
  itemVisibility?: ItemVisibility | readonly ItemVisibility[];

  /**
   * Optional pattern registry. When supplied, skills declaring `pattern:`
   * frontmatter dispatch through the pattern route and the `taskTools`
   * capability is composed in by default; when absent, those skills fail
   * with a clear configuration error at activation.
   */
  patternRegistry?: PatternRegistry;

  /**
   * Optional block-ref registry threaded to pattern workers using
   * `block-ref:`. Unknown refs fail at activation with a clear error.
   */
  blockRegistry?: Record<string, BlockDefinition>;

  /**
   * Default-on when `patternRegistry` is supplied. Set `false` to skip
   * composing the `taskTools` capability — agents lose the runtime
   * mutation surface (`addTask`, `completeTask`, etc.) but the
   * declarative pattern dispatch still works.
   */
  taskTools?: boolean;

  /**
   * Optional AgentRegistry for pattern workers using `agent-ref:`.
   * Wire alongside `materializeAgent` from `@flow-state-dev/workforce`.
   */
  agentRegistry?: AgentRegistry;

  /**
   * Optional capability catalog forwarded to `materializeAgent` for
   * resolving an agent's `usesCapabilities`.
   */
  capabilityCatalog?: Record<string, DefCap>;

  /**
   * Injected materializer that turns a resolved Agent into a worker-shaped
   * generator. Import from `@flow-state-dev/workforce`.
   */
  materializeAgent?: MaterializeAgentFn;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a skills capability. The result plugs into any generator via
 * `uses: [skillsCap]`. Two presets are on by default:
 *   - `tools` — `runSkill` plus the full tool catalog
 *   - `context` — dynamic catalog listing + active-skill bodies
 */
export function createSkillsCapability(
  options: SkillsCapabilityOptions = {},
): DefinedCapability {
  const collectionKey = options.collection ?? "skills";
  const catalog: ToolCatalog = options.catalog ?? {};
  const scope: ResourceScope = options.scope ?? "org";
  const initialSkills = options.initialSkills;

  // The collection's pattern prefix IS the workspace mount path: when the
  // bash capability auto-discovers collections, it mounts them at their
  // pattern prefix, and `${SKILL_DIR}` has to point there.
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

  const runSkillTool = createRunSkillTool({
    collectionKey,
    catalog,
    initialSkills,
    mountPath,
    ...(options.forkModelId !== undefined ? { forkModelId: options.forkModelId } : {}),
    ...(options.patternRegistry ? { patternRegistry: options.patternRegistry } : {}),
    ...(options.blockRegistry ? { blockRegistry: options.blockRegistry } : {}),
    ...(options.agentRegistry ? { agentRegistry: options.agentRegistry } : {}),
    ...(options.materializeAgent ? { materializeAgent: options.materializeAgent } : {}),
    ...(options.capabilityCatalog ? { capabilityCatalog: options.capabilityCatalog } : {}),
  });

  const catalogTools = Object.values(catalog);

  const catalogContext = buildSkillsCatalogContext({
    collectionKey,
    mountPath,
    // Pass initialSkills so the catalog formatter can seed on its first
    // render — otherwise the catalog shows empty on turn 1 and the model
    // never calls runSkill, blocking seeding entirely.
    initialSkills,
  });
  const activeContext = buildActiveSkillsContext({
    collectionKey,
    mountPath,
  });

  const composesTaskTools =
    options.patternRegistry !== undefined && options.taskTools !== false;

  return defineCapability({
    name: "skills",
    itemVisibility: options.itemVisibility,
    ...(composesTaskTools ? { uses: [taskToolsCapability] as const } : {}),

    // Always-on surface: the resource collection and the session-state slice
    // active-skills writes into. The collection's intrinsic `scope` (set via
    // `defineSkillsCollection({ scope })`) determines which storage layer
    // holds its state — consumers reach for it via `ctx.resources[collectionKey]`.
    resources,
    sessionStateSchema: activeSkillStateSchema,

    presets: {
      // Catalog tools — registered for AI SDK schema awareness so any
      // skill (inline or fork mode) can reference them via allowed-tools.
      tools: { tools: [...catalogTools] },

      // Active-skill body formatter — required for any matched skill to
      // appear in the system prompt. Both activation paths (up-front via
      // skillActivator, mid-flow via runSkill) feed it via
      // session.state.activeSkills. Aggregates under the `<skills>`
      // tag with the runSkill catalog when both presets are on.
      context: { context: { skills: [activeContext] } },

      // Mid-flow activation: the runSkill tool + the catalog listing the
      // model reads to decide when to call it. Drop with
      // `cap.presets({ runSkill: false })` when using up-front activation
      // via createSkillActivator — the active-skills formatter above
      // still injects the matched skill's body.
      runSkill: {
        tools: [runSkillTool],
        context: { skills: [catalogContext] },
      },

      default: ["tools", "context", "runSkill"],
    },
  });
}
