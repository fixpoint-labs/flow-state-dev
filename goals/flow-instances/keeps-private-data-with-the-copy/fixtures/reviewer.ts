/**
 * One collection definition the goal instantiates twice, plus the singleton it
 * compares against.
 *
 * The definition carries every cell instance isolation touches: isolated user
 * and org scope state, an isolated single resource with content, an isolated
 * user-scoped collection, and one user-scoped resource that explicitly opts
 * OUT of isolation and so must stay shared between the copies.
 */
import { defineFlow, defineResource, defineResourceCollection, handler } from "@flow-state-dev/core";
import { z } from "zod";

export const REVIEW_KIND = "review";
export const SINGLETON_KIND = "digest";

const inputSchema = z.object({
  /** The private value this copy writes everywhere it owns a cell. */
  marker: z.string(),
  /** Written to the shared resource, or `null` to leave it alone. */
  share: z.string().nullable(),
});

const scopeState = z.object({ marker: z.string().nullable().default(null) });

/** Isolated by the flow-level flag — private to the copy that wrote it. */
const notes = defineResource({
  scope: "user",
  ref: "notes",
  stateSchema: z.object({ text: z.string().default("") }),
  client: { content: { read: true }, state: { read: true } },
});

/** Explicitly shared: every copy of every flow reads and writes this one row. */
const directory = defineResource({
  scope: "user",
  ref: "directory",
  flowIsolation: false,
  stateSchema: z.object({ entry: z.string().default("") }),
  client: { content: { read: true }, state: { read: true } },
});

/** An isolated user-scoped collection, so a member's key routes per copy too. */
const files = defineResourceCollection({
  scope: "user",
  pattern: "files/*",
  stateSchema: z.object({ body: z.string().default("") }),
  client: { content: { read: true }, state: { read: true } },
});

type Collection = {
  create(key: string, init: { body: string }): Promise<{ writeContent(content: string): Promise<unknown> }>;
};

const writeEverything = handler({
  name: "write-everything",
  inputSchema,
  outputSchema: z.object({ marker: z.string() }),
  execute: async (input, ctx) => {
    await ctx.user.patchState({ marker: input.marker });
    await ctx.org?.patchState({ marker: input.marker });
    await ctx.resources.notes.patchState({ text: input.marker });
    await ctx.resources.notes.writeContent(`notes:${input.marker}`);
    const collection = ctx.resources.files as unknown as Collection;
    const report = await collection.create("report", { body: input.marker });
    await report.writeContent(`report:${input.marker}`);
    if (input.share !== null) {
      await ctx.resources.directory.patchState({ entry: input.share });
      await ctx.resources.directory.writeContent(`directory:${input.share}`);
    }
    return { marker: input.marker };
  },
});

const clientMarker = {
  derived: {
    seen: (ctx: { state: { marker?: string | null } }) => ({ marker: ctx.state.marker ?? null }),
  },
};

export const reviewDefinition = defineFlow({
  kind: REVIEW_KIND,
  cardinality: "collection",
  isolateUserState: true,
  isolateOrgState: true,
  actions: { run: { inputSchema, block: writeEverything } },
  user: { stateSchema: scopeState, client: clientMarker },
  org: { stateSchema: scopeState, client: clientMarker },
  resources: { notes, directory, files },
});

/**
 * The same shape as a plain singleton, whose instance id IS its kind — the
 * control for "existing deployments keep their keys".
 */
export const digestDefinition = defineFlow({
  kind: SINGLETON_KIND,
  isolateUserState: true,
  isolateOrgState: true,
  actions: { run: { inputSchema, block: writeEverything } },
  user: { stateSchema: scopeState, client: clientMarker },
  org: { stateSchema: scopeState, client: clientMarker },
  resources: {
    notes: defineResource({
      scope: "user",
      ref: "notes",
      stateSchema: z.object({ text: z.string().default("") }),
      client: { content: { read: true }, state: { read: true } },
    }),
    directory,
    files: defineResourceCollection({
      scope: "user",
      pattern: "files/*",
      stateSchema: z.object({ body: z.string().default("") }),
      client: { content: { read: true }, state: { read: true } },
    }),
  },
});
