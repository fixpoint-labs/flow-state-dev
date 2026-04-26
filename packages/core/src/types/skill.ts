/**
 * Skill type contracts for the Skills System (FIX-378).
 *
 * Skills are user-modifiable folders (SKILL.md + supporting files) stored as
 * resources, invoked by the agent via a `runSkill(name, input?)` tool. The
 * framework does not auto-match skills — the model decides when one applies.
 *
 * These types are exported from `@flow-state-dev/core` so other packages
 * (notably `@flow-state-dev/skills`, the runtime implementation) and user
 * code can refer to a single source of truth.
 */

import type { GeneratorTool } from "../blocks/generator";

/**
 * A bag of executable tools that skills may reference by string key.
 *
 * Tools are executable code and cannot round-trip through a resource
 * collection — apps register them once and skills reference them by name
 * via `allowed-tools` in frontmatter. Unknown refs are warned and skipped.
 */
export type ToolCatalog = Record<string, GeneratorTool>;

/**
 * Activation modes for a skill, controlled by `context:` frontmatter.
 *
 * - `inline` (default): skill body is injected into the in-flight generator
 *   on the next tool-loop step via the existing `prepareStep` machinery.
 * - `fork`: skill runs in a subagent with isolated context and tool set.
 */
export type SkillContextMode = "inline" | "fork";

/**
 * Parsed state for a `skills/{name}/SKILL.md` resource. Derived from the
 * file's YAML frontmatter (kebab-case) and stored on the resource as
 * camelCase. Unknown frontmatter keys are preserved on `_preservedFields`
 * for forward-compatibility and round-trip fidelity.
 */
export interface SkillState {
  /** Required. Used in the runSkill tool description and (truncated) in `<ActiveSkills>` UI. */
  description: string;

  /** From `allowed-tools`. Both additive (introduces) and restrictive (gates). */
  allowedTools?: string[];

  /** From `context:` frontmatter. Defaults to `inline` when omitted. */
  contextMode?: SkillContextMode;

  /** From `disable-model-invocation`. When true, skill is excluded from runSkill tool enum. */
  disableModelInvocation?: boolean;

  /** Optional JSON Schema the fork-mode subagent's structured output must conform to. */
  outputSchema?: unknown;

  /** Optional Claude `when_to_use`. Appended to description for runSkill tool surface. */
  whenToUse?: string;

  /** Optional Claude `argument-hint`. Surfaced in tool description; not validated at runtime. */
  argumentHint?: string;

  /**
   * Optional `keywords` array (FIX-421). Lowercase tokens that the up-front
   * intent classifier's tier-2 keyword scan matches against the user message.
   * Skills without any keywords skip tier-2 and become eligible only via
   * tier-3 LLM classification.
   */
  keywords?: string[];

  /** ISO timestamp set by the seeder when an `initialSkills` entry was first written. */
  _seededAt?: string;

  /** Unknown kebab-case frontmatter keys preserved as camelCase for round-trip. */
  _preservedFields?: Record<string, unknown>;
}

/**
 * Resolved skill descriptor — combines parsed frontmatter, the SKILL.md
 * body, and the `name` derived from the parent directory.
 */
export interface Skill {
  /** Skill name = parent directory name. Validated `[a-z0-9-]`, ≤64 chars. */
  name: string;
  /** SKILL.md body (without frontmatter). */
  body: string;
  /** From frontmatter. */
  description: string;
  /** From frontmatter `allowed-tools`. */
  allowedTools?: string[];
  /** From frontmatter `context:`. Default `"inline"`. */
  contextMode?: SkillContextMode;
  /** From frontmatter `disable-model-invocation`. */
  disableModelInvocation?: boolean;
  /** From frontmatter `when_to_use`. Appended to runSkill tool description. */
  whenToUse?: string;
  /** From frontmatter `argument-hint`. */
  argumentHint?: string;
  /** From frontmatter `keywords`. Lowercase tokens for tier-2 intent matching. */
  keywords?: string[];
}

/** Input the agent passes when invoking the runSkill tool. */
export interface RunSkillInput {
  /** Name of the skill to invoke. Must appear in the runSkill tool enum. */
  name: string;
  /** Optional argument string. Substituted for `$ARGUMENTS` in the body. */
  input?: string;
}

/** Output the runSkill tool returns to the agent. */
export interface RunSkillOutput {
  /** The skill name that was invoked. */
  skill: string;
  /** Mode the skill ran in. */
  mode: SkillContextMode;
  /** Inline mode: ack message; the agent should re-read context on the next step. */
  message?: string;
  /** Fork mode: structured result returned from the subagent. */
  result?: unknown;
}

/** A single supporting file within a skill folder. */
export interface SkillFile {
  /** Path relative to the skill folder root (e.g. `"reference/foo.md"`). */
  path: string;
  /** File contents. */
  content: string;
}

/** A code-authored skill, seeded into the org-scoped collection on startup. */
export interface InitialSkill {
  /** Skill name. Must match `[a-z0-9-]+`. */
  name: string;
  /** Full SKILL.md text including YAML frontmatter. */
  skillMd: string;
  /** Optional supporting files written alongside SKILL.md. */
  files?: SkillFile[];
}

/** Internal seeding metadata stored at `{collectionPrefix}/_meta`. */
export interface SkillsCollectionMeta {
  /** Names already seeded. New `initialSkills` entries with names not in this
   *  list are seeded on the next hydrate; deletions persist (a name stays in
   *  this list even after the user deletes the folder). */
  seededNames: string[];
}

// ---------------------------------------------------------------------------
// Intent classification (FIX-421)
// ---------------------------------------------------------------------------

/**
 * Origin of a skill-activation match. Carried on `MatchedSkill` so downstream
 * consumers (trace UI, telemetry) can branch on how the decision was reached.
 */
export type IntentSource =
  | "slash"            // user typed `/skill-name`
  | "keyword"          // local keyword scan matched
  | "classifier"       // LLM classifier produced the match
  | "manual-override"; // explicit user/UI selection bypassed classification

/**
 * One skill matched by an intent-classification pass. Multiple may be active
 * per turn — the up-front intent selector activates all of them in inline
 * mode by default.
 */
export interface MatchedSkill {
  /** Skill name. Must exist in the skills collection at activation time. */
  name: string;
  /** Argument substituted for `$ARGUMENTS` in the skill body. Empty if none. */
  input: string;
  /** Which tier of `intentSelector` produced this match. */
  source: IntentSource;
  /** Classifier confidence (0..1). Only present when `source === "classifier"`. */
  confidence?: number;
}
