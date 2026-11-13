// FIX-427.
/**
 * Tests for the collection-resource client methods: listCollectionResources,
 * getCollectionResourceState, getResourceManifest. URL construction, response
 * shape, and error pass-through.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createClient,
  type ClientFetch,
  type CollectionListPage,
  type CollectionResourceState,
  type ResourceManifest
} from "../src";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("listCollectionResources", () => {
  it("builds the URL with limit/cursor/topicPrefix and parses the response", async () => {
    const page: CollectionListPage = {
      items: [{ topic: "artifacts/a.md", clientData: { title: "A" } }],
      nextCursor: "artifacts/a.md"
    };
    const fetcher = vi.fn<ClientFetch>(async () => jsonResponse(page));
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher }).resources;

    const result = await client.listCollectionResources("sess_1", "artifacts", {
      limit: 50,
      cursor: "artifacts/prev",
      topicPrefix: "artifacts/a"
    });
    expect(result).toEqual(page);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/resources/artifacts?limit=50&cursor=artifacts%2Fprev&topicPrefix=artifacts%2Fa"
    );
  });

  it("omits query string when no options are passed", async () => {
    const page: CollectionListPage = {
      items: []
    };
    const fetcher = vi.fn<ClientFetch>(async () => jsonResponse(page));
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher }).resources;

    await client.listCollectionResources("sess_1", "artifacts");
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/resources/artifacts"
    );
  });

  it("propagates HTTP errors", async () => {
    const fetcher = vi.fn<ClientFetch>(async () =>
      jsonResponse({ error: "forbidden" }, 403)
    );
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher }).resources;
    await expect(client.listCollectionResources("sess_1", "artifacts")).rejects.toThrow();
  });
});

describe("getCollectionResourceState", () => {
  it("returns the item when present", async () => {
    const item: CollectionResourceState = {
      topic: "artifacts/a.md",
      clientData: { title: "A" }
    };
    const fetcher = vi.fn<ClientFetch>(async () => jsonResponse(item));
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher }).resources;
    const result = await client.getCollectionResourceState("sess_1", "artifacts", "a.md");
    expect(result).toEqual(item);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/resources/artifacts/a.md"
    );
  });

  it("returns null when the topic is absent (server returns 200 + null body)", async () => {
    const fetcher = vi.fn<ClientFetch>(async () => jsonResponse(null));
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher }).resources;
    const result = await client.getCollectionResourceState("sess_1", "artifacts", "missing");
    expect(result).toBeNull();
  });
});

describe("getResourceManifest", () => {
  it("fetches and returns the manifest", async () => {
    const manifest: ResourceManifest = {
      flowKind: "demo",
      resources: [
        {
          ref: "artifacts",
          kind: "collection",
          scope: "session",
          pattern: "artifacts/*",
          prefetchWindow: 0,
          hasClientData: true,
          client: { content: { read: true }, state: { read: true } }
        }
      ]
    };
    const fetcher = vi.fn<ClientFetch>(async () => jsonResponse(manifest));
    const client = createClient({ userId: "devuser", baseUrl: "", fetcher }).resources;
    const result = await client.getResourceManifest("sess_1");
    expect(result).toEqual(manifest);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/flows/sessions/sess_1/manifest"
    );
  });
});
