/**
 * The flow catalog resolves each pinned instance's caller the way that
 * instance's own doors do.
 *
 * A hired worker can carry its own `authentication.resolvePrincipal` while the
 * host keeps the framework default, so the rest of the app stays open. Opening
 * a session on the worker and running its actions use the worker's resolver. The
 * catalog has to use it too, or the operator who can already reach the worker by
 * address never sees it listed.
 *
 * It must also stay per instance: a credential one worker's resolver accepts must
 * not list a different worker whose resolver refuses it, even when the pin would
 * match the principal it named.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, ResolvePrincipalFn } from "@flow-state-dev/core/types";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { createFlowState, inMemoryStores, PrincipalResolutionError } from "../src";

const ping = handler({
  name: "ping",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async () => ({ ok: true }),
});

const appFlow = defineFlow({ kind: "app", actions: { ping: { block: ping } } });
const workerKind = defineFlow({
  kind: "worker",
  cardinality: "collection",
  actions: { ping: { block: ping } },
});

const OPERATOR = "operator";

/**
 * A bearer-token resolver: each token names one organization, the user is the
 * fixed operator identity. A missing or unknown token is a 401 — the shape a
 * hiring host installs on the workers it hires.
 */
function tokenResolver(tokens: Record<string, string>, calls?: { count: number }): ResolvePrincipalFn {
  return (context) => {
    if (calls !== undefined) calls.count += 1;
    const header = context.request?.headers.get("authorization") ?? "";
    const orgId = tokens[header.replace(/^Bearer /, "")];
    if (orgId === undefined) {
      throw new PrincipalResolutionError("Invalid credential.", { status: 401 });
    }
    return { userId: OPERATOR, orgId };
  };
}

/** A worker instance resolving its callers with `resolver`, not the host's. */
function workerWith(id: string, resolver: ResolvePrincipalFn): FlowInstance {
  const worker = workerKind({ id }) as FlowInstance;
  return { ...worker, authentication: { ...worker.authentication, resolvePrincipal: resolver } };
}

/** An app whose host resolver is the framework default: only the workers authenticate. */
async function boot() {
  const state = createFlowState({
    flows: { app: appFlow() as FlowInstance },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({ policy: "allow" }),
  });
  const router = (await state.getRouter()) as {
    GET: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
    POST: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
  };

  const headers = (token?: string): Record<string, string> => ({
    "content-type": "application/json",
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  });

  /** `GET /api/flows` as `token`: the status and the listed ids. */
  const catalog = async (token?: string) => {
    const response = await router.GET(
      new Request("http://test/api/flows", { headers: headers(token) }),
      { params: { path: [] } }
    );
    const json = (await response.json()) as { flows?: { id: string }[] };
    return { status: response.status, ids: (json.flows ?? []).map((flow) => flow.id).sort() };
  };

  /** Open a session on `flowId` as `token` — the door the catalog must agree with. */
  const open = async (flowId: string, token?: string) => {
    const response = await router.POST(
      new Request(`http://test/api/flows/${flowId}/sessions`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ userId: OPERATOR }),
      }),
      { params: { path: [flowId, "sessions"] } }
    );
    return response.status;
  };

  return { state, catalog, open };
}

const ACME_PIN = { orgId: "acme", userId: OPERATOR };

describe("the catalog lists a pinned worker to the caller its own resolver accepts", () => {
  it("lists the worker for the credential that opens it", async () => {
    const h = await boot();
    h.state.register(workerWith("acme.support", tokenResolver({ "tok-acme": "acme" })), {
      pin: ACME_PIN,
    });

    // The door already agrees; the catalog is what this is about.
    expect(await h.open("acme.support", "tok-acme")).toBe(201);
    expect(await h.catalog("tok-acme")).toEqual({ status: 200, ids: ["acme.support", "app"] });
  });

  it("keeps each worker to its own resolver: a credential only one accepts lists only that one", async () => {
    const h = await boot();
    // Both pinned to the same org and user, so a pin check alone could not
    // tell them apart. Only the resolvers differ.
    h.state.register(workerWith("acme.support", tokenResolver({ "tok-acme": "acme" })), {
      pin: ACME_PIN,
    });
    h.state.register(workerWith("acme.billing", tokenResolver({ "tok-billing": "acme" })), {
      pin: ACME_PIN,
    });

    expect(await h.catalog("tok-billing")).toEqual({ status: 200, ids: ["acme.billing", "app"] });
    expect(await h.catalog("tok-acme")).toEqual({ status: 200, ids: ["acme.support", "app"] });
    // And the doors say the same.
    expect(await h.open("acme.support", "tok-billing")).toBe(401);
  });

  it("resolves a resolver shared by several workers once per request", async () => {
    const h = await boot();
    const calls = { count: 0 };
    const shared = tokenResolver({ "tok-acme": "acme" }, calls);
    h.state.register(workerWith("acme.support", shared), { pin: ACME_PIN });
    h.state.register(workerWith("acme.billing", shared), { pin: ACME_PIN });

    expect(await h.catalog("tok-acme")).toEqual({
      status: 200,
      ids: ["acme.billing", "acme.support", "app"],
    });
    expect(calls.count).toBe(1);
  });
});

describe("the catalog still withholds a pinned worker from everyone else", () => {
  async function bootWithWorker() {
    const h = await boot();
    h.state.register(
      workerWith("acme.support", tokenResolver({ "tok-acme": "acme", "tok-bravo": "bravo" })),
      { pin: ACME_PIN }
    );
    return h;
  }

  it("withholds it from another organization's credential the worker's resolver accepts", async () => {
    const h = await bootWithWorker();

    expect(await h.catalog("tok-bravo")).toEqual({ status: 200, ids: ["app"] });
  });

  it("withholds it from a caller with no credential, and still answers 200", async () => {
    const h = await bootWithWorker();

    expect(await h.catalog()).toEqual({ status: 200, ids: ["app"] });
  });

  it("withholds it from a credential only a different worker's resolver accepts", async () => {
    const h = await bootWithWorker();
    h.state.register(workerWith("acme.billing", tokenResolver({ "tok-billing": "acme" })), {
      pin: ACME_PIN,
    });

    expect((await h.catalog("tok-billing")).ids).not.toContain("acme.support");
  });

  it("withholds it from an unknown credential", async () => {
    const h = await bootWithWorker();

    expect(await h.catalog("tok-nobody")).toEqual({ status: 200, ids: ["app"] });
  });
});
