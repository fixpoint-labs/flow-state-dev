import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import type { FlowApiRouter } from "@flow-state-dev/server";
import { handleApiRequest } from "../src/bridge";

/** Build a fake IncomingMessage backed by a Readable for the body. */
function makeReq(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}) {
  const stream = Readable.from(
    opts.body !== undefined ? [Buffer.from(opts.body)] : [],
  );
  return Object.assign(stream, {
    method: opts.method,
    url: opts.url,
    headers: opts.headers ?? {},
  }) as never;
}

/** Build a fake ServerResponse capturing status, headers, body, and write calls. */
function makeRes() {
  const chunks: string[] = [];
  const state = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    headersSent: false,
    flushed: false,
    writeCount: 0,
    ended: false,
  };
  const res = {
    get headersSent() {
      return state.headersSent;
    },
    writeHead(status: number, headers?: Record<string, string>) {
      state.statusCode = status;
      if (headers) state.headers = { ...state.headers, ...headers };
      state.headersSent = true;
      return res;
    },
    flushHeaders() {
      state.flushed = true;
      state.headersSent = true;
    },
    write(chunk: string | Buffer) {
      state.writeCount += 1;
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    },
    end(body?: string | Buffer) {
      if (body !== undefined) {
        chunks.push(typeof body === "string" ? body : body.toString());
      }
      state.ended = true;
      return res;
    },
    state,
    get body() {
      return chunks.join("");
    },
  };
  return res;
}

/** A router that reflects what it received, for asserting the bridge's translation. */
const echoRouter: FlowApiRouter = {
  GET: async (_req, ctx) =>
    new Response(JSON.stringify({ method: "GET", path: ctx.params.path }), {
      status: 200,
      headers: { "content-type": "application/json", "x-custom": "1" },
    }),
  POST: async (req, ctx) =>
    new Response(
      JSON.stringify({ method: "POST", path: ctx.params.path, body: await req.text() }),
      { status: 201, headers: { "content-type": "application/json" } },
    ),
  PATCH: async () => new Response("patched", { status: 200 }),
  DELETE: async () => new Response(null, { status: 204 }),
};

const base = { basePath: "/api/flows" };

describe("handleApiRequest — translation", () => {
  it("derives path segments after the basePath and passes status/headers through", async () => {
    const req = makeReq({ method: "GET", url: "/api/flows/chat/actions/send?x=1" });
    const res = makeRes();

    await handleApiRequest(req, res as never, req.url, echoRouter, base);

    expect(res.state.statusCode).toBe(200);
    expect(res.state.headers["content-type"]).toContain("application/json");
    // header passthrough is verbatim
    expect(res.state.headers["x-custom"]).toBe("1");
    expect(JSON.parse(res.body)).toEqual({
      method: "GET",
      path: ["chat", "actions", "send"],
    });
  });

  it("reads the body for POST and forwards it to the router", async () => {
    const payload = JSON.stringify({ hello: "world" });
    const req = makeReq({
      method: "POST",
      url: "/api/flows/chat/actions/send",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    const res = makeRes();

    await handleApiRequest(req, res as never, req.url, echoRouter, base);

    expect(res.state.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({
      method: "POST",
      path: ["chat", "actions", "send"],
      body: payload,
    });
  });

  it("replies 405 for a method the router does not handle", async () => {
    const req = makeReq({ method: "PUT", url: "/api/flows/chat" });
    const res = makeRes();

    await handleApiRequest(req, res as never, req.url, echoRouter, base);

    expect(res.state.statusCode).toBe(405);
  });

  it("replies 500 when the router throws before headers are sent", async () => {
    const throwing: FlowApiRouter = {
      ...echoRouter,
      GET: async () => {
        throw new Error("boom");
      },
    };
    const req = makeReq({ method: "GET", url: "/api/flows/chat" });
    const res = makeRes();

    await handleApiRequest(req, res as never, req.url, throwing, base);

    expect(res.state.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toBe("boom");
  });

  it("ends the response when a non-SSE body read fails after headers are sent", async () => {
    // A regular (non-SSE) response whose body stream errors mid-read: headers
    // are already flushed, so the bridge can't change the status — it must still
    // close the socket so the client isn't left hanging.
    const failingBody: FlowApiRouter = {
      ...echoRouter,
      GET: async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("read failed"));
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
    const req = makeReq({ method: "GET", url: "/api/flows/chat" });
    const res = makeRes();

    await handleApiRequest(req, res as never, req.url, failingBody, base);

    expect(res.state.headersSent).toBe(true);
    expect(res.state.ended).toBe(true);
  });
});

describe("handleApiRequest — SSE streaming", () => {
  it("flushes headers and forwards each chunk unbuffered", async () => {
    const events = ["data: a\n\n", "data: b\n\n", "data: c\n\n"];
    const sseRouter: FlowApiRouter = {
      ...echoRouter,
      GET: async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const e of events) controller.enqueue(encoder.encode(e));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    };
    const req = makeReq({ method: "GET", url: "/api/flows/chat/stream" });
    const res = makeRes();

    await handleApiRequest(req, res as never, req.url, sseRouter, base);

    // headers flushed before the body (so the client sees the stream open)
    expect(res.state.flushed).toBe(true);
    // one write() per source chunk — proves it isn't buffered into one write
    expect(res.state.writeCount).toBe(events.length);
    expect(res.body).toBe(events.join(""));
    expect(res.state.ended).toBe(true);
  });
});
