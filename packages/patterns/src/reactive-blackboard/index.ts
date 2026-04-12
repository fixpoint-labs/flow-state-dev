/**
 * Reactive Blackboard Pattern
 *
 * Stigmergic multi-agent coordination where actors subscribe to entry
 * topics on a shared resource and react automatically when matching
 * entries are written. Unlike the controller-driven Blackboard (FIX-317),
 * there is no orchestrator — dispatch happens at write-time via
 * `forEachBackground`, and reactions run as background sidechains.
 *
 * Pipeline: [entry input] → [append] → forEachBackground(matched actors → body)
 *           ↑ writer continues immediately after dispatch
 *
 * The entire propagation graph lives inside FSD's flow tree — tracing,
 * heartbeats, cancellation, and replay all work without any external runtime.
 */
import { sequencer } from "@flow-state-dev/core";
import type { BlockDefinition, DefinedResource } from "@flow-state-dev/core/types";
import type { ZodTypeAny } from "zod";
import { matchTopic } from "./match-topic";
import {
  createReactiveBlackboard,
  emitControlSchema,
  reactiveBlackboardStateSchema,
} from "./schemas";
import { createAppendEntry } from "./blocks/append-entry";

export {
  createReactiveBlackboard,
  reactiveBlackboardStateSchema,
  emitControlSchema,
} from "./schemas";
export type {
  ReactiveBlackboardState,
  EmitControlState,
} from "./schemas";
export { matchTopic, compilePattern } from "./match-topic";
export { createAppendEntry } from "./blocks/append-entry";

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

/** Configuration for a reactive blackboard actor. */
export interface ActorConfig {
  /** Unique name for this actor. Used in trace output. */
  name: string;

  /**
   * Glob patterns over `${type}:${topic}` that this actor subscribes to.
   * Must have at least one pattern.
   *
   * Syntax:
   * - `*` matches a single segment (between `:` or `.`)
   * - `**` matches any number of segments
   *
   * Examples: `["observation:slack.*"]`, `["event:**", "request:analysis"]`
   */
  watch: string[];

  /**
   * Block to execute when a matching entry is emitted. Receives the
   * entry as input. Can be any block kind — handler, generator,
   * sequencer, or router.
   */
  body: BlockDefinition<any, any>;
}

/** A frozen actor descriptor. */
export type Actor = Readonly<ActorConfig>;

/**
 * Creates a reactive blackboard actor — a thin descriptor that bundles
 * a watch declaration with a body block. This is a value, not a class.
 *
 * @param config Actor configuration
 * @returns Frozen actor descriptor
 */
export function actor(config: ActorConfig): Actor {
  if (config.watch.length === 0) {
    throw new Error(
      `[reactive-blackboard] Actor "${config.name}" must have at least one watch pattern`
    );
  }
  return Object.freeze({ ...config });
}

// ---------------------------------------------------------------------------
// Reactive Blackboard
// ---------------------------------------------------------------------------

/** Configuration for the reactive blackboard resource. */
export interface ReactiveBlackboardConfig {
  /** Name for this blackboard instance. Used as resource name prefix. */
  name: string;

  /**
   * Zod schema for entry objects. Entries should have `type` (string),
   * `topic` (string), and `body` (any) fields. The schema is used for
   * documentation; entries are stored as `z.any()` in the resource.
   */
  entries: ZodTypeAny;
}

/**
 * Creates a reactive blackboard — a typed entry resource for stigmergic
 * multi-agent coordination. Returns the resource definition; use `mesh()`
 * to wire actors and get the configured emit block.
 */
export function reactiveBlackboard(config: ReactiveBlackboardConfig): {
  /** Writable session resource storing the entry log. */
  blackboard: DefinedResource;
} {
  return {
    blackboard: createReactiveBlackboard(),
  };
}

// ---------------------------------------------------------------------------
// Mesh
// ---------------------------------------------------------------------------

/** Configuration for wiring actors to a reactive blackboard. */
export interface MeshConfig {
  /** Name for this mesh instance. Used as block name prefix. */
  name: string;

  /** Reactive blackboard — the result of `reactiveBlackboard()`. */
  blackboard: { blackboard: DefinedResource };

  /**
   * Actors to register. Each actor's `watch` patterns determine which
   * entries trigger its `body` block. Must have at least one actor.
   */
  actors: Actor[];

  /** Maximum concurrent background dispatches. Default: 16. */
  concurrency?: number;
}

/**
 * Wires actors to a reactive blackboard. Returns the configured `emit`
 * block that appends entries and fans out to matching actors via
 * `forEachBackground`.
 *
 * Usage:
 * ```typescript
 * const myMesh = mesh({
 *   name: "feedback",
 *   blackboard: reactiveBlackboard({ name: "fb", entries: entrySchema }),
 *   actors: [monitor, analyzer],
 * });
 *
 * // Use myMesh.emit in a sequencer:
 * sequencer({ name: "main" }).then(myMesh.emit)
 * ```
 */
export function mesh(config: MeshConfig): {
  /** Sequencer block: appends entry + fans out to matching actors. */
  emit: BlockDefinition<any, any>;
  /** The blackboard resource definition. Declare on your flow's sessionResources. */
  blackboard: DefinedResource;
  /** The registered actors (frozen). */
  actors: readonly Actor[];
} {
  const { name, actors, concurrency = 16 } = config;
  const blackboardResource = config.blackboard.blackboard;

  if (actors.length === 0) {
    throw new Error(
      `[reactive-blackboard] Mesh "${name}" must have at least one actor`
    );
  }

  const appendEntry = createAppendEntry(name, blackboardResource);

  const emit = sequencer({
    name: `${name}-emit`,
    stateSchema: emitControlSchema,
    container: { component: "reactive-blackboard" },
  })
    .then(appendEntry)
    .forEachBackground(
      // Connector: for each matched actor, return a dispatch descriptor
      // containing both the entry and the actor reference.
      (entry: Record<string, unknown>) => {
        const topicKey = `${entry.type ?? ""}:${entry.topic ?? ""}`;
        return actors
          .filter((a) =>
            a.watch.some((pattern) => matchTopic(pattern, topicKey))
          )
          .map((a) => ({ __entry: entry, __actor: a }));
      },
      // Block factory: wrap each actor's body in a dispatch sequencer
      // that extracts the entry and passes it as input to the body.
      (dispatch: { __entry: Record<string, unknown>; __actor: Actor }) => {
        return sequencer({ name: `${name}-dispatch-${dispatch.__actor.name}` })
          .map(() => dispatch.__entry)
          .then(dispatch.__actor.body);
      },
      { concurrency }
    );

  return {
    emit,
    blackboard: blackboardResource,
    actors: Object.freeze([...actors]),
  };
}
