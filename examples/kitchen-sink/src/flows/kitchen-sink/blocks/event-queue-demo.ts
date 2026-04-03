/**
 * Event Queue Demo — kitchen-sink action
 *
 * Demonstrates the event queue pattern with a realistic 3-event chain:
 *   SEARCH → enqueues ANALYZE → conditionally enqueues EXTRACT → terminates
 *
 * Shows: initial queue seeding, cross-type chaining via mid-execution enqueue,
 * and clean termination when the queue drains.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  eventQueue,
  createEventQueueStateSchema,
} from "@flow-state-dev/patterns/event-queue";

// ---------------------------------------------------------------------------
// Event schema
// ---------------------------------------------------------------------------

const DemoEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SEARCH"), query: z.string() }),
  z.object({ type: z.literal("ANALYZE"), data: z.string() }),
  z.object({
    type: z.literal("EXTRACT"),
    source: z.string(),
    fields: z.array(z.string()),
  }),
]);
type DemoEvent = z.infer<typeof DemoEventSchema>;

const stateSchema = createEventQueueStateSchema(DemoEventSchema);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// SEARCH: simulates a search, enqueues an ANALYZE event with the "results"
const handleSearch = handler({
  name: "handle-search",
  inputSchema: z.any(),
  outputSchema: z.object({ found: z.string() }),
  sequencerStateSchema: stateSchema,
  execute: async (input, ctx) => {
    const query = input?.event?.query ?? "unknown";
    const found = `Search results for "${query}": [doc-1, doc-2, doc-3]`;

    // Enqueue a follow-up ANALYZE event
    const current = ctx.sequencer!.state.queue;
    await ctx.sequencer!.patchState({
      queue: [...current, { type: "ANALYZE" as const, data: found }],
    });

    ctx.emitStatus(`Searched for: ${query}`);
    return { found };
  },
});

// ANALYZE: analyzes data, conditionally enqueues an EXTRACT event
const handleAnalyze = handler({
  name: "handle-analyze",
  inputSchema: z.any(),
  outputSchema: z.object({ analysis: z.string() }),
  sequencerStateSchema: stateSchema,
  execute: async (input, ctx) => {
    const data = input?.event?.data ?? "";
    const hasStructuredData = data.includes("doc-");
    const analysis = `Analyzed: ${data.slice(0, 60)}`;

    // Conditionally enqueue EXTRACT if structured data was found
    if (hasStructuredData) {
      const current = ctx.sequencer!.state.queue;
      await ctx.sequencer!.patchState({
        queue: [
          ...current,
          {
            type: "EXTRACT" as const,
            source: data,
            fields: ["title", "author", "date"],
          },
        ],
      });
    }

    ctx.emitStatus(`Analyzed data (${hasStructuredData ? "structured" : "unstructured"})`);
    return { analysis };
  },
});

// EXTRACT: extracts fields from source data — terminal (enqueues nothing)
const handleExtract = handler({
  name: "handle-extract",
  inputSchema: z.any(),
  outputSchema: z.object({ extracted: z.record(z.string()) }),
  execute: async (input, ctx) => {
    const fields = input?.event?.fields ?? [];
    const extracted: Record<string, string> = {};
    for (const field of fields) {
      extracted[field] = `<${field} from source>`;
    }

    ctx.emitStatus(`Extracted ${fields.length} fields`);
    return { extracted };
  },
});

// ---------------------------------------------------------------------------
// Event queue action block
// ---------------------------------------------------------------------------

export const eventQueueDemo = eventQueue<DemoEvent>({
  name: "event-queue-demo",
  schema: DemoEventSchema,
  initialEvents: [{ type: "SEARCH", query: "flow-state patterns" }],
  handlers: {
    SEARCH: handleSearch,
    ANALYZE: handleAnalyze,
    EXTRACT: handleExtract,
  },
  maxIterations: 20,
});

export const eventQueueDemoInputSchema = z.object({
  query: z.string().default("flow-state patterns"),
});
