/**
 * An app that never installs Workforce, end to end through `createFlowState`
 * and the HTTP router.
 *
 * It declares collections whose patterns could reach Workforce's user-owned
 * roster rows, writes and lists through them, and starts. The store already
 * holds another member's user-owned row, as a store shared with a Workforce
 * app would; the app's lists never show it. The same flow beside Workforce's
 * private roster writer refuses to start. No model call is involved.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import {
  HIRED_ROSTER_PRIVATE_PATTERN,
  markHiredRosterPrivateCollection,
  type ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "../src";
import { createMockModelResolver } from "@flow-state-dev/testing";

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

const notesSchema = z.object({ text: z.string() }).passthrough();
const resources = {
  tenantNotes: defineResourceCollection({
    pattern: "[tenant]/**",
    scope: "org",
    flowIsolation: false,
    stateSchema: notesSchema,
  }),
  rosterNotes: defineResourceCollection({
    pattern: "workforce/roster/[owner]/notes",
    scope: "org",
    flowIsolation: false,
    stateSchema: notesSchema,
  }),
  listed: defineResourceCollection({
    pattern: "listed/*",
    scope: "org",
    stateSchema: z.object({ paths: z.array(z.string()) }),
  }),
};

const writeAndList = handler({
  name: "write-and-list",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (_input, ctx) => {
    const tenant = ctx.resources.tenantNotes as unknown as ResourceCollectionRef;
    const roster = ctx.resources.rosterNotes as unknown as ResourceCollectionRef;
    await tenant.create({ tenant: "acme" }, { text: "tenant note" });
    await roster.create({ owner: "team" }, { text: "team note" });
    const paths = [...(await tenant.list()), ...(await roster.list())].map((row) => row.path).sort();
    await (ctx.resources.listed as unknown as ResourceCollectionRef).create("bob", { paths });
    return { ok: true };
  },
});

const actions = { write: { inputSchema: z.object({}), block: writeAndList } };
const app = defineFlow({ kind: "app", resources, actions, authentication: verified });

const hires = defineFlow({
  kind: "hires",
  resources: {
    roster: markHiredRosterPrivateCollection(
      defineResourceCollection({
        pattern: HIRED_ROSTER_PRIVATE_PATTERN,
        scope: "org",
        flowIsolation: false,
        stateSchema: z.object({}).passthrough(),
      }),
    ),
  },
  actions,
  authentication: verified,
});

describe("an app without Workforce", () => {
  it("starts, writes and lists through roster-shaped patterns, and never lists a user-owned row", async () => {
    const stores = inMemoryStores();
    const primary = await stores.resolve(["primary"]);
    for (const key of ["workforce/roster/~alice/research", "workforce/roster/~alice/notes"]) {
      await primary.resourceState!.set("org", "acme", key, { text: "ALICE-PRIVATE" }, "any");
    }
    const state = createFlowState({
      flows: { app: app() },
      resolvePrincipal: verified.resolvePrincipal,
      stores: { default: { primary: stores } },
      modelResolver: createMockModelResolver({}),
    });
    const router = (await state.getRouter()) as Record<
      string,
      (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>
    >;
    const call = async (path: string[], body: unknown) => {
      const response = await router.POST!(
        new Request(`http://test/api/flows/${path.join("/")}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-verified-user": "bob", "x-verified-org": "acme" },
          body: JSON.stringify(body),
        }),
        { params: { path } },
      );
      return { status: response.status, json: await response.json() };
    };
    const opened = await call(["app", "sessions"], { userId: "bob" });
    expect(opened.status).toBe(201);
    const posted = await call(["app", opened.json.session.id, "actions", "write"], { userId: "bob", input: {} });
    expect(posted.status).toBe(202);

    const runtime = await state.getRuntime();
    let listed: { state?: { paths?: string[] } } | undefined;
    for (let i = 0; i < 100 && listed === undefined; i++) {
      listed = await runtime.stores.resourceState.get("org", "acme", "listed/bob");
      if (listed === undefined) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(listed?.state?.paths).toEqual(["acme/**", "workforce/roster/team/notes"]);
  });

  it("the same flow beside the private roster writer refuses to start", async () => {
    const boot = async () => {
      const state = createFlowState({
        flows: { hires: hires(), app: app() },
        resolvePrincipal: verified.resolvePrincipal,
        stores: { default: { primary: inMemoryStores() } },
        modelResolver: createMockModelResolver({}),
      });
      await state.getRouter();
    };
    await expect(boot()).rejects.toThrow(
      'Collection pattern "[tenant]/**" can read user-owned roster rows on the server.',
    );
  });
});
