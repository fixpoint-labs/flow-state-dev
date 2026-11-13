// FIX-2624.
/**
 * `client.resource(collection)`: a user or org collection's entries,
 * listed and read by scope and key with no session, and each written or
 * deleted through the collection's `runBy` flow at the version it read. What
 * matters to a caller: no session route is touched, an entry update another
 * write beat is re-read and re-applied, a stale delete is refused rather than
 * deleting a newer entry, and a named action reaches the collection's own flow.
 */
import { describe, expect, it, vi } from "vitest";
import { createClient, ResourceWriteError, type ClientFetch } from "../src";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Entry = { value: { name: string }; version: number };

const BASE = "/api/flows/resources/org/projects%2F*";

/**
 * A server holding one org collection. Each write settles as the default write
 * flow does: completed at the version read, else failed `stale_version`.
 * `interleave` lands another writer's rename just before the next `n` writes.
 */
function server(initial: Record<string, Entry>, options: { interleave?: number } = {}) {
  const stored = new Map(Object.entries(initial));
  let interleave = options.interleave ?? 0;
  const results = new Map<string, unknown>();
  const calls: Array<{ call: string; body?: unknown }> = [];
  let id = 0;
  const fetcher = vi.fn<ClientFetch>(async (input, init) => {
    const url = new URL(String(input), "http://x");
    const path = url.pathname;
    const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as { input: Record<string, unknown> });
    calls.push({ call: `${init?.method ?? "GET"} ${path}${url.search}`, body });
    if (path === `${BASE}/entries`) {
      const items = [...stored.entries()].map(([topic, entry]) => ({ topic, storageKey: `projects/${topic}`, ...entry }));
      return json({ items });
    }
    const one = new RegExp(`^${BASE.replace("*", "\\*")}/entries/(.+)$`).exec(path);
    if (one !== null) {
      const entry = stored.get(decodeURIComponent(one[1]!));
      return json(entry === undefined ? null : { topic: one[1], storageKey: `projects/${one[1]}`, ...entry });
    }
    const action = new RegExp(`^${BASE.replace("*", "\\*")}/actions/(\\w+)$`).exec(path);
    if (action !== null) {
      const requestId = `req_${++id}`;
      const name = action[1]!;
      const flow = name === "set" || name === "delete" ? "fsd-default-write" : "planner";
      const write = body!.input as { entry: string; state?: { name: string }; version: number };
      if (interleave > 0 && stored.has(write.entry)) {
        interleave -= 1;
        const current = stored.get(write.entry)!;
        stored.set(write.entry, { value: { name: `${current.value.name}+theirs` }, version: current.version + 1 });
      }
      const current = stored.get(write.entry);
      if (flow === "planner") {
        results.set(requestId, { status: "completed", result: { output: { planned: write }, hasOutput: true } });
      } else if (write.version !== (current?.version ?? 0)) {
        results.set(requestId, { status: "failed", result: { error: { code: "stale_version", message: "stale" } } });
      } else if (name === "delete") {
        stored.delete(write.entry);
        results.set(requestId, { status: "completed", result: { output: { version: write.version + 1 }, hasOutput: true } });
      } else {
        stored.set(write.entry, { value: write.state!, version: write.version + 1 });
        results.set(requestId, { status: "completed", result: { output: { version: write.version + 1 }, hasOutput: true } });
      }
      return json({ status: "in_progress", request: { id: requestId, flowKind: flow, flowId: flow, actionName: name, status: "in_progress" } }, 202);
    }
    const status = /\/api\/flows\/([\w-]+)\/requests\/(req_\d+)\/status/.exec(path);
    if (status !== null) {
      const settled = results.get(status[2]!) as { status: string; result: unknown };
      return json({ id: status[2], startedAtMs: 1, ageMs: 1, ...settled });
    }
    throw new Error(`unrouted ${path}`);
  });
  return { fetcher, calls, stored };
}

const projects = { scope: "org" as const, pattern: "projects/*", ClientType: { name: "" } };
const client = (fetcher: ClientFetch) => createClient({ userId: "alice", baseUrl: "", fetcher });

describe("client.resource on a collection", () => {
  it("lists entries and reads one by its topic with no session", async () => {
    const { fetcher, calls } = server({ p: { value: { name: "P" }, version: 2 } });
    const handle = client(fetcher).resource(projects);
    expect((await handle.list()).items).toEqual([{ topic: "p", storageKey: "projects/p", value: { name: "P" }, version: 2 }]);
    expect(await handle.entry("p").read()).toEqual({ value: { name: "P" }, version: 2 });
    expect(await handle.entry("q").read()).toEqual({ value: null, version: 0 });
    expect(calls.every(({ call }) => !call.includes("/sessions/"))).toBe(true);
  });

  it("re-reads and re-applies an entry update another write beat, so both changes land", async () => {
    const { fetcher, stored, calls } = server({ p: { value: { name: "P" }, version: 1 } }, { interleave: 1 });
    await client(fetcher).resource(projects).entry("p").update((value) => ({ name: `${value?.name}+mine` }));
    expect(stored.get("p")).toEqual({ value: { name: "P+theirs+mine" }, version: 3 });
    expect(calls.filter(({ call }) => call.endsWith("/actions/set")).map(({ body }) => body)).toEqual([
      { userId: "alice", input: { entry: "p", state: { name: "P+mine" }, version: 1 } },
      { userId: "alice", input: { entry: "p", state: { name: "P+theirs+mine" }, version: 2 } }
    ]);
  });

  it("creates an entry the updater sees as absent, at version 0", async () => {
    const { fetcher, stored } = server({});
    await client(fetcher).resource(projects).entry("new").update((value) => ({ name: value === null ? "fresh" : "seen" }));
    expect(stored.get("new")).toEqual({ value: { name: "fresh" }, version: 1 });
  });

  it("deletes an entry at the version it read, and rejects a stale delete instead of deleting a newer one", async () => {
    const { fetcher, stored } = server({ p: { value: { name: "P" }, version: 4 }, q: { value: { name: "Q" }, version: 1 } });
    const handle = client(fetcher).resource(projects);
    await handle.entry("p").delete();
    expect(stored.has("p")).toBe(false);
    const stale = handle.entry("q").delete({ version: 0 });
    await expect(stale).rejects.toBeInstanceOf(ResourceWriteError);
    await expect(stale).rejects.toMatchObject({ code: "stale_version" });
    expect(stored.has("q")).toBe(true);
  });

  it("sends a named action to the collection's own flow, with no session, and resolves to its output", async () => {
    const { fetcher, calls } = server({});
    const output = await client(fetcher).resource(projects).send("plan", { entry: "p", version: 0 });
    expect(output).toEqual({ planned: { entry: "p", version: 0 } });
    expect(calls[0]).toEqual({ call: `POST ${BASE}/actions/plan`, body: { userId: "alice", input: { entry: "p", version: 0 } } });
  });
});
