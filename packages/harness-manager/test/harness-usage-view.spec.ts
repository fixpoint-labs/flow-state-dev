// FIX-2624.
/**
 * Usage read by scope and re-checked through its writer flow, over a real
 * router: the `usage` view answers the stored rows with no session, and
 * Re-check is a send to `harness-usage/**`, which its `runBy` flow runs in
 * the caller's own write session. Two users in one org and one in another
 * each read and change only their own rows, and Re-check asks a harness at
 * most once a minute per person.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import type { HarnessUsageReader, HarnessUsageReading } from "@flow-state-dev/core/harness";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { harnessUsageFlow } from "../src/harness-usage";
import { harnessUsageViewRef, recheckHarnessUsage } from "../src/browser";

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

const callers = { alice: "org-a", bob: "org-a", carol: "org-b" } as const;
type Caller = keyof typeof callers;

/** A reader that answers each caller's own plan, so a row shows whose reading it is. */
function perCaller() {
  const calls: string[] = [];
  let current: Caller = "alice";
  const reader: HarnessUsageReader = async () => {
    calls.push(current);
    const reading: HarnessUsageReading = {
      status: "windows",
      accountId: `acct-${current}`,
      plan: `plan-${current}`,
      windows: [{ id: "codex:primary", label: null, minutes: 300, usedPercent: 10, level: null, resetsAt: Date.now() + 3_600_000 }],
    };
    return reading;
  };
  return { reader, calls, as: (caller: Caller) => (current = caller) };
}

function host(readers: Record<string, HarnessUsageReader>) {
  const registry = createFlowRegistry();
  registry.register(harnessUsageFlow({ readers })() as never);
  const stores = createInMemoryStores();
  const signIn = (context: { request?: Request }) => {
    const user = context.request?.headers.get("x-user");
    return user == null ? null : { userId: user, orgId: callers[user as Caller] };
  };
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0, resolvePrincipal: signIn as never });
  routers.push(router);
  const clientOf = (userId: Caller) =>
    createClient({
      userId,
      fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(new URL(String(input instanceof Request ? input.url : input), "http://localhost"), init);
        request.headers.set("x-user", userId);
        const path = new URL(request.url).pathname.replace(/^\/api\/flows\//, "").split("/").map(decodeURIComponent);
        return request.method === "GET" ? router.GET(request, { params: { path } }) : router.POST(request, { params: { path } });
      },
    });
  return { stores, clientOf };
}

describe("usage, read as a view and re-checked through its writer flow", () => {
  it("lists a registered harness before anyone has re-checked, reads with no session, and starts no reader", async () => {
    const codex = perCaller();
    const { stores, clientOf } = host({ codex: codex.reader });
    const answer = await clientOf("alice").view(harnessUsageViewRef(), {});
    expect(answer.value.harnesses).toEqual([
      { harness: "codex", status: "unavailable", reason: "Not checked yet", plan: null, windows: [], checkedAt: null, ageMs: null, refreshError: null },
    ]);
    expect(codex.calls).toEqual([]);
    expect(await stores.session.list({ parentage: "all" } as never)).toEqual([]);
  });

  it("re-checks each caller's own row: a second user and a second org change and read only their own", async () => {
    const codex = perCaller();
    const { stores, clientOf } = host({ codex: codex.reader });
    for (const caller of ["alice", "bob", "carol"] as const) {
      codex.as(caller);
      await recheckHarnessUsage(clientOf(caller));
    }
    expect(codex.calls).toEqual(["alice", "bob", "carol"]);
    for (const caller of ["alice", "bob", "carol"] as const) {
      const [row] = (await clientOf(caller).view(harnessUsageViewRef(), {})).value.harnesses;
      expect(row).toMatchObject({ harness: "codex", status: "windows", plan: `plan-${caller}` });
    }
    // The reads made none; each writer's one session is the server's write session, never the client's.
    const sessions = await stores.session.list({ parentage: "all" } as never);
    expect(sessions.map((session) => session.userId).sort()).toEqual(["alice", "bob", "carol"]);
    for (const session of sessions) expect(session.id).toContain("fsd-write.");
  });

  it("asks a harness at most once a minute per person, however often Re-check is pressed", async () => {
    const codex = perCaller();
    const { stores, clientOf } = host({ codex: codex.reader });
    const alice = clientOf("alice");
    await recheckHarnessUsage(alice);
    await recheckHarnessUsage(alice);
    await Promise.all([recheckHarnessUsage(alice), recheckHarnessUsage(alice)]);
    expect(codex.calls).toEqual(["alice"]);
    // Bob's minute is his own.
    codex.as("bob");
    await recheckHarnessUsage(clientOf("bob"));
    expect(codex.calls).toEqual(["alice", "bob"]);
    // Four sends, one write session for Alice.
    const sessions = await stores.session.list({ parentage: "all" } as never);
    expect(sessions.filter((session) => session.userId === "alice")).toHaveLength(1);
  });
});
