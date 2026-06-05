/**
 * Node `http` ↔ Web `Request`/`Response` translation for the flow API.
 *
 * Extracted from the dev server's inline bridge (`packages/cli/.../dev.ts`) so
 * the same logic backs `fsdev dev` and any long-lived `serve()` host. It
 * converts an `IncomingMessage` to a Web `Request`, dispatches it to a
 * `FlowApiRouter`, and writes the `Response` back — streaming `text/event-stream`
 * bodies through unbuffered so SSE reaches the client chunk-by-chunk.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FlowApiRouter } from "@flow-state-dev/server";

/** Escape a string for safe use as a literal inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reads the full request body as a UTF-8 string. */
export function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Options for {@link handleApiRequest}. */
export interface HandleApiRequestOptions {
  /**
   * API mount prefix the router is served under (e.g. `"/api/flows"`). The
   * segments after this prefix become the router's `params.path`.
   */
  basePath: string;
  /**
   * Sink for errors thrown mid-SSE-stream after headers are already sent.
   * Client disconnects (`AbortError`) are swallowed regardless. Defaults to a
   * no-op; the dev server and `serve()` pass a stderr writer.
   */
  onStreamError?: (error: Error) => void;
}

/**
 * Convert a Node `IncomingMessage` to a Web `Request`, dispatch it to the
 * `FlowApiRouter`, and write the `Response` back to `res`.
 *
 * Handles GET/POST/PATCH/DELETE (reading a body for POST/PATCH), passes router
 * status and headers through verbatim, and streams `text/event-stream`
 * responses unbuffered (headers flushed immediately, body forwarded as it
 * arrives). Replies `405` for an unsupported method and `500` for a router
 * throw before headers are sent.
 */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  router: FlowApiRouter,
  options: HandleApiRequestOptions,
): Promise<void> {
  const { basePath, onStreamError } = options;
  const method = (req.method ?? "GET").toUpperCase();

  // Extract path segments after the mount prefix.
  const prefixPattern = new RegExp(`^${escapeRegExp(basePath)}/?`);
  const pathAfterPrefix = url.replace(prefixPattern, "");
  const [pathPart] = pathAfterPrefix.split("?", 2);
  const pathSegments = pathPart.split("/").filter((s) => s.length > 0);

  // Build the absolute URL for the Web Request (host is irrelevant downstream).
  const fullUrl = `http://localhost${url}`;

  // Read the request body for the methods that carry one.
  let body: string | undefined;
  if (method === "POST" || method === "PATCH") {
    body = await readRequestBody(req);
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }

  const webRequest = new Request(fullUrl, {
    method,
    headers,
    body: body !== undefined ? body : undefined,
  });

  const handler = router[method as keyof FlowApiRouter];
  if (handler === undefined) {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const webResponse = await handler(webRequest, {
      params: { path: pathSegments },
    });

    res.writeHead(
      webResponse.status,
      Object.fromEntries(webResponse.headers.entries()),
    );

    // Stream SSE responses unbuffered.
    const contentType = webResponse.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream") && webResponse.body !== null) {
      const reader = webResponse.body.getReader();
      const decoder = new TextDecoder();

      res.flushHeaders();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
        // Flush any bytes held back from an incomplete multibyte sequence.
        const finalChunk = decoder.decode();
        if (finalChunk) res.write(finalChunk);
      } catch (streamErr) {
        // Client disconnect is expected; surface anything else.
        if (streamErr instanceof Error && streamErr.name !== "AbortError") {
          onStreamError?.(streamErr);
        }
      } finally {
        res.end();
      }
      return;
    }

    // Regular response: buffer and write.
    const responseBody = await webResponse.text();
    res.end(responseBody);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Internal server error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } else if (!res.writableEnded) {
      // Headers were already flushed (e.g. reading a non-SSE body stream failed
      // mid-read), so we can't change the status — just close the socket so the
      // client isn't left waiting on a response that will never finish.
      res.end();
    }
  }
}
