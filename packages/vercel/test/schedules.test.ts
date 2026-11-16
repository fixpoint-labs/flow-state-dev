/**
 * Tests for `createGetToPostCronShim`.
 * Stubs `globalThis.fetch` so no network is exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGetToPostCronShim } from "../src/schedules";

const SECRET = "s3cret";
const BASE = "https://app.example.com";

function authedRequest(): Request {
  return new Request("https://app.example.com/_cron", {
    headers: { Authorization: `Bearer ${SECRET}` }
  });
}

function unauthedRequest(): Request {
  return new Request("https://app.example.com/_cron", {
    headers: { Authorization: "Bearer wrong" }
  });
}

describe("createGetToPostCronShim", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401s on bad bearer", async () => {
    const handler = createGetToPostCronShim({
      flowKind: "f",
      scheduleId: "s",
      baseUrl: BASE,
      secret: SECRET
    });
    const res = await handler(unauthedRequest());
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("401s when no secret is configured", async () => {
    const handler = createGetToPostCronShim({
      flowKind: "f",
      scheduleId: "s",
      baseUrl: BASE,
      secret: ""
    });
    const res = await handler(authedRequest());
    expect(res.status).toBe(401);
  });

  it("POSTs to the dispatch endpoint with the bearer header", async () => {
    const handler = createGetToPostCronShim({
      flowKind: "send-digest",
      scheduleId: "weekly",
      baseUrl: BASE,
      secret: SECRET
    });
    const res = await handler(authedRequest());
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE}/api/flows/send-digest/schedules/weekly/dispatch`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("relays the dispatch endpoint's status code", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const handler = createGetToPostCronShim({
      flowKind: "f",
      scheduleId: "s",
      baseUrl: BASE,
      secret: SECRET
    });
    const res = await handler(authedRequest());
    expect(res.status).toBe(503);
  });
});
