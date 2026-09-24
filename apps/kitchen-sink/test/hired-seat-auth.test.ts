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
  process.env.WORKFORCE_ADMIN_TOKENS = "acme:tok-acme,bravo:tok-bravo";
  return previous;
});

import { ADMIN_USER_ID } from "../lib/workforce-admin-auth";
import { setWorkforceRegistrarImpl, workforceRegistrar } from "../lib/workforce-registrar";
import workforceAdminFlow from "../flows/workforce-admin/flow";
import { kitchenSinkKinds } from "../workforce/hire";

const ACME = "tok-acme";
const BRAVO = "tok-bravo";
const SEAT = seatAddress("acme", "support.bo", ADMIN_USER_ID);

type Router = {
  GET: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
  POST: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
};

/**
 * The app's runtime as `fsdev.config.ts` assembles the parts this needs: the
 * admin flow registered, and the registrar installed over the FlowState's own
 * door, so a hire goes through the same admission a real one does.
 */
async function boot(stores = inMemoryStores()) {
  const state = createFlowState({
    flows: { workforceAdmin: workforceAdminFlow as FlowInstance },
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({ policy: "allow" }),
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
      orgIds: ["acme", "bravo"],
      kinds: kitchenSinkKinds,
    });
    expect(problems).toEqual([]);
    for (const seat of seats) workforceRegistrar.registerFromRoster(seat, { pin: seat.ownerPin });
    return seats.map((seat) => seat.id);
  };

  return { call, act, reload };
}

/** Boot, and hire `support.bo` into acme with acme's admin credential. */
async function bootWithHire(stores = inMemoryStores()) {
  const app = await boot(stores);
  const hired = await app.act(
    "workforce-admin",
    "hire",
    { seatId: "support.bo", flow: "desk-clerk", settings: { desk: "back" } },
    ACME
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

    const opened = await app.call([SEAT, "sessions"], ACME, { userId: ADMIN_USER_ID });

    expect(opened.status).toBe(201);
  });

  it("runs an action for the operator who hired it", async () => {
    const app = await bootWithHire();

    const ran = await app.act(SEAT, "answer", { note: "where is my order?" }, ACME);

    expect(ran).toEqual({ http: 202, outcome: "completed" });
  });

  it("still answers the operator after a restart brings it back from its row", async () => {
    const stores = inMemoryStores();
    await bootWithHire(stores);

    const restarted = await boot(stores);
    expect(await restarted.reload()).toEqual([SEAT]);
    const ran = await restarted.act(SEAT, "answer", { note: "still there?" }, ACME);

    expect(ran).toEqual({ http: 202, outcome: "completed" });
  });
});

describe("a seat hired over workforce-admin stays closed to everyone else", () => {
  it("answers another organization's admin credential as an address it does not serve", async () => {
    const app = await bootWithHire();

    const opened = await app.call([SEAT, "sessions"], BRAVO, { userId: ADMIN_USER_ID });
    const ran = await app.act(SEAT, "answer", { note: "hello" }, BRAVO);

    expect(opened).toEqual({ status: 404, json: { error: `Unknown flow "${SEAT}"` } });
    expect(ran).toEqual({ http: 404, error: `Unknown flow "${SEAT}"` });
  });

  it("refuses a caller with no credential, even one naming the org and user in the body", async () => {
    const app = await bootWithHire();
    const claimed = { userId: ADMIN_USER_ID, orgId: "acme" };

    const opened = await app.call([SEAT, "sessions"], undefined, claimed);
    const ran = await app.call([SEAT, "actions", "answer"], undefined, {
      ...claimed,
      input: { note: "hello" },
    });

    // 401 once the seat authenticates; 404 (the pin) before it did. Either is a
    // refusal, and neither lets anything run.
    expect([401, 404]).toContain(opened.status);
    expect([401, 404]).toContain(ran.status);
  });
});
