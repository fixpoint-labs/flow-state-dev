import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { abortConductorRequest } from "../src/conductor/dispatch";

function inProgressRecord(id: string, status: "in_progress" | "completed" = "in_progress") {
  const ts = Date.now();
  return {
    id,
    flowKind: "conductor",
    actionName: "wake",
    userId: "cli-user",
    source: "http" as const,
    status,
    startedAtMs: ts,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
  };
}

describe("abortConductorRequest", () => {
  it("stamps abortRequested on an in-progress record", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("req-live-1", inProgressRecord("req-live-1"), "any");

    await expect(abortConductorRequest(stores, "req-live-1")).resolves.toBe("signaled");
    await expect(stores.request.isAbortRequested("req-live-1")).resolves.toBe(true);
    const record = await stores.request.get("req-live-1");
    expect(record?.abortRequested).toBe(true);
  });

  it("returns not-running when the request is missing or already finished", async () => {
    const stores = createInMemoryStores();
    await expect(abortConductorRequest(stores, "req-missing")).resolves.toBe("not-running");

    await stores.request.set("req-done", inProgressRecord("req-done", "completed"), "any");
    await expect(abortConductorRequest(stores, "req-done")).resolves.toBe("not-running");
    await expect(stores.request.isAbortRequested("req-done")).resolves.toBe(false);
  });
});
