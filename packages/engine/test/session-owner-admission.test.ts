/**
 * A session another user owns is refused at admission, at the host seam, and
 * the refusal leaves every request record as it should.
 *
 * The HTTP answer (`404 Unknown session`) is covered by the two-users-one-tenant
 * suite in `@flow-state-dev/integration-tests`. These tests go under it, to
 * `host.dispatch`, for the two things a refusal must get right about the
 * records it did not come to write:
 *
 * - A refusal at admission wrote nothing, so it settles nothing. A caller that
 *   reuses the id of its own request still running elsewhere must not see
 *   that request marked failed by a dispatch that was never admitted.
 * - A queued run admitted into an unused session, whose session another user
 *   created while it waited, is refused when it starts. Its enqueue-time stub
 *   is its own and was acknowledged, so it is settled failed, never left
 *   `in_progress` for a client to poll forever.
 */
import { describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver,
  UserBindingMismatchError
} from "../src";
import { createInitialRequestRecord } from "../src/context/initial-request-record";
import type { FlowDispatcher } from "../src/transports/dispatcher";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";

const FLOW = "session-owner";
const TENANT = "tenant_shared";
const ORG = "org_shared";
const ALICE_SESSION = "s_7c1e";

const input = z.object({ text: z.string() });
const run = {
  inputSchema: input,
  userMessage: (value: { text: string }) => value.text,
  block: handler({ name: "session-owner-run", inputSchema: input, execute: () => ({}) })
};

/** Released by the test, to hold the one-lane key while it arranges a race. */
let releaseHolder: () => void = () => {};
/** Resolves once the holder's run is executing, and so holds the lane. */
let holderStarted: Promise<void> = Promise.resolve();
let markHolderStarted: () => void = () => {};

function buildHost(stores: StoreRegistry, dispatcher?: FlowDispatcher) {
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: FLOW,
      actions: {
        run,
        runQueued: { ...run, concurrency: { policy: "queue", key: "session" } },
        // Every dispatch of these two shares one lane, so a holder can keep a
        // queued run waiting in a session of its own.
        hold: {
          inputSchema: input,
          concurrency: { policy: "queue", key: () => "one-lane" },
          block: handler({
            name: "session-owner-hold",
            inputSchema: input,
            execute: () =>
              new Promise<object>((resolve) => {
                releaseHolder = () => resolve({});
                markHolderStarted();
              })
          })
        },
        runInLane: { ...run, concurrency: { policy: "queue", key: () => "one-lane" } }
      }
    })({ id: FLOW })
  );
  return createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {},
    ...(dispatcher === undefined ? {} : { dispatcher })
  });
}

function dispatch(
  host: ReturnType<typeof buildHost>,
  userId: string,
  action: "run" | "runQueued" | "hold" | "runInLane",
  sessionId: string,
  requestId: string
) {
  return host.dispatch({
    source: "http",
    flowKind: FLOW,
    action,
    input: { text: `${userId}'s note` },
    sessionId,
    requestId,
    tenantId: TENANT,
    orgId: ORG,
    principal: { userId, orgId: ORG }
  });
}

/** Alice's session, written as a completed run of hers leaves it. */
async function aliceHasSession(stores: StoreRegistry): Promise<void> {
  const handle = dispatch(buildHost(stores), "alice", "run", ALICE_SESSION, "req_alice");
  await handle.finished;
}

function aliceSessionRecord(): SessionRecord {
  const now = Date.now();
  return {
    id: `${TENANT}:${ALICE_SESSION}`,
    flowKind: FLOW,
    flowId: FLOW,
    userId: "alice",
    orgId: ORG,
    tenantId: TENANT,
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    journal: []
  } as SessionRecord;
}

/** A queue whose worker never claims the job. */
function externalDispatcher(): FlowDispatcher {
  return {
    dispatch: vi.fn(async (env) => ({
      requestId: env.requestId,
      finished: new Promise<never>(() => {}),
      abort: () => {}
    })),
    close: vi.fn(async () => {})
  };
}

describe("a dispatch into a session another user owns, at the host", () => {
  it.each([
    ["an in-process run", "run", undefined],
    ["a run queued behind its session", "runQueued", undefined],
    ["an external queue", "run", externalDispatcher]
  ] as const)(
    "leaves the caller's own running request under the reused id untouched, on %s",
    async (_label, action, makeDispatcher) => {
      const stores = createInMemoryStores();
      await aliceHasSession(stores);
      // Bob's own request, still running in his own session.
      const bobs = createInitialRequestRecord(
        {
          requestId: "req_bob",
          flowKind: FLOW,
          flowId: FLOW,
          actionName: "run",
          userId: "bob",
          sessionId: "s_bob",
          tenantId: TENANT,
          orgId: ORG,
          input: { text: "bob's note" }
        },
        Date.now()
      );
      await stores.request.set("req_bob", bobs, "absent");

      const host = buildHost(stores, makeDispatcher?.());
      const handle = dispatch(host, "bob", action, ALICE_SESSION, "req_bob");
      await expect(handle.accepted).rejects.toBeInstanceOf(UserBindingMismatchError);
      await handle.finished.catch(() => undefined);

      expect(await stores.request.get("req_bob")).toEqual(bobs);
    }
  );

  it("settles a queued run's stub failed when another user created its session while it waited", async () => {
    const stores = createInMemoryStores();
    const host = buildHost(stores);

    // Something else holds the lane, so Bob's run waits after its admission.
    holderStarted = new Promise<void>((resolve) => {
      markHolderStarted = resolve;
    });
    const holder = dispatch(host, "carol", "hold", "s_carol", "req_holder");
    await holderStarted;
    const bobs = dispatch(host, "bob", "runInLane", ALICE_SESSION, "req_bob");
    // Admitted and acknowledged: the session id was unused.
    await expect(bobs.accepted).resolves.toBeUndefined();
    expect((await stores.request.get("req_bob"))?.status).toBe("in_progress");

    // Alice creates the session under that id before Bob's run starts.
    await stores.session.set(`${TENANT}:${ALICE_SESSION}`, aliceSessionRecord(), "absent");
    releaseHolder();
    await holder.finished;

    await expect(bobs.finished).rejects.toBeInstanceOf(UserBindingMismatchError);
    const record = await stores.request.get("req_bob");
    expect(record?.status).toBe("failed");
    expect(await stores.activeRequests.get("req_bob")).toBeUndefined();
    // And nothing of Bob's reached Alice's session.
    const session = await stores.session.get(`${TENANT}:${ALICE_SESSION}`);
    expect(session?.version).toBe(0);
  });
});
