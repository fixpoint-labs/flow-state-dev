/**
 * `@flow-state-dev/skills` — runtime implementation of the FIX-378 Skills
 * System. Skills are user-modifiable folders (SKILL.md + supporting files)
 * stored as resources, invoked by the agent through a `runSkill` tool.
 *
 * The package is structured so each layer is independently usable:
 *   - `defineSkillsCollection`, `parseSkillMd`, `serializeSkillMd` —
 *     primitives for working with the on-disk format.
 *   - `createRunSkillTool` — the router tool, exported for embedding in
 *     custom generator configurations that don't go through the capability.
 *   - `createSkillForkGenerator`, `inlineActivate` — the two dispatch
 *     branches, exported so custom tool wiring can reuse them.
 *   - `buildSkillsCatalogContext`, `buildActiveSkillsContext` — the dynamic
 *     context formatters, exported for the same reason.
 *   - `createSkillsCapability` — the recommended path: bundles all of the
 *     above into one `uses: [skillsCap]` slot.
 *   - `readSkillsDirectory`, `importSkillsDirectory` — Node-only directory
 *     walkers for build-time and runtime ingestion.
 *
 * Type contracts live in `@flow-state-dev/core` (re-exported here for
 * convenience) so other packages can refer to them without depending on
 * the runtime.
 */

export {
  createSkillsCapability,
  type SkillsCapabilityOptions,
} from "./capability";

export {
  defineSkillsCollection,
  skillStateSchema,
  skillManifestKey,
  skillFileKey,
  META_KEY,
  type DefineSkillsCollectionOptions,
} from "./collection";

export {
  parseSkillMd,
  serializeSkillMd,
  substitute,
  validateSkillName,
  toSkill,
  kebabToCamel,
  camelToKebab,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  type ParsedSkillMd,
  type SubstitutionContext,
} from "./skill-md";

export {
  createRunSkillTool,
  buildRunSkillDescription,
  listEnabledSkills,
  type RunSkillToolOptions,
} from "./run-skill-tool";

export {
  buildActiveSkillsContext,
  buildSkillsCatalogContext,
  type SkillsContextOptions,
} from "./context-fn";

export {
  activeSkillStateSchema,
  pushActiveSkill,
  readActiveSkills,
  unionAllowedTools,
  type ActivePatternMeta,
  type ActiveSkillEntry,
} from "./active-skill-state";

export {
  createPatternRegistry,
  type PatternFactory,
  type PatternRegistry,
  type PatternRegistryDeps,
} from "./pattern-registry";

export {
  materializeWorker,
} from "./worker-materializer";

export {
  getActivePatternCollection,
  getActivePatternMeta,
} from "./active-pattern-collection";

export {
  ensureSeeded,
} from "./seeding";

export {
  createSkillForkGenerator,
  forkInputSchema,
  type CreateSkillForkGeneratorOptions,
  type SkillForkInput,
} from "./fork-generator";

export {
  inlineActivate,
  inlineActivateInputSchema,
  inlineActivateOutputSchema,
} from "./inline-activate";

// Intent classification (FIX-421) — up-front skill activation router.
export {
  createIntentSelector,
  type IntentSelectorOptions,
} from "./intent-selector";
// Public runtime shapes mirroring the IntentSource / MatchedSkill types
// in @flow-state-dev/core. Useful for consumers writing their own apply
// handlers or inspecting `activeSkills` entries from clientData.
export {
  intentSourceSchema,
  matchedSkillSchema,
} from "./intent-types";

export {
  readSkillsDirectory,
  type ReadSkillsDirectoryOptions,
} from "./read-directory";

export {
  importSkillsDirectory,
  type ImportSkillsDirectoryOptions,
  type ImportSkillsDirectoryResult,
} from "./import-directory";

// Re-export the canonical types from core.
export type {
  InitialSkill,
  IntentSource,
  MatchedSkill,
  RunSkillInput,
  RunSkillOutput,
  Skill,
  SkillContextMode,
  SkillFile,
  SkillState,
  SkillsCollectionMeta,
  ToolCatalog,
} from "@flow-state-dev/core";
