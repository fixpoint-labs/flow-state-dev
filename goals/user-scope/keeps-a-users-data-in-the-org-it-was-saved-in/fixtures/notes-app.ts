/**
 * The app flow under test: no pin, no worker, nothing but a flow that saves
 * three things for a user and reads them back. User state, a shared
 * user-scoped resource and a flow-isolated one; and a session-scoped record of
 * what a read run saw, so "by a run" grades a real write the run made.
 */
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";

export const FLOW_ID = "notes-app";

const markerRow = z.object({ marker: z.string() });

const userStateSchema = z.object({ marker: z.string().nullable().default(null) });

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
  userStateSchema,
  execute: async (input, ctx) => {
    await ctx.resources.notes.create("n1", { marker: input.shared });
    await ctx.resources.scratch.create("s1", { marker: input.isolated });
    await ctx.user.patchState({ marker: input.state });
    return { ok: true };
  },
});

const read = handler({
  name: "read",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  userStateSchema,
  execute: async (_input, ctx) => {
    await ctx.resources.seen.create("run", {
      state: ctx.user.state.marker,
      shared: (await ctx.resources.notes.list()).map((row) => row.state.marker),
      isolated: (await ctx.resources.scratch.list()).map((row) => row.state.marker),
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
    stateSchema: userStateSchema,
    client: { expose: ["marker"] },
  },
  actions: {
    save,
    read,
  },
  authentication: verified,
});
