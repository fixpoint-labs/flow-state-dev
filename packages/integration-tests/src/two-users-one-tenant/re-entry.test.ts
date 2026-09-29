/**
 * Only the owner re-enters a request, and only one that arrived on a
 * caller-facing transport.
 *
 * Four routes act on an existing request by id: retry runs it again (with an
 * `inputOverride` the caller chooses), continue picks an interrupted one back
 * up, resume answers its suspension, and abort stops it. A request id is not
 * a secret: it comes back in the `x-request-id` header and the 202 body. So
 * another user in the same tenant can learn one. Every one of these routes
 * must answer them exactly as it answers an id nobody has used, and leave the
 * request as it was. A different answer would tell them the id is in use.
 *
 * Separately, a request that arrived on a transport the public routes do not
 * re-enter (here an out-of-tree SMS transport the deployment never opted in)
 * is not re-entered from HTTP, even by its owner. Re-running it from HTTP
 * would hand the caller's input to a handler that transport fronts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { InboundTransportAdapter } from "@flow-state-dev/engine";
import { z } from "zod";
import { startTwoUserServer, waitFor, type TwoUserServer } from "./harness";

const noteSchema = z.object({ text: z.string() });

/** Releases every `hold` run waiting on it. Replaced per test. */
let release: () => void = () => {};
let held: Promise<void> = Promise.resolve();

const jobs = defineFlow({
  kind: "jobs",
  actions: {
    // Fails, so it can be retried.
    fail: {
      inputSchema: noteSchema,
      userMessage: (input: { text: string }) => input.text,
      block: handler({
        name: "jobs-fail",
        inputSchema: noteSchema,
        outputSchema: z.object({ saved: z.string() }),
        execute: () => {
          throw new Error("the job failed");
        }
      })
    },
    // Stays in progress until the test releases it, so it can be aborted.
    hold: {
      inputSchema: noteSchema,
      userMessage: (input: { text: string }) => input.text,
      block: handler({
        name: "jobs-hold",
        inputSchema: noteSchema,
        outputSchema: z.object({ saved: z.string() }),
        execute: async (input) => {
          await held;
          return { saved: input.text };
        }
      })
    }
  }
});

/** The source the SMS transport stamps; the deployment does not open it to re-entry. */
const SMS_SOURCE = "sms";

/**
 * A minimal out-of-tree transport: `POST /api/flows/_sms/:flowKind/:action`
 * dispatches under the caller the app's resolver names, and answers with the
 * request id once the run settles.
 */
const smsTransport: InboundTransportAdapter = {
  source: SMS_SOURCE,
  createBindings(host) {
    return {
      routes: [
        {
          method: "POST",
          path: "/api/flows/_sms/:flowKind/:action",
          handler: async (request, { params }) => {
            const body = (await request.json()) as { input: unknown; sessionId: string };
            const flowKind = params.flowKind!;
            const action = params.action!;
            const principal = await host.resolvePrincipal({
              source: SMS_SOURCE,
              request,
              envelope: { flowKind, action, sessionId: body.sessionId, input: body.input, metadata: {} }
            });
            const handle = host.dispatch({
              source: SMS_SOURCE,
              flowKind,
              action,
              input: body.input,
              sessionId: body.sessionId,
              tenantId: request.headers.get("x-tenant-id") ?? undefined,
              principal
            });
            await handle.finished;
            return Response.json({ requestId: handle.requestId });
          }
        }
      ]
    };
  }
};

/** An id no one has used, for what "not found" looks like on each route. */
const UNUSED_REQUEST = "req_unused_7f3a";
const ALICE_SESSION = "s_alice";
const ALICE_TEXT = "alice's job";
const BOB_INPUT = "bob's chosen input";

let server: TwoUserServer;

beforeEach(async () => {
  held = new Promise<void>((resolve) => {
    release = resolve;
  });
  server = await startTwoUserServer([jobs()], { adapters: [smsTransport] });
});

afterEach(async () => {
  release();
  await server.close();
});

type Caller = ReturnType<TwoUserServer["as"]>;

/** Start `action` as `caller` in `sessionId`; returns the request id from the 202. */
async function start(caller: Caller, action: string, sessionId: string): Promise<string> {
  const response = await caller(`/jobs/${sessionId}/actions/${action}`, {
    method: "POST",
    body: JSON.stringify({ input: { text: ALICE_TEXT } })
  });
  expect(response.status).toBe(202);
  return ((await response.json()) as { request: { id: string } }).request.id;
}

/** The status of `requestId` as `caller` sees it, once it is `wanted`. */
async function statusOf(caller: Caller, requestId: string, wanted: string): Promise<string> {
  return waitFor(async () => {
    const response = await caller(`/jobs/requests/${requestId}/status`);
    if (response.status !== 200) return undefined;
    const { status } = (await response.json()) as { status: string };
    return status === wanted ? status : undefined;
  }, `request ${requestId} to be ${wanted}`);
}

/** The ids of the requests in `sessionId`, as its owner lists them. */
async function requestsIn(caller: Caller, sessionId: string): Promise<string[]> {
  const response = await caller(`/sessions/${sessionId}/requests`);
  expect(response.status).toBe(200);
  const { requests } = (await response.json()) as { requests: Array<{ id: string }> };
  return requests.map((r) => r.id).sort();
}

/** The four request-control routes, as a caller reaches each for `requestId`. */
const ROUTES: Array<[string, (caller: Caller, requestId: string) => Promise<Response>]> = [
  [
    "retry",
    (caller, requestId) =>
      caller(`/jobs/sessions/${ALICE_SESSION}/requests/${requestId}/retry`, {
        method: "POST",
        body: JSON.stringify({ inputOverride: { text: BOB_INPUT } })
      })
  ],
  [
    "continue",
    (caller, requestId) =>
      caller(`/jobs/sessions/${ALICE_SESSION}/requests/${requestId}/continue`, {
        method: "POST",
        body: "{}"
      })
  ],
  [
    "resume",
    (caller, requestId) =>
      caller(`/jobs/requests/${requestId}/resume`, {
        method: "POST",
        body: JSON.stringify({ suspensionId: "any", action: "approve", data: { text: BOB_INPUT } })
      })
  ],
  ["abort", (caller, requestId) => caller(`/jobs/requests/${requestId}/abort`, { method: "POST" })]
];

/** A response with the addressed id taken out, so two ids' answers compare. */
async function answer(response: Response, requestId: string): Promise<{ status: number; body: string }> {
  return { status: response.status, body: (await response.text()).replaceAll(requestId, "<id>") };
}

describe("another user's request id", () => {
  it.each(ROUTES)("%s answers it exactly as an unused id, and runs nothing", async (_route, call) => {
    const alice = server.as("alice");
    const bob = server.as("bob");

    const aliceRequest = await start(alice, "fail", ALICE_SESSION);
    await statusOf(alice, aliceRequest, "failed");
    const before = await requestsIn(alice, ALICE_SESSION);

    const unused = await answer(await call(bob, UNUSED_REQUEST), UNUSED_REQUEST);
    const probed = await answer(await call(bob, aliceRequest), aliceRequest);

    expect(unused.status).toBe(404);
    expect(probed).toEqual(unused);
    // Nothing ran under Alice's name with Bob's input, and her request is as it was.
    expect(await requestsIn(alice, ALICE_SESSION)).toEqual(before);
    expect(await statusOf(alice, aliceRequest, "failed")).toBe("failed");
  });

  it("abort answers a running request as an unused id, and the request finishes", async () => {
    const alice = server.as("alice");
    const bob = server.as("bob");
    const abort = ROUTES.find(([name]) => name === "abort")![1];

    const aliceRequest = await start(alice, "hold", ALICE_SESSION);
    await statusOf(alice, aliceRequest, "in_progress");

    const unused = await answer(await abort(bob, UNUSED_REQUEST), UNUSED_REQUEST);
    const probed = await answer(await abort(bob, aliceRequest), aliceRequest);
    expect(probed).toEqual(unused);

    release();
    expect(await statusOf(alice, aliceRequest, "completed")).toBe("completed");
  });

  it("does not stop the owner re-entering their own request", async () => {
    const alice = server.as("alice");
    const aliceRequest = await start(alice, "fail", ALICE_SESSION);
    await statusOf(alice, aliceRequest, "failed");

    const retry = ROUTES.find(([name]) => name === "retry")![1];
    const response = await retry(alice, aliceRequest);
    expect(response.status).toBe(202);
    const { request } = (await response.json()) as { request: { retryOf: string } };
    expect(request.retryOf).toBe(aliceRequest);
  });
});

describe("a request that arrived on a transport not open to re-entry", () => {
  it.each(ROUTES.filter(([name]) => name !== "abort"))(
    "%s answers its owner exactly as an unused id",
    async (_route, call) => {
      const alice = server.as("alice");
      const sent = await alice("/_sms/jobs/fail", {
        method: "POST",
        body: JSON.stringify({ input: { text: ALICE_TEXT }, sessionId: ALICE_SESSION })
      });
      expect(sent.status).toBe(200);
      const { requestId } = (await sent.json()) as { requestId: string };
      await statusOf(alice, requestId, "failed");
      const before = await requestsIn(alice, ALICE_SESSION);

      const unused = await answer(await call(alice, UNUSED_REQUEST), UNUSED_REQUEST);
      const probed = await answer(await call(alice, requestId), requestId);

      expect(unused.status).toBe(404);
      expect(probed).toEqual(unused);
      expect(await requestsIn(alice, ALICE_SESSION)).toEqual(before);
    }
  );
});
