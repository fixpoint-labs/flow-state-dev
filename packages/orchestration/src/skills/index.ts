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
 *   - `inlineActivate` — the inline activation branch, exported so custom
 *     tool wiring can reuse it.
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
// The activation-store, binding reader, and load tool are binding internals
// composed by `createSkillsLibrary`, not public surface (BP-038). Only the
// scope union leaks through `createSkillActivator`'s public options.
export {
  createSkillsLibrary,
  type SkillsLibraryOptions,
  type SkillsBindingConfig,
} from "./library";

export type { ExplicitActivationScope } from "./activation-store";

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
  type ActiveSkillEntry,
} from "./active-skill-state";

export {
  buildUserMessage,
  materializeWorker,
  workerInputSchema,
  type WorkerMaterializationDeps,
} from "./worker-materializer";

export {
  createTaskToolsCapability,
  taskTools,
  defaultOwnStateResolver,
  DELEGATION_BOARD_FIELD,
  delegationBoardSchema,
  type TaskCollectionResolver,
} from "./task-tools-capability";

export {
  ensureSeeded,
} from "./seeding";

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
