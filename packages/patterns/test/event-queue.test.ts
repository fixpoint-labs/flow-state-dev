import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  eventQueue,
  createDequeueEvent,
  createDispatchEvent,
  createCheckQueue,
  createEventQueueStateSchema,
} from "../src/event-queue";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PROCESS"), payload: z.string() }),
  z.object({ type: z.literal("NOTIFY"), message: z.string() }),
]);
type AppEvent = z.infer<typeof EventSchema>;

const processedEvents: string[] = [];

/**
 * Deterministic handler that optionally enqueues follow-up events.
 */
function makeHandler(
  name: string,
  enqueue?: AppEvent[]
) {
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.object({ handled: z.string() }),
    sequencerStateSchema: createEventQueueStateSchema(EventSchema),
    execute: async (input, ctx) => {
      const eventType = input?.event?.type ?? input?.type ?? "unknown";
      processedEvents.push(eventType);
      if (enqueue?.length) {
        const current = ctx.sequencer!.state.queue;
        await ctx.sequencer!.patchState({ queue: [...current, ...enqueue] });
      }
      return { handled: eventType };
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("event-queue", () => {
  describe("basic drain loop", () => {
    it("processes all initial events in FIFO order", async () => {
      processedEvents.length = 0;

      const block = eventQueue({
        name: "fifo-test",
        schema: EventSchema,
        initialEvents: [
          { type: "PROCESS", payload: "first" },
          { type: "NOTIFY", message: "second" },
          { type: "PROCESS", payload: "third" },
        ],
        handlers: {
          PROCESS: makeHandler("process-handler"),
          NOTIFY: makeHandler("notify-handler"),
        },
      });

      const result = await testBlock(block, { input: {} });

      expect(result.error).toBeNull();
      expect(processedEvents).toEqual(["PROCESS", "NOTIFY", "PROCESS"]);
    });

    it("exits cleanly when initial queue is empty", async () => {
      processedEvents.length = 0;

      const block = eventQueue({
        name: "empty-test",
        schema: EventSchema,
        initialEvents: [],
        handlers: {
          PROCESS: makeHandler("process-handler-empty"),
          NOTIFY: makeHandler("notify-handler-empty"),
        },
      });

      const result = await testBlock(block, { input: {} });

      expect(result.error).toBeNull();
      expect(processedEvents).toEqual([]);
    });

    it("processes a single event and exits", async () => {
      processedEvents.length = 0;

      const block = eventQueue({
        name: "single-test",
        schema: EventSchema,
        initialEvents: [{ type: "NOTIFY", message: "only one" }],
        handlers: {
          PROCESS: makeHandler("process-handler-single"),
          NOTIFY: makeHandler("notify-handler-single"),
        },
      });

      const result = await testBlock(block, { input: {} });

      expect(result.error).toBeNull();
      expect(processedEvents).toEqual(["NOTIFY"]);
    });
  });

  describe("mid-execution enqueue", () => {
    it("events enqueued by a handler are processed on the next iteration", async () => {
      processedEvents.length = 0;

      const block = eventQueue({
        name: "enqueue-test",
        schema: EventSchema,
        initialEvents: [{ type: "PROCESS", payload: "trigger" }],
        handlers: {
          PROCESS: makeHandler("process-enqueue", [
            { type: "NOTIFY", message: "enqueued by PROCESS" },
          ]),
          NOTIFY: makeHandler("notify-terminal"),
        },
      });

      const result = await testBlock(block, { input: {} });

      expect(result.error).toBeNull();
      expect(processedEvents).toEqual(["PROCESS", "NOTIFY"]);
    });

    it("maintains FIFO order for enqueued events (appended to tail)", async () => {
      processedEvents.length = 0;

      // PROCESS enqueues both a NOTIFY and another PROCESS
      const block = eventQueue({
        name: "fifo-enqueue-test",
        schema: EventSchema,
        initialEvents: [
          { type: "PROCESS", payload: "first" },
          { type: "NOTIFY", message: "second" },
        ],
        handlers: {
          PROCESS: makeHandler("process-fifo", [
            { type: "NOTIFY", message: "enqueued-by-process" },
          ]),
          NOTIFY: makeHandler("notify-fifo"),
        },
      });

      const result = await testBlock(block, { input: {} });

      expect(result.error).toBeNull();
      // PROCESS dequeued first → enqueues NOTIFY at tail
      // NOTIFY (original "second") dequeued next
      // NOTIFY (enqueued-by-process) dequeued last
      expect(processedEvents).toEqual(["PROCESS", "NOTIFY", "NOTIFY"]);
    });

    it("chain: PROCESS → enqueues NOTIFY → NOTIFY terminates cleanly", async () => {
      processedEvents.length = 0;

      const block = eventQueue({
        name: "chain-test",
        schema: EventSchema,
        initialEvents: [{ type: "PROCESS", payload: "start" }],
        handlers: {
          PROCESS: makeHandler("process-chain", [
            { type: "NOTIFY", message: "done" },
          ]),
          NOTIFY: makeHandler("notify-chain"),
        },
      });

      const result = await testBlock(block, { input: {} });

      expect(result.error).toBeNull();
      expect(processedEvents).toEqual(["PROCESS", "NOTIFY"]);
    });
  });

  describe("loop guard", () => {
    it("exits when maxIterations is exceeded (cycle scenario)", async () => {
      processedEvents.length = 0;

      // PROCESS always enqueues another PROCESS → infinite cycle without guard
      const block = eventQueue({
        name: "cycle-test",
        schema: EventSchema,
        initialEvents: [{ type: "PROCESS", payload: "cycle" }],
        handlers: {
          PROCESS: makeHandler("process-cycle", [
            { type: "PROCESS", payload: "again" },
          ]),
          NOTIFY: makeHandler("notify-cycle"),
        },
        maxIterations: 5,
      });

      const result = await testBlock(block, { input: {} });

      // loopBack silently exits when maxIterations is reached (no error thrown)
      expect(result.error).toBeNull();
      // maxIterations=5 allows 5 loop-backs + 1 initial pass = 6 total events
      expect(processedEvents.length).toBe(6);
    });

    it("respects custom maxIterations config", async () => {
      processedEvents.length = 0;

      const block = eventQueue({
        name: "max-iter-test",
        schema: EventSchema,
        initialEvents: [{ type: "PROCESS", payload: "cycle" }],
        handlers: {
          PROCESS: makeHandler("process-max", [
            { type: "PROCESS", payload: "again" },
          ]),
          NOTIFY: makeHandler("notify-max"),
        },
        maxIterations: 3,
      });

      const result = await testBlock(block, { input: {} });

      expect(result.error).toBeNull();
      // maxIterations=3 allows 3 loop-backs + 1 initial pass = 4 total events
      expect(processedEvents.length).toBe(4);
    });
  });

  describe("error handling", () => {
    it("throws descriptive error for unknown event type", async () => {
      const ThreeTypeSchema = z.discriminatedUnion("type", [
        z.object({ type: z.literal("PROCESS"), payload: z.string() }),
        z.object({ type: z.literal("NOTIFY"), message: z.string() }),
        z.object({ type: z.literal("UNKNOWN_TYPE"), data: z.string() }),
      ]);

      const block = eventQueue({
        name: "unknown-type-test",
        schema: ThreeTypeSchema,
        initialEvents: [{ type: "UNKNOWN_TYPE", data: "oops" } as any],
        handlers: {
          PROCESS: makeHandler("process-unknown"),
          NOTIFY: makeHandler("notify-unknown"),
          // Deliberately missing UNKNOWN_TYPE handler
        },
      });

      const result = await testBlock(block, { input: {} });

      expect(result.error).not.toBeNull();
      expect(String(result.error)).toContain("No handler registered for event type");
    });

    it("propagates handler errors", async () => {
      const failingHandler = handler({
        name: "failing-handler",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => {
          throw new Error("handler exploded");
        },
      });

      const block = eventQueue({
        name: "error-propagation-test",
        schema: EventSchema,
        initialEvents: [{ type: "PROCESS", payload: "boom" }],
        handlers: {
          PROCESS: failingHandler,
          NOTIFY: makeHandler("notify-error"),
        },
      });

      const result = await testBlock(block, { input: {} });

      expect(result.error).not.toBeNull();
      expect(String(result.error)).toContain("handler exploded");
    });
  });

  describe("block structure", () => {
    it("returns a sequencer block (kind === 'sequencer')", () => {
      const block = eventQueue({
        name: "structure-test",
        schema: EventSchema,
        handlers: {
          PROCESS: makeHandler("process-struct"),
          NOTIFY: makeHandler("notify-struct"),
        },
      });

      expect(block.kind).toBe("sequencer");
      expect(block.name).toBe("structure-test");
    });

    it("exports createDequeueEvent, createDispatchEvent, createCheckQueue, createEventQueueStateSchema", () => {
      expect(typeof createDequeueEvent).toBe("function");
      expect(typeof createDispatchEvent).toBe("function");
      expect(typeof createCheckQueue).toBe("function");
      expect(typeof createEventQueueStateSchema).toBe("function");
    });
  });
});
