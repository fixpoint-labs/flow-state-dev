// FIX-2623.
/**
 * Views on the client: `client.view` calls the right route at the
 * view's scope and hands back value, topics and keys; `watchView` keeps one
 * live read per view, session and input in a client, shared by every watcher,
 * listening to the topics each answer names, with no loop of its own; a keyed
 * view's unchanged rows keep their identity.
 */
import { describe, expect, it, vi } from "vitest";
import { createClient, viewRef, type SubscribeOptions, type ViewResult, type WireNotice, type WireTopic } from "../src";
import { watchView, type ViewWatchClient } from "../src/view/view";

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("client.view", () => {
  function jsonClient(answer: unknown) {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "null")) });
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    });
    return { client: createClient({ userId: "alice", baseUrl: "http://h", fetcher }), calls };
  }

  it("calls a user or org view with no session in its address, and answers value, topics and keys", async () => {
    const { client, calls } = jsonClient({ output: [{ id: "a" }], topics: [{ scope: "user" }], keys: ["a"] });
    const result = await client.view(viewRef("roster", "list"), { team: "eng" });
    expect(calls[0]!.url).toBe("http://h/api/flows/roster/views/list");
    expect(calls[0]!.body).toMatchObject({ input: { team: "eng" } });
    expect(result).toEqual({ value: [{ id: "a" }], topics: [{ scope: "user" }], keys: ["a"] });
  });

  it("sends an explicit null input as null, and only an omitted one as {}", async () => {
    const { client, calls } = jsonClient({ output: null, topics: [] });
    await client.view(viewRef("desk", "maybe"), null as never);
    await client.view(viewRef("desk", "maybe"));
    expect(calls.map((call) => (call.body as { input: unknown }).input)).toEqual([null, {}]);
  });

  it("calls a session view on the session it names", async () => {
    const { client, calls } = jsonClient({ output: { ok: true }, topics: [] });
    await client.view(viewRef("desk", "board"), undefined, { sessionId: "s 1" });
    expect(calls[0]!.url).toBe("http://h/api/flows/desk/s%201/views/board");
    expect(calls[0]!.body).toMatchObject({ input: {} });
  });
});

type Held = { topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean };

function fakeViewClient(answer: () => ViewResult) {
  const held: Held[] = [];
  let views = 0;
  const client: ViewWatchClient = {
    view: async () => {
      views += 1;
      return answer();
    },
    subscribe: (topics, options) => {
      const entry: Held = { topics, options, closed: false };
      held.push(entry);
      return { close: () => void (entry.closed = true) };
    }
  };
  const notify = (notice: WireNotice | null) => {
    for (const entry of held) if (!entry.closed) entry.options.onChange(notice);
  };
  return { client, held, notify, views: () => views, open: () => held.filter((h) => !h.closed) };
}

const ROSTER = viewRef("roster", "list");

describe("watchView", () => {
  it("shares one read among watchers of the same view and input, and listens to the answer's topics", async () => {
    let n = 0;
    const fake = fakeViewClient(() => ({ value: { n }, topics: [{ scope: "user" }] }));
    const a: unknown[] = [];
    const b: unknown[] = [];
    const stopA = watchView(fake.client, ROSTER, { team: "eng" }, { onValue: (v) => a.push(v) }, { pollIntervalMs: null });
    const stopB = watchView(fake.client, ROSTER, { team: "eng" }, { onValue: (v) => b.push(v) }, { pollIntervalMs: null });
    await flush();
    // The first read names the topics; the live read subscribes them and reads once more.
    expect(fake.views()).toBe(2);
    expect(fake.open().map((h) => h.topics)).toEqual([[{ scope: "user" }]]);
    expect(a).toEqual([{ n: 0 }]);
    expect(b).toEqual([{ n: 0 }]);

    n = 1;
    fake.notify({ topic: { scope: "user" }, kind: "resource" });
    await flush();
    expect(fake.views()).toBe(3);
    expect(a).toEqual([{ n: 0 }, { n: 1 }]);
    expect(b).toEqual([{ n: 0 }, { n: 1 }]);

    stopA();
    expect(fake.open()).toHaveLength(1);
    stopB();
    expect(fake.open()).toHaveLength(0);
  });

  it("gives a late watcher the current value at once, with no read of its own", async () => {
    const fake = fakeViewClient(() => ({ value: "v", topics: [] }));
    watchView(fake.client, ROSTER, {}, {}, { pollIntervalMs: null });
    await flush();
    const before = fake.views();
    const late: unknown[] = [];
    watchView(fake.client, ROSTER, {}, { onValue: (v) => late.push(v) }, { pollIntervalMs: null });
    expect(late).toEqual(["v"]);
    expect(fake.views()).toBe(before);
  });

  it("reads separately for inputs that differ on the wire, as two dates do", async () => {
    const fake = fakeViewClient(() => ({ value: 1, topics: [] }));
    watchView(fake.client, ROSTER, { since: new Date("2026-01-01T00:00:00Z") }, {}, { pollIntervalMs: null });
    watchView(fake.client, ROSTER, { since: new Date("2026-02-01T00:00:00Z") }, {}, { pollIntervalMs: null });
    // The same input with its keys in another order is the same request, and shares.
    watchView(fake.client, ROSTER, { b: 1, a: 2 }, {}, { pollIntervalMs: null });
    watchView(fake.client, ROSTER, { a: 2, b: 1 }, {}, { pollIntervalMs: null });
    await flush();
    expect(fake.views()).toBe(3);
  });

  it("keeps a null input apart from an omitted one", async () => {
    const fake = fakeViewClient(() => ({ value: 1, topics: [] }));
    watchView(fake.client, ROSTER, null, {}, { pollIntervalMs: null });
    watchView(fake.client, ROSTER, undefined, {}, { pollIntervalMs: null });
    await flush();
    expect(fake.views()).toBe(2);
  });

  it("reads separately for another input or another session", async () => {
    const fake = fakeViewClient(() => ({ value: 1, topics: [] }));
    watchView(fake.client, ROSTER, { team: "eng" }, {}, { pollIntervalMs: null });
    watchView(fake.client, ROSTER, { team: "ops" }, {}, { pollIntervalMs: null });
    watchView(fake.client, ROSTER, { team: "eng" }, {}, { pollIntervalMs: null, sessionId: "s1" });
    await flush();
    expect(fake.views()).toBe(3);
  });

  it("keeps an unchanged keyed row as the same object across answers", async () => {
    let second = false;
    const fake = fakeViewClient(() =>
      second
        ? { value: [{ id: "a", n: 1 }, { id: "b", n: 9 }], topics: [{ scope: "user" }], keys: ["a", "b"] }
        : { value: [{ id: "a", n: 1 }, { id: "b", n: 2 }], topics: [{ scope: "user" }], keys: ["a", "b"] }
    );
    const seen: Array<Array<{ id: string }>> = [];
    watchView<Array<{ id: string }>>(fake.client, ROSTER, {}, { onValue: (v) => seen.push(v) }, { pollIntervalMs: null });
    await flush();
    second = true;
    fake.notify(null);
    await flush();
    const [first, next] = [seen[0]!, seen[seen.length - 1]!];
    expect(next[0]).toBe(first[0]);
    expect(next[1]).not.toBe(first[1]);
  });
});
