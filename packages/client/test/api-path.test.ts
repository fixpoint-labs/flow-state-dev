/**
 * `apiPath` — where the flow API is mounted. Every client builds its routes
 * from the mount; a server that mounts the API somewhere other than
 * `/api/flows` (the Node host's `basePath`) is reachable only when the client
 * is told the same mount. Left unset, every URL must stay exactly what it was.
 */
import { describe, expect, it, vi } from "vitest";
import { createClient, type ClientFetch } from "../src";

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

/** One request through every namespace of one client, returning the URLs requested. */
async function requestedUrls(transport: { baseUrl?: string; apiPath?: string }): Promise<string[]> {
  const urls: string[] = [];
  const fetcher = vi.fn<ClientFetch>(async (input) => {
    urls.push(String(input));
    if (String(input).endsWith("/stream")) return new Response(null, { status: 404 });
    return new Response(
      JSON.stringify({ flows: [], interrupted: [], status: "in_progress", request: { id: "r0" } }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });

  const client = createClient({ userId: "u1", ...transport, fetcher });
  await client.flows();
  await client.flow("chat").send("send", {});
  await client.flow("chat").send("send", {}, { sessionId: "s1" });

  await client.sessions.state("s1");
  await client.requests.interrupted();
  await client.resources.getResourceManifest("s1");
  await client.transcribe({ audio: new Uint8Array([1]) });

  client.flow("chat").request("r1").stream({}).close();
  const session = client.sessions.stream("s1");
  await vi.waitFor(() => expect(urls.filter((url) => url.includes("/stream"))).toHaveLength(2));
  session.close();

  return urls;
}

describe("apiPath", () => {
  it("leaves every URL byte-identical when unset", async () => {
    expect(await requestedUrls({ baseUrl: ORIGIN })).toEqual([
      `${ORIGIN}/api/flows`,
      `${ORIGIN}/api/flows/chat/actions/send`,
      `${ORIGIN}/api/flows/chat/s1/actions/send`,
      `${ORIGIN}/api/flows/sessions/s1/state`,
      `${ORIGIN}/api/flows/users/u1/check-interrupted`,
      `${ORIGIN}/api/flows/users/u1/interrupted-requests`,
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
      `${ORIGIN}/flows/users/u1/interrupted-requests`,
      `${ORIGIN}/flows/sessions/s1/manifest`,
      `${ORIGIN}/flows/transcribe?userId=u1`,
      `${ORIGIN}/flows/chat/requests/r1/stream`,
      `${ORIGIN}/flows/sessions/s1/stream`
    ]);
  });

  it("works with a same-origin baseUrl and ignores a trailing slash", async () => {
    const fetcher = jsonFetcher({ status: "in_progress", request: { id: "r0" } });
    const client = createClient({ userId: "u1", baseUrl: "", apiPath: "/v2/flows/", fetcher });
    await client.flow("chat").send("send", {});
    expect(fetcher.mock.calls[0]?.[0]).toBe("/v2/flows/chat/actions/send");
  });
});
