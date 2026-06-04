/**
 * Agent type contracts — structural interfaces consumed cross-package.
 *
 * Declared in `@flow-state-dev/core` so multiple packages can refer to a
 * single source of truth without forming a circular import. The Skills
 * package consumes `AgentRegistry` to thread an `agent-ref` worker
 * resolution path through pattern skills. `@flow-state-dev/workforce`
 * supplies the concrete implementation.
 */

import type { ItemVisibility } from "../items/types";
import type { JsonObject } from "../schema/common";
import type { BlockContext, BlockDefinition } from "./block";
import type { DefinedCapability } from "../capability";
import type { ToolCatalog } from "./skill";

/**
 * How an agent's system prompt is sourced. Resolved by @flow-state-dev/workforce
 * over FIX-699's resource-template primitives (renderResourceTemplate / readContent).
 * - string: bare system prompt, used verbatim — the minimal, single-use form.
 * - PersonaInlineConfig: an inline template + state, rendered via renderResourceTemplate.
 * - { path }: a declared resource OR collection instance, addressed by path and rendered
 *   live via ResourceRef.readContent(). The single-resource and collection cases unify
 *   behind path.
 */
export type PersonaSource = string | PersonaInlineConfig | { path: string };

export interface PersonaInlineConfig {
  /** Role-tagged `.md` body (or plain text). Parsed via parseResourceTemplate. */
  template: string;
  /** Optional state the template renders against (LiquidJS `{ state }` scope). */
  state?: JsonObject;
}

/**
 * REPLACE-semantic overrides applied to a registered Agent at worker
 * materialization. Each field, if present, fully replaces the agent's
 * default — no merging. The REPLACE semantic produces a deterministic,
 * auditable tool surface per pattern skill.
 *
 * No prompt/system override: a change to an agent's persona is a change
 * to the agent definition; for ad-hoc bodies, use `prompt` or `prompt-ref`
 * on the WorkerSpec instead of `agent-ref`.
 */
export interface AgentOverrides {
  /** REPLACES the agent's allowed-tools list. */
  tools?: string[];
  /** REPLACES the agent's model id. */
  model?: string;
  /** REPLACES the agent's item visibility. */
  itemVisibility?: ItemVisibility;
}

/**
 * Resolved agent shape returned by `AgentRegistry.get()`. An Agent is a
 * named, reusable participant composed of a Persona (its identity / system
 * prompt), Skills, a model, and tools. It carries no free-floating prose
 * instructions field — behavior comes from Persona + Skills.
 */
export interface Agent {
  /** Stable identifier. Matches the registry key used by `agent-ref`. */
  name: string;
  /** Routing-facing summary surfaced in trace UI / DevTool. NOT the system prompt. */
  description: string;
  /** System-prompt source. */
  persona: PersonaSource;
  /** Model id; falls back to deps' default, then "intent/chat". */
  model?: string;
  /** Defaults to `{ client: true, history: false }` when undefined. */
  itemVisibility?: ItemVisibility;
  /** Tool-catalog keys this agent may reference. */
  allowedTools?: string[];
  /** Capability keys this agent composes via `uses`, resolved against the capabilityCatalog. */
  usesCapabilities?: string[];
  /** RESERVED — not resolved by FIX-702. */
  usesSkills?: string[];
  /** Default activation mode when dispatched standalone. Only "inline" is honored initially. */
  contextMode?: "fork" | "inline";
}

/**
 * Structural interface for an agent catalog. Implementations are owned
 * by `@flow-state-dev/workforce`; this declaration exists so consumers
 * can type an optional `agentRegistry?` slot without depending on that
 * package.
 */
export interface AgentRegistry {
  /** Resolve an agent by name. Returns `undefined` when unknown. */
  get(name: string): Promise<Agent | undefined>;
  /** Enumerate every registered agent. */
  list(): Promise<Agent[]>;
}

/**
 * Options for materializing an Agent into a worker-shaped or standalone generator.
 * Defined in core (not workforce) so `@flow-state-dev/skills` can type the
 * injected `materializeAgent` dep without importing `@flow-state-dev/workforce`.
 */
export interface MaterializeAgentOptions {
  catalog: ToolCatalog;
  capabilityCatalog?: Record<string, DefinedCapability>;
  defaultModelId?: string;
  overrides?: AgentOverrides;
  shape: "worker" | "standalone";
  workerKey?: string;
  skillName?: string;
}

/** Function shape for materializing an Agent into a BlockDefinition. */
export type MaterializeAgentFn = (agent: Agent, opts: MaterializeAgentOptions) => BlockDefinition;
