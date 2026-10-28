/**
 * A client lists its own user's sessions (FIX-2162 D3), against a real
 * `serve()` host with no sign-in.
 *
 * Without sign-in the server narrows nothing, so a listing with no user filter
 * is every user's sessions: one person's client saw everyone's. The client is
 * built for one user, so its list is that user's unless it asks for another,
 * and turning sign-in on later changes nothing a person sees.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createClient } from "@flow-state-dev/client";
import { z } from "zod";
import { serve, type ServeHandle } from "../src/serve";

const notesFlow = defineFlow({
  kind: "notes",
  actions: {
    note: {
      inputSchema: z.object({}),
      block: handler({ name: "note", inputSchema: z.object({}), execute: () => ({ ok: true }) }),
    },
  },
})();

const handles: ServeHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
});

/** A host with no sign-in, holding one session each for Alice and Bob. */
async function hostWithTwoUsers(): Promise<string> {
  const flowState = createFlowState({
    flows: { notes: notesFlow },
    modelResolver: createMockModelResolver({}),
    stores: { default: { primary: inMemoryStores() } },
  });
  const handle = await serve(flowState, { port: 0 });
  handles.push(handle);
  await flowState.ready();
  const baseUrl = `http://127.0.0.1:${handle.port}`;
  await createClient({ userId: "alice", baseUrl }).flow("notes").createSession({ sessionId: "s_alice" });
  await createClient({ userId: "bob", baseUrl }).flow("notes").createSession({ sessionId: "s_bob" });
  return baseUrl;
}

describe("a client's session list", () => {
  it("holds only its own user's sessions on a host without sign-in", async () => {
    const baseUrl = await hostWithTwoUsers();
    const alice = createClient({ userId: "alice", baseUrl });

    const listed = await alice.sessions.list({ flowKind: "notes" });

    expect(listed.map((session) => session.id)).toEqual(["s_alice"]);
  });

  it("still lists another user's sessions when it names them", async () => {
    const baseUrl = await hostWithTwoUsers();
    const alice = createClient({ userId: "alice", baseUrl });

    const listed = await alice.sessions.list({ flowKind: "notes", userId: "bob" });

    expect(listed.map((session) => session.id)).toEqual(["s_bob"]);
  });
});
