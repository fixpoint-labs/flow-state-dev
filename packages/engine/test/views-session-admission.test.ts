// FIX-2725 D1.
/**
 * A view's session reads, through the view route, answer only what the HTTP
 * session list would show the same caller.
 *
 * Why it matters: a roster flow's view lists sessions of another flow (the
 * agent flow). A caller the roster flow admits as alice, whom the agent
 * flow's own resolver refuses, must get none of the agent flow's sessions,
 * as the HTTP list gives none; nor alice's sessions in another org or
 * tenant, nor a write session. A refusal answers nothing and names no topic,
 * so the screen can't learn of a session it may not run in.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineView, handler } from "@flow-state-dev/core";
import { requestHostOf } from "@flow-state-dev/core/internal";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter } from "../src";
import { createInMemoryStores } from "../src/host";
import type { SessionRecord } from "../src/stores/types";

/** The roster's sign-in: the verified headers. */
const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  }
};
/** The agent flow's own sign-in: the same headers, and a second one it alone checks. */
const agentOnly = {
  resolvePrincipal: (context: { request?: Request }) => {
    if (context.request?.headers.get("x-agent-ok") !== "yes") return null;
    return verified.resolvePrincipal(context);
  }
};

const answer = z.object({ ids: z.array(z.string()), turns: z.number(), read: z.boolean() });

function flows(): { roster: FlowInstance; agent: FlowInstance } {
  const agent = defineFlow({
    kind: "agent",
    authentication: agentOnly,
    actions: { respond: { block: handler({ name: "respond", inputSchema: z.object({}), execute: () => ({ ok: true }) }) } }
  })() as unknown as FlowInstance;
  const roster = defineFlow({
    kind: "roster",
    authentication: verified,
    actions: {},
    views: {
      agentSessions: defineView({
        scope: "user",
        block: handler({
          name: "agent-sessions",
          inputSchema: z.object({ probe: z.string() }),
          outputSchema: answer,
          execute: async (input, ctx) => {
            const sessions = requestHostOf(ctx)!.sessions!;
            const listed = await sessions.list({ flowKind: "agent" });
            const turns = await sessions.turns([input.probe]);
            return { ids: listed.sessions.map((session) => session.id).sort(), turns: turns.length, read: (await sessions.read(input.probe)) !== undefined };
          }
        })
      }),
      // FIX-2754: the same list, asked for sessions by id.
      agentSessionsById: defineView({
        scope: "user",
        block: handler({
          name: "agent-sessions-by-id",
          inputSchema: z.object({ ids: z.array(z.string()) }),
          outputSchema: z.object({ ids: z.array(z.string()) }),
          execute: async (input, ctx) => {
            const listed = await requestHostOf(ctx)!.sessions!.list({ flowKind: "agent", ids: input.ids });
            return { ids: listed.sessions.map((session) => session.id).sort() };
          }
        })
      })
    }
  })() as unknown as FlowInstance;
  return { roster, agent };
}

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

async function boot() {
  const { roster, agent } = flows();
  const registry = createFlowRegistry();
  registry.register(roster);
  registry.register(agent);
  const stores = createInMemoryStores();
  const seed = (id: string, over: Partial<SessionRecord> = {}) =>
    stores.session.set(
      id,
      { id, orgId: "acme", flowKind: "agent", flowId: "agent", userId: "alice", state: {}, version: 0, createdAt: 1, updatedAt: 1, journal: [], lineageId: `lin_${id}`, ...over } as SessionRecord,
      "any"
    );
  await seed("mine");
  await seed("other-org", { orgId: "globex" });
  await seed("t2:other-tenant", { tenantId: "t2" });
  await seed("fsd-write.agent.x");
  await seed("bobs", { userId: "bob" });
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
  routers.push(router);
  return router;
}

async function post(router: ReturnType<typeof createFlowApiRouter>, name: string, input: unknown, headers: Record<string, string>) {
  const path = ["roster", "views", name];
  const response = await router.POST(
    new Request(`http://test/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-verified-user": "alice", "x-verified-org": "acme", ...headers },
      body: JSON.stringify({ input })
    }),
    { params: { path } }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { output: unknown; topics: unknown[] };
}

async function view(router: ReturnType<typeof createFlowApiRouter>, probe: string, headers: Record<string, string>) {
  return (await post(router, "agentSessions", { probe }, headers)) as { output: z.infer<typeof answer>; topics: unknown[] };
}

/** Every seeded session but alice's own, and one that doesn't exist. */
const NOT_HERS = ["other-org", "t2:other-tenant", "fsd-write.agent.x", "bobs", "missing"];

describe("a view's session reads take the HTTP list's admission", () => {
  it("answers alice her own agent session, and none in another org or tenant, and no write session", async () => {
    const router = await boot();
    const { output, topics } = await view(router, "mine", { "x-agent-ok": "yes" });
    expect(output).toEqual({ ids: ["mine"], turns: 0, read: true });
    expect(topics).toContainEqual({ scope: "session", id: "mine" });
  });

  it("answers nothing of the agent flow, and names none of its sessions, to a caller its own resolver refuses", async () => {
    const router = await boot();
    const { output, topics } = await view(router, "mine", {});
    expect(output).toEqual({ ids: [], turns: 0, read: false });
    expect(topics).toEqual([{ scope: "user" }]);
  });

  it("names no topic for a session of another org it was asked for by id", async () => {
    const router = await boot();
    const { output, topics } = await view(router, "other-org", { "x-agent-ok": "yes" });
    expect(output.read).toBe(false);
    expect(topics).not.toContainEqual({ scope: "session", id: "other-org" });
  });

  it("a list by ids answers alice her own session and none of the others she names, hearing only her user topic", async () => {
    const router = await boot();
    const { output, topics } = await post(router, "agentSessionsById", { ids: ["mine", ...NOT_HERS] }, { "x-agent-ok": "yes" });
    expect(output).toEqual({ ids: ["mine"] });
    expect(topics).toEqual([{ scope: "user" }]);
  });

  it("a list by ids answers nothing, and names no session, for another user's, a write or a missing id, or to a refused caller", async () => {
    const router = await boot();
    const others = await post(router, "agentSessionsById", { ids: NOT_HERS }, { "x-agent-ok": "yes" });
    expect(others).toMatchObject({ output: { ids: [] }, topics: [{ scope: "user" }] });
    const refused = await post(router, "agentSessionsById", { ids: ["mine"] }, {});
    expect(refused).toMatchObject({ output: { ids: [] }, topics: [{ scope: "user" }] });
  });
});
