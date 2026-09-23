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
 * FIX-1442 supersedes the interim `orgId` parameter these tests were written
 * for. `openChannels` no longer takes one, and an app cannot choose the
 * organization its channels open under: the server binds it from the verified
 * principal, or — as here, with no resolver configured — from `DEFAULT_ORG_ID`.
 * So what is pinned now is that a channel is never opened WITHOUT one, on every
 * path including the repair, because "no org identity" is the state that made
 * a woken seat fail to read its own documents.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { CHANNEL_KIND, channelFlow, openChannels, type ChannelManifest } from "../src/index";

const OWNER = "u_owner";

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
  it("opens the channel's session bound to an organization the app never named", async () => {
    const { client, sessionOf } = hostedClient();

    await openChannels([record("engineering.standup")], { client, userId: OWNER });

    // The whole point: not "the binder passed a field" but "the session the
    // seat is later woken in carries an org", which is what an org-scoped
    // resource lookup is matched against. This app configures no resolver, so
    // that org is the framework default — supplied by the server, not chosen
    // by the caller.
    expect(await sessionOf("engineering.standup")).toMatchObject({
      flowKind: CHANNEL_KIND,
      userId: OWNER,
      orgId: DEFAULT_ORG_ID
    });
  });

  it("never opens a channel with no organization at all", async () => {
    // The state this whole seam exists to prevent, and the one an app used to
    // land in by simply not passing an `orgId`: a channel whose woken seat
    // cannot read its own org-scoped documents. It is now unreachable rather
    // than merely discouraged — there is no input that produces it.
    const { client, sessionOf } = hostedClient();

    await openChannels([record("engineering.standup")], { client, userId: OWNER });

    const session = await sessionOf("engineering.standup");
    expect(session.orgId).toBeDefined();
    expect(session.orgId).not.toBe("");
  });

  it("opens a re-adopted channel under an organization too, so a repair does not drop it", async () => {
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

    await openChannels([record("engineering.standup")], { client, userId: OWNER });

    expect(await sessionOf("engineering.standup")).toMatchObject({ orgId: DEFAULT_ORG_ID });
  });
});
