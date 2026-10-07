/**
 * The app flow under test: no pin, no worker, nothing but a flow that saves
 * three things for a user and reads them back. User state, a shared
 * user-scoped resource and a flow-isolated one; and a session-scoped record of
 * what a read run saw, so "by a run" grades a real write the run made.
 */
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";

export const FLOW_ID = "notes-app";

const markerRow = z.object({ marker: z.string() });

const resources = {
  /** User-scoped, shared with every flow in the org. */
  notes: defineResourceCollection({
    pattern: "notes/*",
    scope: "user",
    stateSchema: markerRow,
    client: { state: { read: true } },
  }),
  /** User-scoped, isolated to this flow. */
  scratch: defineResourceCollection({
    pattern: "scratch/*",
    scope: "user",
    flowIsolation: true,
    stateSchema: markerRow,
    client: { state: { read: true } },
  }),
  /** What a read run saw, kept on its own session. */
  seen: defineResourceCollection({
    pattern: "seen/*",
    scope: "session",
    stateSchema: z.object({ state: z.string().nullable(), shared: z.array(z.string()), isolated: z.array(z.string()) }),
    client: { state: { read: true } },
  }),
};

const saveInput = z.object({ state: z.string(), shared: z.string(), isolated: z.string() });

const save = handler({
  name: "save",
  inputSchema: saveInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (input, ctx) => {
    await (ctx.resources.notes as unknown as ResourceCollectionRef).create("n1", { marker: input.shared });
    await (ctx.resources.scratch as unknown as ResourceCollectionRef).create("s1", { marker: input.isolated });
    await ctx.user.patchState({ marker: input.state });
    return { ok: true };
  },
});

const markersOf = async (ref: unknown): Promise<string[]> =>
  (await (ref as ResourceCollectionRef).list()).map((row) => String((row.state as { marker: string }).marker));

const read = handler({
  name: "read",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (_input, ctx) => {
    await (ctx.resources.seen as unknown as ResourceCollectionRef).create("run", {
      state: (ctx.user.state as { marker: string | null }).marker ?? null,
      shared: await markersOf(ctx.resources.notes),
      isolated: await markersOf(ctx.resources.scratch),
    });
    return { ok: true };
  },
});

/**
 * Trusts two headers as the verified principal: the stand-in for a host's
 * auth, so each request names its user and org the way a resolver would.
 */
export const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

export const notesApp = defineFlow({
  kind: FLOW_ID,
  resources,
  user: {
    stateSchema: z.object({ marker: z.string().nullable().default(null) }),
    client: { derived: { mine: (ctx) => ({ marker: (ctx.state as { marker?: string | null }).marker ?? null }) } },
  },
  actions: {
    save: { inputSchema: saveInput, block: save },
    read: { inputSchema: z.object({}), block: read },
  },
  authentication: verified,
});
