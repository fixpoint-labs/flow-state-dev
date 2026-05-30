import { describe, expect, it, vi, beforeEach } from "vitest";
import type { VoiceProvider } from "@flow-state-dev/core/types";
import { createInMemoryStores } from "../src/stores";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";
import { detectInterruptedRequests, retryRequest } from "../src/execution/request-recovery";

// retryRequest dispatches via runAction; mock it so the test asserts what
// retry hands off without executing a real flow.
const runActionMock = vi.fn(() => Promise.resolve(undefined));
vi.mock("../src/execution/runAction", () => ({
  runAction: (...args: unknown[]) => runActionMock(...args)
}));

function makeVoiceProvider(id: string): VoiceProvider {
  return {
    id,
    providerName: id,
    abilities: { speak: true, speakStream: false, transcribe: false, listVoices: false }
  };
}

function makeRequestRecord(
  id: string,
  overrides?: Partial<RequestRecord>
): RequestRecord {
  const ts = Date.now();
  return {
    id,
    flowKind: "chat",
    actionName: "run",
    userId: "user_1",
    status: "in_progress",
    startedAtMs: ts,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    ...overrides
  };
}

describe("detectInterruptedRequests", () => {
  let stores: StoreRegistry;

  beforeEach(() => {
    stores = createInMemoryStores();
  });

  it("marks stale in_progress requests as interrupted", async () => {
    // Register a stale active request
    await stores.activeRequests.register({
      requestId: "req_stale",
      flowKind: "chat",
      actionName: "run",
      userId: "user_1",
      startedAt: Date.now() - 60_000,
      lastHeartbeatAt: Date.now() - 60_000
    });

    // Create corresponding request record
    await stores.request.set("req_stale", makeRequestRecord("req_stale"), "any");

    const interrupted = await detectInterruptedRequests({
      stores,
      staleThresholdMs: 30_000
    });

    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].entry.requestId).toBe("req_stale");

    // Request record should be updated
    const record = await stores.request.get("req_stale");
    expect(record!.status).toBe("interrupted");
    expect(record!.interruptedAt).toBeDefined();

    // Entry should be deregistered
    const entry = await stores.activeRequests.get("req_stale");
    expect(entry).toBeUndefined();
  });

  it("does not mark already completed requests", async () => {
    await stores.activeRequests.register({
      requestId: "req_done",
      flowKind: "chat",
      actionName: "run",
      userId: "user_1",
      startedAt: Date.now() - 60_000,
      lastHeartbeatAt: Date.now() - 60_000
    });

    await stores.request.set(
      "req_done",
      makeRequestRecord("req_done", { status: "completed" })
    , "any");

    const interrupted = await detectInterruptedRequests({
      stores,
      staleThresholdMs: 30_000
    });

    // Entry is still deregistered (cleanup), but record status unchanged
    expect(interrupted).toHaveLength(1);
    const record = await stores.request.get("req_done");
    expect(record!.status).toBe("completed");
  });

  it("returns empty array when no stale entries exist", async () => {
    const interrupted = await detectInterruptedRequests({
      stores,
      staleThresholdMs: 30_000
    });

    expect(interrupted).toHaveLength(0);
  });

  it("filters by userId when provided", async () => {
    const longAgo = Date.now() - 60_000;

    await stores.activeRequests.register({
      requestId: "req_alice",
      flowKind: "chat",
      actionName: "run",
      userId: "alice",
      startedAt: longAgo,
      lastHeartbeatAt: longAgo
    });
    await stores.request.set(
      "req_alice",
      makeRequestRecord("req_alice", { userId: "alice" }),
      "any"
    );

    await stores.activeRequests.register({
      requestId: "req_bob",
      flowKind: "chat",
      actionName: "run",
      userId: "bob",
      startedAt: longAgo,
      lastHeartbeatAt: longAgo
    });
    await stores.request.set(
      "req_bob",
      makeRequestRecord("req_bob", { userId: "bob" }),
      "any"
    );

    const interrupted = await detectInterruptedRequests({
      stores,
      staleThresholdMs: 30_000,
      userId: "alice"
    });

    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].entry.requestId).toBe("req_alice");

    expect((await stores.request.get("req_alice"))!.status).toBe("interrupted");
    // Bob's untouched
    expect((await stores.request.get("req_bob"))!.status).toBe("in_progress");
    expect(await stores.activeRequests.get("req_bob")).toBeDefined();
  });

  it("prefers the per-flow voice provider over the router-level one on retry", async () => {
    // Regression: retry used to forward only the router-level provider, so a
    // flow that overrides TTS would synthesize with the wrong backend after
    // resume. retry must merge `flow.voice?.provider` first, mirroring normal
    // dispatch (createInboundTransportHost).
    runActionMock.mockClear();

    const routerProvider = makeVoiceProvider("router");
    const flowProvider = makeVoiceProvider("flow-override");

    await stores.request.set(
      "req_voice",
      makeRequestRecord("req_voice"),
      "any"
    );

    const flow = {
      kind: "chat",
      actions: { run: {} },
      voice: { provider: flowProvider }
    } as never;
    const flowRegistry = { get: vi.fn(() => flow) } as never;

    await retryRequest({
      originalRequestId: "req_voice",
      stores,
      flowRegistry,
      voiceProvider: routerProvider
    });

    expect(runActionMock).toHaveBeenCalledTimes(1);
    expect(runActionMock.mock.calls[0][0].voiceProvider).toBe(flowProvider);
  });

  it("falls back to the router-level voice provider when the flow declares none", async () => {
    runActionMock.mockClear();

    const routerProvider = makeVoiceProvider("router");

    await stores.request.set(
      "req_voice_fallback",
      makeRequestRecord("req_voice_fallback"),
      "any"
    );

    const flow = { kind: "chat", actions: { run: {} } } as never;
    const flowRegistry = { get: vi.fn(() => flow) } as never;

    await retryRequest({
      originalRequestId: "req_voice_fallback",
      stores,
      flowRegistry,
      voiceProvider: routerProvider
    });

    expect(runActionMock).toHaveBeenCalledTimes(1);
    expect(runActionMock.mock.calls[0][0].voiceProvider).toBe(routerProvider);
  });

  it("skips entries with recent heartbeats", async () => {
    await stores.activeRequests.register({
      requestId: "req_fresh",
      flowKind: "chat",
      actionName: "run",
      userId: "user_1",
      startedAt: Date.now(),
      lastHeartbeatAt: Date.now()
    });

    await stores.request.set("req_fresh", makeRequestRecord("req_fresh"), "any");

    const interrupted = await detectInterruptedRequests({
      stores,
      staleThresholdMs: 30_000
    });

    expect(interrupted).toHaveLength(0);

    // Request should still be in_progress
    const record = await stores.request.get("req_fresh");
    expect(record!.status).toBe("in_progress");
  });
});
