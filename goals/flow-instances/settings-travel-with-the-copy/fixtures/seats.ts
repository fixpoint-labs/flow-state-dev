/**
 * One collection definition the goal instantiates three times, each with a
 * different bag of settings — and one block graph shared by all three.
 *
 * The knob is read at a NESTED position (a tap inside a sequencer, and a tool
 * block reached through the router's branch) rather than in the root handler,
 * because a read that works at the root proves nothing about the context
 * spread that carries the value down.
 */
import { defineFlow, handler, router, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

export const SEAT_KIND = "seat";

/**
 * What a seat is GIVEN. Everything here is fixed when the copy is created —
 * what a seat LEARNS (its counters below) is scope state, not config.
 */
export const seatConfigSchema = z.object({
  harness: z.enum(["claude-code", "codex", "cursor"]),
  model: z.string(),
  /** Deliberately defaulted, so a copy that omits it still reads a value. */
  retries: z.number().default(1),
  /** Never leaves the process — the goal greps the whole store for it. */
  apiKey: z.string()
});

/** What one block needs of ANY flow that installs it. It names no flow. */
const needsHarness = z.object({ harness: z.string(), model: z.string() });

const inputSchema = z.object({ note: z.string() });
const runState = z.object({
  /** Written by the nested tap — proves the value reached a non-root block. */
  ranOn: z.string().nullable().default(null),
  /** Written by the routed branch — a second, differently-nested read. */
  routedTo: z.string().nullable().default(null),
  /** A counter: what the seat LEARNS, kept out of the bag on purpose. */
  runs: z.number().default(0)
});

/** The root: does no config reading at all, so it cannot mask a nested failure. */
const start = handler({
  name: "seat-start",
  inputSchema,
  outputSchema: z.object({ note: z.string() }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ runs: 1 });
    return { note: input.note };
  }
});

/** Nested read #1 — a tap inside the sequencer. */
const recordHarness = handler({
  name: "seat-record-harness",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.void(),
  flowConfigSchema: needsHarness,
  sessionStateSchema: runState,
  execute: async (_input, ctx) => {
    await ctx.session.patchState({
      ranOn: `${ctx.flow.config.harness}/${ctx.flow.config.model}`
    });
  }
});

/** Nested read #2 — inside a router branch, one level deeper again. */
const claudeBranch = handler({
  name: "seat-branch-claude",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({ note: z.string() }),
  flowConfigSchema: needsHarness,
  sessionStateSchema: runState,
  execute: async (input, ctx) => {
    await ctx.session.patchState({ routedTo: `claude:${ctx.flow.config.model}` });
    return input;
  }
});

const otherBranch = handler({
  name: "seat-branch-other",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({ note: z.string() }),
  flowConfigSchema: needsHarness,
  sessionStateSchema: runState,
  execute: async (input, ctx) => {
    await ctx.session.patchState({ routedTo: `${ctx.flow.config.harness}:${ctx.flow.config.model}` });
    return input;
  }
});

/** The router itself branches ON a knob — the copy's own setting steers it. */
const byHarness = router({
  name: "seat-by-harness",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({ note: z.string() }),
  flowConfigSchema: needsHarness,
  routes: [claudeBranch, otherBranch],
  execute: (_input, ctx) => (ctx.flow.config.harness === "claude-code" ? claudeBranch : otherBranch)
});

/** The one action tree. Built ONCE, at module load, and shared by every copy. */
export const seatWork = sequencer({ name: "seat-work", inputSchema })
  .step(start)
  .tap(recordHarness)
  .step(byHarness);

const clientView = {
  derived: {
    ran: (ctx: { state: { ranOn?: string | null; routedTo?: string | null; runs?: number } }) => ({
      ranOn: ctx.state.ranOn ?? null,
      routedTo: ctx.state.routedTo ?? null,
      runs: ctx.state.runs ?? 0
    })
  }
};

export const seatDefinition = defineFlow({
  kind: SEAT_KIND,
  cardinality: "collection",
  configSchema: seatConfigSchema,
  actions: { run: { inputSchema, block: seatWork } },
  session: { stateSchema: runState, client: clientView }
});

/**
 * A second definition installing the SAME block, with a different (and looser)
 * `configSchema`. The block names no flow, so it is checked here too — which is
 * what makes it portable rather than merely reusable.
 */
export const AUDIT_KIND = "audit";

export const auditDefinition = defineFlow({
  kind: AUDIT_KIND,
  cardinality: "collection",
  // `model` is OPTIONAL here while the block requires it: these two can never
  // fit for a copy that omits it, and that is refused per COPY at the mint,
  // not where the two were written.
  configSchema: z.object({ harness: z.string(), model: z.string().optional() }),
  actions: { run: { inputSchema, block: seatWork } },
  session: { stateSchema: runState, client: clientView }
});
