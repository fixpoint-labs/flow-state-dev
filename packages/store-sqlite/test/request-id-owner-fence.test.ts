/**
 * On SQLite a request's items live in their own table, keyed by request id, so
 * a record overwritten under the same id reads its first owner's items back
 * under the new one. A dispatch carrying another user's request id must
 * therefore never reach the record at all: this proves the host refuses it on
 * the queued path, which writes its record at enqueue time, and that the first
 * owner's record and items stay exactly as they were.
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver,
  RequestOwnerMismatchError
} from "@flow-state-dev/engine";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src";

const FLOW = "sqlite-owner-fence";
const REQUEST_ID = "req_client_chosen";

const input = z.object({ text: z.string() });

function buildHost(stores: SQLiteStoreRegistry) {
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: FLOW,
      actions: {
        write: {
          inputSchema: input,
          userMessage: (value: { text: string }) => value.text,
          concurrency: { policy: "queue", key: "session" },
          block: handler({ name: "sqlite-owner-fence-write", inputSchema: input, execute: () => ({}) })
        }
      }
    })({ id: FLOW })
  );
  return createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {}
  });
}

function write(host: ReturnType<typeof buildHost>, userId: string, text: string) {
  return host.dispatch({
    source: "http",
    flowKind: FLOW,
    action: "write",
    input: { text },
    sessionId: `s_${userId}`,
    requestId: REQUEST_ID,
    orgId: "org_shared",
    principal: { userId, orgId: "org_shared" }
  });
}

let stores: SQLiteStoreRegistry | undefined;
afterEach(() => {
  stores?.close();
  stores = undefined;
});

describe("a request id another user holds, on SQLite", () => {
  it("is refused, and the owner keeps the record and its items", async () => {
    stores = createSQLiteStores({ filename: ":memory:" });
    const host = buildHost(stores);

    await write(host, "alice", "alice's private note").finished;
    const before = await stores.request.get(REQUEST_ID);
    expect(before?.userId).toBe("alice");
    const itemCount = await stores.request.countItems(REQUEST_ID);
    expect(itemCount).toBeGreaterThan(0);

    const reuse = write(host, "bob", "bob's note");
    await expect(reuse.accepted).rejects.toBeInstanceOf(RequestOwnerMismatchError);
    await reuse.finished.catch(() => undefined);

    const after = await stores.request.get(REQUEST_ID);
    expect(after).toEqual(before);
    expect(await stores.request.countItems(REQUEST_ID)).toBe(itemCount);
    expect(JSON.stringify(after?.items)).toContain("alice's private note");
    expect(JSON.stringify(after?.items)).not.toContain("bob's note");
  });
});
