/**
 * The flows the DevTool goal inspects: one collection definition registered
 * twice, plus an ordinary singleton.
 *
 * Every copy writes a marker of its own into session state AND emits it as a
 * chat message, so the browser can be graded on WHICH copy ran rather than on a
 * request having succeeded. The message is the part the grader reads: it lands
 * in the stream where an operator would see it, so "B's result appeared under
 * A" is a claim about the screen rather than about a store.
 *
 * Handlers only — the property under test is identity, and a model would add
 * nondeterminism without adding evidence.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

export const ENGINEER_KIND = "engineer";
export const REPORTS_KIND = "reports";

const empty = z.object({});
const markerState = z.object({ marker: z.string().nullable().default(null) });

/** A collection: every copy needs an explicit id, and the bare kind is not an address. */
export const engineerDefinition = defineFlow({
  kind: ENGINEER_KIND,
  cardinality: "collection",
  actions: {
    inspect: {
      inputSchema: empty,
      block: handler({ name: "engineer-inspect", inputSchema: empty, execute: () => ({}) }),
    },
  },
  // Exposed to the client on purpose: the DevTool's Session Context panel shows
  // the client projection, so a marker that is not exposed cannot be inspected
  // there — and per-instance state being visible in that panel is one of the
  // things this goal grades.
  session: { stateSchema: markerState, client: { expose: ["marker"] } },
});

/** A registered copy of `engineer` that stamps `marker` on every run. */
export function engineerInstance(id: string, marker: string) {
  return engineerDefinition({
    id,
    actions: {
      inspect: {
        inputSchema: empty,
        block: handler({
          name: `engineer-inspect-${id}`,
          inputSchema: empty,
          outputSchema: z.object({ marker: z.string() }),
          execute: async (_input, ctx) => {
            await ctx.session.patchState({ marker });
            ctx.emit.message(`marker:${marker}`);
            return { marker };
          },
        }),
      },
    },
  });
}

/**
 * An ordinary single-copy flow, registered alongside the two. Its whole job in
 * this goal is to be unchanged: a one-copy app must not pay for the navigator.
 */
export const reportsFlow = defineFlow({
  kind: REPORTS_KIND,
  actions: {
    summarize: {
      inputSchema: empty,
      block: handler({
        name: "reports-summarize",
        inputSchema: empty,
        outputSchema: z.object({ marker: z.string() }),
        execute: async (_input, ctx) => {
          await ctx.session.patchState({ marker: "reports-ran" });
          ctx.emit.message("marker:reports-ran");
          return { marker: "reports-ran" };
        },
      }),
    },
  },
  // Exposed to the client on purpose: the DevTool's Session Context panel shows
  // the client projection, so a marker that is not exposed cannot be inspected
  // there — and per-instance state being visible in that panel is one of the
  // things this goal grades.
  session: { stateSchema: markerState, client: { expose: ["marker"] } },
});
