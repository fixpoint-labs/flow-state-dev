/**
 * Per-flow voice-provider override (FIX-528). Verifies the host merges
 * `flow.voice.provider ?? runtimeConfig.voiceProvider` once at dispatch and
 * passes the effective value to `runAction` via `runtimeConfig.voiceProvider`,
 * while `host.resolvers.voice` keeps the router-level provider only.
 * `runAction` is mocked here to capture options without standing up a full
 * execution.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineFlow, handler, type VoiceProvider } from "@flow-state-dev/core";
import { z } from "zod";
import type { runAction } from "../../src/execution/runAction";

type RunActionOptions = Parameters<typeof runAction>[0];
const runActionMock = vi.fn((_options: RunActionOptions) =>
  Promise.resolve({ output: undefined, items: [], durationMs: 0 })
);
vi.mock("../../src/execution/runAction", () => ({
  runAction: (options: RunActionOptions) => runActionMock(options)
}));

/** The options `runAction` was called with; fails unless it was called exactly once. */
function onlyRunActionCall(): RunActionOptions {
  expect(runActionMock).toHaveBeenCalledTimes(1);
  return runActionMock.mock.calls[0]![0];
}

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
          block: handler({
            name: "voice-run",
            execute: (_input: { value: string }): { ok: true } => ({ ok: true })
          })
        }
      }
    })({ id: "voice-flow" })
  );
  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: { voiceProvider: opts.routerProvider }
  });
  return host;
}

function dispatch(host: ReturnType<typeof buildHost>) {
  return host.dispatch({
    source: "test",
    flowKind: "voice-flow",
    action: "run",
    input: { value: "hi" },
    principal: { userId: "u1", orgId: "org_test" }
  });
}

describe("per-flow voice provider override", () => {
  beforeEach(() => {
    runActionMock.mockClear();
  });

  it("flow.voice.provider wins over the router-level provider", async () => {
    const host = buildHost({ routerProvider: providerA, flowProvider: providerB });
    await dispatch(host).finished;
    expect(onlyRunActionCall().runtimeConfig).toMatchObject({
      voiceProvider: providerB
    });
  });

  it("falls back to the router-level provider when the flow has none", async () => {
    const host = buildHost({ routerProvider: providerA });
    await dispatch(host).finished;
    expect(onlyRunActionCall().runtimeConfig).toMatchObject({
      voiceProvider: providerA
    });
  });

  it("passes undefined when neither is set", async () => {
    const host = buildHost({});
    await dispatch(host).finished;
    expect(onlyRunActionCall().runtimeConfig.voiceProvider).toBeUndefined();
  });

  it("host.resolvers.voice holds the router-level provider regardless of override", () => {
    const host = buildHost({ routerProvider: providerA, flowProvider: providerB });
    expect(host.resolvers?.voice).toBe(providerA);
  });
});
