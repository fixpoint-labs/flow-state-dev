/**
 * The official client against a real `serve()` host, over a loopback socket.
 *
 * `basePath` moves the flow API off `/api/flows`; the client reaches it by
 * naming the same mount in `apiPath`. Both halves are pinned here: a custom
 * mount completes an action round trip, and the default mount still works
 * with neither option set.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  ClientHttpError,
  createClient,
  createSessionClient,
} from "@flow-state-dev/client";
import { z } from "zod";
import { serve, type ServeHandle } from "../src/serve";

const echoFlow = defineFlow({
  kind: "echo",
  actions: {
    say: {
      inputSchema: z.object({ text: z.string() }),
      block: handler({
        name: "say",
        inputSchema: z.object({ text: z.string() }),
        execute: (input) => ({ heard: input.text }),
      }),
    },
  },
})();

const handles: ServeHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
});

async function startServer(basePath?: string): Promise<string> {
  const flowState = createFlowState({
    flows: { echo: echoFlow },
    modelResolver: createMockModelResolver({}),
    stores: { default: { primary: inMemoryStores() } },
  });
  const handle = await serve(flowState, { port: 0, basePath });
  handles.push(handle);
  await flowState.ready();
  return `http://127.0.0.1:${handle.port}`;
}

/**
 * Open a session, run one action in it, wait for the server to report it
 * finished, then read the session's request list back.
 */
async function roundTrip(transport: { baseUrl: string; apiPath?: string }): Promise<void> {
  const client = createClient({ flowKind: "echo", userId: "u1", ...transport });
  const sessions = createSessionClient(transport);

  const session = await sessions.createSession({ flowKind: "echo", userId: "u1" });
  const sent = await client.sendAction("say", { text: "hi" }, { sessionId: session.id });
  await vi.waitFor(async () => {
    const status = await client.getRequestStatus(sent.request.id);
    expect(status.status).toBe("completed");
  });

  const requests = await sessions.listSessionRequests(session.id);
  expect(requests.map((request) => request.id)).toContain(sent.request.id);
}

describe("official client against a serve() host", () => {
  it("reaches a custom basePath when apiPath names the same mount", async () => {
    await roundTrip({ baseUrl: await startServer("/flows"), apiPath: "/flows" });
  });

  it("misses a custom basePath when the client keeps the default mount", async () => {
    const baseUrl = await startServer("/flows");
    const client = createClient({ flowKind: "echo", userId: "u1", baseUrl });

    const error = await client.listFlows().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClientHttpError);
    expect((error as ClientHttpError).status).toBe(404);
  });

  it("reaches the default mount with neither basePath nor apiPath set", async () => {
    await roundTrip({ baseUrl: await startServer() });
  });
});
