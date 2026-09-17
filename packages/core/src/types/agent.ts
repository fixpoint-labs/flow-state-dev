/**
 * Agent type contracts — structural interfaces consumed cross-package.
 *
 * Declared in `@flow-state-dev/core` so multiple packages can refer to a
 * single source of truth without forming a circular import. The Skills
 * package consumes `AgentRegistry` to thread an `agent-ref` worker
 * resolution path through pattern skills.
 *
 * These are extension points, not a description of shipped code: no package
 * here implements `AgentRegistry` or `MaterializeAgentFn`. An app that staffs
 * a seat with `agent-ref` writes both and passes them to
 * `createSkillsLibrary`, which refuses to bind such a skill when either is
 * missing. Everything below that reads as a promise — a validation, a
 * resolution — is what an implementation owes its callers, not something this
 * repo performs on its behalf.
 */

import type { ZodTypeAny } from "zod";
import type { ItemVisibility } from "../items/types";
import type { JsonObject } from "../schema/common";
import type { BlockContext, BlockDefinition } from "./block";
import type { DefinedCapability } from "../capability";
import type { ToolCatalog } from "./skill";

/**
 * How an agent's system prompt is sourced. Nothing here resolves one — the
 * forms below say what an implementation is expected to do with each, over
 * core's resource-template primitives (renderResourceTemplate / readContent).
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
 * on the AgentSpec instead of `agent-ref`.
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
  /** Structured output contract for the materialized generator. When omitted,
   *  the agent emits free text (`z.string()`). Honored on both shapes — mounted
   *  directly and delegated to a board — so one declaration answers what the
   *  agent emits however it is run. A delegated result is read off the completed
   *  task, not returned inline to the coordinator.
   *
   *  Subject to the same BP-016 OpenAI-strict requirement as any generator
   *  output, which core enforces wherever the schema reaches a generator. Two
   *  further rules are the materializer's to enforce, and none ships here: the
   *  root must be a bare `z.string()` or an object, and no field may parse to a
   *  value JSON cannot carry (a transform, a `Date`, a `BigInt`), since a
   *  durable board round-trips a task result through `JSON.stringify`. A
   *  materializer that skips them gets a shape back from a resume that is not
   *  the one it declared. */
  outputSchema?: ZodTypeAny;
  /** Tool-catalog keys this agent may reference. */
  allowedTools?: string[];
  /** Capabilities this agent composes via `uses`. Each entry is EITHER a string
   *  key resolved against the materialize-time `capabilityCatalog`, OR a
   *  capability reference used as-is — including `someCapability.presets({ ... })`,
   *  which keeps full preset typing (mirrors how `generator({ uses })` consumes
   *  capabilities today). A string key declared with NO catalog to resolve it
   *  against should be refused rather than dropped — the materializer's call to
   *  make, since none ships here. */
  usesCapabilities?: Array<string | DefinedCapability>;
  /** RESERVED — not resolved by FIX-702. */
  usesSkills?: string[];
  /** Default activation mode when dispatched standalone. Only "inline" is honored initially. */
  contextMode?: "fork" | "inline";
}

/**
 * Structural interface for an agent catalog. No implementation ships in this
 * repo — an app that uses `agent-ref` writes one and injects it. This
 * declaration exists so consumers can type an optional `agentRegistry?` slot
 * without depending on whoever implements it.
 */
export interface AgentRegistry {
  /** Resolve an agent by name. Returns `undefined` when unknown. */
  get(name: string): Promise<Agent | undefined>;
  /** Enumerate every registered agent. */
  list(): Promise<Agent[]>;
}

/**
 * Options for materializing an Agent into a worker-shaped or standalone generator.
 * Defined in core so `@flow-state-dev/orchestration` can type the injected
 * `materializeAgent` dep without depending on whoever implements it.
 */
export interface MaterializeAgentOptions {
  catalog: ToolCatalog;
  capabilityCatalog?: Record<string, DefinedCapability>;
  defaultModelId?: string;
  overrides?: AgentOverrides;
  shape: "worker" | "standalone";
  workerKey?: string;
  skillName?: string;
  /**
   * Board-bound `taskTools` capability for a worker-shaped agent that itself
   * declares `taskTools` (mid-drain fan-out). When set, the agent's `taskTools`
   * resolve against the active drain board rather than the process-wide
   * singleton (which looks at no board). When unset, the singleton is used —
   * standalone agents and non-delegation callers are unaffected.
   */
  boardTaskTools?: DefinedCapability;
}

/** Function shape for materializing an Agent into a BlockDefinition. */
export type MaterializeAgentFn = (agent: Agent, opts: MaterializeAgentOptions) => BlockDefinition;
