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

// Skills v2 (FIX-911) — shared library + per-generator binding via config.
export {
  createSkillsLibrary,
  type SkillsLibraryOptions,
  type SkillsBindingConfig,
} from "./library";

export {
  BLOCK_LOCATION,
  BLOCK_STATE_FIELD,
  readActivations,
  appendActivation,
  type ActivationLocation,
  type ExplicitActivationScope,
} from "./activation-store";

export {
  buildSkillBindingReader,
  type SkillBindingReaderOptions,
} from "./binding-reader";

export {
  createLoadSkillTool,
  buildLoadCatalogContext,
  type LoadSkillToolOptions,
  type LoadCatalogContextOptions,
} from "./load-tool";

export { renderActiveSkillBody } from "./render-skill-body";

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
  activeSkillsArraySchema,
  pushActiveSkill,
  readActiveSkills,
  unionAllowedTools,
  type ActivePatternMeta,
  type ActiveSkillEntry,
} from "./active-skill-state";

export {
  createPatternRegistry,
  type MaterializedPattern,
  type PatternFactory,
  type PatternRegistry,
  type PatternRegistryDeps,
} from "./pattern-registry";

export {
  buildUserMessage,
  materializeWorker,
  workerInputSchema,
} from "./worker-materializer";

export {
  createPatternRunRoute,
  type PatternRunRouterOptions,
} from "./pattern-run";

export {
  createTaskToolsCapability,
  taskTools,
} from "./task-tools-capability";

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

// Skill activation (FIX-421) — up-front skill activation router.
export {
  createSkillActivator,
  type SkillActivatorOptions,
} from "./skill-activator";
// Public runtime shapes mirroring the SkillActivationSource / MatchedSkill
// types in @flow-state-dev/core. Useful for consumers writing their own
// apply handlers or inspecting `activeSkills` entries from clientData.
export {
  skillActivationSourceSchema,
  matchedSkillSchema,
} from "./skill-activation-types";

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
  MatchedSkill,
  RunSkillInput,
  RunSkillOutput,
  Skill,
  SkillActivationSource,
  SkillContextMode,
  SkillFile,
  SkillState,
  SkillsCollectionMeta,
  ToolCatalog,
} from "@flow-state-dev/core";
