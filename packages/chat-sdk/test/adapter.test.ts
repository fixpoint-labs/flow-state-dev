/**
 * Smoke tests for `createChatTransportAdapter`. Cover the adapter
 * shape, route enumeration from `bot.webhooks`, lazy-bot resolution,
 * and the construction-time validation. Routing/session/principal
 * mechanics have their own focused tests; this file is the contract
 * boundary check.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createChatTransportAdapter,
  CHAT_TRANSPORT_SOURCE,
} from "../src/adapter";
import type { InboundTransportHost } from "@flow-state-dev/server";

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
  it("requires either flowKind or route", () => {
    expect(() =>
      createChatTransportAdapter({ bot: makeBot() as never })
    ).toThrow(/flowKind.*route/);
  });

  it("stamps source = 'chat'", () => {
    const adapter = createChatTransportAdapter({
      bot: makeBot() as never,
      flowKind: "support",
    });
    expect(adapter.source).toBe(CHAT_TRANSPORT_SOURCE);
    expect(adapter.source).toBe("chat");
  });

  it("enumerates POST + GET routes per registered platform", () => {
    const adapter = createChatTransportAdapter({
      bot: makeBot(["slack", "discord"]) as never,
      flowKind: "support",
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
      flowKind: "support",
    });
    adapter.createBindings(makeHost());
    expect(bot.onNewMention).toHaveBeenCalled();
  });

  it("respects custom routePrefix", () => {
    const adapter = createChatTransportAdapter({
      bot: makeBot(["slack"]) as never,
      flowKind: "support",
      routePrefix: "/hooks/chat",
    });
    const bindings = adapter.createBindings(makeHost());
    const paths = (bindings.routes ?? []).map((r) => r.path);
    expect(paths).toContain("/hooks/chat/slack");
  });

  it("lazy bot mounts wildcard :platform", () => {
    const adapter = createChatTransportAdapter({
      bot: () => makeBot() as never,
      flowKind: "support",
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
      flowKind: "support",
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
      flowKind: "support",
      mountOAuthRoutes: true,
    });
    const bindings = adapter.createBindings(makeHost());
    const oauthPaths = (bindings.routes ?? [])
      .map((r) => r.path)
      .filter((p) => p.includes("oauth"));
    expect(oauthPaths).toHaveLength(0);
  });
});
