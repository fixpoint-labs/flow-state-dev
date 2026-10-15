/**
 * A definition's `secret` fields never leave the server.
 *
 * The debug routes return full state on purpose, and a collection with
 * `client.state.read` and no projection sends each item's whole state. Both
 * would hand back a stored key. Each test seeds a record whose `value` is a
 * sentinel and checks every read the engine serves for it: the debug tree and
 * item listing, the client snapshot, and the list-state and get-state routes.
 * The live delta is checked in `context/resource-registry.spec.ts`. Each also checks a non-secret field arrives, so a read that
 * returned nothing at all cannot pass.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { createInMemoryStores, createFlowRegistry } from "../src";
import type { SessionRecord } from "../src/stores/types";
import {
  handleDebugListCollectionItems,
  handleDebugListResources,
  resolveDebugConfig
} from "../src/routes/debug-routes";
import {
  handleGetCollectionItemState,
  handleListCollectionState
} from "../src/routes/resource-routes";
import { buildResourceSnapshot } from "../src/routes/route-utils";

const SENTINEL = "sk-secret-sentinel-0451";
const SET_AT = "2026-10-13T00:00:00.000Z";
const credentialSchema = z.object({ value: z.string(), setAt: z.string() });

/** Identity client view: without `secret`, every client read would carry `value`. */
const keys = defineResourceCollection({
  pattern: "keys/*",
  scope: "session",
  stateSchema: credentialSchema,
  secret: ["value"],
  prefetchWindow: 5,
  client: { state: { read: true } }
});

/** A `data` projection that returns all it is handed. */
const token = defineResource({
  scope: "session",
  stateSchema: z.object({ value: z.string().default(""), setAt: z.string().default("") }),
  secret: ["value"],
  client: { data: (s) => ({ ...s }) }
});

function buildFlow() {
  const block = handler({
    name: "noop",
    resources: { keys, token },
    execute: () => "ok"
  });
  return defineFlow({
    kind: "secret-flow",
    actions: { run: { inputSchema: z.string(), block } }
  })();
}

const SESSION = "sess_1";
const record = { value: SENTINEL, setAt: SET_AT };

async function setup() {
  const stores = createInMemoryStores();
  const registry = createFlowRegistry();
  registry.register(buildFlow());
  const session: SessionRecord = {
    id: SESSION,
    flowKind: "secret-flow",
    userId: "user_1",
    state: {},
    journal: [],
    version: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await stores.session.set(SESSION, session, "any");
  await stores.resourceState.set("session", SESSION, "keys/linear", record, "any");
  await stores.resourceState.set("session", SESSION, "token", record, "any");
  const debug = resolveDebugConfig({ debugEndpointsEnabled: true, debugAllowAnonymousLocal: true });
  return { registry, stores, sessionId: SESSION, debug };
}

/** The response body as text: the sentinel must appear nowhere in it, at any depth. */
async function bodyOf(res: Response): Promise<{ text: string; json: any }> {
  const text = await res.text();
  return { text, json: JSON.parse(text) };
}

describe("secret resource fields", () => {
  it("the stored record does hold the key (the reads below have something to leak)", async () => {
    const ctx = await setup();
    expect(await ctx.stores.resourceState.get("session", SESSION, "keys/linear")).toMatchObject({
      state: { value: SENTINEL }
    });
  });

  it("the debug tree omits a single resource's secret field", async () => {
    const ctx = await setup();
    const res = await handleDebugListResources(
      new Request(`http://localhost/api/flows/sessions/${SESSION}/debug/resources`),
      { kind: "debug_list_resources", sessionId: SESSION },
      ctx
    );
    expect(res.status).toBe(200);
    const { text, json } = await bodyOf(res);
    expect(text).not.toContain(SENTINEL);
    const entry = json.resources.find((r: { primaryName: string }) => r.primaryName === "token");
    expect(entry.state).toEqual({ setAt: SET_AT });
    expect(entry.clientView).toEqual({ ok: true, value: { setAt: SET_AT } });
  });

  it("the debug item listing omits a collection item's secret field", async () => {
    const ctx = await setup();
    const res = await handleDebugListCollectionItems(
      new Request(`http://localhost/api/flows/sessions/${SESSION}/debug/resources/keys/items`),
      { kind: "debug_list_collection_items", sessionId: SESSION, ref: "keys" },
      ctx
    );
    expect(res.status).toBe(200);
    const { text, json } = await bodyOf(res);
    expect(text).not.toContain(SENTINEL);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].state).toEqual({ setAt: SET_AT });
  });

  it("the client snapshot omits it from prefetched items and a data projection", async () => {
    const snapshot = await buildResourceSnapshot({
      configs: { keys, token } as Record<string, unknown>,
      persisted: { "keys/linear": record, token: record }
    });
    expect(JSON.stringify(snapshot)).not.toContain(SENTINEL);
    expect((snapshot as any).keys.prefetched[0].clientData).toEqual({ setAt: SET_AT });
    expect((snapshot as any).token.clientData).toEqual({ setAt: SET_AT });
  });

  it("the list-state and get-state routes omit it", async () => {
    const ctx = await setup();
    const listed = await handleListCollectionState(
      new Request(`http://localhost/api/flows/sessions/${SESSION}/resources/keys/state`),
      { kind: "list_collection_state", sessionId: SESSION, ref: "keys" } as never,
      ctx as never
    );
    expect(listed.status).toBe(200);
    const list = await bodyOf(listed);
    expect(list.text).not.toContain(SENTINEL);
    expect(list.json.items[0].clientData).toEqual({ setAt: SET_AT });

    const got = await handleGetCollectionItemState(
      new Request(`http://localhost/api/flows/sessions/${SESSION}/resources/keys/linear/state`),
      { kind: "get_collection_item_state", sessionId: SESSION, ref: "keys", topic: "linear" } as never,
      ctx as never
    );
    expect(got.status).toBe(200);
    const one = await bodyOf(got);
    expect(one.text).not.toContain(SENTINEL);
    expect(one.json.clientData).toEqual({ setAt: SET_AT });
  });
});

describe("client.data and secret fields", () => {
  it("lets a data projection derive from a secret field but not return it", async () => {
    const withFlag = defineResource({
      scope: "session",
      stateSchema: credentialSchema,
      secret: ["value"],
      client: { data: (s) => ({ keyTail: s.value.slice(-4), value: s.value, setAt: s.setAt }) }
    });
    const snapshot = await buildResourceSnapshot({
      configs: { withFlag } as Record<string, unknown>,
      persisted: { withFlag: record }
    });
    expect(JSON.stringify(snapshot)).not.toContain(SENTINEL);
    expect((snapshot as any).withFlag.clientData).toEqual({ keyTail: SENTINEL.slice(-4), setAt: SET_AT });
  });
});

describe("flows sharing a cell agree on secret fields", () => {
  const sharedFlow = (kind: string, secret?: ["value"]) =>
    defineFlow({
      kind,
      resources: {
        keys: defineResourceCollection({
          pattern: "shared-keys/*",
          scope: "user",
          stateSchema: credentialSchema,
          ...(secret ? { secret } : {})
        })
      },
      actions: { run: { inputSchema: z.string(), block: handler({ name: "noop", execute: () => "ok" }) } }
    })();

  it("refuses a second flow that declares the shared cell without the secret", () => {
    const registry = createFlowRegistry();
    registry.register(sharedFlow("writer", ["value"]));
    expect(() => registry.register(sharedFlow("reader"))).toThrow(/secret-mismatch.*marks secret value, the other none/);
  });

  it("accepts two flows that mark the same secret fields", () => {
    const registry = createFlowRegistry();
    registry.register(sharedFlow("writer", ["value"]));
    expect(() => registry.register(sharedFlow("reader", ["value"]))).not.toThrow();
  });
});

describe("secret declaration checks", () => {
  it("rejects a secret field that is not on the state schema", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "bad/*",
        scope: "session",
        stateSchema: credentialSchema,
        secret: ["valu" as "value"]
      })
    ).toThrow(/secret names key\(s\) not on stateSchema: valu/);
  });

  it("rejects a secret field that client.expose also names", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "bad/*",
        scope: "session",
        stateSchema: credentialSchema,
        secret: ["value"],
        client: { state: { read: true }, expose: ["value", "setAt"] }
      })
    ).toThrow(/client\.expose names secret key\(s\): value/);
  });
});
