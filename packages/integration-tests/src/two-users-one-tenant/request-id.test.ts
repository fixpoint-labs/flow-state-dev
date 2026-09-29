/**
 * A request id a caller supplies is an address, never an ownership.
 *
 * A client may send its own `requestId` on an action call, so a retry lands
 * on the same request. The id is not a secret: it comes back in the
 * `x-request-id` header and the 202 body, and it travels in URLs and logs.
 * So another user in the same tenant can learn it and send it on their own
 * call. What that must get them is their own request, never the first user's
 * record, items, stream or suspension.
 *
 * Both dispatch paths an action takes are asked: the ordinary in-process run,
 * and a run queued behind its session's concurrency key, which writes its
 * request record at enqueue time. The store is SQLite, which keeps a request's
 * items in their own table, so a record taken over keeps its first owner's
 * items where the new owner can read them.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { startTwoUserServer, waitFor, type TwoUserServer } from "./harness";

const noteSchema = z.object({ text: z.string() });

const notes = defineFlow({
  kind: "notes",
  actions: {
    write: {
      inputSchema: noteSchema,
      userMessage: (input: { text: string }) => input.text,
      block: handler({
        name: "notes-write",
        inputSchema: noteSchema,
        outputSchema: z.object({ saved: z.string() }),
        execute: (input) => ({ saved: input.text })
      })
    },
    writeQueued: {
      inputSchema: noteSchema,
      userMessage: (input: { text: string }) => input.text,
      concurrency: { policy: "queue", key: "session" },
      block: handler({
        name: "notes-write-queued",
        inputSchema: noteSchema,
        outputSchema: z.object({ saved: z.string() }),
        execute: (input) => ({ saved: input.text })
      })
    }
  }
});

const ALICE_SECRET = "alice's private note";
const BOB_TEXT = "bob's note";

let server: TwoUserServer;

beforeEach(async () => {
  server = await startTwoUserServer([notes()]);
});

afterEach(async () => {
  await server.close();
});

type Caller = ReturnType<TwoUserServer["as"]>;

/** POST an action; returns the request id the server answered with. */
async function act(
  caller: Caller,
  action: string,
  sessionId: string,
  text: string,
  requestId?: string
): Promise<{ status: number; requestId?: string; header: string | null }> {
  const response = await caller(`/notes/${sessionId}/actions/${action}`, {
    method: "POST",
    body: JSON.stringify({ input: { text }, ...(requestId === undefined ? {} : { requestId }) })
  });
  const body = (await response.json()) as { request?: { id?: string } };
  return {
    status: response.status,
    requestId: body.request?.id,
    header: response.headers.get("x-request-id")
  };
}

/** Wait for `requestId` to settle as `caller` sees it, and return its status. */
async function settled(caller: Caller, requestId: string): Promise<string> {
  return waitFor(async () => {
    const response = await caller(`/notes/requests/${requestId}/status`);
    if (response.status !== 200) return undefined;
    const { status } = (await response.json()) as { status: string };
    return status === "in_progress" ? undefined : status;
  }, `request ${requestId} to settle`);
}

/** The replayed stream of a settled request, as `caller` sees it. */
async function replay(caller: Caller, requestId: string): Promise<{ status: number; text: string }> {
  const response = await caller(`/notes/requests/${requestId}/stream`);
  return { status: response.status, text: await response.text() };
}

describe.each([
  ["an in-process run", "write"],
  ["a run queued behind its session", "writeQueued"]
])("a request id reused by another user, on %s", (_label, action) => {
  it("gets the second user their own request and leaves the first user's untouched", async () => {
    const alice = server.as("alice");
    const bob = server.as("bob");

    // Alice's request, and its id as any response hands it out.
    const first = await act(alice, action, "s_alice", ALICE_SECRET);
    expect(first.status).toBe(202);
    const aliceRequestId = first.requestId!;
    expect(await settled(alice, aliceRequestId)).toBe("completed");

    // Bob sends Alice's id on his own call, in his own session.
    const reused = await act(bob, action, "s_bob", BOB_TEXT, aliceRequestId);

    // Bob's call succeeds as Bob's own request, under an id that is not Alice's.
    expect(reused.status).toBe(202);
    const bobRequestId = reused.requestId!;
    expect(bobRequestId).not.toBe(aliceRequestId);
    // Bob learns his own id from the header, as the docs promise, not only the body.
    expect(reused.header).toBe(bobRequestId);
    expect(await settled(bob, bobRequestId)).toBe("completed");
    const bobs = await replay(bob, bobRequestId);
    expect(bobs.status).toBe(200);
    expect(bobs.text).toContain(BOB_TEXT);
    expect(bobs.text).not.toContain(ALICE_SECRET);

    // Alice's request is still hers, as it was: settled, her items, none of Bob's.
    expect(await settled(alice, aliceRequestId)).toBe("completed");
    const alices = await replay(alice, aliceRequestId);
    expect(alices.status).toBe(200);
    expect(alices.text).toContain(ALICE_SECRET);
    expect(alices.text).not.toContain(BOB_TEXT);

    // And Bob still cannot reach it: not its stream, not its status, not a resume.
    const attach = await replay(bob, aliceRequestId);
    expect([403, 404]).toContain(attach.status);
    expect(attach.text).not.toContain(ALICE_SECRET);
    const status = await bob(`/notes/requests/${aliceRequestId}/status`);
    expect([403, 404]).toContain(status.status);
    const resume = await bob(`/notes/requests/${aliceRequestId}/resume`, {
      method: "POST",
      body: JSON.stringify({ suspensionId: "any", action: "approve" })
    });
    expect([403, 404]).toContain(resume.status);
  });

  it("keeps a user's own reused id idempotent: the same id, the same request", async () => {
    const alice = server.as("alice");
    const first = await act(alice, action, "s_alice", ALICE_SECRET, "req_client_chosen");
    expect(first.requestId).toBe("req_client_chosen");
    await settled(alice, "req_client_chosen");

    const again = await act(alice, action, "s_alice", ALICE_SECRET, "req_client_chosen");
    expect(again.status).toBe(202);
    expect(again.requestId).toBe("req_client_chosen");
  });
});
