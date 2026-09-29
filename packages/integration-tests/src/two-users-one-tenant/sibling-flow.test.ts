/**
 * A session's flow never authorizes another flow's history, and a request id
 * another user knows answers as an id nobody has used.
 *
 * Two flows share the server. `notes` authenticates any known user; `vault`
 * authenticates only a caller with clearance. A caller cleared for `notes`
 * alone is admitted to a `notes` session by that session's own flow, so if a
 * `vault` run could sit in that session, every read of the session (its
 * request listing with items, its state with items, its live stream) would
 * hand the vault run's items to a caller `vault` never admitted. The run
 * must not get there, and a read must not serve it.
 *
 * And a request id travels in the `x-request-id` header, the 202 body and
 * URLs, so another user in the tenant can learn one. Asking for its status
 * or its stream must tell them nothing, not even that the id is in use.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { ORG_ID, startTwoUserServer, waitFor, type TwoUserServer } from "./harness";

const noteSchema = z.object({ text: z.string() });

/** The header `vault` requires, on top of the verified user. */
const CLEARANCE = { "x-vault-clearance": "granted" };

function writeAction(kind: string) {
  return {
    inputSchema: noteSchema,
    userMessage: (input: { text: string }) => input.text,
    block: handler({
      name: `${kind}-write`,
      inputSchema: noteSchema,
      outputSchema: z.object({ saved: z.string() }),
      execute: (input) => ({ saved: input.text })
    })
  };
}

/** Authenticated by the host's resolver: any verified user. */
const notes = defineFlow({ kind: "notes", actions: { write: writeAction("notes") } });

/** Authenticated by its own resolver: a verified user with clearance, and no one else. */
const vault = defineFlow({
  kind: "vault",
  actions: { write: writeAction("vault") },
  authentication: {
    resolvePrincipal: (context) => {
      const headers = context.request?.headers;
      const userId = headers?.get("x-verified-user");
      if (userId == null || userId === "") return null;
      if (headers?.get("x-vault-clearance") !== "granted") return null;
      return { userId, orgId: ORG_ID };
    }
  }
});

const SESSION = "s_mixed";
const NOTE_TEXT = "alice's shopping list";
const VAULT_SECRET = "alice's vault combination";

let server: TwoUserServer;

beforeEach(async () => {
  server = await startTwoUserServer([notes(), vault()]);
});

afterEach(async () => {
  await server.close();
});

type Caller = ReturnType<TwoUserServer["as"]>;

/** Wait for `requestId` to settle, read through `flow` by a caller it admits. */
async function settled(caller: Caller, flow: string, requestId: string, headers = {}): Promise<string> {
  return waitFor(async () => {
    const response = await caller(`/${flow}/requests/${requestId}/status`, { headers });
    if (response.status !== 200) return undefined;
    const { status } = (await response.json()) as { status: string };
    return status === "in_progress" ? undefined : status;
  }, `request ${requestId} to settle`);
}

/** Everything a live session stream sends in its first `ms`. */
async function streamFor(caller: Caller, path: string, ms: number): Promise<string> {
  const abort = new AbortController();
  const response = await caller(path, { signal: abort.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const stop = setTimeout(() => abort.abort(), ms);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // Aborted: the window is over.
  } finally {
    clearTimeout(stop);
  }
  return text;
}

describe("a session's stored flow", () => {
  it("never carries another flow's run, nor serves one to a caller only it admits", async () => {
    const alice = server.as("alice");

    // Alice's notes session, with a note in it.
    const note = await alice(`/notes/${SESSION}/actions/write`, {
      method: "POST",
      body: JSON.stringify({ input: { text: NOTE_TEXT } })
    });
    expect(note.status).toBe(202);
    const noteId = ((await note.json()) as { request: { id: string } }).request.id;
    expect(await settled(alice, "notes", noteId)).toBe("completed");

    // Alice, cleared for the vault, posts a vault run into that notes session.
    const stray = await alice(`/vault/${SESSION}/actions/write`, {
      method: "POST",
      headers: CLEARANCE,
      body: JSON.stringify({ input: { text: VAULT_SECRET }, requestId: "req_vault_stray" })
    });
    // Whatever it answered, let anything it started finish before the reads.
    if (stray.status === 202) {
      await settled(alice, "vault", "req_vault_stray", CLEARANCE);
    }

    // Read as a caller the session's own flow admits and the vault does not:
    // the listing with items, the state with items, and the live stream.
    const listing = await alice(`/sessions/${SESSION}/requests?include_items=true`);
    expect(listing.status).toBe(200);
    const listed = await listing.text();
    expect(listed).toContain(NOTE_TEXT);
    expect(listed).not.toContain(VAULT_SECRET);
    expect(listed).not.toContain("req_vault_stray");

    const state = await alice(`/sessions/${SESSION}/state?include_items=true`);
    expect(state.status).toBe(200);
    const stated = await state.text();
    expect(stated).toContain(NOTE_TEXT);
    expect(stated).not.toContain(VAULT_SECRET);

    const streamed = await streamFor(alice, `/sessions/${SESSION}/stream?since=0`, 1_500);
    expect(streamed).toContain(NOTE_TEXT);
    expect(streamed).not.toContain(VAULT_SECRET);

    // The run was refused at the door, and nothing was written under its id.
    expect(stray.status).toBe(409);
    expect(
      (await alice(`/vault/requests/req_vault_stray/status`, { headers: CLEARANCE })).status
    ).toBe(404);
  });
});

/** Status and body, with the addressed id written as `<id>` so two ids compare. */
async function answer(
  caller: Caller,
  path: string,
  id: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  const response = await caller(path, { headers });
  return { status: response.status, body: (await response.text()).split(id).join("<id>") };
}

describe("a request id another user in the tenant knows", () => {
  it.each([
    ["its status", "/notes/requests/:id/status", {}],
    ["its stream", "/notes/requests/:id/stream", {}],
    ["its stream, resumed from a cursor", "/notes/requests/:id/stream?starting_after=3", {}],
    ["its stream, resumed from a Last-Event-ID", "/notes/requests/:id/stream", { "last-event-id": ":id:3" }]
  ] as const)("answers %s to the second user as if the id were unused", async (_label, path, headers) => {
    const alice = server.as("alice");
    const bob = server.as("bob");
    const response = await alice(`/notes/s_alice/actions/write`, {
      method: "POST",
      body: JSON.stringify({ input: { text: NOTE_TEXT } })
    });
    expect(response.status).toBe(202);
    const aliceRequestId = response.headers.get("x-request-id")!;
    expect(await settled(alice, "notes", aliceRequestId)).toBe("completed");

    const probe = (id: string) =>
      answer(
        bob,
        path.replace(":id", id),
        id,
        Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, v.replace(":id", id)]))
      );
    const unused = await probe("req_unused");
    const alices = await probe(aliceRequestId);

    // The same status and the same words as an id nobody has used.
    expect(alices).toEqual(unused);
    expect(alices.body).not.toContain(NOTE_TEXT);
    expect(alices.body).not.toContain("alice");

    // Still Alice's, as it was.
    const own = await alice(path.replace(":id", aliceRequestId).split("?")[0]!);
    expect(own.status).toBe(200);
  });
});
