/**
 * Push delivery on `serve()` (FIX-2428): the Node host serves the socket on
 * `GET <basePath>/users/:userId/stream` with an upgrade, and the router it
 * fronts reports `push` and answers the mint. Real WebSocket clients against
 * a bound port.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler, topic } from "@flow-state-dev/core";
import type { PushMintAnswer, PushServerFrame } from "@flow-state-dev/core/internal";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { createServerApp } from "../src/app";
import { serve, type ServeHandle, type ServeOptions } from "../src/serve";

const chat = defineFlow({
  kind: "chat",
  actions: {
    say: handler({
        name: "chat-say",
        inputSchema: z.object({ text: z.string() }),
        execute: () => ({})
      })
  }
})();

const handles: ServeHandle[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function start(options: ServeOptions = {}): Promise<{ handle: ServeHandle; base: string; flowState: FlowState }> {
  const flowState = createFlowState({ flows: { chat }, stores: { default: { primary: inMemoryStores() } } });
  const handle = await serve(flowState, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200, ...options });
  handles.push(handle);
  return { handle, base: `http://127.0.0.1:${handle.port}`, flowState };
}

async function mint(base: string, topics: unknown[], apiPath = "/api/flows"): Promise<PushMintAnswer> {
  const response = await fetch(`${base}${apiPath}/users/alice/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topics })
  });
  expect(response.status).toBe(200);
  return (await response.json()) as PushMintAnswer;
}

/** Open a socket at `path` and collect what it hears. */
function open(base: string, path: string) {
  const socket = new WebSocket(`${base.replace(/^http/, "ws")}${path}`);
  sockets.push(socket);
  const frames: PushServerFrame[] = [];
  let closeCode: number | undefined;
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true });
  });
  const closed = new Promise<number>((resolve) => {
    socket.addEventListener("close", (event) => {
      closeCode = event.code;
      resolve(event.code);
    });
  });
  socket.addEventListener("message", (event) => frames.push(JSON.parse(String(event.data)) as PushServerFrame));
  return { socket, frames, opened, closed, closeCode: () => closeCode };
}

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("serve() push delivery", () => {
  it("reports the WebSocket push in capabilities, and none with push: false", async () => {
    const on = await start();
    expect(await (await fetch(`${on.base}/api/flows/capabilities`)).json()).toEqual({
      userStream: false,
      push: { transport: "websocket" }
    });
    const off = await start({ push: false });
    expect(await (await fetch(`${off.base}/api/flows/capabilities`)).json()).toEqual({ userStream: false, push: null });
    expect((await fetch(`${off.base}/api/flows/users/alice/stream`, { method: "POST", body: "{}" })).status).toBe(404);
  });

  it("delivers a change in a session to a socket subscribed through the mint", async () => {
    const { base } = await start();
    const created = await fetch(`${base}/api/flows/chat/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice" })
    });
    const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
    const answer = await mint(base, [topic.session(sessionId)]);
    expect(answer.transport).toBe("websocket");
    if (answer.transport !== "websocket") return;
    expect(answer.topics).toEqual([topic.session(sessionId)]);

    const ws = open(base, `/api/flows${answer.path}`);
    await ws.opened;
    ws.socket.send(JSON.stringify({ type: "subscribe", ticket: answer.ticket }));
    await until(() => ws.frames.length > 0);
    expect(ws.frames[0]).toEqual({ type: "subscribed" });

    await fetch(`${base}/api/flows/chat/${sessionId}/actions/say`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice", input: { text: "hi" } })
    });
    await until(() => ws.frames.some((frame) => frame.type === "notice"));
    const notice = ws.frames.find((frame) => frame.type === "notice");
    expect(notice).toMatchObject({ type: "notice", topic: { scope: "session", id: sessionId } });
  });

  it("serves the socket under a custom basePath, and nowhere else", async () => {
    const { base } = await start({ basePath: "/v1" });
    const answer = await mint(base, [topic.user()], "/v1");
    if (answer.transport !== "websocket") throw new Error("expected websocket");
    const ws = open(base, `/v1${answer.path}`);
    await ws.opened;
    const stray = open(base, `/api/flows${answer.path}`);
    await expect(stray.opened).rejects.toThrow();
  });

  it("closes a socket whose ticket names another user than its path", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { base } = await start();
    const answer = await mint(base, [topic.user()]);
    if (answer.transport !== "websocket") throw new Error("expected websocket");
    const ws = open(base, "/api/flows/users/bob/stream");
    await ws.opened;
    ws.socket.send(JSON.stringify({ type: "subscribe", ticket: answer.ticket }));
    expect(await ws.closed).toBe(4401);
  });

  it("accepts a ticket another process minted when both share pushSecret, and refuses it otherwise", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = await start({ pushSecret: "shared" });
    const b = await start({ pushSecret: () => "shared" });
    const c = await start();
    const answer = await mint(a.base, [topic.user()]);
    if (answer.transport !== "websocket") throw new Error("expected websocket");

    const onB = open(b.base, `/api/flows${answer.path}`);
    await onB.opened;
    onB.socket.send(JSON.stringify({ type: "subscribe", ticket: answer.ticket }));
    await until(() => onB.frames.length > 0);
    expect(onB.frames[0]).toEqual({ type: "subscribed" });

    const onC = open(c.base, `/api/flows${answer.path}`);
    await onC.opened;
    onC.socket.send(JSON.stringify({ type: "subscribe", ticket: answer.ticket }));
    expect(await onC.closed).toBe(4401);
  });

  it("accepts tickets on either of two hosts that serve one router, with no pushSecret", async () => {
    const flowState = createFlowState({ flows: { chat }, stores: { default: { primary: inMemoryStores() } } });
    const router = await flowState.getRouter();
    const options = { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200, disposeOnClose: false };
    const first = await serve(router, options);
    const second = await serve(router, options);
    handles.push(first, second);
    const bases = [first, second].map((handle) => `http://127.0.0.1:${handle.port}`);
    for (const mintOn of bases) {
      const answer = await mint(mintOn, [topic.user()]);
      if (answer.transport !== "websocket") throw new Error("expected websocket");
      for (const openOn of bases) {
        const ws = open(openOn, `/api/flows${answer.path}`);
        await ws.opened;
        ws.socket.send(JSON.stringify({ type: "subscribe", ticket: answer.ticket }));
        await until(() => ws.frames.length > 0 || ws.closeCode() !== undefined);
        expect(ws.closeCode()).toBeUndefined();
        expect(ws.frames[0]).toEqual({ type: "subscribed" });
      }
    }
  });

  it("reports and mints push only on the host that serves the socket, when two hosts share a router", async () => {
    const flowState = createFlowState({ flows: { chat }, stores: { default: { primary: inMemoryStores() } } });
    const router = await flowState.getRouter();
    const options = { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200, disposeOnClose: false };
    const withPush = await serve(router, options);
    const withoutPush = await serve(router, { ...options, push: false });
    handles.push(withPush, withoutPush);
    const on = `http://127.0.0.1:${withPush.port}`;
    const off = `http://127.0.0.1:${withoutPush.port}`;
    expect(await (await fetch(`${on}/api/flows/capabilities`)).json()).toEqual({ userStream: false, push: { transport: "websocket" } });
    expect(await (await fetch(`${off}/api/flows/capabilities`)).json()).toEqual({ userStream: false, push: null });
    const offMint = await fetch(`${off}/api/flows/users/alice/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topics: [topic.user()] })
    });
    expect(offMint.status).toBe(404);
    expect((await mint(on, [topic.user()])).transport).toBe("websocket");
  });

  it("takes the shared secret from FSD_PUSH_SECRET when pushSecret is not given", async () => {
    vi.stubEnv("FSD_PUSH_SECRET", "from-env");
    const a = await start();
    const b = await start({ pushSecret: "from-env" });
    const answer = await mint(a.base, [topic.user()]);
    if (answer.transport !== "websocket") throw new Error("expected websocket");
    const ws = open(b.base, `/api/flows${answer.path}`);
    await ws.opened;
    ws.socket.send(JSON.stringify({ type: "subscribe", ticket: answer.ticket }));
    await until(() => ws.frames.length > 0);
    expect(ws.frames[0]?.type).toBe("subscribed");
  });

  it("closes open sockets when the server closes", async () => {
    const { base, handle } = await start();
    const answer = await mint(base, [topic.user()]);
    if (answer.transport !== "websocket") throw new Error("expected websocket");
    const ws = open(base, `/api/flows${answer.path}`);
    await ws.opened;
    handles.splice(handles.indexOf(handle), 1);
    await handle.close();
    await ws.closed;
    expect(ws.closeCode()).toBeDefined();
  });

  it("leaves an upgrade on another path to another listener", async () => {
    const { base, handle } = await start();
    let heard = "";
    handle.server.on("upgrade", (req, socket) => {
      heard = req.url ?? "";
      socket.destroy();
    });
    const other = open(base, "/hmr");
    await expect(other.opened).rejects.toThrow();
    expect(heard).toBe("/hmr");
  });
});

describe("createServerApp", () => {
  it("reports no push over a router another host serves push for", async () => {
    const flowState = createFlowState({ flows: { chat }, stores: { default: { primary: inMemoryStores() } } });
    const router = await flowState.getRouter();
    const handle = await serve(router, { port: 0, host: "127.0.0.1", handleSignals: false, disposeOnClose: false });
    handles.push(handle);
    const { app } = createServerApp(router);
    const response = await app.fetch(new Request("http://localhost/api/flows/capabilities"));
    expect(await response.json()).toEqual({ userStream: false, push: null });
    const minted = await app.fetch(
      new Request("http://localhost/api/flows/users/alice/stream", { method: "POST", body: JSON.stringify({ topics: [] }) })
    );
    expect(minted.status).toBe(404);
  });

  it("serves no push: capabilities says so, with no socket to open", async () => {
    const flowState = createFlowState({ flows: { chat }, stores: { default: { primary: inMemoryStores() } } });
    const { app, dispose } = createServerApp(flowState);
    const response = await app.fetch(new Request("http://localhost/api/flows/capabilities"));
    expect(await response.json()).toEqual({ userStream: false, push: null });
    await dispose();
  });
});
