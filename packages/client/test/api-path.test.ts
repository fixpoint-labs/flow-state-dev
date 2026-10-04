/**
 * `apiPath` — where the flow API is mounted. Every client builds its routes
 * from the mount; a server that mounts the API somewhere other than
 * `/api/flows` (the Node host's `basePath`) is reachable only when the client
 * is told the same mount. Left unset, every URL must stay exactly what it was.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createClient,
  createRecoveryClient,
  createResourceClient,
  createSessionClient,
  createSessionSSEClient,
  createSSEClient,
  transcribe,
  type ClientFetch
} from "../src";

const ORIGIN = "http://api.test";

function jsonFetcher(body: unknown = {}): ReturnType<typeof vi.fn<ClientFetch>> {
  return vi.fn<ClientFetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  );
}

/** One request through every client constructor, returning the URLs requested. */
async function requestedUrls(transport: { baseUrl?: string; apiPath?: string }): Promise<string[]> {
  const fetcher = jsonFetcher({ flows: [], interrupted: [] });
  const sseFetcher = vi.fn<ClientFetch>(async () => new Response(null, { status: 404 }));

  const client = createClient({ flowKind: "chat", userId: "u1", ...transport, fetcher });
  await client.listFlows();
  await client.sendAction("send", {});
  await client.sendAction("send", {}, { sessionId: "s1" });

  await createSessionClient({ ...transport, fetcher }).getSessionState("s1");
  await createRecoveryClient({ ...transport, fetcher }).checkInterrupted({ userId: "u1" });
  await createResourceClient({ ...transport, fetcher }).getResourceManifest("s1");
  await transcribe({ audio: new Uint8Array([1]), userId: "u1" }, { ...transport, fetcher });

  createSSEClient({ url: "/api/flows/chat/requests/r1/stream", ...transport, fetcher: sseFetcher }).close();
  const session = createSessionSSEClient({ sessionId: "s1", ...transport, fetcher: sseFetcher });
  await vi.waitFor(() => expect(sseFetcher).toHaveBeenCalledTimes(2));
  session.close();

  return [...fetcher.mock.calls, ...sseFetcher.mock.calls].map((call) => String(call[0]));
}

describe("apiPath", () => {
  it("leaves every URL byte-identical when unset", async () => {
    expect(await requestedUrls({ baseUrl: ORIGIN })).toEqual([
      `${ORIGIN}/api/flows`,
      `${ORIGIN}/api/flows/chat/actions/send`,
      `${ORIGIN}/api/flows/chat/s1/actions/send`,
      `${ORIGIN}/api/flows/sessions/s1/state`,
      `${ORIGIN}/api/flows/users/u1/check-interrupted`,
      `${ORIGIN}/api/flows/sessions/s1/manifest`,
      `${ORIGIN}/api/flows/transcribe?userId=u1`,
      `${ORIGIN}/api/flows/chat/requests/r1/stream`,
      `${ORIGIN}/api/flows/sessions/s1/stream`
    ]);
  });

  it("sends every route to the mount it names, after baseUrl", async () => {
    expect(await requestedUrls({ baseUrl: ORIGIN, apiPath: "/flows" })).toEqual([
      `${ORIGIN}/flows`,
      `${ORIGIN}/flows/chat/actions/send`,
      `${ORIGIN}/flows/chat/s1/actions/send`,
      `${ORIGIN}/flows/sessions/s1/state`,
      `${ORIGIN}/flows/users/u1/check-interrupted`,
      `${ORIGIN}/flows/sessions/s1/manifest`,
      `${ORIGIN}/flows/transcribe?userId=u1`,
      `${ORIGIN}/flows/chat/requests/r1/stream`,
      `${ORIGIN}/flows/sessions/s1/stream`
    ]);
  });

  it("works without baseUrl and ignores a trailing slash", async () => {
    const fetcher = jsonFetcher({ flows: [] });
    const client = createClient({ flowKind: "chat", userId: "u1", apiPath: "/v2/flows/", fetcher });
    await client.sendAction("send", {});
    expect(fetcher.mock.calls[0]?.[0]).toBe("/v2/flows/chat/actions/send");
  });
});
