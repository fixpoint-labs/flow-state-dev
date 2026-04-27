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
// Entry normalisation
// ---------------------------------------------------------------------------

type EntryLike = { type: string; topic: string; body: unknown };

/**
 * Normalises actor body output into an array of entry objects suitable for
 * re-emission. Returns only objects that have `type` (string), `topic`
 * (string), and `body` fields. Non-entry values (strings, nulls, objects
 * without the required shape) are silently dropped.
 */
export function normalizeToEntries(output: unknown): EntryLike[] {
  if (output == null) return [];

  // Unwrap `{ entries: [...] }` wrapper (common when generators require
  // a top-level object schema).
  let raw: unknown = output;
  if (
    !Array.isArray(raw) &&
    typeof raw === "object" &&
    Array.isArray((raw as Record<string, unknown>).entries)
  ) {
    raw = (raw as Record<string, unknown>).entries as unknown[];
  }

  const candidates: unknown[] = Array.isArray(raw) ? raw : [raw];
  return candidates.filter(
    (item): item is EntryLike =>
      item != null &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).type === "string" &&
      typeof (item as Record<string, unknown>).topic === "string" &&
      "body" in (item as Record<string, unknown>)
  );
}

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

  /**
   * When true, actor body outputs that conform to the entry shape
   * (`{ type, topic, body }`) are automatically appended to the blackboard
   * and dispatched to matching actors — creating recursive reactive chains.
   *
   * Disabled by default for backward compatibility.
   */
  reEmit?: boolean;

  /**
   * Maximum re-emission depth. Only meaningful when `reEmit` is true.
   * At `maxDepth`, actor bodies still run but their output is not
   * re-emitted. Prevents infinite loops.
   *
   * Default: 3.
   */
  maxDepth?: number;
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
  /** The blackboard resource definition. Declare on your flow's `resources`. */
  blackboard: DefinedResource;
  /** The registered actors (frozen). */
  actors: readonly Actor[];
} {
  const {
    name,
    actors,
    concurrency = 16,
    reEmit = false,
    maxDepth = 3,
  } = config;
  const blackboardResource = config.blackboard.blackboard;

  if (actors.length === 0) {
    throw new Error(
      `[reactive-blackboard] Mesh "${name}" must have at least one actor`
    );
  }

  const appendEntry = createAppendEntry(name, blackboardResource);

  // Connector shared by the top-level emit and re-emission fan-outs:
  // given an entry, return dispatch descriptors for every actor whose
  // watch patterns match the entry's type:topic key.
  function matchActors(entry: Record<string, unknown>) {
    const topicKey = `${entry.type ?? ""}:${entry.topic ?? ""}`;
    return actors
      .filter((a) => a.watch.some((pattern) => matchTopic(pattern, topicKey)))
      .map((a) => ({ __entry: entry, __actor: a }));
  }

  // Builds the dispatch sequencer for a single actor invocation.
  // When reEmit is enabled and depth < maxDepth, the actor's output is
  // normalised to entries, each appended to the blackboard, and matching
  // actors are dispatched recursively at depth + 1.
  function buildDispatch(
    dispatch: { __entry: Record<string, unknown>; __actor: Actor },
    depth: number
  ): BlockDefinition<any, any> {
    const base = sequencer({
      name: `${name}-dispatch-${dispatch.__actor.name}`,
    })
      .map(() => dispatch.__entry)
      .then(dispatch.__actor.body);

    if (!reEmit) return base;

    // At maxDepth: still append entries to the blackboard (so they're
    // visible in the resource + UI), but don't fan out to further actors.
    if (depth >= maxDepth) {
      return base
        .map((output: unknown) => normalizeToEntries(output))
        .forEachBackground(
          sequencer({ name: `${name}-append-d${depth}` })
            .then(appendEntry),
          { concurrency }
        );
    }

    // Re-emission: actor output → entry[] → append each → fan out
    return base
      .map((output: unknown) => normalizeToEntries(output))
      .forEachBackground(
        // Form 1: iterate the entries array, run a re-emit sequencer
        // per entry. Each entry is appended then fanned out to actors.
        sequencer({ name: `${name}-reemit-d${depth}` })
          .then(appendEntry)
          .forEachBackground(
            // Form 2: connector + factory for actor dispatch
            (appended: Record<string, unknown>) => matchActors(appended),
            (d: { __entry: Record<string, unknown>; __actor: Actor }) =>
              buildDispatch(d, depth + 1),
            { concurrency }
          ),
        { concurrency }
      );
  }

  const emit = sequencer({
    name: `${name}-emit`,
    stateSchema: emitControlSchema,
    container: { component: "reactive-blackboard" },
  })
    .then(appendEntry)
    .forEachBackground(
      matchActors,
      (dispatch: { __entry: Record<string, unknown>; __actor: Actor }) =>
        buildDispatch(dispatch, 1),
      { concurrency }
    );

  return {
    emit,
    blackboard: blackboardResource,
    actors: Object.freeze([...actors]),
  };
}
