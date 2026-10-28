/**
 * The request host's session read (FIX-2160 D2): a block checks a target
 * session of its principal before it writes anything to it.
 *
 * Why it matters: a message addressed to a session is refused before its row
 * when the session is not the sender's user's, in their tenant and org. The
 * read must answer those as it answers a missing session, so a refusal tells
 * nothing of another user's sessions, and must hand over only the markers the
 * session's flow declares readonly, never the rest of its state.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createInMemoryStores } from "../src/stores";
import { createRequestSessions } from "../src/context/request-sessions";
import { resolveSessionStorageKey } from "../src/stores/scope-keys";

const workerFlow = {
  id: "worker-1",
  kind: "worker",
  session: {
    stateSchema: z.object({
      workerId: z.string().readonly(),
      taskId: z.string().readonly().optional(),
      notes: z.string().optional(),
    }),
  },
} as unknown as FlowInstance;
const deskFlow = { id: "desk", kind: "desk", session: { stateSchema: z.object({ draft: z.string() }) } } as unknown as FlowInstance;

async function setup(tenantId: string | undefined = undefined) {
  const stores = createInMemoryStores();
  const seed = (id: string, over: Record<string, unknown> = {}) =>
    stores.session.set(
      resolveSessionStorageKey(id, (over.tenantId as string | undefined) ?? tenantId),
      {
        id: resolveSessionStorageKey(id, (over.tenantId as string | undefined) ?? tenantId),
        state: { workerId: "researcher", notes: "private", draft: "x" },
        version: 0,
        createdAt: 0,
        updatedAt: 0,
        flowKind: "worker",
        flowId: "worker-1",
        userId: "u1",
        orgId: "o1",
        ...(tenantId !== undefined ? { tenantId } : {}),
        journal: [],
        ...over,
      } as never,
      "any"
    );
  await seed("mine");
  await seed("theirs", { userId: "u2" });
  await seed("other-org", { orgId: "o2" });
  await seed("unbound", { orgId: undefined });
  await seed("legacy", { flowId: undefined, flowKind: "worker-1" });
  await seed("unregistered", { flowId: "gone", flowKind: "worker" });
  const sessions = createRequestSessions({
    sessions: stores.session,
    identity: { userId: "u1", tenantId, orgId: "o1" },
    flow: deskFlow,
    resolveFlow: (address) => (address === workerFlow.id ? workerFlow : undefined),
  });
  return { stores, sessions, seed };
}

describe("RequestHost.sessions.read", () => {
  it("answers a session of the principal's with its flow and only its readonly state", async () => {
    const { sessions } = await setup();
    expect(await sessions.read("mine")).toEqual({
      flowKind: "worker",
      flowId: "worker-1",
      state: { workerId: "researcher" },
    });
  });

  it("answers another user's, another org's, an unbound one and a missing one alike: absent", async () => {
    const { sessions } = await setup();
    for (const id of ["theirs", "other-org", "unbound", "missing", ""]) {
      expect(await sessions.read(id)).toBeUndefined();
    }
  });

  it("never answers another tenant's session, even under the same id and user", async () => {
    const { stores } = await setup("t1");
    const otherTenant = createRequestSessions({
      sessions: stores.session,
      identity: { userId: "u1", tenantId: "t2", orgId: "o1" },
      flow: deskFlow,
      resolveFlow: () => workerFlow,
    });
    expect(await otherTenant.read("mine")).toBeUndefined();
  });

  it("reads the readonly fields of the session's own flow, not the running one's", async () => {
    // The control for the cut: the running flow declares no readonly field,
    // so a read that used it would hand over nothing.
    const { sessions } = await setup();
    expect((await sessions.read("mine"))?.state).not.toHaveProperty("draft");
    expect((await sessions.read("mine"))?.state).toHaveProperty("workerId");
  });

  it("answers no state for a flow not registered here, and a legacy row by its singleton kind", async () => {
    const { sessions } = await setup();
    expect(await sessions.read("unregistered")).toEqual({ flowKind: "worker", flowId: "gone", state: {} });
    // A legacy row's kind names an instance of another kind here: not its owner.
    expect(await sessions.read("legacy")).toEqual({ flowKind: "worker-1", state: {} });
  });

  it("hands over a copy: changing the answer changes no record", async () => {
    const { stores, sessions } = await setup();
    const view = await sessions.read("mine");
    expect(Object.isFrozen(view?.state)).toBe(true);
    expect((await stores.session.get("mine"))?.state).toMatchObject({ workerId: "researcher", notes: "private" });
  });
});
