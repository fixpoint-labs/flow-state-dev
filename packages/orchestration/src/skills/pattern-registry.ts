/**
 * `PatternRegistry` — interface for materializing pattern-shaped skills.
 *
 * Pattern skills declare a registry key in `SKILL.md` frontmatter (e.g.
 * `pattern: task-board`). The runSkill router's pattern route looks the
 * key up in a `PatternRegistry`, asks the matching `PatternFactory` to
 * turn the parsed `PatternBinding` into a runnable `BlockDefinition`,
 * and dispatches into it.
 *
 * The interface lives here so the router can consume it without depending
 * on `@flow-state-dev/patterns`. The default implementation
 * (`defaultPatternRegistry`) ships from `@flow-state-dev/patterns`; apps
 * wire it via `createSkillsCapability({ patternRegistry })`.
 */

import type { ZodTypeAny } from "zod";
import type {
  AgentRegistry,
  DefinedCapability,
  MaterializeAgentFn,
  PatternBinding,
  ResourceCollectionRef,
  ToolCatalog,
} from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";

/**
 * Shared dependencies handed to every `PatternFactory.fromConfig` call.
 * Threaded from `SkillsCapabilityOptions` through `PatternRunRouterOptions`.
 */
export interface PatternRegistryDeps {
  /** Tool catalog. Workers resolve their `tools:` field against this. */
  catalog: ToolCatalog;
  /** Optional block catalog for `block-ref:` workers. Default `{}`. */
  blocks?: Record<string, BlockDefinition>;
  /**
   * Optional agent registry consumed by `agent-ref:` workers. When
   * undefined, any worker using `agent-ref` fails activation with a
   * "no registry configured" error.
   */
  agentRegistry?: AgentRegistry;
  /**
   * Optional capability catalog forwarded to `materializeAgent` for
   * resolving an agent's `usesCapabilities`.
   */
  capabilityCatalog?: Record<string, DefinedCapability>;
  /**
   * Injected materializer that turns a resolved Agent into a worker-shaped
   * generator. Supplied by `@flow-state-dev/workforce`; absent means
   * `agent-ref` workers fail with a clear configuration error.
   */
  materializeAgent?: MaterializeAgentFn;
  /** Skill name — used for default collection/board ids. */
  skillName: string;
  /** Skill resource collection — supports `prompt-ref` reads. */
  skillCollection: ResourceCollectionRef;
  /** Default model id when a worker omits its own `model`. */
  defaultModelId?: string;
  /** Activation input ($ARGUMENTS substitution context). */
  input?: string;
  /**
   * Unique collection id for this activation. Adapters use it as the
   * board's `collectionId` so two activations of the same pattern skill
   * within one request render side-by-side instead of colliding.
   */
  collectionId: string;
}

/**
 * Result of materializing a pattern factory. The materialized block is
 * returned alongside its collection metadata (id, backing, resource key)
 * so the runSkill router can stamp the active-skill entry without
 * re-deriving it.
 */
export interface MaterializedPattern {
  block: BlockDefinition;
  /**
   * Stable id the runSkill router stamps onto the active-skill entry
   * so `taskTools` and other surfaces can locate the live collection.
   */
  collectionId: string;
  /** How the collection is stored. */
  backing: "request" | "resource";
  /** Resource registry key when `backing === "resource"`. */
  resourceCollectionKey?: string;
}

/**
 * Factory describing one named pattern. Registered factories are
 * looked up by `key` and asked to materialize themselves from a
 * parsed `PatternBinding` plus deps.
 */
export interface PatternFactory {
  /** Kebab-case registry key, e.g. `"task-board"`. */
  key: string;
  /** Zod schema validating the kebab-case `pattern-config` block. */
  configSchema: ZodTypeAny;
  /**
   * Construct a runnable BlockDefinition from the binding + deps.
   * Throws on unrecoverable wiring errors (unknown registry refs,
   * unreadable prompt-refs, etc.); the runSkill router translates
   * the throw into a runtime tool error surfaced to the agent.
   */
  fromConfig(
    binding: PatternBinding,
    deps: PatternRegistryDeps,
    ctx: BlockContext,
  ): Promise<MaterializedPattern>;
}

/** Lookup surface consumed by the pattern dispatch route. */
export interface PatternRegistry {
  /** Resolve a factory by its kebab-case key. */
  get(key: string): PatternFactory | undefined;
  /** Enumerate every registered factory. */
  list(): PatternFactory[];
}

/**
 * Build a `PatternRegistry` from a static list of factories. Duplicate
 * keys throw at construction time — silent shadowing makes the registry
 * unpredictable.
 */
export function createPatternRegistry(
  factories: PatternFactory[],
): PatternRegistry {
  const byKey = new Map<string, PatternFactory>();
  for (const f of factories) {
    if (byKey.has(f.key)) {
      throw new Error(`createPatternRegistry: duplicate factory key "${f.key}"`);
    }
    byKey.set(f.key, f);
  }
  return {
    get: (key) => byKey.get(key),
    list: () => Array.from(byKey.values()),
  };
}
