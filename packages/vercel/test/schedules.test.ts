/**
 * Tests for `createGetToPostCronShim` and `createScheduleTickHandler`.
 * Stubs `globalThis.fetch` so no network is exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleIndex, ScheduleIndexRow } from "@flow-state-dev/scheduled";
import {
  createGetToPostCronShim,
  createScheduleTickHandler
} from "../src/schedules";

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

describe("createScheduleTickHandler", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fakeIndex(due: ScheduleIndexRow[], opts: { failClaim?: boolean } = {}): ScheduleIndex {
    return {
      async upsert() {},
      async remove() {},
      async claimDue() {
        if (opts.failClaim) throw new Error("boom");
        return due;
      }
    };
  }

  const ROW: ScheduleIndexRow = {
    userId: "u1",
    key: "weekly",
    cron: "0 0 * * 0",
    nextFireAt: 1
  };

  it("401s on bad bearer", async () => {
    const handler = createScheduleTickHandler({
      flowKind: "f",
      index: fakeIndex([ROW]),
      baseUrl: BASE,
      secret: SECRET
    });
    const res = await handler(unauthedRequest());
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 204 with no due rows", async () => {
    const handler = createScheduleTickHandler({
      flowKind: "f",
      index: fakeIndex([]),
      baseUrl: BASE,
      secret: SECRET
    });
    const res = await handler(authedRequest());
    expect(res.status).toBe(204);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dispatches each due row with the correct URL + bearer", async () => {
    const handler = createScheduleTickHandler({
      flowKind: "f",
      index: fakeIndex([ROW, { ...ROW, userId: "u2", key: "daily" }]),
      baseUrl: BASE,
      secret: SECRET
    });
    const res = await handler(authedRequest());
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const urls = fetchSpy.mock.calls.map((c) => c[0]).sort();
    expect(urls).toEqual([
      `${BASE}/api/flows/f/schedules/u1/weekly/dispatch`,
      `${BASE}/api/flows/f/schedules/u2/daily/dispatch`
    ]);
    for (const call of fetchSpy.mock.calls) {
      expect(call[1].headers.Authorization).toBe(`Bearer ${SECRET}`);
    }
  });

  it("returns 500 when claimDue throws", async () => {
    const handler = createScheduleTickHandler({
      flowKind: "f",
      index: fakeIndex([], { failClaim: true }),
      baseUrl: BASE,
      secret: SECRET
    });
    // Silence the expected error log from the handler.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handler(authedRequest());
    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("invokes onDispatch with non-2xx status; does not throw", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 500 }));
    const onDispatch = vi.fn();
    const handler = createScheduleTickHandler({
      flowKind: "f",
      index: fakeIndex([ROW]),
      baseUrl: BASE,
      secret: SECRET,
      onDispatch
    });
    const res = await handler(authedRequest());
    expect(res.status).toBe(200);
    expect(onDispatch).toHaveBeenCalledWith(ROW, 500);
  });

  it("invokes onDispatch with status 0 when the POST itself throws", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    const onDispatch = vi.fn();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = createScheduleTickHandler({
      flowKind: "f",
      index: fakeIndex([ROW]),
      baseUrl: BASE,
      secret: SECRET,
      onDispatch
    });
    const res = await handler(authedRequest());
    expect(res.status).toBe(200);
    expect(onDispatch).toHaveBeenCalledWith(ROW, 0);
    err.mockRestore();
  });
});
