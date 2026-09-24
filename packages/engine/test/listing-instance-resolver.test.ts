/**
 * The session listing and the active-request listing judge a row owned by an
 * instance with its own resolver the way that instance's doors judge its
 * caller.
 *
 * A hired seat can carry its own `authentication.resolvePrincipal` while the
 * rest of the app stays on the host's resolver. Opening a session on the seat
 * and running its actions use the seat's resolver, so the listings must too,
 * or the operator who can already reach the seat never sees its sessions or
 * its in-flight runs listed.
 *
 * It stays per instance: a credential one seat's resolver accepts must not
 * list a different seat's rows, even when both resolve the same principal.
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
const seatKind = defineFlow({
  kind: "seat",
  cardinality: "collection",
  actions: { ping: { block: ping } },
});

const OPERATOR = "operator";
const VISITOR = "visitor";

/**
 * A bearer-token resolver: each token names one organization, the user is the
 * fixed operator identity unless the token maps to `org/user`. A missing or
 * unknown token is a 401, the shape a hiring host installs on its seats.
 */
function tokenResolver(tokens: Record<string, string>): ResolvePrincipalFn {
  return (context) => {
    const header = context.request?.headers.get("authorization") ?? "";
    const entry = tokens[header.replace(/^Bearer /, "")];
    if (entry === undefined) {
      throw new PrincipalResolutionError("Invalid credential.", { status: 401 });
    }
    const [orgId, userId = OPERATOR] = entry.split("/");
    return { userId, orgId };
  };
}

/** A seat instance resolving its callers with `resolver`, not the host's. */
function seatWith(id: string, resolver: ResolvePrincipalFn): FlowInstance {
  const seat = seatKind({ id }) as FlowInstance;
  return { ...seat, authentication: { ...seat.authentication, resolvePrincipal: resolver } };
}

const ACME_PIN = { orgId: "acme", userId: OPERATOR };

/**
 * An app whose only flow of its own is open. `hostResolver` is the host-level
 * fallback; omitted, it is the framework default, so only the seats
 * authenticate.
 */
async function boot(hostResolver?: ResolvePrincipalFn) {
  const state = createFlowState({
    flows: { app: appFlow() as FlowInstance },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({ policy: "allow" }),
    ...(hostResolver === undefined ? {} : { resolvePrincipal: hostResolver }),
  });
  const router = (await state.getRouter()) as {
    GET: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
    POST: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
  };
  const { stores } = await state.getRuntime();

  const headers = (token?: string): Record<string, string> => ({
    "content-type": "application/json",
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  });

  /** Open a session on `flowId` as `token`; returns the status and the session id. */
  const open = async (flowId: string, sessionId: string, token?: string, userId = OPERATOR) => {
    const response = await router.POST(
      new Request(`http://test/api/flows/${flowId}/sessions`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ sessionId, userId }),
      }),
      { params: { path: [flowId, "sessions"] } }
    );
    return response.status;
  };

  /** `GET /api/flows/<path>` as `token`: the status and the parsed body. */
  const get = async (path: string[], token?: string) => {
    const response = await router.GET(
      new Request(`http://test/api/flows/${path.join("/")}`, { headers: headers(token) }),
      { params: { path } }
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  };

  /** The session listing as `token`: status and the sorted session ids. */
  const sessions = async (token?: string) => {
    const { status, json } = await get(["sessions"], token);
    const rows = (json.sessions ?? []) as { id: string }[];
    return { status, ids: rows.map((row) => row.id).sort() };
  };

  /** The active-request listing as `token`: status and the sorted request ids. */
  const active = async (token?: string) => {
    const { status, json } = await get(["active-requests"], token);
    const rows = (json.entries ?? []) as { requestId: string }[];
    return { status, ids: rows.map((row) => row.requestId).sort() };
  };

  /** An in-flight request owned by `flowId`, as `runAction` registers one. */
  const running = async (
    requestId: string,
    owner: { flowId: string; flowKind: string; userId: string; orgId: string }
  ) => {
    const now = Date.now();
    await stores.activeRequests.register({
      requestId,
      sessionId: `s-${requestId}`,
      flowId: owner.flowId,
      flowKind: owner.flowKind,
      actionName: "ping",
      userId: owner.userId,
      orgId: owner.orgId,
      source: "http",
      startedAt: now,
      lastHeartbeatAt: now,
    });
  };

  return { state, stores, open, sessions, active, running };
}

type Harness = Awaited<ReturnType<typeof boot>>;

/**
 * Two seats pinned to the same org and user, so a pin check alone could not
 * tell them apart; only their resolvers differ. Each has one session and one
 * in-flight request, opened through its own door. The open app has one of
 * each too, from a caller with no credential.
 */
async function seedTwoSeats(h: Harness) {
  h.state.register(
    seatWith("acme.support", tokenResolver({ "tok-acme": "acme", "tok-bravo": "bravo" })),
    { pin: ACME_PIN }
  );
  h.state.register(seatWith("acme.billing", tokenResolver({ "tok-billing": "acme" })), {
    pin: ACME_PIN,
  });

  // The doors already admit these callers; the listings are what this is about.
  expect(await h.open("acme.support", "s-support", "tok-acme")).toBe(201);
  expect(await h.open("acme.billing", "s-billing", "tok-billing")).toBe(201);
  await h.running("r-support", { flowId: "acme.support", flowKind: "seat", userId: OPERATOR, orgId: "acme" });
  await h.running("r-billing", { flowId: "acme.billing", flowKind: "seat", userId: OPERATOR, orgId: "acme" });
}

describe("in a mixed app, the listings show a seat's rows to the caller its own resolver accepts", () => {
  async function bootMixed() {
    const h = await boot();
    await seedTwoSeats(h);
    expect(await h.open("app", "s-app", undefined, VISITOR)).toBe(201);
    await h.running("r-app", { flowId: "app", flowKind: "app", userId: VISITOR, orgId: "__fsd_default_org__" });
    return h;
  }

  it("lists the seat's session and in-flight request for the credential that opens it", async () => {
    const h = await bootMixed();

    expect(await h.sessions("tok-acme")).toEqual({ status: 200, ids: ["s-app", "s-support"] });
    expect(await h.active("tok-acme")).toEqual({ status: 200, ids: ["r-app", "r-support"] });
  });

  it("keeps each seat to its own resolver: a credential only one accepts lists only that one", async () => {
    const h = await bootMixed();

    expect(await h.sessions("tok-billing")).toEqual({ status: 200, ids: ["s-app", "s-billing"] });
    expect(await h.active("tok-billing")).toEqual({ status: 200, ids: ["r-app", "r-billing"] });
  });

  it("withholds the seat's rows from another organization's credential its resolver accepts", async () => {
    const h = await bootMixed();

    expect(await h.sessions("tok-bravo")).toEqual({ status: 200, ids: ["s-app"] });
    expect(await h.active("tok-bravo")).toEqual({ status: 200, ids: ["r-app"] });
  });

  it("withholds every seat's rows from a caller with no credential, who still sees the open flow's", async () => {
    const h = await bootMixed();

    expect(await h.sessions()).toEqual({ status: 200, ids: ["s-app"] });
    expect(await h.active()).toEqual({ status: 200, ids: ["r-app"] });
  });

  it("withholds a row the pin refuses, even from a caller the seat's resolver names as its owner", async () => {
    const h = await boot();
    h.state.register(
      seatWith("acme.support", tokenResolver({ "tok-acme": "acme", "tok-intruder": "acme/intruder" })),
      { pin: ACME_PIN }
    );
    // The door refuses this caller, so no route could have written the row.
    // It is planted to show the listing applies the pin too.
    expect(await h.open("acme.support", "s-probe", "tok-intruder", "intruder")).toBe(404);
    await h.running("r-intruder", { flowId: "acme.support", flowKind: "seat", userId: "intruder", orgId: "acme" });
    const now = Date.now();
    await h.stores.session.set(
      "s-intruder",
      {
        id: "s-intruder",
        flowKind: "seat",
        flowId: "acme.support",
        userId: "intruder",
        orgId: "acme",
        state: {},
        version: 0,
        createdAt: now,
        updatedAt: now,
        journal: [],
      },
      "any"
    );

    expect(await h.sessions("tok-intruder")).toEqual({ status: 200, ids: [] });
    expect(await h.active("tok-intruder")).toEqual({ status: 200, ids: [] });
  });
});

describe("with a host resolver, the listings show a seat's rows to the caller its own resolver accepts", () => {
  /** A host that names every caller the same visitor, as the kitchen-sink app does. */
  const visitorHost: ResolvePrincipalFn = () => ({ userId: VISITOR, orgId: "acme" });

  async function bootHosted() {
    const h = await boot(visitorHost);
    await seedTwoSeats(h);
    expect(await h.open("app", "s-app")).toBe(201);
    await h.running("r-app", { flowId: "app", flowKind: "app", userId: VISITOR, orgId: "acme" });
    return h;
  }

  it("lists the seat's rows alongside the host principal's for the seat's credential", async () => {
    const h = await bootHosted();

    expect(await h.sessions("tok-acme")).toEqual({ status: 200, ids: ["s-app", "s-support"] });
    expect(await h.active("tok-acme")).toEqual({ status: 200, ids: ["r-app", "r-support"] });
  });

  it("keeps each seat to its own resolver", async () => {
    const h = await bootHosted();

    expect(await h.sessions("tok-billing")).toEqual({ status: 200, ids: ["s-app", "s-billing"] });
    expect(await h.active("tok-billing")).toEqual({ status: 200, ids: ["r-app", "r-billing"] });
  });

  it("shows a caller with no seat credential only the host principal's rows", async () => {
    const h = await bootHosted();

    expect(await h.sessions()).toEqual({ status: 200, ids: ["s-app"] });
    expect(await h.active()).toEqual({ status: 200, ids: ["r-app"] });
    expect(await h.sessions("tok-bravo")).toEqual({ status: 200, ids: ["s-app"] });
  });
});
