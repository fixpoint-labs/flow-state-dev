/**
 * Per-flow voice-provider override (FIX-528). Verifies the host merges
 * `flow.voice.provider ?? voiceProvider` once at dispatch and passes the
 * effective value to `runAction`, while `host.resolvers.voice` keeps the
 * router-level provider only. `runAction` is mocked here to capture options
 * without standing up a full execution.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineFlow, handler, type VoiceProvider } from "@flow-state-dev/core";
import { z } from "zod";

const runActionMock = vi.fn(() =>
  Promise.resolve({ output: undefined, items: [], durationMs: 0 })
);
vi.mock("../../src/execution/runAction", () => ({
  runAction: (opts: unknown) => runActionMock(opts as never)
}));

import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver
} from "../../src";

function provider(id: string): VoiceProvider {
  return {
    id,
    providerName: id,
    abilities: { speak: true, speakStream: false, transcribe: true, listVoices: false }
  };
}

const providerA = provider("router-A");
const providerB = provider("flow-B");

function buildHost(opts: { routerProvider?: VoiceProvider; flowProvider?: VoiceProvider }) {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(
    defineFlow({
      kind: "voice-flow",
      voice: opts.flowProvider ? { provider: opts.flowProvider } : undefined,
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler<{ value: string }, { ok: true }>({
            name: "voice-run",
            execute: () => ({ ok: true })
          })
        }
      }
    })({ id: "voice-flow" })
  );
  const host = createInboundTransportHost({
    registry,
    stores,
    voiceProvider: opts.routerProvider,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver
  });
  return host;
}

function dispatch(host: ReturnType<typeof buildHost>) {
  return host.dispatch({
    source: "test",
    flowKind: "voice-flow",
    action: "run",
    input: { value: "hi" },
    principal: { userId: "u1" }
  });
}

describe("per-flow voice provider override", () => {
  beforeEach(() => {
    runActionMock.mockClear();
  });

  it("flow.voice.provider wins over the router-level provider", async () => {
    const host = buildHost({ routerProvider: providerA, flowProvider: providerB });
    await dispatch(host).finished;
    expect(runActionMock).toHaveBeenCalledTimes(1);
    expect(runActionMock.mock.calls[0][0]).toMatchObject({ voiceProvider: providerB });
  });

  it("falls back to the router-level provider when the flow has none", async () => {
    const host = buildHost({ routerProvider: providerA });
    await dispatch(host).finished;
    expect(runActionMock.mock.calls[0][0]).toMatchObject({ voiceProvider: providerA });
  });

  it("passes undefined when neither is set", async () => {
    const host = buildHost({});
    await dispatch(host).finished;
    expect(runActionMock.mock.calls[0][0].voiceProvider).toBeUndefined();
  });

  it("host.resolvers.voice holds the router-level provider regardless of override", () => {
    const host = buildHost({ routerProvider: providerA, flowProvider: providerB });
    expect(host.resolvers?.voice).toBe(providerA);
  });
});
