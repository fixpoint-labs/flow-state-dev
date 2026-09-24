/**
 * A seat hired over `workforce-admin` answers the credential that hired it —
 * over HTTP, through the router this app serves, the way a caller reaches it.
 *
 * The hire pins the seat to the organization (and the user) the admin
 * credential resolved. Every later request to the seat is checked against that
 * pin, so the seat is only reachable if the request resolves the same principal.
 * With no resolver of its own the seat fell to the framework default, which
 * names the default organization — and the pin refused even the operator who
 * had just hired it.
 *
 * Red state, produced before the green was trusted: drop the
 * `withAdminAuthentication` call from `registerFromRoster` in
 * `lib/workforce-registrar.ts`. The three "hiring credential" cases go red
 * (`404 Unknown flow` on the open, the run, and the run after a restart); the
 * refusals stay green, because they were refused before the fix too.
 *
 * The catalog and listing legs lean on the engine resolving each instance's
 * caller with that instance's own resolver. Revert `flowsForCaller` in the
 * engine's `routes/http-handlers.ts` to the host resolver alone and only "is
 * listed in the catalog" goes red. Drop the `ownResolverVerdict` calls from
 * the engine's session listing and only the two "session listing" cases for
 * the hiring credential go red.
 *
 * Every admin token names `kitchen-sink`, the one organization this app runs
 * as (`lib/workforce-admin-auth.ts`). A token naming any other organization is
 * refused when the credentials are read, so the "another organization" case
 * below is that token being refused at the seat, not a pin miss.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { reloadHiredSeats, seatAddress } from "@flow-state-dev/workforce";

// Before any import below evaluates: the admin flow and the registrar each read
// the credential once, at module scope, exactly as they do at boot.
const previousTokens = vi.hoisted(() => {
  const previous = process.env.WORKFORCE_ADMIN_TOKENS;
  process.env.WORKFORCE_ADMIN_TOKENS = "kitchen-sink:tok-ks,elsewhere:tok-elsewhere";
  return previous;
});

import { ADMIN_USER_ID } from "../lib/workforce-admin-auth";
import { setWorkforceRegistrarImpl, workforceRegistrar } from "../lib/workforce-registrar";
import workforceAdminFlow from "../flows/workforce-admin/flow";
import { kitchenSinkKinds } from "../workforce/hire";
import { KITCHEN_SINK_ORG_ID, resolveKitchenSinkPrincipal } from "../lib/kitchen-sink-principal";

/** The configured kitchen-sink admin token. */
const TOKEN = "tok-ks";
/** A token whose entry named another organization, refused when the credentials were read. */
const OTHER_ORG_TOKEN = "tok-elsewhere";
const SEAT = seatAddress(KITCHEN_SINK_ORG_ID, "support.bo", ADMIN_USER_ID);

type Router = {
  GET: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
  POST: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
};

/**
 * The app's runtime as `fsdev.config.ts` assembles the parts this needs: the
 * admin flow registered, and the registrar installed over the FlowState's own
 * door, so a hire goes through the same admission a real one does.
 */
async function boot(stores = inMemoryStores(), options: { hostResolver?: boolean } = {}) {
  const state = createFlowState({
    flows: { workforceAdmin: workforceAdminFlow as FlowInstance },
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({ policy: "allow" }),
    // The host-level fallback `fsdev.config.ts` installs. Off by default: the
    // hire, open and run legs do not reach it, since the admin flow and the
    // seat each bring their own.
    ...(options.hostResolver === true ? { resolvePrincipal: resolveKitchenSinkPrincipal } : {}),
  });
  const router = (await state.getRouter()) as Router;
  const runtime = await state.getRuntime();
  setWorkforceRegistrarImpl({
    register: (flow, options) => state.register(flow, options),
    unregister: (id) => state.unregister(id),
    kindAt: (id) => runtime.registry.get(id)?.kind,
  });

  // Every body names the admin user, as a client does (the session client
  // always sends a `userId`). That makes the refusals below the pin's and not
  // a missing-field 400 — and shows the body naming the right user gets a
  // caller nowhere: only the verified principal counts.
  const call = async (path: string[], token: string | undefined, body: unknown) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const response = await router.POST(
      new Request(`http://kitchen-sink.local/api/flows/${path.join("/")}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  /** `GET /api/flows` — the catalog — as `token`: the status and the listed ids. */
  const catalog = async (token: string | undefined) => {
    const headers: Record<string, string> = {};
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const response = await router.GET(
      new Request("http://kitchen-sink.local/api/flows", { headers }),
      { params: { path: [] } }
    );
    const json = (await response.json()) as { flows?: { id: string }[] };
    return { status: response.status, ids: (json.flows ?? []).map((flow) => flow.id) };
  };

  /** `GET /api/flows/sessions` — the session listing — as `token`: the status and the listed ids. */
  const sessions = async (token: string | undefined) => {
    const headers: Record<string, string> = {};
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const response = await router.GET(
      new Request("http://kitchen-sink.local/api/flows/sessions", { headers }),
      { params: { path: ["sessions"] } }
    );
    const json = (await response.json()) as { sessions?: { id: string }[] };
    return { status: response.status, ids: (json.sessions ?? []).map((session) => session.id) };
  };

  /** Post an action and wait for its request to settle. */
  const act = async (flowId: string, action: string, input: unknown, token: string | undefined) => {
    const posted = await call([flowId, "actions", action], token, { userId: ADMIN_USER_ID, input });
    if (posted.status >= 400) return { http: posted.status, error: posted.json?.error as string };
    const requestId = posted.json.request?.id as string;
    for (let i = 0; i < 200; i++) {
      const record = await runtime.stores.request.get(requestId);
      if (record !== undefined && !["pending", "queued", "in_progress", "running"].includes(record.status)) {
        return { http: posted.status, outcome: record.status };
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { http: posted.status, outcome: "never settled" };
  };

  /**
   * The boot reload, as `fsdev.config.ts` runs it: every stored row hired back
   * and admitted through the registrar's roster door.
   */
  const reload = async () => {
    const { seats, problems } = await reloadHiredSeats({
      stores: runtime.stores,
      orgIds: [KITCHEN_SINK_ORG_ID],
      kinds: kitchenSinkKinds,
    });
    expect(problems).toEqual([]);
    for (const seat of seats) workforceRegistrar.registerFromRoster(seat, { pin: seat.ownerPin });
    return seats.map((seat) => seat.id);
  };

  return { call, act, catalog, sessions, reload };
}

/** Boot, and hire `support.bo` into kitchen-sink with its admin credential. */
async function bootWithHire(stores = inMemoryStores(), options: { hostResolver?: boolean } = {}) {
  const app = await boot(stores, options);
  const hired = await app.act(
    "workforce-admin",
    "hire",
    { seatId: "support.bo", flow: "desk-clerk", settings: { desk: "back" } },
    TOKEN
  );
  // If the hire itself did not land, everything below is about nothing.
  expect(hired).toEqual({ http: 202, outcome: "completed" });
  return app;
}

afterAll(() => {
  if (previousTokens === undefined) delete process.env.WORKFORCE_ADMIN_TOKENS;
  else process.env.WORKFORCE_ADMIN_TOKENS = previousTokens;
});

describe("a seat hired over workforce-admin, reached with the hiring credential", () => {
  it("opens a session for the operator who hired it", async () => {
    const app = await bootWithHire();

    const opened = await app.call([SEAT, "sessions"], TOKEN, { userId: ADMIN_USER_ID });

    expect(opened.status).toBe(201);
  });

  it("runs an action for the operator who hired it", async () => {
    const app = await bootWithHire();

    const ran = await app.act(SEAT, "answer", { note: "where is my order?" }, TOKEN);

    expect(ran).toEqual({ http: 202, outcome: "completed" });
  });

  it("is listed in the catalog for the operator who hired it", async () => {
    const app = await bootWithHire();

    const listed = await app.catalog(TOKEN);

    expect(listed.status).toBe(200);
    expect(listed.ids).toContain(SEAT);
  });

  it("lists the session it opened in the session listing for the operator who hired it", async () => {
    const app = await bootWithHire();
    const opened = await app.call([SEAT, "sessions"], TOKEN, { userId: ADMIN_USER_ID, sessionId: "s-op" });
    expect(opened.status).toBe(201);

    const listed = await app.sessions(TOKEN);

    expect(listed.status).toBe(200);
    expect(listed.ids).toContain("s-op");
  });

  it("lists that session under the host resolver this app installs, too", async () => {
    const app = await bootWithHire(inMemoryStores(), { hostResolver: true });
    const opened = await app.call([SEAT, "sessions"], TOKEN, { userId: ADMIN_USER_ID, sessionId: "s-op" });
    expect(opened.status).toBe(201);

    const listed = await app.sessions(TOKEN);

    // The host resolver names every caller the app's one visitor, not the
    // operator the seat resolves. The seat's own resolver decides its rows.
    expect(listed.status).toBe(200);
    expect(listed.ids).toContain("s-op");
  });

  it("still answers the operator after a restart brings it back from its row", async () => {
    const stores = inMemoryStores();
    await bootWithHire(stores);

    const restarted = await boot(stores);
    expect(await restarted.reload()).toEqual([SEAT]);
    const ran = await restarted.act(SEAT, "answer", { note: "still there?" }, TOKEN);

    expect(ran).toEqual({ http: 202, outcome: "completed" });
  });
});

describe("a seat hired over workforce-admin stays closed to everyone else", () => {
  it("refuses a token configured for another organization, which was refused at boot", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await bootWithHire();

    const opened = await app.call([SEAT, "sessions"], OTHER_ORG_TOKEN, { userId: ADMIN_USER_ID });
    const ran = await app.act(SEAT, "answer", { note: "hello" }, OTHER_ORG_TOKEN);

    expect(opened.status).toBe(401);
    expect(opened.json?.error).toMatch(/Invalid workforce-admin credential/);
    expect(ran).toEqual({ http: 401, error: "Invalid workforce-admin credential." });
  });

  it("is left out of the catalog for another organization and for a caller with no credential", async () => {
    const app = await bootWithHire();

    const elsewhere = await app.catalog(OTHER_ORG_TOKEN);
    const anonymous = await app.catalog(undefined);

    expect(elsewhere.status).toBe(200);
    expect(elsewhere.ids).not.toContain(SEAT);
    // The catalog route stays exempt: no credential is a shorter list, not a 401.
    expect(anonymous.status).toBe(200);
    expect(anonymous.ids).not.toContain(SEAT);
  });

  it("keeps the seat's sessions out of the session listing for anyone else", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const hostResolver of [false, true]) {
      const app = await bootWithHire(inMemoryStores(), { hostResolver });
      const opened = await app.call([SEAT, "sessions"], TOKEN, { userId: ADMIN_USER_ID, sessionId: "s-op" });
      expect(opened.status).toBe(201);

      const anonymous = await app.sessions(undefined);
      const elsewhere = await app.sessions(OTHER_ORG_TOKEN);

      // No credential is a shorter list, not a 401.
      expect(anonymous.status).toBe(200);
      expect(anonymous.ids).not.toContain("s-op");
      expect(elsewhere.status).toBe(200);
      expect(elsewhere.ids).not.toContain("s-op");
    }
  });

  it("refuses a caller with no credential, even one naming the org and user in the body", async () => {
    const app = await bootWithHire();
    const claimed = { userId: ADMIN_USER_ID, orgId: KITCHEN_SINK_ORG_ID };

    const opened = await app.call([SEAT, "sessions"], undefined, claimed);
    const ran = await app.call([SEAT, "actions", "answer"], undefined, {
      ...claimed,
      input: { note: "hello" },
    });

    // The seat's own resolver refuses a missing credential before the pin runs.
    expect(opened.status).toBe(401);
    expect(ran.status).toBe(401);
  });
});
