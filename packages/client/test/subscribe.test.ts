/**
 * `client.subscribe` (FIX-2428): one socket per client, minted through the
 * client's own fetcher, and a timer wherever push can miss a change: no
 * push, the socket down, its bus not crossing processes, or a topic refused.
 *
 * `onChange` is passed the notice that woke it, and `null` for a connect, a
 * reconnect, a change of the crossing answer, or a poll.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, topic, type ClientFetch, type WireNotice, type WireTopic } from "../src";

/** A WebSocket double the test drives: open, deliver a frame, drop. */
class FakeSocket {
  static all: FakeSocket[] = [];
  /**
   * Acknowledge each ticket at once, as a server that subscribes it before
   * the next frame does. A test of the gap before the acknowledgement turns
   * it off and sends `subscribed` itself.
   */
  static autoAck = true;
  readonly sent: unknown[] = [];
  readyState = 0;
  closedWith: number | undefined;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string): void {
    const frame = JSON.parse(data) as { type: string };
    this.sent.push(frame);
    if (frame.type === "subscribe" && FakeSocket.autoAck) this.frame({ type: "subscribed" });
  }
  close(code = 1000): void {
    if (this.readyState === 3) return;
    this.closedWith = code;
    this.readyState = 3;
    this.emit("close", { code });
  }
  // --- the test's side ---
  open(): void {
    if (this.readyState === 1) return;
    this.readyState = 1;
    this.emit("open", {});
  }
  frame(frame: unknown): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.emit("close", { code });
  }
  /** A handshake that fails as Node's WebSocket reports it: an error, and no close. */
  fail(): void {
    this.emit("error", {});
  }
  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

type MintCall = { topics: WireTopic[]; authorization: string | null };

/** A server double: capabilities, and a mint that grants what `grant` allows. */
function server(
  options: {
    push?: unknown;
    grant?: (topic: WireTopic) => boolean;
    transport?: string;
    mintStatus?: () => number;
    /** A raw 200 body for the mint, in place of a real answer. */
    mintBody?: string;
    /** Hold a mint's answer until the promise this returns settles. */
    holdMint?: (topics: WireTopic[]) => Promise<void> | undefined;
  } = {}
) {
  const mints: MintCall[] = [];
  let ticket = 0;
  const fetcher: ClientFetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.endsWith("/capabilities")) {
      const body = options.push === undefined ? { userStream: false } : { userStream: false, push: options.push };
      return Response.json(body);
    }
    if (url.endsWith("/users/u1/stream") && init?.method === "POST") {
      const { topics } = JSON.parse(String(init.body)) as { topics: WireTopic[] };
      mints.push({ topics, authorization: headers.get("authorization") });
      await options.holdMint?.(topics);
      const status = options.mintStatus?.() ?? 200;
      if (status !== 200) return Response.json({ error: "no" }, { status });
      if (options.mintBody !== undefined) return new Response(options.mintBody, { status: 200 });
      const granted = topics.filter(options.grant ?? (() => true));
      if (options.transport === "ably") {
        return Response.json({ transport: "ably", tokenRequest: {}, channels: [], topics: granted });
      }
      ticket += 1;
      return Response.json({ transport: "websocket", ticket: `t${ticket}`, path: "/users/u1/stream", topics: granted });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  };
  const wrapped: ClientFetch = (input, init) =>
    fetcher(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: "Bearer secret" } });
  return { fetcher: wrapped, mints };
}

function client(fetcher: ClientFetch) {
  return createClient({ userId: "u1", baseUrl: "http://host:3000", fetcher });
}

/** Let promise chains settle without moving the clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await vi.advanceTimersByTimeAsync(0);
}

const S1 = topic.session("s1");
const notice = (topicValue: WireTopic, kind: WireNotice["kind"] = "items"): WireNotice => ({ topic: topicValue, kind });

beforeEach(() => {
  FakeSocket.all = [];
  FakeSocket.autoAck = true;
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Subscribe, let the mint answer, open the socket, and send `crosses`. */
async function connected(fsd: ReturnType<typeof client>, topics: WireTopic[], pollIntervalMs: number | undefined, crosses?: boolean) {
  const onChange = vi.fn();
  const sub = fsd.subscribe(topics, { onChange, ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}) });
  await settle();
  const socket = FakeSocket.all.at(-1)!;
  socket.open();
  if (crosses !== undefined) socket.frame({ type: "crossing", crosses });
  return { sub, onChange, socket };
}

describe("client.subscribe on a host with no push", () => {
  it("reads on its timer, passing null, and never mints or opens a socket", async () => {
    const { fetcher, mints } = server({ push: null });
    const onChange = vi.fn();
    client(fetcher).subscribe([S1], { onChange, pollIntervalMs: 1000 });
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange.mock.calls).toEqual([[null], [null], [null]]);
    expect(mints).toEqual([]);
    expect(FakeSocket.all).toEqual([]);
  });

  it("treats an older server with no push field as no push", async () => {
    const { fetcher, mints } = server();
    const onChange = vi.fn();
    client(fetcher).subscribe([S1], { onChange, pollIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(mints).toEqual([]);
  });

  it("with pollIntervalMs omitted, has no timer at all", async () => {
    const { fetcher } = server({ push: null });
    const onChange = vi.fn();
    client(fetcher).subscribe([S1], { onChange });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops reading once closed", async () => {
    const { fetcher } = server({ push: null });
    const onChange = vi.fn();
    const sub = client(fetcher).subscribe([S1], { onChange, pollIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    sub.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("client.subscribe on a host with push", () => {
  it("mints through the client's own fetcher, then sends the ticket as the socket's first message", async () => {
    const { fetcher, mints } = server({ push: { transport: "websocket" } });
    const { socket } = await connected(client(fetcher), [S1, topic.user()], 1000);
    expect(mints).toEqual([{ topics: [S1, topic.user()], authorization: "Bearer secret" }]);
    expect(socket.url).toBe("ws://host:3000/api/flows/users/u1/stream");
    expect(socket.sent[0]).toEqual({ type: "subscribe", ticket: "t1" });
  });

  it("runs onChange once on connect, and passes each notice that wakes it", async () => {
    const { fetcher } = server({ push: { transport: "websocket" } });
    const { onChange, socket } = await connected(client(fetcher), [S1], undefined, true);
    expect(onChange.mock.calls).toEqual([[null]]);
    socket.frame({ type: "notice", ...notice(S1, "request"), origin: { requestId: "r1" } });
    expect(onChange.mock.calls[1]).toEqual([{ topic: S1, kind: "request", origin: { requestId: "r1" } }]);
  });

  it("keeps reading on its timer until the first crossing frame says crosses: true, then stops", async () => {
    const { fetcher } = server({ push: { transport: "websocket" } });
    const { onChange, socket } = await connected(client(fetcher), [S1], 1000);
    onChange.mockClear();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onChange).toHaveBeenCalledTimes(2);
    socket.frame({ type: "crossing", crosses: true });
    onChange.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    // The change of the answer runs it once, as a connect does; no polls.
    expect(onChange.mock.calls).toEqual([]);
  });

  it("reads on its timer while the bus says it doesn't cross, and once on each change of the answer", async () => {
    const { fetcher } = server({ push: { transport: "websocket" } });
    const { onChange, socket } = await connected(client(fetcher), [S1], 1000, false);
    onChange.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange).toHaveBeenCalledTimes(3);
    onChange.mockClear();
    socket.frame({ type: "crossing", crosses: true });
    expect(onChange.mock.calls).toEqual([[null]]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange).toHaveBeenCalledTimes(1);
    socket.frame({ type: "crossing", crosses: false });
    expect(onChange).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("still runs onChange on a notice while it reads on its timer", async () => {
    const { fetcher } = server({ push: { transport: "websocket" } });
    const { onChange, socket } = await connected(client(fetcher), [S1], 1000, false);
    socket.frame({ type: "notice", ...notice(S1) });
    expect(onChange).toHaveBeenLastCalledWith(notice(S1));
  });

  it("passes a notice only to the subscriptions whose topics cover it", async () => {
    const { fetcher } = server({ push: { transport: "websocket" } });
    const fsd = client(fetcher);
    const whole = await connected(fsd, [S1], undefined, true);
    const tasks = vi.fn();
    fsd.subscribe([topic.session("s1", { resource: "tasks" })], { onChange: tasks });
    const other = vi.fn();
    fsd.subscribe([topic.session("s2")], { onChange: other });
    await settle();
    tasks.mockClear();
    other.mockClear();
    whole.onChange.mockClear();
    whole.socket.frame({ type: "notice", ...notice(topic.session("s1", { resource: "plan" })) });
    whole.socket.frame({ type: "notice", ...notice(topic.session("s1", { resource: "tasks" })) });
    expect(whole.onChange).toHaveBeenCalledTimes(2);
    expect(tasks.mock.calls).toEqual([[notice(topic.session("s1", { resource: "tasks" }))]]);
    expect(other).not.toHaveBeenCalled();
  });

  it("shares one socket across subscriptions, mints only what is new, and closes it with the last handle", async () => {
    const { fetcher, mints } = server({ push: { transport: "websocket" } });
    const fsd = client(fetcher);
    const first = await connected(fsd, [S1], undefined, true);
    const onChange = vi.fn();
    const second = fsd.subscribe([S1, topic.org()], { onChange });
    await settle();
    expect(FakeSocket.all).toHaveLength(1);
    expect(mints.map((call) => call.topics)).toEqual([[S1], [topic.org()]]);
    expect(first.socket.sent.at(-1)).toEqual({ type: "subscribe", ticket: "t2" });
    // Its connect: once, when the socket covers it.
    expect(onChange.mock.calls).toEqual([[null]]);

    second.close();
    expect(first.socket.sent.at(-1)).toEqual({ type: "unsubscribe", topics: [topic.org()] });
    expect(first.socket.closedWith).toBeUndefined();
    first.sub.close();
    expect(first.socket.closedWith).toBe(1000);
  });

  it("mints again on a reconnect, reads once, and reads on its timer from the first failed reconnect", async () => {
    let mintStatus = 200;
    const { fetcher, mints } = server({ push: { transport: "websocket" }, mintStatus: () => mintStatus });
    const { onChange, socket } = await connected(client(fetcher), [S1], 1000, true);
    onChange.mockClear();
    mintStatus = 503;
    socket.drop();
    await settle();
    // The first reconnect is tried at once, and failed: the timer is on.
    expect(mints).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange.mock.calls).toEqual([[null]]);
    mintStatus = 200;
    await vi.advanceTimersByTimeAsync(5000);
    const again = FakeSocket.all.at(-1)!;
    expect(again).not.toBe(socket);
    onChange.mockClear();
    again.open();
    again.frame({ type: "crossing", crosses: true });
    // The reconnect reads once; then push covers it and the timer stops.
    expect(onChange.mock.calls).toEqual([[null]]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("reads on its timer and retries when the handshake fails with an error and no close", async () => {
    const { fetcher, mints } = server({ push: { transport: "websocket" } });
    const onChange = vi.fn();
    client(fetcher).subscribe([S1], { onChange, pollIntervalMs: 1000 });
    await settle();
    FakeSocket.all.at(-1)!.fail();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange.mock.calls).toEqual([[null]]);
    expect(mints).toHaveLength(2);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("gives up on a handshake that never answers, and reads on its timer meanwhile", async () => {
    const { fetcher, mints } = server({ push: { transport: "websocket" } });
    const onChange = vi.fn();
    client(fetcher).subscribe([S1], { onChange, pollIntervalMs: 1000 });
    await settle();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeSocket.all[0]!.closedWith).toBeDefined();
    expect(onChange).toHaveBeenCalled();
    expect(mints.length).toBeGreaterThanOrEqual(2);
  });

  it("backs off 1, 2, 4, 8, 16 s across sockets that open and then have their ticket refused", async () => {
    FakeSocket.autoAck = false; // a refused ticket is never acknowledged
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetcher } = server({ push: { transport: "websocket" } });
    client(fetcher).subscribe([S1], { onChange: () => {}, pollIntervalMs: 60_000 });
    await settle();
    const gaps: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const socket = FakeSocket.all.at(-1)!;
      socket.open();
      socket.drop(4401);
      const count = FakeSocket.all.length;
      let waited = 0;
      while (FakeSocket.all.length === count && waited < 60_000) {
        await vi.advanceTimersByTimeAsync(500);
        waited += 500;
      }
      gaps.push(waited);
    }
    expect(gaps.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  it("reads on connect only once the server acknowledges the ticket, and keeps its timer until then", async () => {
    FakeSocket.autoAck = false;
    const { fetcher } = server({ push: { transport: "websocket" } });
    const onChange = vi.fn();
    client(fetcher).subscribe([S1], { onChange, pollIntervalMs: 1000 });
    await settle();
    const socket = FakeSocket.all.at(-1)!;
    socket.open();
    // A read now could finish before the server hears S1: a write in that
    // gap would be missed. So no connect read yet, and the timer runs.
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange.mock.calls).toEqual([[null]]);
    onChange.mockClear();
    socket.frame({ type: "subscribed" });
    socket.frame({ type: "crossing", crosses: true });
    // The connect read, after acceptance; the first crossing frame adds none.
    expect(onChange.mock.calls).toEqual([[null]]);
    onChange.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("covers a topic added to a live socket only once the server acknowledges its ticket", async () => {
    const { fetcher } = server({ push: { transport: "websocket" } });
    const fsd = client(fetcher);
    const first = await connected(fsd, [S1], undefined, true);
    FakeSocket.autoAck = false;
    const onChange = vi.fn();
    fsd.subscribe([topic.org()], { onChange, pollIntervalMs: 1000 });
    await settle();
    expect(first.socket.sent.at(-1)).toEqual({ type: "subscribe", ticket: "t2" });
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange.mock.calls).toEqual([[null]]);
    onChange.mockClear();
    first.socket.frame({ type: "subscribed" });
    expect(onChange.mock.calls).toEqual([[null]]);
    onChange.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("mints a topic again after a stop and reopen, though an older mint for it was still in flight", async () => {
    let release: (() => void) | undefined;
    const { fetcher, mints } = server({
      push: { transport: "websocket" },
      holdMint: (topics) =>
        topics.some((t) => t.scope === "org") && release === undefined
          ? new Promise<void>((resolve) => (release = resolve))
          : undefined
    });
    const fsd = client(fetcher);
    const first = await connected(fsd, [S1], undefined, true);
    const pending = fsd.subscribe([topic.org()], { onChange: () => {} });
    await settle();
    first.sub.close();
    pending.close();
    const second = await connected(fsd, [topic.user()], undefined, true);
    const onChange = vi.fn();
    fsd.subscribe([topic.org()], { onChange });
    await settle();
    release!();
    await settle();
    expect(mints.filter((call) => call.topics.some((t) => t.scope === "org"))).toHaveLength(2);
    expect(second.socket.sent.filter((frame) => (frame as { type: string }).type === "subscribe")).toHaveLength(2);
    expect(onChange.mock.calls).toEqual([[null]]);
  });

  it("drops a frame that isn't one the server sends", async () => {
    const { fetcher } = server({ push: { transport: "websocket" } });
    const { onChange, socket } = await connected(client(fetcher), [S1], undefined, true);
    onChange.mockClear();
    socket.frame({ type: "notice", topic: { scope: "session" }, kind: "items" });
    socket.frame({ type: "notice", kind: "items" });
    socket.frame({ type: "crossing", crosses: "yes" });
    socket.frame(["notice"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reconnects at once when the server ends the socket at its age limit", async () => {
    const { fetcher, mints } = server({ push: { transport: "websocket" } });
    const { socket } = await connected(client(fetcher), [S1], 1000, true);
    socket.drop(4000);
    await settle();
    expect(mints).toHaveLength(2);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("backs off, and reads on its timer, when the server refuses its ticket", async () => {
    const { fetcher, mints } = server({ push: { transport: "websocket" } });
    const { onChange, socket } = await connected(client(fetcher), [S1], 1000, true);
    onChange.mockClear();
    socket.drop(4401);
    await settle();
    expect(mints).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(mints).toHaveLength(2);
  });

  it("treats a refused topic as not covered: reads on its timer, and asks for it again at the poll pace", async () => {
    let allow = false;
    const { fetcher, mints } = server({ push: { transport: "websocket" }, grant: (t) => t.scope !== "session" || allow });
    const { onChange, socket } = await connected(client(fetcher), [S1], 1000, true);
    // A refused topic gets no connect read and is not heard.
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange.mock.calls).toEqual([[null]]);
    expect(mints.map((call) => call.topics)).toEqual([[S1], [S1]]);
    allow = true;
    onChange.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    // Granted on this retry: it reads once, as a connect, and its timer stops.
    expect(socket.sent.at(-1)).toEqual({ type: "subscribe", ticket: "t3" });
    expect(onChange.mock.calls).toEqual([[null], [null]]);
    onChange.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("with pollIntervalMs omitted, tries a refused topic again on reconnect only", async () => {
    let allow = false;
    const { fetcher, mints } = server({ push: { transport: "websocket" }, grant: () => allow });
    const { onChange, socket } = await connected(client(fetcher), [S1], undefined, true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mints).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
    allow = true;
    socket.drop();
    await settle();
    FakeSocket.all.at(-1)!.open();
    expect(onChange.mock.calls).toEqual([[null]]);
  });

  it("decides by the mint answer's transport, not the capabilities it read", async () => {
    const { fetcher } = server({ push: { transport: "ably" } });
    const { socket } = await connected(client(fetcher), [S1], 1000, true);
    expect(socket.sent[0]).toEqual({ type: "subscribe", ticket: "t1" });
  });

  it("reads on its timer when the mint answers a transport this client does not build (Ably)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetcher } = server({ push: { transport: "ably" }, transport: "ably" });
    const onChange = vi.fn();
    client(fetcher).subscribe([S1], { onChange, pollIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeSocket.all).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  for (const [name, body] of [
    ["no body", ""],
    ["a page that isn't JSON", "<html>bad gateway</html>"],
    ["JSON that isn't a mint answer", JSON.stringify({ transport: "websocket" })],
    ["JSON null", "null"]
  ] as const) {
    it(`reads on its timer, and never rejects, when the mint answers ${name}`, async () => {
      const { fetcher } = server({ push: { transport: "websocket" }, mintBody: body });
      const onChange = vi.fn();
      client(fetcher).subscribe([S1], { onChange, pollIntervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(2000);
      expect(FakeSocket.all).toEqual([]);
      expect(onChange.mock.calls).toEqual([[null], [null]]);
    });
  }

  it("keeps calling the other subscriptions when one onChange throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetcher } = server({ push: { transport: "websocket" } });
    const fsd = client(fetcher);
    fsd.subscribe([S1], {
      onChange: () => {
        throw new Error("boom");
      }
    });
    const { onChange, socket } = await connected(fsd, [S1], undefined, true);
    onChange.mockClear();
    socket.frame({ type: "notice", ...notice(S1) });
    expect(onChange).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
