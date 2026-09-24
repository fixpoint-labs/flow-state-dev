/**
 * A seat hired from inside the app opens for a visitor, even when admin
 * credentials are configured. A seat hired over `workforce-admin` still does not.
 *
 * Two hire paths reach the registrar's roster door. The admin action pins its
 * seat to the organization AND the admin user, so that seat has to resolve its
 * callers with the admin credential (`hired-seat-auth.test.ts`). The in-app
 * hire, the `hire` tool mara carries, pins its seat to the organization only.
 * A visitor opens that seat like any other, so it must keep resolving callers
 * through the app's host resolver, not demand the operator's token.
 *
 * Every case boots the app's real `fsdev.config.ts`, the way
 * `named-org.test.ts` does: the host resolver, the admin credential, the
 * registrar and the admin flow are the ones the app ships, and every request
 * goes through the router a browser reaches. Only the model is scripted
 * (`KITCHEN_SINK_TEST_MODE=1` builds it from `test/mock-flowstate`, mocked
 * below), so mara's tool call is fixed.
 *
 * Red states, produced before the green was trusted:
 *
 *   - Make `withAdminAuthentication` attach the admin resolver whatever the
 *     pin says (the behaviour this fixes). The two visitor cases go red with
 *     `401`; the admin-seat cases stay green.
 *   - Make it never attach the resolver. The two admin-seat cases go red; the
 *     visitor cases stay green.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowState } from "@flow-state-dev/engine";
import { seatAddress } from "@flow-state-dev/workforce";

import { ADMIN_USER_ID } from "@/lib/workforce-admin-auth";
import { KITCHEN_SINK_ORG_ID } from "@/lib/kitchen-sink-principal";

/** What the mocked `agent-answer` says next. Set before a boot; read when the config builds its resolver. */
const script = vi.hoisted(() => ({ steps: [] as unknown[] }));

vi.mock("@/test/mock-flowstate", async () => {
  const { createMockModelResolver, mockGenerator } = await import("@flow-state-dev/testing");
  return {
    createKitchenSinkTestModelResolver: () =>
      createMockModelResolver({
        generators: {
          "agent-answer": mockGenerator({ name: "agent-answer", script: script.steps as never }),
        },
        policy: "allow",
      }),
  };
});

const TOKEN = "tok-ks";
const IN_APP_SEAT = seatAddress(KITCHEN_SINK_ORG_ID, "support.cy");
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

/**
 * Boot the app from its real config, with an admin credential configured and
 * mara scripted to hire `support.cy` as a desk clerk.
 */
async function bootApp() {
  vi.resetModules();
  script.steps = [
    {
      toolCalls: [
        {
          toolCallId: "h1",
          toolName: "hire",
          args: { seatId: "support.cy", flow: "desk-clerk", settings: { desk: "front" } },
        },
      ],
    },
    { text: "hired" },
  ];
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

  /** Mara hires `support.cy` with her own `hire` tool: the in-app path, pinned to the org alone. */
  const hireInApp = async () => {
    const session = await call(["support.mara", "sessions"], undefined, {});
    expect(session.status).toBe(201);
    const ran = await act("support.mara", "run", { message: "hire cy" }, undefined, {
      sessionId: session.json.session.id,
    });
    expect(ran).toEqual({ http: 202, outcome: "completed" });
    // Where the seat ended up, not whether the run said ok.
    expect(runtime.registry.get(IN_APP_SEAT)?.kind).toBe("desk-clerk");
  };

  /** The operator hires `support.bo` over `workforce-admin`: pinned to the org and the admin user. */
  const hireAsAdmin = async () => {
    const hired = await act(
      "workforce-admin",
      "hire",
      { seatId: "support.bo", flow: "desk-clerk", settings: { desk: "back" } },
      TOKEN
    );
    expect(hired).toEqual({ http: 202, outcome: "completed" });
    expect(runtime.registry.get(ADMIN_SEAT)?.kind).toBe("desk-clerk");
  };

  return { call, act, hireInApp, hireAsAdmin };
}

describe("a seat mara hires, pinned to the organization only, with an admin credential configured", () => {
  it("opens a session for a visitor who sends no credential", async () => {
    const app = await bootApp();
    await app.hireInApp();

    const opened = await app.call([IN_APP_SEAT, "sessions"], undefined, {});

    expect(opened.status).toBe(201);
    expect(opened.json.session.orgId).toBe(KITCHEN_SINK_ORG_ID);
  });

  it("runs an action for a visitor who sends no credential", async () => {
    const app = await bootApp();
    await app.hireInApp();

    const ran = await app.act(IN_APP_SEAT, "answer", { note: "where is my order?" }, undefined);

    expect(ran).toEqual({ http: 202, outcome: "completed" });
  });
});

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
