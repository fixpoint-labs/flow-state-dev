/**
 * One worker kind, built the way an app builds one: the documents its
 * `resources/` folder declared, spread into a flow-level map beside a store of
 * its own.
 *
 * A factory rather than a module-level constant, because the documents come off
 * disk. That is also what makes the fixture honest: the flow-level map holds a
 * `${STORE}` the allowlist must never touch, beside documents it must narrow.
 * A fixture whose flow-level map held nothing but documents would be green for
 * a resolver that silently deletes the app's own machinery.
 *
 * No model, no generator. What is graded is which resources reached a running
 * block and which of them it could write.
 */
import { defineFlow, defineResource, handler, sequencer } from "@flow-state-dev/core";
import type { DeclaredResources } from "@flow-state-dev/core";
import type { ResourceDoc } from "@flow-state-dev/workforce";
import { resourcesFromDocs, workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

export const DESK_KIND = "desk";

/** The app's own store, declared at flow level beside the documents. Not a document. */
export const STORE = "audit-log";

const auditLog = defineResource({
  ref: STORE,
  scope: "org",
  stateSchema: z.object({ entries: z.array(z.string()).default([]) }),
  default: { entries: [] },
  writable: true
});

const inputSchema = z.object({ note: z.string() });

/** What the seat records about what it could actually touch. */
const seatState = z.object({
  /** Every resource key the block resolved, sorted. */
  reach: z.array(z.string()).nullable().default(null),
  /** Every one of those it could also write, sorted. */
  wrote: z.array(z.string()).nullable().default(null),
  runs: z.number().default(0)
});

const start = handler({
  name: "desk-start",
  inputSchema,
  execute: async (_input, ctx) => {
    await ctx.session.incState({ runs: 1 });
  }
});

/**
 * The nested read — what this seat can reach, and what it can write.
 *
 * Both halves are probed by DOING them, never by reading a flag: `ro` is only
 * worth anything if the write actually refuses at the seam, and a check that
 * asserted `writable === false` would pass for a flag nothing consults.
 */
function probe(keys: readonly string[]) {
  return handler({
    name: "desk-probe",
    inputSchema,
    outputSchema: z.void(),
    // Every document is org-scoped, and a flow collects `requiresOrg` from its
    // blocks rather than from its resource map. Without this the request is
    // admitted with no org, no org registry is built, and every document reads
    // as unregistered — a green `reach: []` for the wrong reason.
    requireOrg: true,
    sessionStateSchema: seatState,
    execute: async (_input, ctx) => {
      const reach: string[] = [];
      const wrote: string[] = [];
      for (const key of keys) {
        let ref: { setState(next: Record<string, unknown>): Promise<void> } | undefined;
        try {
          ref = ctx.resources.get(key) as unknown as typeof ref;
        } catch {
          continue;
        }
        if (ref === undefined) continue;
        reach.push(key);
        try {
          await ref.setState({ touched: true });
          wrote.push(key);
        } catch {
          // A refused write is the point of the `ro` half, not an error here.
        }
      }
      await ctx.session.patchState({ reach: reach.sort(), wrote: wrote.sort() });
    }
  });
}

const clientView = {
  derived: {
    ran: (ctx: { state: { reach?: string[] | null; wrote?: string[] | null; runs?: number } }) => ({
      reach: ctx.state.reach ?? null,
      wrote: ctx.state.wrote ?? null,
      runs: ctx.state.runs ?? 0
    })
  }
};

/**
 * Build the kind from the documents the loader found.
 *
 * Returns the catalog too, because that is the same map the app hands
 * `hireWorkforce` as `documents` — one list, spread into the flow and passed to
 * the hire step, never built twice.
 */
export function buildDesk(documents: ResourceDoc[]): {
  deskFlow: ReturnType<typeof defineFlow>;
  catalog: DeclaredResources;
  probedKeys: string[];
} {
  const catalog = resourcesFromDocs(documents);
  const probedKeys = [...Object.keys(catalog), STORE].sort();

  const deskFlow = defineFlow({
    kind: DESK_KIND,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    resources: { ...catalog, [STORE]: auditLog } as DeclaredResources,
    actions: {
      run: {
        inputSchema,
        block: sequencer({ name: "desk-work", inputSchema }).tap(start).tap(probe(probedKeys))
      }
    },
    session: { stateSchema: seatState, client: clientView }
  });

  return { deskFlow, catalog, probedKeys };
}
