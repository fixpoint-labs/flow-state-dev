/**
 * Next.js App Router handler for Bull Board.
 *
 * Bridges the Express-based Bull Board adapter to the Web API
 * Request/Response surface that Next.js App Router expects.
 */
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { bullBoardApp } from "@/lib/bull-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const body =
    req.method !== "GET" && req.method !== "HEAD"
      ? Buffer.from(await req.arrayBuffer())
      : undefined;

  return new Promise<Response>((resolve) => {
    const socket = new Socket({ readable: false, writable: false });
    const nodeReq = new IncomingMessage(socket);
    nodeReq.method = req.method;
    nodeReq.url = url.pathname + url.search;
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k] = v;
    });
    nodeReq.headers = headers;
    if (body) nodeReq.push(body);
    nodeReq.push(null);

    const nodeRes = new ServerResponse(nodeReq);
    const chunks: Uint8Array[] = [];

    nodeRes.write = function (chunk: unknown): boolean {
      if (chunk) {
        chunks.push(
          typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer)
        );
      }
      return true;
    } as typeof nodeRes.write;

    nodeRes.end = function (chunk?: unknown): ServerResponse {
      if (chunk) {
        chunks.push(
          typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer)
        );
      }
      const responseHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(nodeRes.getHeaders())) {
        if (v != null)
          responseHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v);
      }
      // The Web Response constructor forbids a body on "null body status"
      // codes (101, 103, 204, 205, 304). Bull Board's static asset serving
      // returns 304 on conditional requests, so pass null instead of an
      // (empty) buffer to avoid a TypeError that escapes as an uncaughtException.
      const nullBodyStatus = new Set([101, 103, 204, 205, 304]);
      const responseBody = nullBodyStatus.has(nodeRes.statusCode)
        ? null
        : Buffer.concat(chunks);
      resolve(
        new Response(responseBody, {
          status: nodeRes.statusCode,
          headers: responseHeaders,
        })
      );
      socket.destroy();
      return nodeRes;
    } as typeof nodeRes.end;

    bullBoardApp(nodeReq as never, nodeRes as never);
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
