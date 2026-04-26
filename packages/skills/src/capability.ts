/**
 * `createSkillsCapability()` — the public API surface for wiring a skills
 * system into a generator.
 *
 * Returns a `DefinedCapability` exposing:
 *   - **Resources**: the skills collection, registered at the chosen scope
 *     (default `project`).
 *   - **Session state**: an `__activeSkills` array fragment used by the
 *     dynamic context formatter to read which skills are currently active.
 *   - **Preset `tools`** (default-on): the catalog of skill-referenceable
 *     tools, registered for AI SDK schema awareness.
 *   - **Preset `context`** (default-on): the active-skill body formatter —
 *     required for any matched skill to actually appear in the system
 *     prompt, regardless of which activation path matched it.
 *   - **Preset `runSkill`** (default-on): the mid-flow activation path —
 *     the `runSkill` tool plus the catalog listing the model reads to
 *     decide when to call it. Drop with `cap.presets({ runSkill: false })`
 *     when using up-front activation via `createIntentSelector`.
 */

import { defineCapability, type DefinedCapability } from "@flow-state-dev/core";
import type {
  DeclaredResourceEntry,
  ScopeType,
} from "@flow-state-dev/core/types";
import type { AgentType, InitialSkill, ToolCatalog } from "@flow-state-dev/core";
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
   * Scope to register the skills collection at. Default `"project"` so
   * seeded skills are shared across users. Use `"user"` for personal
   * skill libraries; `"session"` is mainly for tests.
   */
  scope?: ScopeType;
  /**
   * Optional collection sizing overrides. The `prefix` here doubles as the
   * skills workspace mount path: `${CLAUDE_SKILL_DIR}` resolves to
   * `/workspace/<prefix>/<skill-name>/` when the skills collection is
   * mounted via the bash capability (the default mount setup).
   */
  collectionConfig?: Pick<DefineSkillsCollectionOptions, "maxInstances" | "prefix">;
  /** Optional override of the model fork-mode subagents run on. */
  forkModelId?: string;
  /**
   * Restrict this capability to blocks with a matching `agentType`.
   *
   * Omitted (default): every generator that declares skills via `uses:`
   * gets the full body + runSkill tool.
   * Set to `"primary"` in multi-agent patterns so only the main agent
   * (planner, supervisor, blackboard synthesizer) coordinates with skills;
   * workers (`agentType: "sub"`) don't duplicate the skill body into their
   * context on every step. See CapabilityConfig.agentType.
   */
  agentType?: AgentType | readonly AgentType[];
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
  const scope: ScopeType = options.scope ?? "project";
  const initialSkills = options.initialSkills;

  // The collection's pattern prefix IS the workspace mount path: when the
  // bash capability auto-discovers collections, it mounts them at their
  // pattern prefix, and `${CLAUDE_SKILL_DIR}` has to point there.
  const collectionPrefix = options.collectionConfig?.prefix ?? collectionKey;
  const mountPath = collectionPrefix;

  const skillsCollection = defineSkillsCollection({
    prefix: collectionPrefix,
    maxInstances: options.collectionConfig?.maxInstances,
  });

  const resources: Record<string, DeclaredResourceEntry> = {
    [collectionKey]: skillsCollection,
  };

  const runSkillTool = createRunSkillTool({
    collectionKey,
    scope,
    catalog,
    initialSkills,
    mountPath,
    forkModelId: options.forkModelId,
  });

  const catalogTools = Object.values(catalog);

  const catalogContext = buildSkillsCatalogContext({
    collectionKey,
    scope,
    mountPath,
    // Pass initialSkills so the catalog formatter can seed on its first
    // render — otherwise the catalog shows empty on turn 1 and the model
    // never calls runSkill, blocking seeding entirely.
    initialSkills,
  });
  const activeContext = buildActiveSkillsContext({
    collectionKey,
    scope,
    mountPath,
  });

  // Resources are declared on the appropriate scope-specific field so the
  // framework auto-installs them.
  const sessionResources = scope === "session" ? resources : undefined;
  const userResources = scope === "user" ? resources : undefined;
  const projectResources = scope === "project" ? resources : undefined;

  return defineCapability({
    name: "skills",
    agentType: options.agentType,

    // Always-on surface: the resource collection and the session-state slice
    // active-skills writes into.
    sessionResources,
    userResources,
    projectResources,
    sessionStateSchema: activeSkillStateSchema,

    presets: {
      // Catalog tools — registered for AI SDK schema awareness so any
      // skill (inline or fork mode) can reference them via allowed-tools.
      tools: { tools: [...catalogTools] },

      // Active-skill body formatter — required for any matched skill to
      // appear in the system prompt. Both activation paths (up-front via
      // intentSelector, mid-flow via runSkill) feed it via
      // session.state.__activeSkills. Aggregates under the `<skills>`
      // tag with the runSkill catalog when both presets are on.
      context: { context: { skills: [activeContext] } },

      // Mid-flow activation: the runSkill tool + the catalog listing the
      // model reads to decide when to call it. Drop with
      // `cap.presets({ runSkill: false })` when using up-front activation
      // via createIntentSelector — the active-skills formatter above
      // still injects the matched skill's body.
      runSkill: {
        tools: [runSkillTool],
        context: { skills: [catalogContext] },
      },

      default: ["tools", "context", "runSkill"],
    },
  });
}
