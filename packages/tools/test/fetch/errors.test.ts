import { describe, expect, it, vi, afterEach } from "vitest";
import { FlowError } from "@flow-state-dev/core";
import { builtinFetchAdapter } from "../../src/fetch/providers/builtin";
import {
  classifyFetchFailure,
  readTruncatedBody,
} from "../../src/fetch/errors";

describe("classifyFetchFailure", () => {
  it("classifies an aborted request", () => {
    expect(classifyFetchFailure(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(
      "abort"
    );
    expect(
      classifyFetchFailure(new Error("x", { cause: { code: "UND_ERR_ABORTED" } }))
    ).toBe("abort");
  });

  it("classifies timeouts from undici and system codes", () => {
    expect(
      classifyFetchFailure(new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }))
    ).toBe("timeout");
    expect(
      classifyFetchFailure(new TypeError("fetch failed", { cause: { code: "ETIMEDOUT" } }))
    ).toBe("timeout");
  });

  it("classifies socket/DNS failures as network", () => {
    expect(
      classifyFetchFailure(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }))
    ).toBe("network");
    expect(
      classifyFetchFailure(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }))
    ).toBe("network");
    // EAI_AGAIN is a transient DNS failure, not a timeout.
    expect(
      classifyFetchFailure(new TypeError("fetch failed", { cause: { code: "EAI_AGAIN" } }))
    ).toBe("network");
  });

  it("classifies a JSON parse failure", () => {
    expect(classifyFetchFailure(new SyntaxError("Unexpected token"))).toBe("parse");
  });

  it("returns unknown when no code is discoverable", () => {
    expect(classifyFetchFailure(new TypeError("fetch failed"))).toBe("unknown");
  });
});

describe("readTruncatedBody", () => {
  it("caps the body at the limit and marks truncation", async () => {
    const res = { text: () => Promise.resolve("x".repeat(2000)) } as unknown as Response;
    const body = await readTruncatedBody(res, 100);
    expect(body.length).toBeLessThan(2000);
    expect(body.endsWith("…[truncated]")).toBe(true);
  });

  it("returns an empty string when the body cannot be read", async () => {
    const res = { text: () => Promise.reject(new Error("reset")) } as unknown as Response;
    expect(await readTruncatedBody(res)).toBe("");
  });
});

describe("builtin adapter error shaping", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws a FlowError with HTTP details for a non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: () => Promise.resolve("Access denied by bot wall"),
    });

    const err = await builtinFetchAdapter
      .fetch("https://seekingalpha.com/symbol/ATI/", { waitForJS: false })
      .catch((e) => e);

    expect(err).toBeInstanceOf(FlowError);
    expect((err as FlowError).code).toBe("fetch_http_error");
    expect((err as FlowError).retryable).toBe(false);
    expect((err as FlowError).details).toMatchObject({
      errorType: "http",
      httpStatus: 403,
      httpStatusText: "Forbidden",
      responseBody: "Access denied by bot wall",
      url: "https://seekingalpha.com/symbol/ATI/",
    });
  });

  it("marks a 5xx response retryable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: () => Promise.resolve(""),
    });

    const err = (await builtinFetchAdapter
      .fetch("https://example.com", { waitForJS: false })
      .catch((e) => e)) as FlowError;

    expect(err.retryable).toBe(true);
    expect(err.details).toMatchObject({ errorType: "http", httpStatus: 503 });
  });

  it("marks a 429 rate-limited response retryable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: () => Promise.resolve("slow down"),
    });

    const err = (await builtinFetchAdapter
      .fetch("https://example.com", { waitForJS: false })
      .catch((e) => e)) as FlowError;

    expect(err.retryable).toBe(true);
    expect(err.details).toMatchObject({ errorType: "http", httpStatus: 429 });
  });

  it("throws a classified FlowError carrying the cause on a transport failure", async () => {
    const cause = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    globalThis.fetch = vi.fn().mockRejectedValue(cause);

    const err = (await builtinFetchAdapter
      .fetch("https://finance.yahoo.com/quote/ATI", { waitForJS: false })
      .catch((e) => e)) as FlowError;

    expect(err).toBeInstanceOf(FlowError);
    expect(err.code).toBe("fetch_transport_error");
    expect(err.retryable).toBe(true);
    expect(err.cause).toBe(cause);
    expect(err.details).toMatchObject({ errorType: "network" });
  });
});
