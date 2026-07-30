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
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
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

  it("still carries the principal's orgId when the body omits one", async () => {
    const capture: { orgId?: string } = {};
    const registry = createFlowRegistry();
    registry.register(buildAuthenticatedFlow(capture));
    const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });

    const res = await postAction(
      router,
      { sessionId: "sess-plain", input: {} },
      { "x-verified-org": "org-x" }
    );
    await drain(res.body);

    expect(capture.orgId).toBe("org-x");
  });
});
