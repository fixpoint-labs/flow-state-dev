/**
 * Event Queue Pattern
 *
 * A composable sequencer that processes a typed event queue using a loopBack-driven
 * drain loop. Handlers can enqueue new events mid-execution via `ctx.sequencer!.patchState`.
 *
 * Pipeline: [dequeue] → [dispatch to handler] → [check queue] → loopBack
 *
 * Demonstrates that FSD's `stateSchema` + `loopBack` primitives are architecturally
 * sufficient for intra-flow event-driven dispatch — no new framework APIs required.
 */
import { sequencer, handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodType } from "zod";
import { createEventQueueStateSchema, type EventQueueState } from "./schemas";
import { createDequeueEvent } from "./blocks/dequeue-event";
import { createDispatchEvent } from "./blocks/dispatch-event";
import { createCheckQueue } from "./blocks/check-queue";

export { createEventQueueStateSchema, type EventQueueState } from "./schemas";
export { createDequeueEvent } from "./blocks/dequeue-event";
export { createDispatchEvent } from "./blocks/dispatch-event";
export { createCheckQueue } from "./blocks/check-queue";

export interface EventQueueConfig<TEvent extends { type: string }> {
  /** Name for this event-queue instance. Used as block name prefix. */
  name: string;

  /** Zod schema for the event union. `z.discriminatedUnion('type', [...])` recommended. */
  schema: ZodType<TEvent>;

  /** Events to seed the queue with at start. Handlers can add more during execution. */
  initialEvents?: TEvent[];

  /**
   * Handler blocks keyed by event type.
   * Each handler receives the specific event subtype as input.
   * Handlers can enqueue new events: `ctx.sequencer!.patchState({ queue: [...state.queue, newEvent] })`
   */
  handlers: Record<string, BlockDefinition<any, any>>;

  /**
   * Maximum events processed before forcing exit. Default: 500.
   * Required by loopBack (no built-in default).
   * Set lower for tightly bounded workflows; increase for deep event chains.
   */
  maxIterations?: number;
}

/**
 * Creates an event queue block — a sequencer that drains a typed event queue,
 * dispatching each event to a type-specific handler via a router, and looping
 * back while events remain in the queue.
 */
export function eventQueue<TEvent extends { type: string }>(
  config: EventQueueConfig<TEvent>
) {
  const stateSchema = createEventQueueStateSchema(config.schema);
  const maxIterations = config.maxIterations ?? 500;

  const initialEvents = config.initialEvents ?? [];
  const dequeue = createDequeueEvent<TEvent>(config.name, stateSchema);
  const dispatch = createDispatchEvent<TEvent>(config.name, config.handlers);
  const checkQueue = createCheckQueue<TEvent>(config.name, stateSchema);

  // Seed step: writes initial events into sequencer state.
  // Sequencer state defaults to `{ queue: [] }` from the schema; this step
  // populates it with the configured initial events before the drain loop starts.
  const seed = handler({
    name: `${config.name}-seed`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    sequencerStateSchema: stateSchema,
    execute: async (input, ctx) => {
      if (initialEvents.length > 0) {
        await ctx.sequencer!.patchState({ queue: initialEvents });
      }
      return input;
    },
  });

  return sequencer({
    name: config.name,
    stateSchema,
  })
    .then(seed)
    .then(dequeue)
    .thenIf(
      (v: { event: TEvent | null }) => v.event !== null,
      dispatch
    )
    .then(checkQueue)
    .loopBack(`${config.name}-dequeue`, {
      when: (v: { hasMore: boolean }) => v.hasMore,
      maxIterations,
    });
}
