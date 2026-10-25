/**
 * The one client: sending through a flow handle, typed flows, the request
 * handle's lifecycle, and the interrupted read.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { ClientHttpError, createClient, type ClientFetch, type ExecuteActionResponse } from "../src";

const EXECUTE_RESPONSE: ExecuteActionResponse = {
  status: "in_progress",
  request: { id: "req_1", flowKind: "demo", actionName: "run", status: "in_progress" },
  session: { id: "sess_1" }
};

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

/** A fetcher answering by route, recording every call. */
function routed(routes: Record<string, (init?: RequestInit) => Response>) {
  return vi.fn<ClientFetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    for (const [key, answer] of Object.entries(routes)) {
      const [m, fragment] = key.split(" ") as [string, string];
      if (m === method && url.includes(fragment)) return answer(init);
    }
    throw new Error(`unrouted ${method} ${url}`);
  });
}

const calls = (fetcher: ReturnType<typeof routed>) =>
  fetcher.mock.calls.map(([input, init]) => `${init?.method ?? "GET"} ${String(input)}`);

const demoFlow = defineFlow({
  kind: "demo",
  actions: {
    run: {
      inputSchema: z.object({ value: z.string() }),
      block: handler({
        name: "run-handler",
        inputSchema: z.object({ value: z.string() }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: (input) => ({ ok: input.value.length > 0 })
      })
    }
  }
});

describe("createClient", () => {
  it("needs a user, and a baseUrl when it has no fetcher", () => {
    expect(() => createClient({ userId: "", baseUrl: "" })).toThrow("userId is required");
    expect(() => createClient({ userId: "u1" })).toThrow("baseUrl");
    expect(() => createClient({ userId: "u1", fetcher: vi.fn() })).not.toThrow();
  });

  it("addresses the same origin when it has a fetcher and no baseUrl", async () => {
    // A credential wrapper forwards the URL to the browser's fetch, so it must
    // stay relative; `createInProcessFetch` reads only the path either way.
    const fetcher = routed({ "GET /api/flows": () => json({ flows: [] }) });
    await createClient({ userId: "u1", fetcher }).flows();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("/api/flows");
  });
});

/** A response whose headers arrived but whose body stream fails mid-read. */
function brokenBody(status: number): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("connection reset"));
    }
  });
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("a body that fails to read", () => {
  it("rejects a successful call instead of resolving it as an absent record", async () => {
    // `getCollectionItemState` answers `null` for an absent topic; a 200 whose
    // body never arrived must not read as one.
    const fetcher = routed({ "GET /resources/notes/a": () => brokenBody(200) });
    const read = createClient({ userId: "u1", fetcher }).resources.getCollectionItemState("sess_1", "notes", "a");
    await expect(read).rejects.toThrow("connection reset");
  });

  it("still reports a refusal with its status when the refusal's body is unreadable", async () => {
    const fetcher = routed({ "GET /resources/notes/a": () => brokenBody(503) });
    const refused = await createClient({ userId: "u1", fetcher })
      .resources.getCollectionItemState("sess_1", "notes", "a")
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ClientHttpError);
    expect((refused as ClientHttpError).status).toBe(503);
  });
});

describe("flow(address).send", () => {
  it("posts the action with the client's user, and returns a request handle", async () => {
    const fetcher = routed({
      "POST /actions/run": (init) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({ input: { value: "ok" }, userId: "devuser" });
        return json(EXECUTE_RESPONSE);
      }
    });
    const sent = await createClient({ userId: "devuser", baseUrl: "", fetcher }).flow("demo").send("run", { value: "ok" });

    expect(sent.id).toBe("req_1");
    expect(sent.flow).toBe("demo");
    expect(sent.response.status).toBe("in_progress");
    expect(calls(fetcher)).toEqual(["POST /api/flows/demo/actions/run"]);
  });

  it("uses the session-scoped route when a session is named", async () => {
    const fetcher = routed({ "POST /actions/run": () => json(EXECUTE_RESPONSE) });
    await createClient({ userId: "devuser", baseUrl: "", fetcher }).flow("demo").send("run", {}, { sessionId: "sess_1" });
    expect(calls(fetcher)).toEqual(["POST /api/flows/demo/sess_1/actions/run"]);
  });

  it("returns the raw SSE response with stream: true", async () => {
    const fetcher = routed({
      "POST /actions/run": (init) => {
        expect(init?.headers).toMatchObject({ accept: "text/event-stream" });
        return new Response("data: {}\n\n", { headers: { "content-type": "text/event-stream" } });
      }
    });
    const response = await createClient({ userId: "devuser", baseUrl: "", fetcher })
      .flow("demo")
      .send("run", {}, { sessionId: "sess_1", stream: true });
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });

  it("rejects a refused send with a ClientHttpError carrying the server's answer", async () => {
    const fetcher = routed({ "POST /actions/run": () => json({ error: "nope" }, 422) });
    const refused = await createClient({ userId: "devuser", baseUrl: "", fetcher })
      .flow("demo")
      .send("run", {})
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ClientHttpError);
    expect(refused).toMatchObject({ status: 422, body: { error: "nope" } });
  });

  it("checks the action name and input against a flow type, imported as a type only", async () => {
    const fetcher = routed({ "POST /actions/run": () => json(EXECUTE_RESPONSE) });
    const demo = createClient({ userId: "devuser", baseUrl: "", fetcher }).flow<typeof demoFlow>("demo");
    await demo.send("run", { value: "ok" });
    // @ts-expect-error not an action of the flow
    await demo.send("walk", { value: "ok" }).catch(() => undefined);
    // @ts-expect-error the input does not match the action's schema
    await demo.send("run", { value: 1 }).catch(() => undefined);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("addresses a collection flow's instance by its id", async () => {
    const fetcher = routed({ "POST /actions/run": () => json(EXECUTE_RESPONSE) });
    await createClient({ userId: "devuser", baseUrl: "", fetcher }).flow<typeof demoFlow>("demo-copy-2").send("run", { value: "x" });
    expect(calls(fetcher)).toEqual(["POST /api/flows/demo-copy-2/actions/run"]);
  });

  it("creates a session on the flow as the client's user", async () => {
    const fetcher = routed({
      "POST /demo/sessions": (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ userId: "devuser", title: "Hi" });
        return json({ session: { id: "sess_9" } }, 201);
      }
    });
    const session = await createClient({ userId: "devuser", baseUrl: "", fetcher }).flow("demo").createSession({ title: "Hi" });
    expect(session.id).toBe("sess_9");
  });
});

describe("request handle", () => {
  it("continues under the same id, reading the session from one status read per handle", async () => {
    const fetcher = routed({
      "GET /requests/req_1/status": () => json({ id: "req_1", status: "interrupted", sessionId: "sess_1" }),
      "POST /continue": () => json({ requestId: "req_1" })
    });
    const request = createClient({ userId: "u1", baseUrl: "", fetcher }).flow("demo").request("req_1");

    const continued = await request.continue();
    await request.continue();

    expect(continued).toBe(request);
    expect(continued.id).toBe("req_1");
    expect(calls(fetcher)).toEqual([
      "GET /api/flows/demo/requests/req_1/status",
      "POST /api/flows/demo/sessions/sess_1/requests/req_1/continue",
      "POST /api/flows/demo/sessions/sess_1/requests/req_1/continue"
    ]);
  });

  it("rejects continue and retry before any call for a request with no session", async () => {
    const fetcher = routed({});
    const sent = routed({
      "POST /actions/run": () => json({ ...EXECUTE_RESPONSE, session: undefined })
    });
    const client = createClient({ userId: "u1", baseUrl: "", fetcher: sent });
    const request = await client.flow("demo").send("run", {});

    await expect(request.continue()).rejects.toMatchObject({ name: "ClientHttpError", status: 0 });
    await expect(request.retry()).rejects.toMatchObject({ name: "ClientHttpError", status: 0 });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces a continue the server refuses (already finished) as a typed ClientHttpError", async () => {
    const fetcher = routed({
      "GET /status": () => json({ id: "req_1", status: "completed", sessionId: "sess_1" }),
      "POST /continue": () => json({ error: "Request is not interrupted" }, 409)
    });
    const refused = await createClient({ userId: "u1", baseUrl: "", fetcher })
      .flow("demo")
      .request("req_1")
      .continue()
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ClientHttpError);
    expect((refused as ClientHttpError).status).toBe(409);
  });

  it("retries as a new request, with an input override when given", async () => {
    const fetcher = routed({
      "GET /status": () => json({ id: "req_1", status: "failed", sessionId: "sess_1" }),
      "POST /retry": (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ inputOverride: { value: "again" } });
        return json({ request: { id: "req_2", flowId: "demo" }, session: { id: "sess_1" } }, 202);
      }
    });
    const failed = createClient({ userId: "u1", baseUrl: "", fetcher }).flow("demo").request("req_1");
    const retried = await failed.retry({ input: { value: "again" } });

    expect(retried.id).toBe("req_2");
    expect(calls(fetcher).at(-1)).toBe("POST /api/flows/demo/sessions/sess_1/requests/req_1/retry");
  });

  it("resumes a suspension under the same request, and refuses an unknown action before any call", async () => {
    const fetcher = routed({
      "POST /resume": (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ suspensionId: "sus_1", action: "approve" });
        return json({ requestId: "req_1" }, 202);
      }
    });
    const request = createClient({ userId: "u1", baseUrl: "", fetcher }).flow("demo").request("req_1");

    const resumed = await request.resume({ suspensionId: "sus_1", action: "approve" });
    expect(resumed).toBe(request);

    await expect(
      // @ts-expect-error not a resume action
      request.resume({ suspensionId: "sus_1", action: "maybe" })
    ).rejects.toMatchObject({ status: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("answers a user's stop on the answer route, never the resume route, and sends no resumedBy", async () => {
    const fetcher = routed({
      "POST /answer": (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ suspensionId: "sus_1", action: "submit", data: "eu-west" });
        return json({ requestId: "req_1" }, 202);
      }
    });
    const request = createClient({ userId: "u1", baseUrl: "", fetcher }).flow("demo").request("req_1");

    expect(await request.answer({ suspensionId: "sus_1", action: "submit", data: "eu-west" })).toBe(request);
    expect(calls(fetcher)).toEqual(["POST /api/flows/demo/requests/req_1/answer"]);
  });

  it("waits past the status a request was carried on from while the server still holds its run", async () => {
    // The continue route answers once the run is registered, before it gets its
    // turn: the record still says `interrupted`, with a live heartbeat beside it.
    const reads = [
      { id: "req_1", status: "interrupted", sessionId: "sess_1" },
      { id: "req_1", status: "interrupted", sessionId: "sess_1", lastHeartbeatAt: 1 },
      { id: "req_1", status: "in_progress", sessionId: "sess_1", lastHeartbeatAt: 2 },
      { id: "req_1", status: "completed", sessionId: "sess_1" }
    ];
    const fetcher = routed({
      "GET /status": () => json(reads.shift()),
      "POST /continue": () => json({ requestId: "req_1" })
    });
    const request = createClient({ userId: "u1", baseUrl: "", fetcher }).flow("demo").request("req_1");

    const continued = await request.continue();

    await expect(continued.wait({ pollMs: 1 })).resolves.toMatchObject({ status: "completed" });
  });

  it("resolves a wait on a stop once the server holds no run of it", async () => {
    const fetcher = routed({
      "GET /status": () => json({ id: "req_1", status: "suspended", sessionId: "sess_1" })
    });
    const request = createClient({ userId: "u1", baseUrl: "", fetcher }).flow("demo").request("req_1");

    await expect(request.wait({ pollMs: 1, timeoutMs: 100 })).resolves.toMatchObject({ status: "suspended" });
  });

  it("aborts, and a refusal carries the route's status", async () => {
    const fetcher = routed({ "POST /abort": () => new Response("already terminal", { status: 409 }) });
    const refused = await createClient({ userId: "u1", baseUrl: "", fetcher })
      .flow("demo")
      .request("req_1")
      .abort()
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ClientHttpError);
    expect((refused as ClientHttpError).status).toBe(409);
  });

  it("continue with stream: true returns the SSE response, with trace on request", async () => {
    const fetcher = routed({
      "GET /status": () => json({ id: "req_1", status: "interrupted", sessionId: "sess_1" }),
      "POST /continue": () => new Response("", { headers: { "content-type": "text/event-stream" } })
    });
    const response = await createClient({ userId: "u1", baseUrl: "", fetcher })
      .flow("demo")
      .request("req_1")
      .continue({ stream: true, includeTrace: true });
    expect(response).toBeInstanceOf(Response);
    expect(calls(fetcher).at(-1)).toBe("POST /api/flows/demo/sessions/sess_1/requests/req_1/continue?include=trace");
  });

  it("waits until the request leaves in_progress", async () => {
    let reads = 0;
    const fetcher = routed({
      "GET /status": () => json({ id: "req_1", status: ++reads < 3 ? "in_progress" : "completed" })
    });
    const done = await createClient({ userId: "u1", baseUrl: "", fetcher }).flow("demo").request("req_1").wait({ pollMs: 1 });
    expect(done.status).toBe("completed");
    expect(reads).toBe(3);
  });
});

describe("requests.interrupted", () => {
  it("pokes the sweep, then reads every interrupted record, the same on every call", async () => {
    const fetcher = routed({
      // The poke answers only what it changed: nothing, the second time.
      "POST /check-interrupted": () => json({ interrupted: [] }),
      "GET /interrupted-requests": () =>
        json({
          interrupted: [
            { requestId: "req_1", sessionId: "sess_1", flowKind: "support", flowId: "support-2", actionName: "reply", interruptedAt: 5 }
          ]
        })
    });
    const client = createClient({ userId: "u 1", baseUrl: "", fetcher });

    const first = await client.requests.interrupted({ staleThresholdMs: 2000 });
    const second = await client.requests.interrupted();

    expect(first.map((r) => r.id)).toEqual(["req_1"]);
    expect(second.map((r) => r.id)).toEqual(["req_1"]);
    expect(first[0]).toMatchObject({ flow: "support-2", flowKind: "support", sessionId: "sess_1", actionName: "reply" });
    expect(calls(fetcher).slice(0, 2)).toEqual([
      "POST /api/flows/users/u%201/check-interrupted?staleThresholdMs=2000",
      "GET /api/flows/users/u%201/interrupted-requests"
    ]);
  });

  it("continues a listed request at its instance address with no status read", async () => {
    const fetcher = routed({
      "POST /check-interrupted": () => json({ interrupted: [] }),
      "GET /interrupted-requests": () =>
        json({ interrupted: [{ requestId: "req_1", sessionId: "sess_1", flowKind: "support", flowId: "support-2", actionName: "reply", interruptedAt: 5 }] }),
      "POST /continue": () => json({ requestId: "req_1" })
    });
    const [lost] = await createClient({ userId: "u1", baseUrl: "", fetcher }).requests.interrupted();
    await lost!.continue();
    expect(calls(fetcher).at(-1)).toBe("POST /api/flows/support-2/sessions/sess_1/requests/req_1/continue");
    expect(calls(fetcher).some((c) => c.includes("/status"))).toBe(false);
  });

  it("falls back to the flow kind for a row with no instance id (BP-030)", async () => {
    const fetcher = routed({
      "POST /check-interrupted": () => json({ interrupted: [] }),
      "GET /interrupted-requests": () =>
        json({ interrupted: [{ requestId: "req_1", flowKind: "support", actionName: "reply", interruptedAt: 5 }] })
    });
    const [lost] = await createClient({ userId: "u1", baseUrl: "", fetcher }).requests.interrupted();
    expect(lost!.flow).toBe("support");
    await expect(lost!.continue()).rejects.toMatchObject({ status: 0 });
  });
});
