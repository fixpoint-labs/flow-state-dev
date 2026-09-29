/**
 * A session id is an address, never an ownership.
 *
 * Session ids travel in URLs (`/api/flows/:flow/:sessionId/actions/...`,
 * `/api/flows/sessions/:sessionId`), so another user in the same tenant can
 * learn one. Knowing it must get them nothing of the session: not its record,
 * state, requests, resources or stream, not a way to write into it, and not
 * even the fact that it exists. Every session route answers them exactly as it
 * answers an id nobody has used, and an action they post into it is refused
 * before it is acknowledged, with nothing written and no owner named.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { startTwoUserServer, waitFor, type TwoUserServer } from "./harness";

const noteSchema = z.object({ text: z.string() });

/** A one-action flow of `kind`; the suite runs two, so a probe can come in through the other one. */
function notesFlow(kind: string) {
  return defineFlow({
    kind,
    actions: {
      write: {
        inputSchema: noteSchema,
        userMessage: (input: { text: string }) => input.text,
        block: handler({
          name: `${kind}-write`,
          inputSchema: noteSchema,
          outputSchema: z.object({ saved: z.string() }),
          execute: (input) => ({ saved: input.text })
        })
      },
      // Queued behind its session, so the run is admitted by the transport
      // host at enqueue time rather than by the in-process run.
      writeQueued: {
        inputSchema: noteSchema,
        userMessage: (input: { text: string }) => input.text,
        concurrency: { policy: "queue", key: "session" },
        block: handler({
          name: `${kind}-write-queued`,
          inputSchema: noteSchema,
          outputSchema: z.object({ saved: z.string() }),
          execute: (input) => ({ saved: input.text })
        })
      }
    }
  });
}

/** Alice's session id. Nothing in it names her, so an answer that does is a leak. */
const ALICE_SESSION = "s_7c1e";
/** An id no one has used, for what "not found" looks like on each route. */
const UNUSED_SESSION = "s_unused";
const ALICE_SECRET = "alice's private note";
const BOB_TEXT = "bob's note";

let server: TwoUserServer;

beforeEach(async () => {
  server = await startTwoUserServer([notesFlow("notes")(), notesFlow("memos")()]);
});

afterEach(async () => {
  await server.close();
});

type Caller = ReturnType<TwoUserServer["as"]>;

/** Alice writes into her session and waits for it to settle. */
async function aliceWrites(alice: Caller): Promise<void> {
  const response = await alice(`/notes/${ALICE_SESSION}/actions/write`, {
    method: "POST",
    body: JSON.stringify({ input: { text: ALICE_SECRET } })
  });
  expect(response.status).toBe(202);
  const { request } = (await response.json()) as { request: { id: string } };
  await waitFor(async () => {
    const status = await alice(`/notes/requests/${request.id}/status`);
    const body = (await status.json()) as { status?: string };
    return body.status === "completed" ? true : undefined;
  }, "alice's request to settle");
}

/** Every session-addressed route, as a method and a path with `:id` for the session id. */
const SESSION_ROUTES: Array<[string, string, unknown?]> = [
  ["GET", "/sessions/:id"],
  ["GET", "/sessions/:id/state"],
  ["GET", "/sessions/:id/stream"],
  ["GET", "/sessions/:id/requests"],
  ["GET", "/sessions/:id/children"],
  ["GET", "/sessions/:id/manifest"],
  ["GET", "/sessions/:id/resources/notes/content"],
  ["GET", "/sessions/:id/debug/resources"],
  ["PATCH", "/sessions/:id/metadata", { metadata: { pinned: true } }],
  ["DELETE", "/sessions/:id"]
];

/** Status and body, with the addressed id written as `<id>` so two ids compare. */
async function answer(
  caller: Caller,
  method: string,
  path: string,
  id: string,
  body?: unknown
): Promise<{ status: number; body: string }> {
  const response = await caller(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, body: (await response.text()).split(id).join("<id>") };
}

describe("a session id another user in the tenant knows", () => {
  it.each(SESSION_ROUTES)(
    "%s %s answers the second user as if the session did not exist",
    async (method, path, body) => {
      const alice = server.as("alice");
      const bob = server.as("bob");
      await aliceWrites(alice);

      const probe = (id: string) => answer(bob, method, path.replace(":id", id), id, body);
      const unused = await probe(UNUSED_SESSION);
      const alices = await probe(ALICE_SESSION);

      // The same status and the same words as an id nobody has used, so the
      // answer says nothing about whether the session exists or whose it is.
      expect(alices).toEqual(unused);
      expect(alices.status).not.toBe(200);
      expect(alices.body).not.toContain(ALICE_SECRET);
      expect(alices.body).not.toContain("alice");
    }
  );

  it.each([
    ["the flow that owns it", "notes", "write"],
    ["the flow that owns it, queued behind the session", "notes", "writeQueued"],
    ["another flow", "memos", "write"]
  ])("refuses an action posted into it through %s before acknowledging it", async (_label, flow, action) => {
    const alice = server.as("alice");
    const bob = server.as("bob");
    await aliceWrites(alice);
    const snapshot = async () => ({
      record: await (await alice(`/sessions/${ALICE_SESSION}`)).json(),
      requests: await (await alice(`/sessions/${ALICE_SESSION}/requests`)).json()
    });
    const before = await snapshot();

    const response = await bob(`/${flow}/${ALICE_SESSION}/actions/${action}`, {
      method: "POST",
      body: JSON.stringify({ input: { text: BOB_TEXT }, requestId: "req_bob_probe" })
    });
    const text = await response.text();

    // Not a 202 for a request that never runs, and not the owner's name.
    expect(response.status).toBe(404);
    expect(JSON.parse(text)).toEqual({ error: `Unknown session "${ALICE_SESSION}"` });
    expect(text).not.toContain("alice");
    // Nothing was written under the id Bob sent.
    expect((await bob(`/${flow}/requests/req_bob_probe/status`)).status).toBe(404);

    // Alice's session is exactly as it was: the same record, version and
    // update time included, and only her request in it.
    expect(await snapshot()).toEqual(before);
  });

  it("still opens and runs for its owner", async () => {
    const alice = server.as("alice");
    await aliceWrites(alice);

    const session = await alice(`/sessions/${ALICE_SESSION}`);
    expect(session.status).toBe(200);
    const { session: record } = (await session.json()) as {
      session: { id: string; userId: string };
    };
    expect(record).toMatchObject({ id: ALICE_SESSION, userId: "alice" });

    // A second action into her own session is accepted as before.
    const again = await alice(`/notes/${ALICE_SESSION}/actions/write`, {
      method: "POST",
      body: JSON.stringify({ input: { text: "again" } })
    });
    expect(again.status).toBe(202);
  });
});
