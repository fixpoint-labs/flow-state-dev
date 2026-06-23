/**
 * `createChatTransportAdapter` — the entry point.
 *
 * Builds an `InboundTransportAdapter` that mounts every platform's
 * webhook handler exposed by the supplied Chat instance under
 * `${routePrefix}/${platform}`. On first request, the adapter registers
 * its Chat callbacks (mention/message/reaction/action/etc.) so any
 * inbound event drives a flow dispatch.
 *
 * Two construction shapes:
 *
 *   - Eager: `bot` is a `Chat` instance — enumerate routes immediately.
 *   - Lazy:  `bot` is a thunk — mount a wildcard `:platform` route and
 *            instantiate the bot on first request (single-flight).
 *
 * Source is always `"chat"`. Per-platform routing is owned by the Chat
 * SDK's `bot.webhooks[platform]` handler; this adapter does not parse
 * webhook payloads — it forwards the raw `Request` to the SDK.
 */
import type { Chat } from "chat";
import type {
  InboundTransportAdapter,
  InboundTransportHost,
  TransportBindings,
  TransportRoute,
} from "@flow-state-dev/server";
import { CHAT_TRANSPORT_SOURCE, type ChatAdapterOptions } from "./types";
import { registerEventHandlers } from "./event-handlers";
import { buildOAuthRoutes } from "./oauth/routes";
import {
  buildChatSubscriptionIndex,
  hasChatSubscriptions,
  type ChatSubscriptionIndex,
} from "./subscription-index";

export { CHAT_TRANSPORT_SOURCE };

/**
 * Build an `InboundTransportAdapter` wrapping a Chat SDK bot. Mount via
 * `createFlowApiRouter({ adapters: [createChatTransportAdapter(...)] })`.
 */
export function createChatTransportAdapter(
  options: ChatAdapterOptions
): InboundTransportAdapter {
  const prefix = normalizePrefix(options.routePrefix ?? "/api/chat");

  return {
    source: CHAT_TRANSPORT_SOURCE,
    createBindings(host: InboundTransportHost): TransportBindings {
      const routes: TransportRoute[] = [];

      // Snapshot holder populated synchronously by `start()`. Event handlers
      // registered now (eager) or on first request (lazy) read it through
      // the accessor, so the index is in place before any event fires.
      let index: ChatSubscriptionIndex = { byEventKey: new Map() };
      const getIndex = (): ChatSubscriptionIndex => index;

      if (typeof options.bot !== "function") {
        const bot = options.bot;
        registerEventHandlers(bot, host, options, getIndex);
        for (const platform of platformNames(bot)) {
          routes.push(...platformRoutes(prefix, platform, () => bot));
        }
        if (options.mountOAuthRoutes) {
          routes.push(...buildOAuthRoutes(bot, prefix, options.mountOAuthRoutes));
        }
      } else {
        const ensureBot = createLazyBotResolver(options.bot, host, options, getIndex);
        // Wildcard fallback. The Chat SDK validates the platform name
        // against `bot.webhooks` once resolved.
        routes.push({
          method: "POST",
          path: `${prefix}/:platform`,
          handler: lazyHandler(ensureBot),
        });
        routes.push({
          method: "GET",
          path: `${prefix}/:platform`,
          handler: lazyHandler(ensureBot),
        });
        // OAuth callbacks for lazy bots: we can't enumerate adapter names
        // until the bot resolves. Hosts that need OAuth should construct
        // eagerly.
      }

      if (routes.length === 0) {
        host.logger?.warn?.(
          "@flow-state-dev/chat-sdk: bot exposes no webhooks; adapter mounts no routes",
          {}
        );
      }

      return {
        routes,
        // Build the subscription index by walking the registry once, and
        // fail fast when no flow declares `chat.on` — routing is purely
        // declarative now (FIX-838), so an adapter with no subscriptions can
        // never dispatch. Runs synchronously: `createFlowApiRouter` invokes
        // `start()` fire-and-forget, so only a synchronous throw aborts startup.
        start(): void {
          index = buildChatSubscriptionIndex(host.registry.list());
          if (!hasChatSubscriptions(index)) {
            throw new Error(
              "@flow-state-dev/chat-sdk: no chat routing configured. Declare " +
                "`chat.on` on at least one flow (CHAT_ADAPTER_NO_ROUTING)."
            );
          }
        },
      };
    },
  };
}

function normalizePrefix(p: string): string {
  let s = p.trim();
  if (s.length === 0) return "";
  if (!s.startsWith("/")) s = `/${s}`;
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

function platformNames(bot: Chat): string[] {
  const webhooks = (bot as { webhooks?: Record<string, unknown> }).webhooks ?? {};
  return Object.keys(webhooks);
}

function platformRoutes(
  prefix: string,
  platform: string,
  getBot: () => Chat
): TransportRoute[] {
  const handler = (req: Request): Promise<Response> => {
    const bot = getBot();
    const webhook = (bot.webhooks as Record<string, (r: Request) => Promise<Response>>)[
      platform
    ];
    if (webhook === undefined) {
      return Promise.resolve(
        new Response(`Unknown chat platform: ${platform}`, { status: 404 })
      );
    }
    return webhook(req);
  };
  return [
    { method: "POST", path: `${prefix}/${platform}`, handler: (req) => handler(req) },
    { method: "GET", path: `${prefix}/${platform}`, handler: (req) => handler(req) },
  ];
}

function createLazyBotResolver(
  factory: () => Chat | Promise<Chat>,
  host: InboundTransportHost,
  options: ChatAdapterOptions,
  getIndex: () => ChatSubscriptionIndex
): () => Promise<Chat> {
  let cached: Chat | null = null;
  let pending: Promise<Chat> | null = null;
  let handlersRegistered = false;
  return async () => {
    if (cached !== null) return cached;
    if (pending !== null) return pending;
    pending = Promise.resolve(factory())
      .then((bot) => {
        cached = bot;
        if (!handlersRegistered) {
          registerEventHandlers(bot, host, options, getIndex);
          handlersRegistered = true;
        }
        return bot;
      })
      .finally(() => {
        // Clear regardless of resolve/reject so a transient factory
        // failure (e.g. a network blip fetching OAuth tokens on cold
        // start) doesn't leave the resolver returning the same stale
        // rejected promise forever.
        pending = null;
      });
    return pending;
  };
}

function lazyHandler(
  ensureBot: () => Promise<Chat>
): (req: Request, ctx: { params: Record<string, string> }) => Promise<Response> {
  return async (req, ctx) => {
    const platform = ctx.params.platform;
    if (typeof platform !== "string" || platform.length === 0) {
      return new Response("Missing platform", { status: 400 });
    }
    const bot = await ensureBot();
    const webhook = (bot.webhooks as Record<string, (r: Request) => Promise<Response>>)[
      platform
    ];
    if (webhook === undefined) {
      return new Response(`Unknown chat platform: ${platform}`, { status: 404 });
    }
    return webhook(req);
  };
}
