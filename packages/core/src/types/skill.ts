/**
 * Skill type contracts for the Skills System (FIX-378).
 *
 * Skills are user-modifiable folders (SKILL.md + supporting files) stored as
 * resources, invoked by the agent via a `runSkill(name, input?)` tool. The
 * framework does not auto-match skills — the model decides when one applies.
 *
 * These types are exported from `@flow-state-dev/core` so other packages
 * (notably `@flow-state-dev/orchestration`, the runtime implementation) and user
 * code can refer to a single source of truth.
 */

import type { GeneratorTool } from "../blocks/generator";
import type { ItemVisibility } from "../items/types";
import type { AgentOverrides } from "./agent";

/**
 * A bag of executable tools that skills may reference by string key.
 *
 * Tools are executable code and cannot round-trip through a resource
 * collection — apps register them once and skills reference them by name
 * via `allowed-tools` in frontmatter. Unknown refs are warned and skipped.
 */
export type ToolCatalog = Record<string, GeneratorTool>;

/**
 * Activation mode for a skill, controlled by `context:` frontmatter.
 *
 * - `inline` (default, and now the only value): the skill body is injected
 *   into the in-flight generator on the next tool-loop step via the existing
 *   `prepareStep` machinery.
 *
 * Both non-inline modes were removed in FIX-918: `fork` (an isolated subagent)
 * and `pattern` (a session-global multi-agent dispatcher). Delegation is now a
 * capability derived from a skill's `workers:` field (see
 * `createSkillsLibrary`), not an execution mode. The type is kept as a
 * one-value union so its readers keep compiling and a future mode has a seam.
 */
export type SkillContextMode = "inline";

/**
 * A single agent entry under a skill's `agents:` map (FIX-918). A skill
 * describes its team as agents — prompt-driven participants — and the board
 * commands them: work is assigned as tasks and executed by draining the board.
 *
 * An agent is defined one of two ways (exactly one resolution field is set,
 * validated at parse time):
 *   - **inline** — `prompt` (or `promptRef`) plus optional `tools`/`model`/
 *     `visibility`. Travels inside the skill folder; a skill stays code-free.
 *   - **registry** — `agentRef` (+ optional `agentOverrides`), resolving a
 *     named agent through the supplied AgentRegistry.
 *
 * There is no `blockRef`: an arbitrary app block is a *tool* (assign a task to
 * it — a follow-up), while a prompt-driven participant is an *agent*.
 */
export interface AgentSpec {
  /** Inline agent: prompt body (the persona). Substitutions apply at activation. */
  prompt?: string;
  /** Inline agent: skill-folder-relative path to a persona prompt file. */
  promptRef?: string;
  /** Registry agent: agent registry key — resolves through the supplied AgentRegistry. */
  agentRef?: string;
  /** REPLACE-semantic overrides applied to the resolved registry agent. Requires agentRef. */
  agentOverrides?: AgentOverrides;
  /** Tool catalog keys an inline agent may call directly (incl. `taskTools`). */
  tools?: string[];
  /** Visibility controlling client delivery and history inclusion. Defaults to `{ client: true, history: false }`. */
  itemVisibility?: ItemVisibility;
  /** Model id override for an inline agent. Falls back to the deps' default. */
  model?: string;
  /**
   * How much prior context the materialized agent inherits (FIX-920). INPUT
   * policy only — it controls what the agent *reads*, via the generator
   * `history` slot; it does not touch the output axis (`itemVisibility.history`)
   * or flow-policy / `priorWork` (tool-call observations).
   *
   * - **absent (the default):** the agent is isolated — it sees only its task
   *   input, no conversation history slot. Today's behavior.
   * - `"conversation"`: the agent inherits the parent conversation up to the
   *   point it was dispatched (the fork point), then diverges. The window is
   *   **bounded by default** (not the full history window). Its own steps still
   *   stay out of the host's history (output keeps `itemVisibility.history:
   *   false`), so the host context window is preserved — fork-like sub-execution.
   *
   * There is no `"isolated"` value: absence already means isolated, so a
   * sentinel would be a redundant no-op. Only honorable for inline
   * (`prompt`/`promptRef`) agents; setting it on an `agentRef` agent fails loud
   * (that agent owns its own context). Named `contextSupply` (not `contextMode`)
   * to avoid colliding with the skill-level `SkillContextMode` in this file and
   * the workforce agent-level `contextMode`.
   */
  contextSupply?: "conversation";
}

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

  /**
   * Declared delegation agents, parsed from the `agents:` frontmatter field
   * (FIX-918). A bound skill that declares `agents:` turns on the delegation
   * surface in `createSkillsLibrary`: a private task board, `taskTools`, and a
   * board-drain tool. The skill assigns work as tasks (`addTask` with an
   * `assignee` naming an agent) and executes the graph by draining the board —
   * there are no per-agent host tools. `prompt`/`promptRef` agents are portable
   * data (inline, code-free); `agentRef` references a registered agent.
   */
  agents?: Record<string, AgentSpec>;
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
  /** Mode the skill ran in. Always `"inline"` after FIX-918. */
  mode: SkillContextMode;
  /** Ack message; the agent should re-read context on the next step. */
  message?: string;
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
// Skill activation (FIX-421)
// ---------------------------------------------------------------------------

/**
 * Origin of a skill-activation match. Carried on `MatchedSkill` so downstream
 * consumers (trace UI, telemetry) can branch on how the decision was reached.
 */
export type SkillActivationSource =
  | "slash"            // user typed `/skill-name`
  | "keyword"          // local keyword scan matched
  | "classifier"       // LLM classifier produced the match
  | "manual-override"; // explicit user/UI selection bypassed classification

/**
 * One skill matched by a skill-activation pass. Multiple may be active
 * per turn — the up-front skill activator activates all of them in inline
 * mode by default.
 */
export interface MatchedSkill {
  /** Skill name. Must exist in the skills collection at activation time. */
  name: string;
  /** Argument substituted for `$ARGUMENTS` in the skill body. Empty if none. */
  input: string;
  /** Which tier of `skillActivator` produced this match. */
  source: SkillActivationSource;
  /** Classifier confidence (0..1). Only present when `source === "classifier"`. */
  confidence?: number;
}
