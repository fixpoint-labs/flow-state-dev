/**
 * Kitchen-sink runs as one named organization — driven through the app's own
 * `fsdev.config.ts` and the router it builds, not through `runAction`.
 *
 * Every case imports the real config. So the host resolver is the one the app
 * ships, and a request goes through route-level authentication exactly as a
 * browser's does. Promoted from the spec POC
 * (`specs/issues/FIX-1500/poc/named-org/`).
 *
 * One thing is substituted, below the wiring under test: the model.
 * `KITCHEN_SINK_TEST_MODE=1` makes the config build its model resolver from
 * `test/mock-flowstate`, which this file mocks with a scripted `agent-answer`,
 * so a seat's answer is fixed.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1500/PLAN.md`), and the red
 * state each was seen in before its green was trusted:
 *
 *   V18 A session on the assistant's flow, with a worker and with the
 *       coordinator binds to `kitchen-sink`, whatever the body says
 *       (FIX-1792 BR-25). Red: remove `resolvePrincipal` from
 *       `fsdev.config.ts` — every session binds to `__fsd_default_org__`.
 *
 * V19 (a boot over a store written before the app named its organization
 * refuses, naming each stored mailbox) and the refusal of a store written
 * before mailboxes were renamed left with the mailboxes the boot opened
 * (FIX-1792 S6, D2): the boot opens no session, so it reads none an earlier
 * store holds, and nothing old is refused by name.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowState } from "@flow-state-dev/engine";

type ScriptStep =
  | { toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }> }
  | { text: string };

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

// Each case imports the whole app afresh. The first import is cold (about 4.8s
// on its own), and beside another file doing the same it outruns vitest's 5s
// default.
vi.setConfig({ testTimeout: 30_000 });

const ORG = "kitchen-sink";

type Router = Awaited<ReturnType<FlowState["getRouter"]>>;

// ---------------------------------------------------------------------------
// One boot of the app, from its real config.
// ---------------------------------------------------------------------------

afterEach(async () => {
  const hmr = globalThis as { __fsdFlowstate?: FlowState };
  await hmr.__fsdFlowstate?.dispose();
  delete hmr.__fsdFlowstate;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function bootApp(options: { steps?: ScriptStep[] } = {}) {
  vi.resetModules();
  script.steps = options.steps ?? [{ text: "ok" }];
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
  vi.stubEnv("STORE_TYPE", "memory");
  delete process.env.FSDEV_DEFAULT_MODEL;
  const log: string[] = [];
  const realError = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    log.push(args.map(String).join(" "));
    realError(...args);
  });

  const flowstate = (await import("@/fsdev.config")).default as FlowState;
  const runtime = await flowstate.getRuntime();
  const router = await flowstate.getRouter();
  return { flowstate, runtime, router, log };
}

// ---------------------------------------------------------------------------
// Requests, as the browser makes them.
// ---------------------------------------------------------------------------

async function call(
  router: Router,
  method: "GET" | "POST",
  segments: string[],
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await router[method](
    new Request(`http://localhost/api/flows/${segments.map(encodeURIComponent).join("/")}`, {
      method,
      headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: { path: segments } },
  );
  return { status: res.status, text: await res.text() };
}

const json = (text: string) => (text.length > 0 ? JSON.parse(text) : null);

/** Open a session the way the page does: a body `userId`, which a resolver overrides. */
async function openSession(router: Router, flowId: string, body: Record<string, unknown> = {}) {
  const res = await call(router, "POST", [flowId, "sessions"], { userId: "someone-else", ...body });
  const session = json(res.text)?.session as { id?: string; orgId?: string } | undefined;
  return { status: res.status, id: session?.id, orgId: session?.orgId, text: res.text };
}

async function act(router: Router, flowId: string, action: string, sessionId: string, input: unknown, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return call(router, "POST", [flowId, "actions", action], { userId: "someone-else", sessionId, input, ...extra }, headers);
}

// ---------------------------------------------------------------------------

describe("V18 · one organization, from the host resolver", () => {
  it("binds the assistant's flow, a worker's conversation and a conversation with the coordinator to kitchen-sink, whatever the body says", async () => {
    const { router } = await bootApp();

    const opens: Array<[string, Record<string, unknown>]> = [
      ["chat-agent", {}],
      ["agent", { state: { workerId: "support.devices" } }],
      ["agent", { state: { workerId: "support.general" } }],
      ["coordinator", { state: { workerId: "support.help" } }],
    ];
    for (const [flowId, body] of opens) {
      const opened = await openSession(router, flowId, { orgId: "globex", ...body });
      expect(opened.status, `${flowId}: ${opened.text}`).toBe(201);
      expect(opened.orgId, flowId).toBe(ORG);
    }
  });

  it("binds a specialist's session for the coordinator's post to kitchen-sink too", async () => {
    const { router, runtime } = await bootApp();
    const opened = await openSession(router, "coordinator", { orgId: "globex", state: { workerId: "support.help" } });
    expect(opened.status, opened.text).toBe(201);
    const posted = await act(router, "coordinator", "run", opened.id!, { message: "a post naming nobody" }, { orgId: "globex" });
    expect(posted.status, posted.text).toBe(200);
    // Best fit cannot place it, so the fallback takes it, in a session the post's conversation started.
    let delegate: { orgId?: string } | undefined;
    for (let i = 0; i < 200 && delegate === undefined; i++) {
      const sessions = await runtime.stores.session.list({ flowId: "agent", parentage: "all" });
      delegate = sessions.find((s) => s.parentSessionId === opened.id);
      if (delegate === undefined) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(delegate, "the fallback's session").toBeDefined();
    expect(delegate!.orgId).toBe(ORG);
  });

});
