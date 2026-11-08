/**
 * The Workforce client reads an action's answer by its request id (FIX-2455):
 * a roster change resolves to what the roster action returned without listing
 * the roster session's requests, so a long session can't push the answer off
 * the page and read as "could not be read". A failed action rejects with its
 * own words.
 *
 * Real engine and HTTP router; nothing mocked.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "../src/workers/client";
import { bootHost, FIXTURE } from "./worker-model-harness";

/** A Workforce client for `userId` that records every URL it fetched. */
function recorded(userId: string) {
  const h = bootHost(createInMemoryStores());
  const urls: string[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(`${init?.method ?? "GET"} ${String(input)}`);
    return h.fetcherFor(userId)(input, init);
  };
  return { urls, client: createWorkforceClient(createClient({ userId, fetcher })) };
}

const listsRequests = (url: string) => /\/sessions\/[^/?]+\/requests(\?|$)/.test(url);

describe("a Workforce roster change reads its answer by request id", () => {
  it("resolves to what the roster action returned, without listing the session's requests", async () => {
    const { urls, client } = recorded("alice");

    await expect(client.hire({ id: "scribe", flow: FIXTURE })).resolves.toMatchObject({ id: "scribe", flow: FIXTURE });

    expect(urls.filter(listsRequests)).toEqual([]);
    expect(urls.some((url) => url.includes("/status?include_result_output=true"))).toBe(true);
  });

  it("rejects a refused action with its own words, read the same way", async () => {
    const { urls, client } = recorded("alice");

    await expect(client.fire("nobody-by-this-name")).rejects.toThrow(/nobody-by-this-name/);
    expect(urls.filter(listsRequests)).toEqual([]);
  });
});
