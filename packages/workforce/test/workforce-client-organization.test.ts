/**
 * `WorkforceClient.organization()`: the organization the server acts in for
 * the signed-in user, the one a worker's conversation is derived under. An
 * app's connection gate reads it: a refusal (401 or 403) is the refused page,
 * anything else the unreachable one.
 *
 * Real engine, real HTTP router, the caller a verified user.
 */
import { describe, expect, it } from "vitest";
import { ClientHttpError, createClient } from "@flow-state-dev/client";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { createWorkforceClient } from "../src/workers/client";
import { bootHost, ORG } from "./worker-model-harness";

describe("organization()", () => {
  it("answers the organization the server verified, not one the caller could name", async () => {
    const h = bootHost(createInMemoryStores());
    expect(await h.client("alice").organization()).toBe(ORG);
    expect(await h.client("alice", "beta").organization()).toBe("beta");
  });

  it("reads it once per client, however many screens ask", async () => {
    const h = bootHost(createInMemoryStores());
    const asked: string[] = [];
    const fetcher = h.fetcherFor("alice");
    const client = createWorkforceClient(
      createClient({
        userId: "alice",
        fetcher: (input, init) => {
          const url = String(input instanceof Request ? input.url : input);
          if (new URL(url, "http://localhost").pathname.endsWith("/identity")) asked.push(url);
          return fetcher(input, init);
        }
      })
    );
    const [first, second] = await Promise.all([client.organization(), client.organization()]);
    expect([first, second, await client.organization()]).toEqual([ORG, ORG, ORG]);
    expect(asked).toHaveLength(1);
  });

  it("rejects with the server's status for a caller it can't verify, and asks again next time", async () => {
    const h = bootHost(createInMemoryStores());
    let signedIn = false;
    const fetcher = h.fetcherFor("alice");
    const unverified = h.router as unknown as { GET: (request: Request, context: { params: { path: string[] } }) => Promise<Response> };
    const client = createWorkforceClient(
      createClient({
        userId: "alice",
        fetcher: async (input, init) => {
          if (signedIn) return fetcher(input, init);
          // No `x-user`: the host's resolver verifies nobody.
          const request = new Request(new URL(String(input instanceof Request ? input.url : input), "http://localhost"), init);
          const path = new URL(request.url).pathname.replace(/^\/api\/flows\//, "").split("/");
          return unverified.GET(request, { params: { path } });
        }
      })
    );
    const refused = await client.organization().catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ClientHttpError);
    expect((refused as ClientHttpError).status).toBe(401);
    signedIn = true;
    expect(await client.organization()).toBe(ORG);
  });
});
