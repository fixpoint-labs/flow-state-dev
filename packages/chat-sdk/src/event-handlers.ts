/**
 * Wire Chat SDK callback registrations to a shared dispatch path.
 *
 * Each `bot.on*` registration constructs a `ChatInboundEvent` from the
 * native callback args and forwards to `dispatchChatEvent`, which owns
 * routing, principal/session resolution, dispatch into the FSD runtime,
 * and (optionally) bridging the stream back to the originating thread.
 *
 * Handler registration is gated by `options.events` — each field defaults
 * to enabled and can be set to `false` to skip the registration.
 */
import type { Chat, Thread, Message } from "chat";
import type { InboundTransportHost } from "@flow-state-dev/server";
import { PrincipalResolutionError } from "@flow-state-dev/server";
import {
  CHAT_TRANSPORT_SOURCE,
  type ChatAdapterOptions,
  type ChatInboundEvent,
  type ChatEnvelopeMetadata,
} from "./types";
import { routeEvent } from "./routing";
import { resolvePrincipalFromEvent } from "./principal-resolver";
import { ensureSessionForChat } from "./session-resolver";
import { setThreadForRequest, clearThreadForRequest } from "./thread-registry";
import { bridgeStreamToThread } from "./stream-bridge";
import type {
  ChatSubscriptionIndex,
  ChatSubscriptionEntry,
} from "./subscription-index";

/**
 * Pull a `userId` out of a Chat SDK `Author`-shaped object. Used by the
 * event-kind handlers that receive a typed `user: Author` field (action,
 * slashCommand, modalSubmit) — `Author.userId` is the canonical id.
 */
function extractAuthorUserId(user: unknown): string | undefined {
  if (user === null || typeof user !== "object") return undefined;
  const userId = (user as { userId?: unknown }).userId;
  return typeof userId === "string" ? userId : undefined;
}

/**
 * Register handlers on the given Chat instance. Each callback maps a
 * native Chat SDK event into the unified `ChatInboundEvent` and delegates
 * to `dispatchChatEvent`. Idempotency-by-flag is the caller's job — call
 * this once per Chat instance.
 */
export function registerEventHandlers(
  bot: Chat,
  host: InboundTransportHost,
  options: ChatAdapterOptions,
  getIndex: () => ChatSubscriptionIndex
): void {
  const dispatch = (event: ChatInboundEvent): Promise<void> =>
    dispatchChatEvent(host, options, event, getIndex());
  const enabled = options.events ?? {};
  const on = (key: keyof typeof enabled): boolean => enabled[key] !== false;

  if (on("mention")) {
    bot.onNewMention(async (thread, message) => {
      await dispatch({
        kind: "mention",
        thread,
        message,
        platform: thread.adapter.name,
        raw: { thread, message },
      });
    });
  }

  if (on("subscribedMessage")) {
    bot.onSubscribedMessage(async (thread, message) => {
      await dispatch({
        kind: "subscribedMessage",
        thread,
        message,
        platform: thread.adapter.name,
        raw: { thread, message },
      });
    });
  }

  if (on("directMessage")) {
    bot.onDirectMessage(async (thread, message) => {
      await dispatch({
        kind: "directMessage",
        thread,
        message,
        platform: thread.adapter.name,
        raw: { thread, message },
      });
    });
  }

  if (on("reaction")) {
    bot.onReaction(async (event: any) => {
      const thread = (event?.thread ?? null) as Thread | null;
      await dispatch({
        kind: "reaction",
        thread,
        message: (event?.message ?? null) as Message | null,
        platform: thread?.adapter.name ?? "unknown",
        actionValue: event,
        raw: event,
      });
    });
  }

  if (on("action")) {
    bot.onAction(async (event: any) => {
      const thread = (event?.thread ?? null) as Thread | null;
      await dispatch({
        kind: "action",
        thread,
        message: (event?.message ?? null) as Message | null,
        platform: thread?.adapter.name ?? "unknown",
        actionId: typeof event?.actionId === "string" ? event.actionId : undefined,
        actionValue: event?.value ?? event,
        ...(extractAuthorUserId(event?.user) !== undefined
          ? { principalUser: { userId: extractAuthorUserId(event.user)! } }
          : {}),
        raw: event,
      });
    });
  }

  if (on("slashCommand")) {
    bot.onSlashCommand(async (event: any) => {
      const thread = (event?.thread ?? event?.channel ?? null) as Thread | null;
      await dispatch({
        kind: "slashCommand",
        thread,
        message: null,
        platform: thread?.adapter.name ?? "unknown",
        slashCommand: {
          name: String(event?.command ?? ""),
          args: String(event?.text ?? ""),
        },
        ...(extractAuthorUserId(event?.user) !== undefined
          ? { principalUser: { userId: extractAuthorUserId(event.user)! } }
          : {}),
        raw: event,
      });
    });
  }

  if (on("modalSubmit")) {
    bot.onModalSubmit(async (event: any) => {
      const thread = (event?.relatedThread ?? null) as Thread | null;
      await dispatch({
        kind: "modalSubmit",
        thread,
        message: null,
        platform: thread?.adapter.name ?? "unknown",
        actionId: typeof event?.callbackId === "string" ? event.callbackId : undefined,
        actionValue: event?.values,
        ...(extractAuthorUserId(event?.user) !== undefined
          ? { principalUser: { userId: extractAuthorUserId(event.user)! } }
          : {}),
        raw: event,
      });
    });
  }

  if (on("assistantThreadStarted")) {
    bot.onAssistantThreadStarted(async (event: any) => {
      const thread = (event?.thread ?? null) as Thread | null;
      await dispatch({
        kind: "assistantThreadStarted",
        thread,
        message: null,
        platform: thread?.adapter.name ?? "unknown",
        ...(typeof event?.userId === "string"
          ? { principalUser: { userId: event.userId } }
          : {}),
        raw: event,
      });
    });
  }

  if (on("memberJoined")) {
    bot.onMemberJoinedChannel(async (event: any) => {
      const thread = (event?.thread ?? null) as Thread | null;
      await dispatch({
        kind: "memberJoined",
        thread,
        message: null,
        platform: thread?.adapter.name ?? "unknown",
        ...(typeof event?.userId === "string"
          ? { principalUser: { userId: event.userId } }
          : {}),
        raw: event,
      });
    });
  }
}

/**
 * Entry point shared by every event registration.
 *
 * Flow-level subscriptions take total precedence: when any flow declares a
 * `chat.on` binding matching `event.kind` (and its `when` predicate passes),
 * those bindings fire — broadcast, each as its own dispatch — and the
 * adapter-mount `route()`/`flowKind` path is NOT consulted. Only when no
 * flow-level binding matches does dispatch fall back to the FIX-638
 * adapter-routing path. This lets a host migrate one flow at a time.
 */
export async function dispatchChatEvent(
  host: InboundTransportHost,
  options: ChatAdapterOptions,
  event: ChatInboundEvent,
  index: ChatSubscriptionIndex
): Promise<void> {
  const matched = matchSubscriptions(host, event, index);

  if (matched.length > 0) {
    // Broadcast: each matching binding produces an independent dispatch.
    await Promise.all(
      matched.map((entry) => runOneSubscription(host, options, event, entry))
    );
    return;
  }

  await dispatchViaAdapterRouting(host, options, event);
}

/**
 * Evaluate every binding subscribed to `event.kind`, keeping those whose
 * `when` predicate is absent or returns truthy. A `when` that throws is
 * treated as no-match (logged), never aborting the other bindings.
 */
function matchSubscriptions(
  host: InboundTransportHost,
  event: ChatInboundEvent,
  index: ChatSubscriptionIndex
): ChatSubscriptionEntry[] {
  const candidates = index.byEventKey.get(event.kind) ?? [];
  const matched: ChatSubscriptionEntry[] = [];
  for (const entry of candidates) {
    const when = entry.binding.when;
    if (when === undefined) {
      matched.push(entry);
      continue;
    }
    try {
      if (when(event)) matched.push(entry);
    } catch (err) {
      host.logger?.error?.(
        "@flow-state-dev/chat-sdk: chat binding `when` threw — treating as no match",
        { code: "CHAT_BINDING_WHEN_THROWS", flowKind: entry.flowKind, eventKey: entry.eventKey, err }
      );
    }
  }
  return matched;
}

/**
 * Dispatch one flow-level subscription. Resolves `input` and `sessionId`
 * (both may be async; `sessionId` falls back to the thread id on
 * absence/throw), then hands off to the shared executor. A throwing
 * `input` skips only this binding — other matched bindings still run.
 */
async function runOneSubscription(
  host: InboundTransportHost,
  options: ChatAdapterOptions,
  event: ChatInboundEvent,
  entry: ChatSubscriptionEntry
): Promise<void> {
  let input: unknown;
  try {
    input = await entry.binding.input(event);
  } catch (err) {
    host.logger?.error?.("@flow-state-dev/chat-sdk: chat binding `input` threw", {
      code: "CHAT_BINDING_INPUT_THROWS",
      flowKind: entry.flowKind,
      eventKey: entry.eventKey,
      err,
    });
    return;
  }

  let sessionId: string | undefined;
  try {
    sessionId = entry.binding.sessionId !== undefined
      ? await entry.binding.sessionId(event)
      : event.thread?.id;
  } catch (err) {
    host.logger?.error?.(
      "@flow-state-dev/chat-sdk: chat binding `sessionId` threw — falling back to thread id",
      { code: "CHAT_BINDING_SESSION_THROWS", flowKind: entry.flowKind, eventKey: entry.eventKey, err }
    );
    sessionId = event.thread?.id;
  }

  await executeDispatch(host, options, event, {
    flowKind: entry.flowKind,
    action: entry.binding.action,
    input,
    sessionId,
    subscriptionKey: entry.eventKey,
  });
}

/**
 * FIX-638 adapter-routing fallback. Resolves the flow + action via the
 * adapter-mount `route()`/`flowKind` and hands off to the shared executor.
 */
async function dispatchViaAdapterRouting(
  host: InboundTransportHost,
  options: ChatAdapterOptions,
  event: ChatInboundEvent
): Promise<void> {
  let route;
  try {
    route = await routeEvent(event, options);
  } catch (err) {
    host.logger?.warn?.("@flow-state-dev/chat-sdk: route function threw", { err });
    return;
  }
  if (route.skip === true) return;

  await executeDispatch(host, options, event, {
    flowKind: route.flowKind,
    action: route.action,
    input: route.input,
    sessionId: route.sessionId ?? event.thread?.id,
  });
}

/** Resolved routing decision handed to `executeDispatch`. */
type ResolvedDispatch = {
  flowKind: string;
  action: string;
  input: unknown;
  sessionId: string | undefined;
  /** `chat.on` key that matched, when dispatched via a flow-level subscription. */
  subscriptionKey?: string;
};

/**
 * Shared tail of the dispatch path: resolve principal → ensure session →
 * construct envelope → call `host.dispatch`. On `streamToThread`, wire the
 * runtime's response emitter into `thread.post` via the stream bridge.
 * Always observes both the post and dispatch promises so neither leaks.
 */
async function executeDispatch(
  host: InboundTransportHost,
  options: ChatAdapterOptions,
  event: ChatInboundEvent,
  resolved: ResolvedDispatch
): Promise<void> {
  const { flowKind, action, input, sessionId, subscriptionKey } = resolved;

  if (sessionId === undefined) {
    host.logger?.warn?.("@flow-state-dev/chat-sdk: event has no thread id; skipping", {
      kind: event.kind,
      platform: event.platform,
    });
    return;
  }

  let principal;
  try {
    principal = options.resolvePrincipal !== undefined
      ? await options.resolvePrincipal(event)
      : resolvePrincipalFromEvent(event);
  } catch (err) {
    if (err instanceof PrincipalResolutionError) {
      host.logger?.warn?.("@flow-state-dev/chat-sdk: principal rejected", {
        err: err.message,
      });
      return;
    }
    throw err;
  }

  await ensureSessionForChat({
    stores: host.stores,
    sessionId,
    flowKind,
    principal,
    event,
  });

  const streamToThread = shouldStreamToThread(host, options, flowKind);

  const metadata: ChatEnvelopeMetadata = {
    platform: event.platform,
    threadId: event.thread?.id ?? sessionId,
    channelId: typeof (event.thread as any)?.channelId === "string"
      ? (event.thread as any).channelId
      : event.thread?.id ?? sessionId,
    ...(event.message?.id !== undefined ? { messageId: event.message.id } : {}),
    ...(event.message?.author?.userId !== undefined
      ? { authorId: event.message.author.userId }
      : {}),
    isDM: event.thread?.isDM ?? false,
    eventKind: event.kind,
    ...(subscriptionKey !== undefined ? { subscriptionKey } : {}),
  };

  const handle = host.dispatch({
    source: CHAT_TRANSPORT_SOURCE,
    flowKind,
    action,
    input,
    sessionId,
    principal,
    metadata: metadata as unknown as Record<string, unknown>,
    responseEmitter: streamToThread ? undefined : null,
  });

  setThreadForRequest(handle.requestId, event.thread, event.message);
  handle.finished.finally(() => clearThreadForRequest(handle.requestId));

  if (streamToThread && event.thread !== null) {
    const chunks = bridgeStreamToThread(
      handle.responseEmitter,
      options.itemToChunk,
      (err) =>
        host.logger?.warn?.("@flow-state-dev/chat-sdk: itemToChunk threw", { err })
    );
    const postPromise = event.thread.post(chunks).catch((err) => {
      host.logger?.warn?.("@flow-state-dev/chat-sdk: thread.post rejected", { err });
    });
    // Observe both — re-throw flow rejection so Chat SDK releases its lock.
    const [, flowResult] = await Promise.allSettled([postPromise, handle.finished]);
    if (flowResult.status === "rejected") throw flowResult.reason;
  } else {
    await handle.finished;
  }
}

/**
 * Resolve the effective `streamToThread` for a flow, in precedence order:
 * the flow's own `chat.streamToThread`, then the adapter-mount
 * `flowOverrides[flowKind].streamToThread`, then the adapter-level
 * `streamToThread`, defaulting to `true`.
 */
function shouldStreamToThread(
  host: InboundTransportHost,
  options: ChatAdapterOptions,
  flowKind: string
): boolean {
  const flowLevel = host.registry.get(flowKind)?.chat?.streamToThread;
  const flowOverride = options.flowOverrides?.[flowKind]?.streamToThread;
  return flowLevel ?? flowOverride ?? options.streamToThread ?? true;
}
