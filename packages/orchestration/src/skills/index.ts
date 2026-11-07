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

// The skills domain's projection into the discovery door (FIX-817). Registered
// on a scope's manifest registry beside the other domains' sources.
export {
  skillsManifestSource,
  type SkillsManifestSourceOptions,
} from "./manifest-source";

export {
  defineSkillsCollection,
  type DefineSkillsCollectionOptions,
} from "./collection";

export {
  type SkillsPartitionFn,
} from "./partition";

export {
  parseSkillMd,
  serializeSkillMd,
  type ParsedSkillMd,
  type ParseSkillMdOptions,
} from "./skill-md";

export {
  createRunSkillTool,
  type RunSkillToolOptions,
} from "./run-skill-tool";

export {
  activeSkillsArraySchema,
} from "./active-skill-state";

export {
  createTaskToolsCapability,
  type TaskToolsOptions,
  type TaskCollectionResolver,
  // Part of `createTaskToolsCapability`'s signature, so a caller supplying a
  // roster can name its type.
  type AssigneeRoster,
  // A roster fixed, or read per call from the running context (FIX-1794 T1).
  type AssigneeRosterSource,
  // A task turn's question and a turn's stop for the user, and the rules for
  // offering them (FIX-2131).
  createHoldTaskForUser,
  createSuspendForUserTool,
  type TaskTurnToolOptions,
  // A task turn's own progress report and the rule for offering it (FIX-2081).
  createReportProgress,
  type ReportProgressOptions,
} from "./task-tools-capability";

// Seeding writes a copy, so pulling a source edit onto a catalog that already
// holds the skill is its own deliberate call.
export {
  refreshSeededSkills,
  type RefreshSeededSkillsResult,
} from "./refresh";

// What a library is seeded FROM. Public because the resolver form is how a
// consumer whose catalog is per-instance (a hired worker) says where its own set
// lives without this layer learning what an instance is.
export {
  type InitialSkillsSource,
} from "./initial-skills";

export {
  inlineActivate,
} from "./inline-activate";

// Skill activation (FIX-421) — up-front skill activation router.
export {
  createSkillActivator,
  type SkillActivatorOptions,
} from "./skill-activator";
// Tier 3 on an evaluation model: the helper that builds the activator's
// evaluator, and the question a hand-built one asks.
export {
  skillEvaluator,
  skillQuestions,
  skillEvaluatorInputSchema,
  type RecentMessage,
  type SkillEvaluatorBlock,
  type SkillEvaluatorInput,
  type SkillEvaluatorOptions,
  type SkillQuestions,
} from "./skill-evaluator";
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
export type { InitialSkill, MatchedSkill, SkillActivationSource, SkillContextMode, SkillFile, SkillState, ToolCatalog } from "@flow-state-dev/core/types";
