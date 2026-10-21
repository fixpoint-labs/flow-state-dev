/** Store-planted rows. The content route admits a template only where `ownerKeyMaySeed` would seed the run cache. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResource, defineResourceCollection } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "../src";
import { createMockModelResolver } from "@flow-state-dev/testing";

const ALICE_KEY = "notes/~alice/research";
const BOARD_KEY = "board/~alice/pinned";
const passthrough = z.object({}).passthrough();
const readable = { client: { content: { read: true } } } as const;

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

/** Accessor name is the storage key. `findResourceConfig` resolves names only; these patterns match nothing. */
const templates = {
  [ALICE_KEY]: defineResourceCollection({ pattern: "unrelated-a/*", scope: "org", stateSchema: passthrough }),
  [BOARD_KEY]: defineResourceCollection({ pattern: "unrelated-b/*", scope: "org", stateSchema: passthrough }),
  "templates/plain": defineResourceCollection({ pattern: "unrelated-c/*", scope: "org", stateSchema: passthrough }),
  board: defineResourceCollection({
    pattern: "board/[owner]/[id]",
    ownerWrites: { param: "owner" },
    scope: "org",
    flowIsolation: false,
    stateSchema: passthrough,
  }),
  privatePeek: defineResource({ scope: "org", ref: "privatePeek", stateSchema: passthrough, contentTemplateRef: ALICE_KEY, ...readable }),
  boardPeek: defineResource({ scope: "org", ref: "boardPeek", stateSchema: passthrough, contentTemplateRef: BOARD_KEY, ...readable }),
  plainPeek: defineResource({ scope: "org", ref: "plainPeek", stateSchema: passthrough, contentTemplateRef: "templates/plain", ...readable }),
};

const flow = defineFlow({ kind: "tpl", actions: {}, resources: templates, authentication: verified });

async function boot() {
  const stores = inMemoryStores();
  const primary = await stores.resolve(["primary"]);
  await primary.content!.set("org", "acme", ALICE_KEY, "ALICE-PRIVATE-TEMPLATE");
  await primary.content!.set("org", "acme", BOARD_KEY, "ALICE-PUBLIC-BOARD");
  await primary.content!.set("org", "acme", "templates/plain", "PLAIN-TEMPLATE");
  const state = createFlowState({
    flows: { tpl: flow } as never,
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
  });
  type Router = Record<string, (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>>;
  const router = (await state.getRouter()) as Router;
  const call = async (user: string, method: string, path: string[], body?: unknown) => {
    const response = await router[method]!(
      new Request(`http://test/api/flows/${path.join("/")}`, {
        method,
        headers: { "content-type": "application/json", "x-verified-user": user, "x-verified-org": "acme" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } }
    );
    return { status: response.status, json: (await response.json()) as any };
  };
  const contentFor = async (user: string, ref: string) => {
    const opened = await call(user, "POST", ["tpl", "sessions"], { userId: user });
    expect(opened.status).toBe(201);
    const sessionId = opened.json.session.id as string;
    const got = await call(user, "GET", ["sessions", sessionId, "resources", ref, "content"]);
    expect(got.status).toBe(200);
    return got.json.content as string | null;
  };
  return { contentFor };
}

describe("contentTemplateRef on the content route · owner-keyed template rows", () => {
  it("does not render another user's owner-private row as a template", async () => {
    const { contentFor } = await boot();
    const content = await contentFor("bob", "privatePeek");
    expect(content).toBeNull();
  });

  it("renders the owner's own owner-keyed row for the owner", async () => {
    const { contentFor } = await boot();
    expect(await contentFor("alice", "privatePeek")).toContain("ALICE-PRIVATE-TEMPLATE");
  });

  it("renders another user's owner-writes row, which the scope serves to everyone", async () => {
    const { contentFor } = await boot();
    expect(await contentFor("bob", "boardPeek")).toContain("ALICE-PUBLIC-BOARD");
  });

  it("renders a template whose key carries no owner segment for anyone", async () => {
    const { contentFor } = await boot();
    expect(await contentFor("bob", "plainPeek")).toContain("PLAIN-TEMPLATE");
  });
});
