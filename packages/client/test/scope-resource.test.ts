// FIX-2624.
/**
 * `client.resource(def)`: a user or org resource read by scope and
 * key with no session, and written through its `runBy` flow at the version it
 * read. What matters to a caller: no session route is touched, a stale write is
 * re-read and re-applied (so two concurrent edits both land), and a write that
 * keeps losing, or that the server refuses for another reason, rejects with the
 * server's code instead of looping.
 */
import { describe, expect, it, vi } from "vitest";
import { createClient, ResourceWriteError, type ClientFetch } from "../src";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Stored = { value: { pinned: string[] }; version: number };

/**
 * A server holding one resource. Each write settles as the default write flow
 * does: completed at the version read, else failed `stale_version`. `interleave`
 * lands another writer's change just before the next `n` writes.
 */
function server(initial: Stored, options: { interleave?: number; refuse?: string } = {}) {
  let stored = initial;
  let interleave = options.interleave ?? 0;
  const results = new Map<string, unknown>();
  const urls: string[] = [];
  let id = 0;
  const fetcher = vi.fn<ClientFetch>(async (input, init) => {
    const url = new URL(String(input), "http://x");
    urls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/api/flows/resources/user/pins") return json(stored);
    if (url.pathname === "/api/flows/resources/user/pins/actions/set") {
      const body = JSON.parse(String(init?.body)) as { input: { state: { pinned: string[] }; version: number } };
      if (interleave > 0) {
        interleave -= 1;
        stored = { value: { pinned: [...stored.value.pinned, "theirs"] }, version: stored.version + 1 };
      }
      const requestId = `req_${++id}`;
      if (options.refuse !== undefined) {
        results.set(requestId, { status: "failed", result: { error: { code: options.refuse, message: "no" } } });
      } else if (body.input.version !== stored.version) {
        results.set(requestId, { status: "failed", result: { error: { code: "stale_version", message: "stale" } } });
      } else {
        stored = { value: body.input.state, version: stored.version + 1 };
        results.set(requestId, { status: "completed", result: { output: { version: stored.version }, hasOutput: true } });
      }
      return json({ status: "in_progress", request: { id: requestId, flowKind: "fsd-default-write", flowId: "fsd-default-write", actionName: "set", status: "in_progress" } }, 202);
    }
    const status = /\/api\/flows\/fsd-default-write\/requests\/(req_\d+)\/status/.exec(url.pathname);
    if (status !== null) {
      const settled = results.get(status[1]!) as { status: string; result: unknown };
      return json({ id: status[1], startedAtMs: 1, ageMs: 1, ...settled });
    }
    throw new Error(`unrouted ${url.pathname}`);
  });
  return { fetcher, urls, stored: () => stored };
}

const pins = { scope: "user" as const, ref: "pins", ClientType: { pinned: [] as string[] } };
const client = (fetcher: ClientFetch) => createClient({ userId: "alice", baseUrl: "", fetcher });

describe("client.resource", () => {
  it("reads by scope and key with no session", async () => {
    const { fetcher, urls } = server({ value: { pinned: ["a"] }, version: 3 });
    expect(await client(fetcher).resource(pins).state()).toEqual({ pinned: ["a"] });
    expect(urls).toEqual(["GET /api/flows/resources/user/pins"]);
  });

  it("re-reads and re-applies an update another write beat, so both changes land", async () => {
    const { fetcher, stored, urls } = server({ value: { pinned: ["a"] }, version: 1 }, { interleave: 1 });
    await client(fetcher).resource(pins).update((s) => ({ pinned: [...s.pinned, "mine"] }));
    expect(stored().value.pinned).toEqual(["a", "theirs", "mine"]);
    expect(urls.some((url) => url.includes("/sessions/"))).toBe(false);
  });

  it("gives up after three stale writes with the conflict", async () => {
    const { fetcher } = server({ value: { pinned: [] }, version: 0 }, { interleave: 5 });
    const update = client(fetcher).resource(pins).update((s) => s);
    await expect(update).rejects.toBeInstanceOf(ResourceWriteError);
    await expect(update).rejects.toMatchObject({ code: "stale_version" });
  });

  it("rejects a refusal other than a stale version at once, with its code", async () => {
    const { fetcher, urls } = server({ value: { pinned: [] }, version: 0 }, { refuse: "write_refused" });
    await expect(client(fetcher).resource(pins).update((s) => s)).rejects.toMatchObject({ code: "write_refused" });
    expect(urls.filter((url) => url.endsWith("/actions/set"))).toHaveLength(1);
  });

  it("refuses a session resource before sending anything", () => {
    expect(() => client(vi.fn()).resource({ scope: "session", ref: "draft" })).toThrow(/user or org/);
  });

  it("asks a flow who the caller is, with no session", async () => {
    const fetcher = vi.fn<ClientFetch>(async () => json({ userId: "alice", orgId: "org-a" }));
    expect(await client(fetcher).flow("threads").identity()).toEqual({ userId: "alice", orgId: "org-a" });
    expect(String(fetcher.mock.calls[0]![0])).toContain("/api/flows/threads/identity");
  });
});
