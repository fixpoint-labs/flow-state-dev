/**
 * Agent type contracts — structural interfaces consumed cross-package.
 *
 * Declared in `@flow-state-dev/core` so multiple packages can refer to a
 * single source of truth without forming a circular import. The Skills
 * package consumes `AgentRegistry` to thread an optional `agent-ref`
 * worker resolution path through pattern skills. A future Agents package
 * supplies the concrete implementation.
 */

import type { AgentType } from "../items/types";

/**
 * REPLACE-semantic overrides applied to a registered Agent at worker
 * materialization. Each field, if present, fully replaces the agent's
 * default — no merging. The REPLACE semantic produces a deterministic,
 * auditable tool surface per pattern skill.
 *
 * No prompt/system override: a change to an agent's body is a change to
 * the agent definition; for ad-hoc bodies, use `prompt` or `prompt-ref`
 * on the WorkerSpec instead of `agent-ref`.
 */
export interface AgentOverrides {
  /** REPLACES the agent's allowed-tools list. */
  tools?: string[];
  /** REPLACES the agent's model id. */
  model?: string;
  /** REPLACES the agent's agent-type. */
  agentType?: AgentType;
}

/**
 * Resolved agent shape returned by `AgentRegistry.get()`. The body has
 * not had substitutions applied — callers pass per-invocation input via
 * the materialization deps.
 */
export interface Agent {
  /** Stable identifier. Matches the registry key used by `agent-ref`. */
  name: string;
  /** Short human-readable summary surfaced in trace UI / DevTool. */
  description: string;
  /** Agent prompt body (Markdown, post-frontmatter). */
  body: string;
  /** Model id; falls back to the deps' default when undefined. */
  model?: string;
  /** Defaults to `"sub"` when undefined. */
  agentType?: AgentType;
  /** Tool-catalog keys this agent may reference. */
  allowedTools?: string[];
  /** Capability keys this agent composes via `uses`. */
  usesCapabilities?: string[];
  /** Skill names this agent activates on invocation. */
  usesSkills?: string[];
  /** Default activation mode when this agent is dispatched standalone. */
  contextMode?: "fork" | "inline";
}

/**
 * Structural interface for an agent catalog. Implementations are owned
 * by the Agents package; this declaration exists so consumers can type
 * an optional `agentRegistry?` slot without depending on that package.
 */
export interface AgentRegistry {
  /** Resolve an agent by name. Returns `undefined` when unknown. */
  get(name: string): Promise<Agent | undefined>;
  /** Enumerate every registered agent. */
  list(): Promise<Agent[]>;
}
