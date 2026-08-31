/**
 * Sending a message to a session, on the real dispatch path (FIX-1230).
 *
 * Nothing here is injected. Every case drives a real HTTP action request through
 * `createFlowApiRouter` — the entry point `createFlowState` delegates to — so a
 * block reaches `ctx.requestHost.sendMessage`, the send goes through the host's
 * arbiter, the delivery runs as an ordinary request, and the assertions read real
 * store state.
 *
 * **That is the point rather than thoroughness for its own sake (BP-035).** Relay
 * resembles the HTTP action path closely enough that a suite proving the seam
 * works *from outside* would prove nothing about this change: the door, the
 * source stamp, the item visibility and the acceptance boundary all differ, and
 * every one of them is invisible to a test that dispatches over HTTP.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, requireRequestHost } from "@flow-state-dev/core";
import { itemToLLMMessages } from "../../src/context/history";
import type { SendMessageInput, SendMessageResult } from "@flow-state-dev/core/types";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores
} from "../../src";
import type { StoreRegistry } from "../../src/stores/types";

async function drain(stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (stream === null) return;
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

/** What the sending block saw, collected out of the run. */
type Sent = { result?: SendMessageResult; error?: string };

/**
 * A flow with one action that sends, one declared relay binding, and one public
 * action reachable through the fallthrough.
 *
 * Both ends of a send are the same flow here, which is not a simplification —
 * it is the contract: a send names a session, and a session that belongs to
 * another flow is refused, so a two-flow scenario is the *negative* case and has
 * its own test below.
 */
function relayFlow(options: {
  kind: string;
  sent: Sent;
  /** What the sending block asks for. */
  send: () => SendMessageInput;
  /** Records what the recipient's handlers received. */
  received: unknown[];
  /** Declare a `relay.on` binding. */
  declareBinding?: boolean;
  /** Give the public `note` action a real input schema, so validation is real. */
  publicActionSchema?: boolean;
  durablePublicAction?: boolean;
}) {
  const sender = handler({
    name: "sender",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.object({}),
    execute: async (_input, ctx) => {
      try {
        options.sent.result = await requireRequestHost(ctx).sendMessage(options.send());
      } catch (err) {
        options.sent.error = err instanceof Error ? err.message : String(err);
      }
      return {};
    }
  });

  const answerer = handler({
    name: "answerer",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.object({}),
    execute: async (input) => {
      options.received.push({ door: "declared", input });
      return {};
    }
  });

  const note = handler({
    name: "note",
    inputSchema: options.publicActionSchema === true
      ? z.object({ text: z.string() })
      : z.object({}).passthrough(),
    outputSchema: z.object({}),
    execute: async (input) => {
      options.received.push({ door: "action", input });
      return {};
    }
  });

  return defineFlow({
    kind: options.kind,
    actions: {
      send: { inputSchema: z.object({}).passthrough(), block: sender },
      note: {
        inputSchema: note.config.inputSchema as z.ZodTypeAny,
        block: note,
        ...(options.durablePublicAction === true ? { durable: true } : {})
      }
    },
    ...(options.declareBinding === true
      ? {
          relay: {
            on: {
              question: {
                block: answerer,
                input: (m: { payload: unknown }) => m.payload as object
              }
            }
          }
        }
      : {}),
    request: { heartbeatIntervalMs: 10_000 }
  });
}

/** Create a recipient session the way the public create route does. */
async function seedSession(
  stores: StoreRegistry,
  id: string,
  flowKind: string,
  overrides: Partial<{ userId: string; orgId: string; sessionKind: unknown; lineageId: string }> = {}
): Promise<void> {
  const ts = Date.now();
  await stores.session.set(
    id,
    {
      id,
      state: {},
      version: 0,
      createdAt: ts,
      updatedAt: ts,
      flowKind,
      userId: overrides.userId ?? "u_alice",
      lineageId: overrides.lineageId ?? `lin_${id}`,
      journal: [],
      ...(overrides.orgId !== undefined ? { orgId: overrides.orgId } : {}),
      // `sessionKind` is passed through verbatim — including as an absent key —
      // so a legacy record can be built as a record that never had the field,
      // rather than one with it set to `undefined`. Those are the same value in
      // TypeScript and different rows in a store that round-trips JSON.
      ...("sessionKind" in overrides ? { sessionKind: overrides.sessionKind as never } : {})
    } as never,
    "any"
  );
}

async function post(
  router: ReturnType<typeof createFlowApiRouter>,
  kind: string,
  action: string,
  body: Record<string, unknown>
): Promise<Response> {
  const res = await router.POST(
    new Request(`http://localhost/api/flows/${kind}/actions/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body)
    }),
    { params: { path: [kind, "actions", action] } }
  );
  await drain(res.body);
  return res;
}

/** Wait for the recipient's delivery to have run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 5));
}

describe("sendMessage, on the shipped path", () => {
  it("delivers to a declared binding and reports accepted with the delivery's request id", async () => {
    const sent: Sent = {};
    const received: unknown[] = [];
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(
      relayFlow({
        kind: "relay-basic",
        sent,
        received,
        declareBinding: true,
        send: () => ({
          to: "s_recipient",
          kind: "question",
          payload: { text: "ship it?" },
          mode: "fireAndForget"
        })
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_recipient", "relay-basic", { sessionKind: "top-level" });
    await post(router, "relay-basic", "send", { userId: "u_alice", sessionId: "s_sender", input: {} });
    await settle();

    expect(sent.error).toBeUndefined();
    expect(sent.result).toMatchObject({ ok: true, outcome: "accepted" });
    const deliveryRequestId = (sent.result as { deliveryRequestId: string }).deliveryRequestId;
    expect(deliveryRequestId).toMatch(/^req_/);

    // The DECLARED handler ran, with the payload its `input` mapper produced.
    expect(received).toEqual([{ door: "declared", input: { text: "ship it?" } }]);
  });

  it("stamps the relay source on the delivery's request record, and the source is not http", async () => {
    // The source is the whole of relay's authorization story: every guard reads
    // it before believing `metadata.relay`. A delivery recorded as `http` would
    // leave each of those guards inert while every behavioural test still passed.
    const sent: Sent = {};
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(
      relayFlow({
        kind: "relay-source",
        sent,
        received: [],
        declareBinding: true,
        send: () => ({ to: "s_r", kind: "question", payload: {}, mode: "fireAndForget" })
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_r", "relay-source", { sessionKind: "top-level" });
    await post(router, "relay-source", "send", { userId: "u_alice", sessionId: "s_s", input: {} });
    await settle();

    const id = (sent.result as { deliveryRequestId: string }).deliveryRequestId;
    const record = await stores.request.get(id);
    expect(record?.source).toBe("relay");
  });

  it("persists the sender relation on the delivery record BEFORE acceptance resolves", async () => {
    // The boundary, not the eventual state. `sendMessage` hands back a delivery
    // id and a later status lookup authorizes off `metadata.relay.from` +
    // `fromLineageId`; announcing the id before that relation is durable leaves
    // an accepted-but-permanently-unauthorizable delivery. Asserting "eventually
    // persisted" would pass on a path that returns the id first and writes second
    // — which is exactly the defect.
    let atAcceptance: unknown;
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    const sent: Sent = {};

    const sender = handler({
      name: "sender",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}),
      execute: async (_input, ctx) => {
        const result = await requireRequestHost(ctx).sendMessage({
          to: "s_r",
          kind: "question",
          payload: {},
          mode: "fireAndForget"
        });
        sent.result = result;
        // Read the instant the send resolved — no settle, no tick.
        if (result.ok && result.outcome === "accepted") {
          atAcceptance = (await stores.request.get(result.deliveryRequestId))?.metadata;
        }
        return {};
      }
    });

    const answerer = handler({
      name: "answerer",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}),
      execute: async () => ({})
    });

    registry.register(
      defineFlow({
        kind: "relay-relation",
        actions: { send: { inputSchema: z.object({}).passthrough(), block: sender } },
        relay: { on: { question: { block: answerer, input: () => ({}) } } }
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_r", "relay-relation", { sessionKind: "top-level" });
    await seedSession(stores, "s_s", "relay-relation", {
      sessionKind: "top-level",
      lineageId: "lin_sender"
    });
    await post(router, "relay-relation", "send", { userId: "u_alice", sessionId: "s_s", input: {} });
    await settle();

    expect((atAcceptance as { relay?: Record<string, unknown> })?.relay).toMatchObject({
      from: "s_s",
      fromLineageId: "lin_sender",
      kind: "question",
      door: "declared"
    });
  });

  it("falls through to a public action with the BARE payload, which the action's own schema validates", async () => {
    // The fallthrough has no input mapper, and `runAction` validates the
    // dispatched value against the action's schema — so a wrapped
    // `{ kind, payload, from }` would be rejected even when the sender supplied
    // exactly the right body. A suite of refusals proves the door closes and says
    // nothing about it opening.
    const sent: Sent = {};
    const received: unknown[] = [];
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(
      relayFlow({
        kind: "relay-fallthrough",
        sent,
        received,
        publicActionSchema: true,
        send: () => ({
          to: "s_r",
          kind: "note",
          payload: { text: "hello" },
          mode: "fireAndForget"
        })
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_r", "relay-fallthrough", { sessionKind: "top-level" });
    await post(router, "relay-fallthrough", "send", {
      userId: "u_alice",
      sessionId: "s_s",
      input: {}
    });
    await settle();

    expect(sent.result).toMatchObject({ ok: true, outcome: "accepted" });
    expect(received).toEqual([{ door: "action", input: { text: "hello" } }]);
  });

  it("refuses a durable public action on the fallthrough, while the SAME action still works over HTTP", async () => {
    // The second half is what proves the door narrowed rather than the action
    // breaking. Without it, deleting the action would pass the first assertion.
    const sent: Sent = {};
    const received: unknown[] = [];
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(
      relayFlow({
        kind: "relay-durable",
        sent,
        received,
        durablePublicAction: true,
        send: () => ({ to: "s_r", kind: "note", payload: {}, mode: "fireAndForget" })
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_r", "relay-durable", { sessionKind: "top-level" });
    await post(router, "relay-durable", "send", { userId: "u_alice", sessionId: "s_s", input: {} });
    await settle();

    expect(sent.result).toMatchObject({ ok: false, refused: "durable-action" });
    expect(received).toEqual([]);

    // …and the same action, addressed by an ordinary caller, still runs.
    await post(router, "relay-durable", "note", { userId: "u_alice", sessionId: "s_r", input: {} });
    await settle();
    expect(received).toEqual([{ door: "action", input: {} }]);
  });

  it("refuses a kind that matches neither door as a RETURNED refusal, not a thrown ValidationError", async () => {
    // Unresolved this reaches `resolveActionCore` and throws, handing a caller
    // promised a returned refusal an exception — the taxonomy's own promise,
    // broken on the path that breaks it.
    const sent: Sent = {};
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(
      relayFlow({
        kind: "relay-nodoor",
        sent,
        received: [],
        send: () => ({ to: "s_r", kind: "nothing", payload: {}, mode: "fireAndForget" })
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_r", "relay-nodoor", { sessionKind: "top-level" });
    await post(router, "relay-nodoor", "send", { userId: "u_alice", sessionId: "s_s", input: {} });

    expect(sent.error).toBeUndefined();
    expect(sent.result).toMatchObject({ ok: false, outcome: "refused", refused: "no-relay-door" });
  });

  describe("the identity split (BP-031), both halves", () => {
    it("HONOURS the recipient locator the caller supplied — the deliberate exception", async () => {
      // The half a well-meaning implementer breaks. Over-applying "never decide
      // from caller input" to the address makes the whole feature unreachable,
      // so this asserts the message really lands on the session the caller named
      // and not on the sender's own.
      const sent: Sent = {};
      const received: unknown[] = [];
      const stores = createInMemoryStores();
      const registry = createFlowRegistry();
      registry.register(
        relayFlow({
          kind: "relay-locator",
          sent,
          received,
          declareBinding: true,
          send: () => ({ to: "s_named", kind: "question", payload: {}, mode: "fireAndForget" })
        })
      );
      const router = createFlowApiRouter({ registry, stores });

      await seedSession(stores, "s_named", "relay-locator", { sessionKind: "top-level" });
      await post(router, "relay-locator", "send", {
        userId: "u_alice",
        sessionId: "s_sender",
        input: {}
      });
      await settle();

      const id = (sent.result as { deliveryRequestId: string }).deliveryRequestId;
      expect((await stores.request.get(id))?.sessionId).toBe("s_named");
    });

    it("IGNORES an identity asserted in the message — the sender is whoever the request is", async () => {
      // The payload names another user. Every field of the delivery's identity
      // comes off the running request, so the payload changes nothing — the
      // delivery still runs as `u_alice`, and a recipient owned by `u_mallory`
      // is refused rather than reached.
      const sent: Sent = {};
      const stores = createInMemoryStores();
      const registry = createFlowRegistry();
      registry.register(
        relayFlow({
          kind: "relay-identity",
          sent,
          received: [],
          declareBinding: true,
          send: () => ({
            to: "s_mallory",
            kind: "question",
            payload: { userId: "u_mallory", from: "s_mallory", tenantId: "t_other" },
            mode: "fireAndForget"
          })
        })
      );
      const router = createFlowApiRouter({ registry, stores });

      await seedSession(stores, "s_mallory", "relay-identity", {
        sessionKind: "top-level",
        userId: "u_mallory"
      });
      await post(router, "relay-identity", "send", {
        userId: "u_alice",
        sessionId: "s_s",
        input: {}
      });

      expect(sent.result).toMatchObject({ ok: false, refused: "unknown-recipient" });
    });
  });

  it("refuses a recipient that belongs to ANOTHER FLOW — nothing downstream enforces this", async () => {
    // `createExecutionContext` validates user, tenant and org and reads
    // `flowKind` nowhere. Without this check the send passes every existing guard
    // and runs the SENDER's handler against the other flow's session state.
    const sent: Sent = {};
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(
      relayFlow({
        kind: "relay-flow-a",
        sent,
        received: [],
        declareBinding: true,
        send: () => ({ to: "s_other_flow", kind: "question", payload: {}, mode: "fireAndForget" })
      })
    );
    registry.register(
      relayFlow({ kind: "relay-flow-b", sent: {}, received: [], send: () => ({} as never) })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_other_flow", "relay-flow-b", { sessionKind: "top-level" });
    await post(router, "relay-flow-a", "send", { userId: "u_alice", sessionId: "s_s", input: {} });

    expect(sent.result).toMatchObject({ ok: false, refused: "unknown-recipient" });
  });

  it("refuses an org-bound recipient from an unbound sender — the case the existing check lets through", async () => {
    // The downstream binding check fires only when both are set and differ, so an
    // omitted org would silently resolve to the recipient's.
    const sent: Sent = {};
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(
      relayFlow({
        kind: "relay-org",
        sent,
        received: [],
        declareBinding: true,
        send: () => ({ to: "s_orgbound", kind: "question", payload: {}, mode: "fireAndForget" })
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_orgbound", "relay-org", {
      sessionKind: "top-level",
      orgId: "org_acme"
    });
    await post(router, "relay-org", "send", { userId: "u_alice", sessionId: "s_s", input: {} });

    expect(sent.result).toMatchObject({ ok: false, refused: "org-mismatch" });
  });

  it("refuses a legacy recipient — a record built WITHOUT the field, not one holding undefined", async () => {
    const sent: Sent = {};
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(
      relayFlow({
        kind: "relay-legacy",
        sent,
        received: [],
        declareBinding: true,
        send: () => ({ to: "s_legacy", kind: "question", payload: {}, mode: "fireAndForget" })
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    // No `sessionKind` key at all — the shape a row persisted before this
    // release reads back as.
    await seedSession(stores, "s_legacy", "relay-legacy");
    await post(router, "relay-legacy", "send", { userId: "u_alice", sessionId: "s_s", input: {} });

    expect(sent.result).toMatchObject({ ok: false, refused: "recipient-not-addressable" });
  });

  it("refuses no-durable-sender when the sending request named no session", async () => {
    // An action dispatched without a session id runs under a privately minted
    // one the response never carries, so the delivery id it would receive could
    // never be queried by any later request. Both modes, because status is
    // fire-and-forget's only feedback path.
    const sent: Sent = {};
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(
      relayFlow({
        kind: "relay-ephemeral",
        sent,
        received: [],
        declareBinding: true,
        send: () => ({ to: "s_r", kind: "question", payload: {}, mode: "fireAndForget" })
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_r", "relay-ephemeral", { sessionKind: "top-level" });
    // No `sessionId` in the body — a supported call.
    await post(router, "relay-ephemeral", "send", { userId: "u_alice", input: {} });

    expect(sent.result).toMatchObject({ ok: false, refused: "no-durable-sender" });
  });

  it("refuses waitForResponse by name rather than hanging", async () => {
    const sent: Sent = {};
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(
      relayFlow({
        kind: "relay-mode",
        sent,
        received: [],
        declareBinding: true,
        send: () => ({
          to: "s_r",
          kind: "question",
          payload: {},
          mode: "waitForResponse",
          timeoutMs: 1000
        })
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_r", "relay-mode", { sessionKind: "top-level" });
    await post(router, "relay-mode", "send", { userId: "u_alice", sessionId: "s_s", input: {} });

    expect(sent.result).toMatchObject({ ok: false, refused: "mode-not-available" });
  });

  it("refuses an out-of-range timeoutMs rather than clamping it", async () => {
    // Node reduces `Infinity` to a 1 ms timer, so a clamp would answer an
    // unbounded wait almost immediately and look like an ordinary timeout.
    // Asserted on `fireAndForget` because that is the mode that exists today —
    // the value is validated whenever supplied, so one value cannot mean two
    // things once the waiting half lands.
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    const results: SendMessageResult[] = [];

    const sender = handler({
      name: "sender",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}),
      execute: async (_input, ctx) => {
        const host = requireRequestHost(ctx);
        for (const timeoutMs of [Number.POSITIVE_INFINITY, Number.NaN, -1, 0, 2 ** 31]) {
          results.push(
            await host.sendMessage({
              to: "s_r",
              kind: "question",
              payload: {},
              mode: "fireAndForget",
              timeoutMs
            })
          );
        }
        // …and the largest supported value is ACCEPTED, which is what stops this
        // passing for a verb that refuses every timeout it is given.
        results.push(
          await host.sendMessage({
            to: "s_r",
            kind: "question",
            payload: {},
            mode: "fireAndForget",
            timeoutMs: 2 ** 31 - 1
          })
        );
        return {};
      }
    });
    const answerer = handler({
      name: "answerer",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}),
      execute: async () => ({})
    });

    registry.register(
      defineFlow({
        kind: "relay-timeout",
        actions: { send: { inputSchema: z.object({}).passthrough(), block: sender } },
        relay: { on: { question: { block: answerer, input: () => ({}) } } }
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_r", "relay-timeout", { sessionKind: "top-level" });
    await post(router, "relay-timeout", "send", { userId: "u_alice", sessionId: "s_s", input: {} });
    await settle();

    expect(results.slice(0, 5).map((r) => (r.ok ? r.outcome : r.refused))).toEqual([
      "invalid-timeout",
      "invalid-timeout",
      "invalid-timeout",
      "invalid-timeout",
      "invalid-timeout"
    ]);
    expect(results[5]).toMatchObject({ ok: true, outcome: "accepted" });
  });

  describe("the message the recipient's next turn sees", () => {
    it("reconstructs as a user message CARRYING THE PAYLOAD, with no userMessage declared", async () => {
      // Asserting that *some* message appears is a check a placeholder passes,
      // while the recipient's generator has no way to act on what was sent —
      // which is the whole promise. So this asserts the role AND that the
      // reconstructed text contains the payload's own values.
      const sent: Sent = {};
      const stores = createInMemoryStores();
      const registry = createFlowRegistry();
      registry.register(
        relayFlow({
          kind: "relay-item",
          sent,
          received: [],
          declareBinding: true,
          send: () => ({
            to: "s_r",
            kind: "question",
            payload: { question: "ship-behind-a-flag" },
            mode: "fireAndForget"
          })
        })
      );
      const router = createFlowApiRouter({ registry, stores });

      await seedSession(stores, "s_r", "relay-item", { sessionKind: "top-level" });
      await post(router, "relay-item", "send", { userId: "u_alice", sessionId: "s_s", input: {} });
      await settle();

      const id = (sent.result as { deliveryRequestId: string }).deliveryRequestId;
      await stores.request.flushItems(id);
      const items = (await stores.request.get(id))?.items ?? [];

      // Through the REAL history reconstruction, not through the item being
      // persisted: `itemToLLMMessages` admits only conversational items with
      // `history: true`, so a structural carrier would pass a presence test and
      // be invisible to the very turn the promise is about.
      const messages = items.flatMap((item) => itemToLLMMessages(item, items));
      const user = messages.find((m) => m.role === "user");

      expect(user).toBeDefined();
      expect(JSON.stringify(user)).toContain("ship-behind-a-flag");
    });

    it("stamps the input item visible on BOTH axes", async () => {
      const sent: Sent = {};
      const stores = createInMemoryStores();
      const registry = createFlowRegistry();
      registry.register(
        relayFlow({
          kind: "relay-visibility",
          sent,
          received: [],
          declareBinding: true,
          send: () => ({ to: "s_r", kind: "question", payload: { a: 1 }, mode: "fireAndForget" })
        })
      );
      const router = createFlowApiRouter({ registry, stores });

      await seedSession(stores, "s_r", "relay-visibility", { sessionKind: "top-level" });
      await post(router, "relay-visibility", "send", {
        userId: "u_alice",
        sessionId: "s_s",
        input: {}
      });
      await settle();

      const id = (sent.result as { deliveryRequestId: string }).deliveryRequestId;
      await stores.request.flushItems(id);
      const items = (await stores.request.get(id))?.items ?? [];
      const message = items.find((item) => item.type === "message");

      // Explicit on both axes rather than inherited from a default that happens
      // to match today: client-visible so a UI watching the recipient shows the
      // message, history-visible so the next generator turn learns of it.
      expect(message).toMatchObject({ itemVisibility: { client: true, history: true } });
    });
  });

  it("does NOT stamp latestRequestId on the recipient — a delivery is not an auto-resume target", async () => {
    const sent: Sent = {};
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(
      relayFlow({
        kind: "relay-latest",
        sent,
        received: [],
        declareBinding: true,
        send: () => ({ to: "s_r", kind: "question", payload: {}, mode: "fireAndForget" })
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_r", "relay-latest", { sessionKind: "top-level" });
    // Give the recipient a real prior request, so "unchanged" is a value rather
    // than an absence that any implementation would satisfy.
    await post(router, "relay-latest", "note", { userId: "u_alice", sessionId: "s_r", input: {} });
    await settle();
    const before = (await stores.session.get("s_r"))?.latestRequestId;
    expect(before).toBeDefined();

    await post(router, "relay-latest", "send", { userId: "u_alice", sessionId: "s_s", input: {} });
    await settle();

    expect((await stores.session.get("s_r"))?.latestRequestId).toBe(before);
  });

  it("drops a delivery whose recipient was replaced between the send and the run, leaving no row and no handler run", async () => {
    // The recreate lands BEFORE the guard, which is the case the design promises
    // against. Asserted on the promise — the handler did not run and the
    // replacement session's history is empty — rather than on a field: a prior
    // version of this check read `latestRequestId` and passed while a foreign
    // message sat in the replacement's history.
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    const received: unknown[] = [];
    const sent: Sent = {};
    let deliveryId: string | undefined;

    const sender = handler({
      name: "sender",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}),
      execute: async (_input, ctx) => {
        // The recipient holds its own concurrency key for the duration of a
        // long-running request, so the delivery is accepted and then waits —
        // an ordinary in-process `queue` policy, no external dispatcher needed.
        const result = await requireRequestHost(ctx).sendMessage({
          to: "s_r",
          kind: "question",
          payload: { text: "for the old session" },
          mode: "fireAndForget"
        });
        sent.result = result;
        if (result.ok && result.outcome === "accepted") deliveryId = result.deliveryRequestId;

        // Delete and recreate the recipient under the same id while the delivery
        // is still queued. The replacement gets a NEW lineage.
        await stores.session.delete("s_r");
        await seedSession(stores, "s_r", "relay-incarnation", {
          sessionKind: "top-level",
          lineageId: "lin_replacement"
        });
        // Release the key so the delivery runs against the replacement.
        release();
        return {};
      }
    });

    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });

    const holder = handler({
      name: "holder",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}),
      execute: async () => {
        await held;
        return {};
      }
    });

    const answerer = handler({
      name: "answerer",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}),
      execute: async (input) => {
        received.push(input);
        return {};
      }
    });

    registry.register(
      defineFlow({
        kind: "relay-incarnation",
        actions: {
          send: { inputSchema: z.object({}).passthrough(), block: sender },
          hold: { inputSchema: z.object({}).passthrough(), block: holder }
        },
        relay: { on: { question: { block: answerer, input: (m) => m.payload as object } } },
        // Session-keyed queue: the delivery waits behind the holder's key.
        request: { concurrency: { policy: "queue", key: "session" } }
      })
    );
    const router = createFlowApiRouter({ registry, stores });

    await seedSession(stores, "s_r", "relay-incarnation", {
      sessionKind: "top-level",
      lineageId: "lin_original"
    });

    // Start the long-running request that holds the recipient's key, then send.
    const holding = post(router, "relay-incarnation", "hold", {
      userId: "u_alice",
      sessionId: "s_r",
      input: {}
    });
    await new Promise((r) => setTimeout(r, 10));
    await post(router, "relay-incarnation", "send", {
      userId: "u_alice",
      sessionId: "s_s",
      input: {}
    });
    await holding;
    await settle();

    expect(sent.result).toMatchObject({ ok: true, outcome: "accepted" });

    // THE PROMISE: the handler did not run against the replacement…
    expect(received).toEqual([]);
    // …and the acceptance-time writes are reconciled, so the replacement session
    // exposes no request row for the dropped delivery and its message cannot
    // reach that session's reconstructed history.
    expect(deliveryId).toBeDefined();
    expect(await stores.request.get(deliveryId!)).toBeUndefined();
  });
});
