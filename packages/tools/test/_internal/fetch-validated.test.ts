/**
 * The time and size bounds of the built-in providers' fetch, against a real
 * HTTP server through the real fetch and dispatcher.
 *
 * The server listens on loopback, which the policy refuses, so the socket's
 * lookup is swapped for one that sends every name there. Everything else —
 * the deadline, the signal, the streamed body — is the production path.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/_internal/public-url", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/_internal/public-url")>();
  const loopback: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
    else callback(null, "127.0.0.1", 4);
  };
  return { ...original, publicAddressLookup: loopback };
});

const { fetchValidated, ResponseTooLargeError } = await import(
  "../../src/_internal/fetch-validated"
);

const routes: Record<string, (res: ServerResponse) => void> = {
  // Accepts the request and never answers.
  "/hang": () => {},
  // Sends headers and a first chunk, then stalls mid-body.
  "/trickle": (res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.write("<html>");
  },
  "/big": (res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("x".repeat(2048));
  },
  "/small": (res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<p>héllo</p>");
  },
};

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => routes[req.url ?? ""]?.(res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://site.test:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("fetchValidated bounds", () => {
  it("returns a body under the cap intact", async () => {
    const { body, finalUrl } = await fetchValidated(`${base}/small`, { maxBytes: 1024 });

    expect(body).toBe("<p>héllo</p>");
    expect(finalUrl).toBe(`${base}/small`);
  });

  it("times out a server that never answers", async () => {
    await expect(fetchValidated(`${base}/hang`, { timeoutMs: 100 })).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("times out a body that stalls after the headers", async () => {
    // The deadline covers reading the body, not just waiting for headers.
    await expect(fetchValidated(`${base}/trickle`, { timeoutMs: 100 })).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("cuts off a body past the byte cap", async () => {
    await expect(fetchValidated(`${base}/big`, { maxBytes: 1024 })).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });

  it("aborts when the run's signal aborts", async () => {
    const run = new AbortController();
    const pending = fetchValidated(`${base}/hang`, { signal: run.signal });
    setTimeout(() => run.abort(), 20);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
