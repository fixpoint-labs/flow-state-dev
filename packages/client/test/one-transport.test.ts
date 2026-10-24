/**
 * One client is one transport, structurally.
 *
 * One `createClient` with an instrumented fetcher drives every namespace:
 * sessions, resources, `flow().send`, `request().continue`, the requests
 * list, transcription and all three streams. Every call must land on that one
 * fetcher, exactly one transport may be built, and nothing may reach the
 * global `fetch`. A client that built a second transport (or a wrapper) for
 * one namespace fails on the transport count; one that called the network
 * directly fails on the global fetch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientFetch } from "../src";

const built = vi.hoisted(() => ({ transports: 0 }));

vi.mock("../src/internal/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/internal/http")>();
  return {
    ...actual,
    createTransport: (...args: Parameters<typeof actual.createTransport>) => {
      built.transports += 1;
      return actual.createTransport(...args);
    }
  };
});

const { createClient } = await import("../src");

afterEach(() => {
  vi.restoreAllMocks();
});

function answer(url: string): Response {
  if (url.includes("/stream")) {
    return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  const body = url.includes("/actions/")
    ? { status: "in_progress", request: { id: "req_1" }, session: { id: "sess_1" } }
    : url.includes("/interrupted-requests")
      ? { interrupted: [{ requestId: "req_1", sessionId: "sess_1", flowKind: "f", flowId: "f", actionName: "a", interruptedAt: 1 }] }
      : url.includes("/requests/") && url.endsWith("/status")
        ? { id: "req_1", status: "completed", sessionId: "sess_1" }
        : { flows: [], sessions: [], session: { id: "sess_1" }, requests: [], children: [], interrupted: [], items: [], text: "" };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("one client is one transport", () => {
  it("routes every namespace through the one fetcher it was given", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const seen: string[] = [];
    const fetcher: ClientFetch = async (input) => {
      seen.push(String(input));
      return answer(String(input));
    };
    built.transports = 0;

    const fsd = createClient({ userId: "u1", fetcher });
    await fsd.flows();
    await fsd.capabilities();
    await fsd.sessions.list();
    await fsd.sessions.get("sess_1");
    await fsd.sessions.requests("sess_1");
    await fsd.sessions.state("sess_1");
    await fsd.resources.listCollectionItems("sess_1", "notes");
    await fsd.resources.getResourceManifest("sess_1");
    await fsd.transcribe({ audio: new Uint8Array([1]) });
    const flow = fsd.flow("f");
    await flow.createSession();
    const sent = await flow.send("a", {}, { sessionId: "sess_1" });
    await sent.status();
    await flow.request("req_1").continue();
    const [lost] = await fsd.requests.interrupted();
    await lost!.continue();

    const requestStream = sent.stream({});
    const sessionStream = fsd.sessions.stream("sess_1");
    const userStream = fsd.stream({});
    await vi.waitFor(() => expect(seen.filter((url) => url.includes("/stream"))).toHaveLength(3));
    requestStream.close();
    sessionStream.close();
    userStream.close();

    expect(built.transports).toBe(1);
    expect(globalFetch).not.toHaveBeenCalled();
    // Every route the namespaces address arrived at this one fetcher.
    for (const route of [
      "/api/flows",
      "/api/flows/capabilities",
      "/api/flows/sessions",
      "/api/flows/sessions/sess_1/requests",
      "/api/flows/sessions/sess_1/resources/notes",
      "/api/flows/transcribe",
      "/api/flows/f/sessions",
      "/api/flows/f/sess_1/actions/a",
      "/api/flows/f/requests/req_1/status",
      "/api/flows/f/sessions/sess_1/requests/req_1/continue",
      "/api/flows/users/u1/check-interrupted",
      "/api/flows/users/u1/interrupted-requests",
      "/api/flows/f/requests/req_1/stream",
      "/api/flows/sessions/sess_1/stream",
      "/api/flows/users/u1/stream"
    ]) {
      expect(seen.some((url) => url.split("?")[0] === route), route).toBe(true);
    }
  });
});
