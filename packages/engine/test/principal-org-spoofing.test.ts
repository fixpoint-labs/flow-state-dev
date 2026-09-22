/**
 * The authenticated principal's `orgId` is the only org a request may run
 * under.
 *
 * The action route builds the dispatch envelope's `orgId` from the resolved
 * principal. A caller-supplied `body.orgId` must never displace it: when a flow
 * configures `authentication.resolvePrincipal` (a JWT verifier, a bearer-token
 * check), that resolver is the security boundary, and letting the POST body
 * override its answer would route an authenticated org-x user's action — and
 * every org-scoped resource, state, and session binding it touches — into
 * org-y. That is BP-031: auth decisions never come from caller-controllable
 * input.
 *
 * The org binding is enforced downstream too (`OrgBindingMismatchError` rejects
 * re-binding an *existing* session), so these tests exercise the path that
 * guard cannot see: a brand-new session, where the request's orgId becomes the
 * binding rather than being checked against one.
 *
 * A flow that configures no `authentication` at all is a second instance of
 * that same path, on a host that resolves no principal for anybody. There is
 * no resolver to displace, so the binding falls to `DEFAULT_ORG_ID` — the
 * session-creation route must still ignore `body.orgId` rather than adopting
 * it as that flow's only signal of org identity (`session-routes.ts`'s
 * `handleCreateSession`). This is what keeps an unauthenticated reference app
 * from being steered into another org's data by whatever the caller sends.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores
} from "../src";

/** Flow whose principal comes from a verified header, not the body. */
function buildAuthenticatedFlow(capture: { orgId?: string }) {
  const probe = handler({
    name: "probe",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: (_input, ctx) => {
      capture.orgId = ctx.request.identity.orgId;
      return {};
    }
  });
  return defineFlow({
    kind: "org-auth-flow",
    actions: { run: { inputSchema: z.object({}), block: probe } },
    authentication: {
      // Stands in for a real verifier: identity is derived from a trusted
      // header, never from the request body.
      resolvePrincipal: (context) => {
        const token = context.request?.headers.get("x-verified-org");
        return token === null || token === undefined
          ? null
          : { userId: "user-a", orgId: token };
      }
    }
  });
}

async function drain(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (stream === null) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

function postAction(
  router: ReturnType<typeof createFlowApiRouter>,
  body: Record<string, unknown>,
  headers: Record<string, string>
) {
  return router.POST(
    new Request("http://localhost/api/flows/org-auth-flow/actions/run", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
      body: JSON.stringify(body)
    }),
    { params: { path: ["org-auth-flow", "actions", "run"] } }
  );
}

describe("action dispatch org binding", () => {
  it("ignores body.orgId when a resolver authenticated the principal", async () => {
    const capture: { orgId?: string } = {};
    const registry = createFlowRegistry();
    registry.register(buildAuthenticatedFlow(capture));
    const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });

    // Attacker authenticates as org-x, then asks for org-y in the body.
    const res = await postAction(
      router,
      { orgId: "org-y", sessionId: "sess-spoof", input: {} },
      { "x-verified-org": "org-x" }
    );
    await drain(res.body);

    expect(capture.orgId).toBe("org-x");
  });

  it("binds a new session to the authenticated org, not the body's", async () => {
    const capture: { orgId?: string } = {};
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(buildAuthenticatedFlow(capture));
    const router = createFlowApiRouter({ registry, stores });

    const res = await postAction(
      router,
      { orgId: "org-y", sessionId: "sess-binding", input: {} },
      { "x-verified-org": "org-x" }
    );
    await drain(res.body);

    // The stored binding is what every later request is checked against, so a
    // spoofed value here would persist past the request that set it.
    const session = await stores.session.get("sess-binding");
    expect(session?.orgId).toBe("org-x");
  });
});

// ---------------------------------------------------------------------------
// Session creation on a flow with no `authentication` at all — no resolver
// to displace, but the session must still bind to `DEFAULT_ORG_ID`.
// ---------------------------------------------------------------------------

type Row = { rows?: string[]; orgId?: string };

/** Org-scoped, shared across flows — the kind of collection a roster or a
 *  channel board keeps. */
function rowCollection() {
  return defineResourceCollection({
    pattern: "row/*",
    scope: "org",
    flowIsolation: false,
    stateSchema: z.object({ label: z.string() })
  });
}

function rowActions(board: ReturnType<typeof rowCollection>, capture: Row) {
  const seed = handler({
    name: "seed",
    inputSchema: z.object({ label: z.string() }),
    outputSchema: z.object({}),
    resources: { board },
    execute: async (input: { label: string }, ctx: any) => {
      await ctx.resources.board.create(input.label, { label: input.label }, { replace: true });
      return {};
    }
  });

  const read = handler({
    name: "read",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    resources: { board },
    execute: async (_input: unknown, ctx: any) => {
      const refs = await ctx.resources.board.list();
      capture.rows = refs.map((ref: { state: { label: string } }) => ref.state.label).sort();
      capture.orgId = ctx.request.identity.orgId;
      return {};
    }
  });

  return { seed, read };
}

/** Plants victim data under a known org via a verified header. Used only to
 *  seed the row the unauthenticated flow must not be able to see. */
function ownerFlow(capture: Row) {
  const board = rowCollection();
  const { seed, read } = rowActions(board, capture);
  return defineFlow({
    kind: "row-owner",
    resources: { board },
    actions: {
      seed: { inputSchema: z.object({ label: z.string() }), block: seed },
      read: { inputSchema: z.object({}), block: read }
    },
    authentication: {
      resolvePrincipal: (context) => {
        const org = context.request?.headers.get("x-verified-org");
        return org === null || org === undefined ? null : { userId: "owner", orgId: org };
      }
    }
  });
}

/** The flow under test: no `authentication` configured, on a host that
 *  resolves no principal for anybody either. */
function unauthenticatedFlow(capture: Row) {
  const board = rowCollection();
  const { seed, read } = rowActions(board, capture);
  return defineFlow({
    kind: "row-unauth",
    resources: { board },
    actions: {
      seed: { inputSchema: z.object({ label: z.string() }), block: seed },
      read: { inputSchema: z.object({}), block: read }
    }
  });
}

function buildUnauthenticatedRouter(capture: Row) {
  const registry = createFlowRegistry();
  registry.register(ownerFlow(capture));
  registry.register(unauthenticatedFlow(capture));
  const stores = createInMemoryStores();
  // No host-level principal resolver either — nothing authenticates anybody.
  return { router: createFlowApiRouter({ registry, stores }), stores };
}

async function postFlowAction(
  router: ReturnType<typeof createFlowApiRouter>,
  path: string[],
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<void> {
  const response = await router.POST(
    new Request(`http://localhost/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
      body: JSON.stringify(body)
    }),
    { params: { path } }
  );
  await drain(response.body);
}

async function createSession(
  router: ReturnType<typeof createFlowApiRouter>,
  flowKind: string,
  body: Record<string, unknown>
): Promise<string> {
  const path = [flowKind, "sessions"];
  const response = await router.POST(
    new Request(`http://localhost/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: { path } }
  );
  const json = (await response.json()) as { session?: { id: string }; id?: string };
  const id = json.session?.id ?? json.id;
  if (id === undefined) throw new Error(`no session id in ${JSON.stringify(json)}`);
  return id;
}

describe("session creation with no principal resolver", () => {
  it("binds a new session to DEFAULT_ORG_ID, not the body's orgId", async () => {
    const capture: Row = {};
    const { router, stores } = buildUnauthenticatedRouter(capture);

    const sessionId = await createSession(router, "row-unauth", {
      userId: "u1",
      orgId: "victim-org"
    });

    const stored = await stores.session.get(sessionId);
    expect(stored?.orgId).toBe(DEFAULT_ORG_ID);
    expect(stored?.orgId).not.toBe("victim-org");
  });

  it("cannot read another org's rows, whatever the caller sends", async () => {
    const capture: Row = {};
    const { router } = buildUnauthenticatedRouter(capture);

    // Plant a row under victim-org through the authenticated flow.
    await postFlowAction(
      router,
      ["row-owner", "actions", "seed"],
      { userId: "planter", input: { label: "victim-row" } },
      { "x-verified-org": "victim-org" }
    );

    // Confirm the plant landed where we think it did.
    await postFlowAction(
      router,
      ["row-owner", "actions", "read"],
      { userId: "planter", input: {} },
      { "x-verified-org": "victim-org" }
    );
    expect(capture.rows).toEqual(["victim-row"]);

    // Now the unauthenticated flow, claiming victim-org every way a caller
    // can: the session-create body, the action body, and two headers.
    const sessionId = await createSession(router, "row-unauth", {
      userId: "u1",
      orgId: "victim-org"
    });
    await postFlowAction(
      router,
      ["row-unauth", sessionId, "actions", "seed"],
      { userId: "u1", orgId: "victim-org", input: { label: "shell-row" } },
      { "x-verified-org": "victim-org", "x-org-id": "victim-org" }
    );
    await postFlowAction(
      router,
      ["row-unauth", sessionId, "actions", "read"],
      { userId: "u1", orgId: "victim-org", input: {} },
      { "x-verified-org": "victim-org", "x-org-id": "victim-org" }
    );

    expect(capture.orgId, "the org the unauthenticated flow ran under").toBe(DEFAULT_ORG_ID);
    expect(capture.rows, "what the unauthenticated flow can see").toEqual(["shell-row"]);
    expect(capture.rows).not.toContain("victim-row");
  });
});
