/**
 * A seat hired from inside the app opens for a visitor, even when admin
 * credentials are configured. A seat hired over `workforce-admin` still does not.
 *
 * Two hire paths reach the registrar's roster door. The admin action pins its
 * seat to the organization AND the admin user, so that seat has to resolve its
 * callers with the admin credential (`hired-seat-auth.test.ts`). The in-app
 * hire, the `hire` tool a manager seat carries, pins its seat to the
 * organization only. A visitor opens that seat like any other, so it must keep
 * resolving callers the way every other flow in the app does, not demand the
 * operator's token.
 *
 * The host resolver below stands in for how the app names its visitors: one
 * fixed principal in a named organization, read from nothing on the request.
 *
 * Red state, produced before the green was trusted: on main, `registerFromRoster`
 * gave every roster seat the admin resolver whenever a credential was
 * configured. The two "visitor" cases went red with `401` on the open and on
 * the run; the admin-seat cases stayed green. The other direction: make
 * `withAdminAuthentication` never attach the resolver, and the two admin-seat
 * cases go red while the visitor cases stay green.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import type { FlowInstance, ResolvePrincipalFn } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import {
  hiredSeatManifest,
  hireWorkforce,
  seatAddress,
  toHiredSeatRow,
} from "@flow-state-dev/workforce";

// Before any import below evaluates: the admin flow and the registrar each read
// the credential once, at module scope, exactly as they do at boot.
const previousTokens = vi.hoisted(() => {
  const previous = process.env.WORKFORCE_ADMIN_TOKENS;
  process.env.WORKFORCE_ADMIN_TOKENS = "acme:tok-acme";
  return previous;
});

import { ADMIN_USER_ID } from "../lib/workforce-admin-auth";
import { setWorkforceRegistrarImpl } from "../lib/workforce-registrar";
import workforceAdminFlow from "../flows/workforce-admin/flow";
import { kitchenSinkKinds, kitchenSinkSeatHireOptions } from "../workforce/hire";

const ORG = "acme";
const ACME = "tok-acme";
const VISITOR = "visitor";

/** Every caller with no flow resolver of its own is this visitor, in the org. */
const resolveVisitor: ResolvePrincipalFn = () => ({ userId: VISITOR, orgId: ORG });

type Router = {
  POST: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
};

/** The admin flow registered and the registrar installed over the FlowState's door. */
async function boot() {
  const stores = inMemoryStores();
  const state = createFlowState({
    flows: { workforceAdmin: workforceAdminFlow as FlowInstance },
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({ policy: "allow" }),
    resolvePrincipal: resolveVisitor,
  });
  const router = (await state.getRouter()) as Router;
  const runtime = await state.getRuntime();
  setWorkforceRegistrarImpl({
    register: (flow, options) => state.register(flow, options),
    unregister: (id) => state.unregister(id),
    kindAt: (id) => runtime.registry.get(id)?.kind,
  });

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
    const posted = await call([flowId, "actions", action], token, { userId: VISITOR, input });
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

  return { call, act };
}

/**
 * Hire `seatId` the way the in-app `hire` tool does: a row owned by the
 * organization and no user, minted into a seat, and admitted through the same
 * door the tool is given, with the org-only pin it passes.
 */
function hireInApp(seatId: string): string {
  const row = toHiredSeatRow({
    seatId,
    flow: "desk-clerk",
    settings: { desk: "front" },
    instructions: null,
    owningOrgId: ORG,
  });
  const record = hiredSeatManifest(ORG, row);
  if ("problem" in record) throw new Error(record.problem);
  const [seat] = hireWorkforce([record.manifest], { kinds: kitchenSinkKinds });
  if (seat === undefined) throw new Error(`"${seatId}" did not mint`);
  kitchenSinkSeatHireOptions.register(seat, { orgId: ORG });
  return seat.id;
}

afterAll(() => {
  if (previousTokens === undefined) delete process.env.WORKFORCE_ADMIN_TOKENS;
  else process.env.WORKFORCE_ADMIN_TOKENS = previousTokens;
});

describe("a seat hired in-app, pinned to the organization only, with admin credentials configured", () => {
  it("opens a session for a visitor who sends no credential", async () => {
    const app = await boot();
    const seat = hireInApp("support.cy");
    expect(seat).toBe(seatAddress(ORG, "support.cy"));

    const opened = await app.call([seat, "sessions"], undefined, { userId: VISITOR });

    expect(opened.status).toBe(201);
  });

  it("runs an action for a visitor who sends no credential", async () => {
    const app = await boot();
    const seat = hireInApp("support.cy");

    const ran = await app.act(seat, "answer", { note: "where is my order?" }, undefined);

    expect(ran).toEqual({ http: 202, outcome: "completed" });
  });
});

describe("a seat hired over workforce-admin, beside the visitor's resolver", () => {
  /** Hire `support.bo` with acme's admin credential; the pin names the admin user. */
  async function bootWithAdminHire() {
    const app = await boot();
    const hired = await app.act(
      "workforce-admin",
      "hire",
      { seatId: "support.bo", flow: "desk-clerk", settings: { desk: "back" } },
      ACME
    );
    expect(hired).toEqual({ http: 202, outcome: "completed" });
    return { app, seat: seatAddress(ORG, "support.bo", ADMIN_USER_ID) };
  }

  it("still refuses a caller with no credential, rather than hearing them as the visitor", async () => {
    const { app, seat } = await bootWithAdminHire();

    const opened = await app.call([seat, "sessions"], undefined, { userId: VISITOR });

    expect(opened.status).toBe(401);
  });

  it("still answers the organization's admin credential", async () => {
    const { app, seat } = await bootWithAdminHire();

    const opened = await app.call([seat, "sessions"], ACME, { userId: ADMIN_USER_ID });

    expect(opened.status).toBe(201);
  });
});
