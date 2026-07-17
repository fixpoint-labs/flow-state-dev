/**
 * The DevTool bearer fetcher adds `Authorization: Bearer` to every request so a
 * bearer-gated flow accepts DevTool traffic (FIX-894).
 */
import { describe, it, expect, vi } from "vitest";
import { bearerFetcher } from "../src/react/lib/client";

describe("bearerFetcher", () => {
  it("returns undefined when no token is set (client uses its default)", () => {
    expect(bearerFetcher(undefined)).toBeUndefined();
    expect(bearerFetcher("")).toBeUndefined();
  });

  it("adds an Authorization: Bearer header, preserving existing headers", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    const fetcher = bearerFetcher("s3cret")!;

    await fetcher("/api/flows", { method: "POST", headers: { accept: "application/json" } });

    const [, init] = spy.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer s3cret");
    expect(headers.get("accept")).toBe("application/json");
    spy.mockRestore();
  });
});
