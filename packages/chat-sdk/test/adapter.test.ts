/**
 * Smoke tests for `createChatTransportAdapter`. Cover the adapter
 * shape, route enumeration from `bot.webhooks`, lazy-bot resolution,
 * and the construction-time validation. Routing/session/principal
 * mechanics have their own focused tests; this file is the contract
 * boundary check.
 */
import { describe, expect, it, vi } from "vitest";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createChatTransportAdapter,
  CHAT_TRANSPORT_SOURCE,
} from "../src/adapter";
import type {
  InboundTransportHost,
  InboundRequestEnvelope,
} from "@flow-state-dev/server";
import {
  createInboundTransportConformanceTests,
  createMockTransportHost,
} from "@flow-state-dev/testing/conformance";

/** A handler block with a known name, for inline chat bindings in fixtures. */
function blk(name: string) {
  return handler({
    name,
    inputSchema: z.object({}).passthrough(),
    execute: () => undefined,
  });
}

/** A flow instance declaring a single `chat.on.mention` inline-core binding. */
function chatFlow(kind = "support"): unknown {
  return {
    kind,
    id: kind,
    actions: {},
    chat: { on: { mention: { block: blk("reply"), input: (e: unknown) => e } } },
  };
}

function makeHost(): InboundTransportHost {
  return {
    registry: { get: () => undefined, list: () => [] } as never,
    stores: { session: { get: async () => undefined } } as never,
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
    dispatch: vi.fn() as never,
    resolvePrincipal: vi.fn() as never,
  };
}

function makeBot(platforms: string[] = ["slack", "discord"]): unknown {
  const webhooks: Record<string, (req: Request) => Promise<Response>> = {};
  for (const p of platforms) {
    webhooks[p] = async (req) =>
      new Response(`ok:${p}:${req.method}`, { status: 200 });
  }
  return {
    webhooks,
    adapters: Object.fromEntries(platforms.map((p) => [p, {}])),
    onNewMention: vi.fn(),
    onSubscribedMessage: vi.fn(),
    onDirectMessage: vi.fn(),
    onReaction: vi.fn(),
    onAction: vi.fn(),
    onSlashCommand: vi.fn(),
    onModalSubmit: vi.fn(),
    onAssistantThreadStarted: vi.fn(),
    onMemberJoinedChannel: vi.fn(),
  };
}

describe("createChatTransportAdapter", () => {
  it("does not throw at construction when no routing is configured", () => {
    // The no-routing check moved to start() (FIX-667) so the index can be
    // consulted; construction is side-effect-free.
    expect(() =>
      createChatTransportAdapter({ bot: makeBot() as never })
    ).not.toThrow();
  });

  it("start() throws CHAT_ADAPTER_NO_ROUTING when nothing routes", () => {
    const adapter = createChatTransportAdapter({ bot: makeBot() as never });
    const bindings = adapter.createBindings(makeHost());
    expect(() => bindings.start?.()).toThrow(/CHAT_ADAPTER_NO_ROUTING/);
  });

  it("start() does not throw when a flow declares chat.on", () => {
    const adapter = createChatTransportAdapter({ bot: makeBot() as never });
    const host = makeHost();
    (host.registry as { list: () => unknown[] }).list = () => [chatFlow()];
    const bindings = adapter.createBindings(host);
    expect(() => bindings.start?.()).not.toThrow();
  });

  it("stamps source = 'chat'", () => {
    const adapter = createChatTransportAdapter({
      bot: makeBot() as never,
    });
    expect(adapter.source).toBe(CHAT_TRANSPORT_SOURCE);
    expect(adapter.source).toBe("chat");
  });

  it("enumerates POST + GET routes per registered platform", () => {
    const adapter = createChatTransportAdapter({
      bot: makeBot(["slack", "discord"]) as never,
    });
    const bindings = adapter.createBindings(makeHost());
    const paths = (bindings.routes ?? []).map(
      (r) => `${r.method} ${r.path}`
    );
    expect(paths).toContain("POST /api/chat/slack");
    expect(paths).toContain("GET /api/chat/slack");
    expect(paths).toContain("POST /api/chat/discord");
    expect(paths).toContain("GET /api/chat/discord");
  });

  it("registers event handlers on the bot at bindings time (eager)", () => {
    const bot = makeBot() as { onNewMention: ReturnType<typeof vi.fn> };
    const adapter = createChatTransportAdapter({
      bot: bot as never,
    });
    adapter.createBindings(makeHost());
    expect(bot.onNewMention).toHaveBeenCalled();
  });

  it("respects custom routePrefix", () => {
    const adapter = createChatTransportAdapter({
      bot: makeBot(["slack"]) as never,
      routePrefix: "/hooks/chat",
    });
    const bindings = adapter.createBindings(makeHost());
    const paths = (bindings.routes ?? []).map((r) => r.path);
    expect(paths).toContain("/hooks/chat/slack");
  });

  it("lazy bot mounts wildcard :platform", () => {
    const adapter = createChatTransportAdapter({
      bot: () => makeBot() as never,
    });
    const bindings = adapter.createBindings(makeHost());
    const paths = (bindings.routes ?? []).map(
      (r) => `${r.method} ${r.path}`
    );
    expect(paths).toContain("POST /api/chat/:platform");
    expect(paths).toContain("GET /api/chat/:platform");
  });

  it("mounts OAuth callback routes only for adapters with handleOAuthCallback", () => {
    const bot = makeBot(["slack"]) as Record<string, unknown>;
    (bot.adapters as Record<string, unknown>).slack = {
      handleOAuthCallback: async () => new Response("redirect", { status: 302 }),
    };
    const adapter = createChatTransportAdapter({
      bot: bot as never,
      mountOAuthRoutes: true,
    });
    const bindings = adapter.createBindings(makeHost());
    const paths = (bindings.routes ?? []).map(
      (r) => `${r.method} ${r.path}`
    );
    expect(paths).toContain("GET /api/chat/slack/oauth/callback");
  });

  it("does not mount OAuth routes for adapters without handleOAuthCallback", () => {
    const adapter = createChatTransportAdapter({
      bot: makeBot(["discord"]) as never,
      mountOAuthRoutes: true,
    });
    const bindings = adapter.createBindings(makeHost());
    const oauthPaths = (bindings.routes ?? [])
      .map((r) => r.path)
      .filter((p) => p.includes("oauth"));
    expect(oauthPaths).toHaveLength(0);
  });
});

/**
 * Inbound-transport contract conformance. Drives a mention through the
 * adapter via the captured Chat SDK callback and asserts the envelope
 * carries the adapter's source and the resolved principal. Baseline only —
 * FIX-667 dispatch behavior is covered in `dispatch.test.ts`.
 */
function makeConformanceBot(): {
  bot: unknown;
  fire: (thread: unknown, message: unknown) => Promise<void>;
} {
  let mentionCb: ((thread: unknown, message: unknown) => Promise<void>) | undefined;
  const bot = {
    webhooks: { slack: async () => new Response("ok") },
    adapters: { slack: {} },
    onNewMention: (cb: (t: unknown, m: unknown) => Promise<void>) => {
      mentionCb = cb;
    },
    onSubscribedMessage: vi.fn(),
    onDirectMessage: vi.fn(),
    onReaction: vi.fn(),
    onAction: vi.fn(),
    onSlashCommand: vi.fn(),
    onModalSubmit: vi.fn(),
    onAssistantThreadStarted: vi.fn(),
    onMemberJoinedChannel: vi.fn(),
  };
  return {
    bot,
    fire: async (thread, message) => {
      if (mentionCb === undefined) throw new Error("mention handler not registered");
      await mentionCb(thread, message);
    },
  };
}

createInboundTransportConformanceTests({
  name: "chat-sdk",
  factory: () =>
    createChatTransportAdapter({
      bot: makeConformanceBot().bot as never,
      streamToThread: false,
    }),
  helpers: {
    async buildEnvelope(_adapter, host): Promise<InboundRequestEnvelope> {
      // The factory builds a fresh bot per adapter; rebuild a paired
      // adapter/bot here so we hold the `fire` handle to the same instance.
      const { bot, fire } = makeConformanceBot();
      // The conformance mock host carries the injected principal resolver
      // on `host.resolvePrincipal` and empty stores. The chat adapter
      // resolves the principal from the event by default, so route it back
      // through the host resolver, add a stub session store, and register a
      // flow declaring `chat.on.mention` so the (now purely declarative)
      // dispatch path actually fires.
      const flow = chatFlow();
      const augmentedHost = Object.assign({}, host, {
        registry: {
          list: () => [flow],
          get: (k: string) => (k === "support" ? flow : undefined),
        },
        stores: {
          ...(host.stores as object),
          session: { get: async () => undefined, set: async () => undefined },
        },
      }) as ReturnType<typeof createMockTransportHost>;
      const adapter = createChatTransportAdapter({
        bot: bot as never,
        streamToThread: false,
        resolvePrincipal: () => host.resolvePrincipal({} as never),
      });
      const bindings = adapter.createBindings(augmentedHost);
      bindings.start?.();
      await fire(
        { id: "thread-1", isDM: false, adapter: { name: "slack" } },
        { id: "m1", text: "hi", author: { userId: "alice" } }
      );
      return augmentedHost.dispatchCalls[0].envelope;
    },
  },
});
