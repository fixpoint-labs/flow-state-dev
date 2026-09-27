/**
 * A seat hired over `workforce-admin` does not open for a visitor, in the app
 * as it ships, with its host resolver beside the admin credential.
 *
 * The admin action pins its seat to the organization AND the admin user, so
 * that seat has to resolve its callers with the admin credential
 * (`hired-seat-auth.test.ts`). A visitor, who sends none, must be refused
 * rather than heard as the app's own user.
 *
 * Every case boots the app's real `fsdev.config.ts`, the way
 * `named-org.test.ts` does: the host resolver, the admin credential, the
 * registrar and the admin flow are the ones the app ships, and every request
 * goes through the router a browser reaches.
 *
 * Red state, produced before the green was trusted: make
 * `withAdminAuthentication` never attach the resolver. Both cases go red.
 *
 * The in-app hire this file also covered, a seat's own `hire` tool pinning to
 * the organization only, left with the tool (FIX-1611): no seat in this app
 * carries it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowState } from "@flow-state-dev/engine";
import { seatAddress } from "@flow-state-dev/workforce";

import { ADMIN_USER_ID } from "@/lib/workforce-admin-auth";
import { KITCHEN_SINK_ORG_ID } from "@/lib/kitchen-sink-principal";

const TOKEN = "tok-ks";
const ADMIN_SEAT = seatAddress(KITCHEN_SINK_ORG_ID, "support.bo", ADMIN_USER_ID);

// Each case imports the whole app afresh. The first import is cold, and beside
// `named-org.test.ts` doing the same in another worker it outruns vitest's 5s
// default.
vi.setConfig({ testTimeout: 30_000 });

type Router = Awaited<ReturnType<FlowState["getRouter"]>>;

afterEach(async () => {
  const hmr = globalThis as { __fsdFlowstate?: FlowState };
  await hmr.__fsdFlowstate?.dispose();
  delete hmr.__fsdFlowstate;
  vi.unstubAllEnvs();
});

/** Boot the app from its real config, with an admin credential configured. */
async function bootApp() {
  vi.resetModules();
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
  vi.stubEnv("STORE_TYPE", "memory");
  vi.stubEnv("WORKFORCE_ADMIN_TOKENS", `${KITCHEN_SINK_ORG_ID}:${TOKEN}`);
  delete process.env.FSDEV_DEFAULT_MODEL;

  const flowstate = (await import("@/fsdev.config")).default as FlowState;
  const runtime = await flowstate.getRuntime();
  const router = (await flowstate.getRouter()) as Router;

  /** A POST as the browser makes it: a body `userId`, which the resolver overrides. */
  const call = async (path: string[], token: string | undefined, body: Record<string, unknown>) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const response = await router.POST(
      new Request(`http://localhost/api/flows/${path.join("/")}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ userId: "someone-else", ...body }),
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  /** Post an action and wait for its request to settle. */
  const act = async (
    flowId: string,
    action: string,
    input: unknown,
    token: string | undefined,
    extra: Record<string, unknown> = {}
  ) => {
    const posted = await call([flowId, "actions", action], token, { input, ...extra });
    if (posted.status >= 400) return { http: posted.status, error: posted.json?.error as string };
    const requestId = posted.json.request?.id as string;
    for (let i = 0; i < 400; i++) {
      const record = await runtime.stores.request.get(requestId);
      if (record !== undefined && !["pending", "queued", "in_progress", "running"].includes(record.status)) {
        return { http: posted.status, outcome: record.status };
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { http: posted.status, outcome: "never settled" };
  };

  /** The operator hires `support.bo` over `workforce-admin`: pinned to the org and the admin user. */
  const hireAsAdmin = async () => {
    const hired = await act(
      "workforce-admin",
      "hire",
      { seatId: "support.bo", flow: "agent", instructions: "You take refund questions." },
      TOKEN
    );
    expect(hired).toEqual({ http: 202, outcome: "completed" });
    expect(runtime.registry.get(ADMIN_SEAT)?.kind).toBe("agent");
  };

  return { call, act, hireAsAdmin };
}

describe("a seat hired over workforce-admin, in the same app", () => {
  it("still refuses a caller with no credential, rather than hearing them as the visitor", async () => {
    const app = await bootApp();
    await app.hireAsAdmin();

    const opened = await app.call([ADMIN_SEAT, "sessions"], undefined, {});

    expect(opened.status).toBe(401);
  });

  it("still answers the organization's admin credential", async () => {
    const app = await bootApp();
    await app.hireAsAdmin();

    const opened = await app.call([ADMIN_SEAT, "sessions"], TOKEN, {});

    expect(opened.status).toBe(201);
  });
});
