/**
 * The org a channel session is opened under, driven through the real session
 * route rather than a mock.
 *
 * `channel-binder.test.ts` asserts what the binder HANDS its client. That is
 * not the claim that matters here: an `orgId` the binder passes is only worth
 * anything if the session it opens comes out bound to that org, because that
 * binding is what every org-scoped lookup is matched against — file-declared
 * documents install at `scope: "org"` (`resourcesFromDocs`), and a delivery
 * whose request org does not match the session's is refused rather than moved
 * across the boundary (`create-request-host`). So these drive the actual route
 * and read the session back.
 *
 * The no-org case is pinned alongside it on purpose. It is the state an app
 * that passes no org still gets, and the one this change must leave exactly as
 * it was: a channel with no org identity, which is correct for an app that has
 * no orgs.
 *
 * These drive the DEFAULT resolver, which reads the request body. An app that
 * authenticates its callers binds the session to the verified principal's org
 * instead, and a caller-supplied one is ignored there (BP-031) — engine's own
 * `management-route-auth.test.ts` pins that, and repeating it here would be
 * asserting engine's rule through this package.
 */
import { describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { CHANNEL_KIND, channelFlow, openChannels, type ChannelManifest } from "../src/index";

const OWNER = "u_owner";
const ORG = "org_acme";

/** The session API `openChannels` declares, wired to the real HTTP routes. */
function hostedClient() {
  const state = createFlowState({
    flows: { [CHANNEL_KIND]: channelFlow() },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({})
  });

  const call = async (
    method: "GET" | "POST" | "DELETE",
    segments: string[],
    body?: unknown
  ): Promise<{ status: number; json: any }> => {
    const router = await state.getRouter();
    const request = new Request(`http://test/api/flows/${segments.join("/")}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const response = await (router as any)[method](request, { params: { path: segments } });
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  const raise = (label: string, status: number, json: unknown): never => {
    throw Object.assign(new Error(`${label} ${status}: ${JSON.stringify(json)}`), { status });
  };

  const client = {
    createSession: async (options: {
      flowKind: string;
      userId: string;
      sessionId?: string;
      orgId?: string;
      description?: string;
      state?: Record<string, unknown>;
    }): Promise<unknown> => {
      const { flowKind, ...rest } = options;
      const { status, json } = await call("POST", [flowKind, "sessions"], rest);
      if (status >= 400) raise("createSession", status, json);
      return json;
    },
    getSession: async (sessionId: string) => {
      const { status, json } = await call("GET", ["sessions", sessionId]);
      if (status >= 400) raise("getSession", status, json);
      const session = json.session ?? {};
      return {
        flowKind: session.flowKind,
        flowId: session.flowId,
        userId: session.userId,
        // Carried because a real `SessionDetail` carries it, and the binder
        // reads it to refuse a channel already open outside the org asked for.
        orgId: session.orgId,
        state: session.state
      };
    },
    deleteSession: async (sessionId: string): Promise<void> => {
      const { status, json } = await call("DELETE", ["sessions", sessionId]);
      if (status >= 400) raise("deleteSession", status, json);
    }
  };

  /** The stored session, as the route hands it back — `orgId` included. */
  const sessionOf = async (sessionId: string): Promise<Record<string, unknown>> => {
    const { status, json } = await call("GET", ["sessions", sessionId]);
    if (status >= 400) raise("getSession", status, json);
    return json.session as Record<string, unknown>;
  };

  return { client, sessionOf };
}

function record(id: string): ChannelManifest {
  return { id, declared: { members: ["engineering.lead"] }, body: "Say what you finished." };
}

describe("openChannels org identity", () => {
  it("opens the channel's session bound to the org its documents are scoped to", async () => {
    const { client, sessionOf } = hostedClient();

    await openChannels([record("engineering.standup")], { client, userId: OWNER, orgId: ORG });

    // The whole point: not "the binder passed a field" but "the session the
    // seat is later woken in carries the org", which is what an org-scoped
    // resource lookup is matched against.
    expect(await sessionOf("engineering.standup")).toMatchObject({
      flowKind: CHANNEL_KIND,
      userId: OWNER,
      orgId: ORG
    });
  });

  it("leaves a channel unbound to any org when the app passes none", async () => {
    const { client, sessionOf } = hostedClient();

    await openChannels([record("engineering.standup")], { client, userId: OWNER });

    expect((await sessionOf("engineering.standup")).orgId).toBeUndefined();
  });

  it("opens a re-adopted channel under the org too, so a repair does not drop it", async () => {
    const { client, sessionOf } = hostedClient();

    // What a post or read on the id before the binder ran leaves behind: this
    // kind's own session for this principal, carrying no channel state. The
    // binder releases it and re-creates — and that second create has to carry
    // the org as well, or a raced channel is the one that silently has none.
    await client.createSession({
      flowKind: CHANNEL_KIND,
      userId: OWNER,
      sessionId: "engineering.standup"
    });

    await openChannels([record("engineering.standup")], { client, userId: OWNER, orgId: ORG });

    expect(await sessionOf("engineering.standup")).toMatchObject({ orgId: ORG });
  });
});
