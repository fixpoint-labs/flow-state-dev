/**
 * One test per production path that mints a `SessionRecord` (FIX-1000).
 *
 * `storageGeneration` is optional on the type, deliberately: a missed mint site
 * degrades to legacy behaviour and breaks nothing observable, so the compiler
 * cannot be the completeness check. That makes a missed mint site **silent** —
 * the session simply goes unfenced, and every existing test stays green. These
 * are the substitute, one per path so a regression names the path it broke
 * instead of failing a single aggregate.
 *
 * The engine owns three of the five: the HTTP session route, the execution
 * context's implicit create, and the webhook session resolver. The other two
 * live with their packages — `packages/chat-sdk/test/session-generation-mint.test.ts`
 * and `packages/cli/test/session-generation-mint.test.ts` — because that is
 * where the code is, and a mint-site test that cannot import the site it
 * covers is a test of nothing.
 *
 * A path added later is not caught by these; that is the stated, accepted cost
 * of the optional field (§9). Adding the path means adding a case here.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createExecutionContext,
  createFlowRegistry,
  createInMemoryStores,
  resolveSessionResourceScopeId
} from "../src";
import type { SessionRecord } from "../src/stores/types";
import { handleCreateSession } from "../src/routes/session-routes";
import { ensureSessionForWebhook } from "../src/transports/webhook/session-resolver";

const FLOW_KIND = "mint-flow";

const flow = defineFlow({
  kind: FLOW_KIND,
  actions: {
    run: {
      inputSchema: z.string(),
      block: handler({ name: "noop", execute: () => "ok" })
    }
  }
})();

/**
 * The shared bar every mint path clears: a generation is present, it is a
 * non-empty string, and it actually moves the resource address off the record
 * key. The last clause is what makes this more than a field-presence check —
 * a generation that resolved back to the bare id would satisfy the first two
 * and fence nothing.
 */
function expectFenced(record: SessionRecord | undefined): string {
  expect(record).toBeDefined();
  const generation = record!.storageGeneration;
  expect(typeof generation).toBe("string");
  expect(generation!.length).toBeGreaterThan(0);
  expect(resolveSessionResourceScopeId(record!)).not.toBe(record!.id);
  return generation!;
}

describe("FIX-1000: every production session mint path fences its record", () => {
  it("HTTP session route — POST /:flowKind/sessions", async () => {
    const registry = createFlowRegistry();
    registry.register(flow);
    const stores = createInMemoryStores();

    const response = await handleCreateSession(
      new Request(`http://x/api/flows/${FLOW_KIND}/sessions`, {
        method: "POST",
        body: JSON.stringify({ sessionId: "sess_route", userId: "u1" })
      }),
      { kind: "create_session", flowKind: FLOW_KIND },
      { registry, stores }
    );
    expect(response.status).toBe(201);

    // Assert on the STORED record, not the response body: the body is a
    // projection and could carry a field the store dropped.
    expectFenced(await stores.session.get("sess_route"));
  });

  it("execution context — the implicit create for a session id with no record", async () => {
    const stores = createInMemoryStores();

    await createExecutionContext({
      flow: flow as never,
      actionName: "run",
      requestId: "req_1",
      sessionId: "sess_implicit",
      userId: "u1",
      stores
    } as never);

    expectFenced(await stores.session.get("sess_implicit"));
  });

  it("execution context — an ephemeral (session-less) run still fences its record", async () => {
    // `ephemeral_…` sessions get a record like any other and are not
    // special-cased (§9). Nothing else in the suite pins that.
    const stores = createInMemoryStores();

    const ctx = (await createExecutionContext({
      flow: flow as never,
      actionName: "run",
      requestId: "req_2",
      userId: "u1",
      stores
    } as never)) as { session: { identity: { id: string } } };

    const sessionId = ctx.session.identity.id;
    expect(sessionId.startsWith("ephemeral")).toBe(true);
    expectFenced(await stores.session.get(sessionId));
  });

  it("webhook session resolver — the first delivery for a derived session id", async () => {
    const stores = createInMemoryStores();

    await ensureSessionForWebhook({
      stores,
      sessionId: "customer-cus_123",
      flowKind: FLOW_KIND,
      principal: { userId: "u1" },
      provider: "stripe",
      eventType: "invoice.paid"
    });

    expectFenced(await stores.session.get("customer-cus_123"));
  });

  it("webhook session resolver — a redelivery reuses the record, so the generation is stable", async () => {
    // Re-minting on every delivery would give the same session a new address
    // each time and orphan everything the previous deliveries wrote. The
    // resolver's early return is what prevents that; this pins it.
    const stores = createInMemoryStores();
    const args = {
      stores,
      sessionId: "customer-cus_456",
      flowKind: FLOW_KIND,
      principal: { userId: "u1" },
      provider: "stripe",
      eventType: "invoice.paid"
    };

    await ensureSessionForWebhook(args);
    const first = expectFenced(await stores.session.get("customer-cus_456"));
    await ensureSessionForWebhook(args);
    const second = expectFenced(await stores.session.get("customer-cus_456"));

    expect(second).toBe(first);
  });

  it("a session loaded a second time keeps its generation — the address is stable per record", async () => {
    // The counterpart of the redelivery case for the execution context: a
    // second request against an existing session must not re-mint, or every
    // request would get a private scope.
    const stores = createInMemoryStores();

    await createExecutionContext({
      flow: flow as never,
      actionName: "run",
      requestId: "req_3",
      sessionId: "sess_stable",
      userId: "u1",
      stores
    } as never);
    const first = expectFenced(await stores.session.get("sess_stable"));

    await createExecutionContext({
      flow: flow as never,
      actionName: "run",
      requestId: "req_4",
      sessionId: "sess_stable",
      userId: "u1",
      stores
    } as never);
    const second = expectFenced(await stores.session.get("sess_stable"));

    expect(second).toBe(first);
  });
});
