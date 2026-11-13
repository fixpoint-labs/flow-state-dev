// FIX-2623.
/**
 * Views on the client: `client.view` calls the right route at the
 * view's scope and hands back value, topics and keys; `watchView` keeps one
 * live read per view, session and input in a client, shared by every watcher,
 * listening to the topics each answer names, with no loop of its own; a keyed
 * view's unchanged rows keep their identity.
 */
import { describe, expect, it, vi } from "vitest";
import { createClient, viewRef, type SubscribeOptions, type ViewCallOptions, type ViewResult, type WireNotice, type WireTopic } from "../src";
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

  // FIX-2625 D1: the call carries the notice that woke it; a partial answer says so.
  it("sends the change a call answers for, and hands back a partial answer's removed keys", async () => {
    const { client, calls } = jsonClient({ output: [{ id: "b" }], topics: [{ scope: "user" }], keys: ["b"], partial: { removed: ["c"] } });
    const changed: WireNotice = { topic: { scope: "user", resource: "pins/b" }, kind: "resource", ids: ["pins/b", "pins/c"], origin: { requestId: "r1" } };
    const result = await client.view(viewRef("roster", "list"), {}, { changed });
    expect(calls[0]!.body).toMatchObject({ changed: { topic: changed.topic, kind: "resource", ids: ["pins/b", "pins/c"] } });
    expect(result).toEqual({ value: [{ id: "b" }], topics: [{ scope: "user" }], keys: ["b"], partial: { removed: ["c"] } });
  });

  it("sends no change for a notice with no ids", async () => {
    const { client, calls } = jsonClient({ output: [], topics: [], keys: [] });
    await client.view(viewRef("roster", "list"), {}, { changed: { topic: { scope: "user" }, kind: "resource" } });
    expect(calls[0]!.body).not.toHaveProperty("changed");
  });

  it("calls a session view on the session it names", async () => {
    const { client, calls } = jsonClient({ output: { ok: true }, topics: [] });
    await client.view(viewRef("desk", "board"), undefined, { sessionId: "s 1" });
    expect(calls[0]!.url).toBe("http://h/api/flows/desk/s%201/views/board");
    expect(calls[0]!.body).toMatchObject({ input: {} });
  });
});

type Held = { topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean };

function fakeViewClient(answer: (options?: ViewCallOptions) => ViewResult) {
  const held: Held[] = [];
  let views = 0;
  const calls: Array<ViewCallOptions | undefined> = [];
  const client: ViewWatchClient = {
    view: async (_ref, _input, options) => {
      views += 1;
      calls.push(options);
      return answer(options);
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
  return { client, held, notify, calls, views: () => views, open: () => held.filter((h) => !h.closed) };
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

  // FIX-2625: an answer says which notices change what its run read, so a write
  // to another resource of the scope, or a kind nothing it read changes on,
  // reads nothing.
  describe("the notices an answer says it hears", () => {
    const hearing = (): ViewResult => ({
      value: "v",
      topics: [{ scope: "user" }, { scope: "session", id: "s1", resource: "desk" }],
      hears: [
        { topic: { scope: "user" }, kinds: ["resource"], paths: ["workers"] },
        { topic: { scope: "session", id: "s1", resource: "desk" }, kinds: ["board"] }
      ]
    });

    it("reads on a resource under a root it read, a resource notice that names no path, and a board it read", async () => {
      const fake = fakeViewClient(hearing);
      watchView(fake.client, ROSTER, {}, {}, { pollIntervalMs: null });
      await flush();
      const settled = fake.views();
      for (const notice of [
        { topic: { scope: "user", resource: "workers" }, kind: "resource" },
        { topic: { scope: "user", resource: "workers/w1" }, kind: "resource" },
        { topic: { scope: "user" }, kind: "resource" },
        { topic: { scope: "session", id: "s1", resource: "desk" }, kind: "board", ids: ["t1"] }
      ] as WireNotice[]) {
        const before = fake.views();
        fake.notify(notice);
        await flush();
        expect(fake.views(), JSON.stringify(notice)).toBe(before + 1);
      }
      expect(fake.views()).toBe(settled + 4);
    });

    it("reads nothing for another resource, another kind, or another board", async () => {
      const fake = fakeViewClient(hearing);
      watchView(fake.client, ROSTER, {}, {}, { pollIntervalMs: null });
      await flush();
      const settled = fake.views();
      for (const notice of [
        { topic: { scope: "user", resource: "lab-pins" }, kind: "resource" },
        { topic: { scope: "user", resource: "workersX" }, kind: "resource" },
        { topic: { scope: "user" }, kind: "run" },
        { topic: { scope: "user" }, kind: "state" },
        { topic: { scope: "session", id: "s1", resource: "plan" }, kind: "board", ids: ["t1"] },
        { topic: { scope: "session", id: "s2", resource: "desk" }, kind: "board", ids: ["t1"] }
      ] as WireNotice[]) {
        fake.notify(notice);
        await flush();
      }
      expect(fake.views()).toBe(settled);
      // A resync still reads.
      fake.notify({ topic: { scope: "user" }, kind: "resync" });
      await flush();
      expect(fake.views()).toBe(settled + 1);
    });

    it("hears every notice under its topics from a server that names no hearing", async () => {
      const fake = fakeViewClient(() => ({ value: "v", topics: [{ scope: "user" }] }));
      watchView(fake.client, ROSTER, {}, {}, { pollIntervalMs: null });
      await flush();
      const settled = fake.views();
      fake.notify({ topic: { scope: "user" }, kind: "run" });
      await flush();
      expect(fake.views()).toBe(settled + 1);
    });
  });

  // FIX-2625 D1: a notice with ids asks the view for just the rows it touches;
  // the answer is placed by key over the rows held, so the screen equals a
  // whole read without one.
  describe("a partial answer", () => {
    type Entry = { id: string; n: number };
    /** A server holding `stored`: whole with no change, else just the ones named, and the named keys it no longer has. */
    function server(stored: Entry[]) {
      const fake = fakeViewClient((options) => {
        const ids = options?.changed?.ids;
        if (ids === undefined) return { value: stored.map((e) => ({ ...e })), topics: [{ scope: "user" }], keys: stored.map((e) => e.id) };
        const named = stored.filter((e) => ids.includes(e.id)).map((e) => ({ ...e }));
        return {
          value: named,
          topics: [{ scope: "user", resource: "extra" }],
          keys: named.map((e) => e.id),
          partial: { removed: ids.filter((id) => !stored.some((e) => e.id === id)) }
        };
      });
      return fake;
    }
    const change = (...ids: string[]): WireNotice => ({ topic: { scope: "user" }, kind: "resource", ids });

    it("asks for the named entries, places them by key, drops removed ones, appends new ones, and equals a whole read", async () => {
      const stored: Entry[] = [
        { id: "a", n: 1 },
        { id: "b", n: 2 },
        { id: "c", n: 3 }
      ];
      const fake = server(stored);
      const seen: Entry[][] = [];
      watchView<Entry[]>(fake.client, ROSTER, {}, { onValue: (v) => seen.push(v) }, { pollIntervalMs: null });
      await flush();
      const before = seen[seen.length - 1]!;

      stored[1] = { id: "b", n: 20 };
      stored.splice(2, 1);
      stored.push({ id: "d", n: 4 });
      fake.notify(change("b", "c", "d"));
      await flush();

      expect(fake.calls.filter((c) => c?.changed !== undefined).map((c) => c!.changed!.ids)).toEqual([["b", "c", "d"]]);
      const after = seen[seen.length - 1]!;
      expect(after).toEqual(stored);
      // A row the answer didn't carry is the object the screen already held.
      expect(after[0]).toBe(before[0]);
    });

    it("never stops listening to a topic a whole answer named", async () => {
      const fake = server([{ id: "a", n: 1 }]);
      watchView<Entry[]>(fake.client, ROSTER, {}, {}, { pollIntervalMs: null });
      await flush();
      fake.notify(change("a"));
      await flush();
      // The subscription the partial answer leads to keeps the whole answer's topic beside its own.
      const afterPartial = fake.held.find((h) => h.topics.some((t) => t.resource === "extra"));
      expect(afterPartial?.topics).toEqual(expect.arrayContaining([{ scope: "user" }, { scope: "user", resource: "extra" }]));
    });

    it("reads whole for a notice with no ids", async () => {
      const fake = server([{ id: "a", n: 1 }]);
      watchView<Entry[]>(fake.client, ROSTER, {}, {}, { pollIntervalMs: null });
      await flush();
      fake.notify({ topic: { scope: "user" }, kind: "resource" });
      await flush();
      const before = fake.calls.length;
      expect(before).toBeGreaterThan(1);
      expect(fake.calls.map((c) => c?.changed)).toEqual(fake.calls.map(() => undefined));
    });

    it("in development and tests, names the view whose partial answer differs from a whole run, and shows the whole one", async () => {
      const stored: Entry[] = [
        { id: "a", n: 1 },
        { id: "b", n: 2 }
      ];
      // A view that answers for the named row only, though the change also moved row "a".
      const fake = fakeViewClient((options) =>
        options?.changed === undefined
          ? { value: stored.map((e) => ({ ...e })), topics: [], keys: stored.map((e) => e.id) }
          : { value: [{ ...stored[1]! }], topics: [], keys: ["b"], partial: { removed: [] } }
      );
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const seen: Entry[][] = [];
      watchView<Entry[]>(fake.client, ROSTER, {}, { onValue: (v) => seen.push(v) }, { pollIntervalMs: null });
      await flush();
      stored[0] = { id: "a", n: 10 };
      stored[1] = { id: "b", n: 20 };
      fake.notify(change("b"));
      await flush();
      expect(seen[seen.length - 1]).toEqual(stored);
      expect(error.mock.calls.some((call) => String(call[0]).includes('"roster" view "list"'))).toBe(true);
      error.mockRestore();
    });
  });
});
