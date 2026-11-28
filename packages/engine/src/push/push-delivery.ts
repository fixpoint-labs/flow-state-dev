// FIX-2428.
/**
 * Push delivery on a router: a host that serves the socket turns
 * it on, and from then the router reports `push` in `GET /capabilities` and
 * answers the mint, `POST /users/:userId/stream`.
 *
 * The router owns both halves of the check. The mint runs each topic through
 * the check its scope's read route uses, on the caller's real request, and
 * signs a ticket naming only the topics it granted. The socket session
 * ({@link openPushSocket}) accepts topics only from such a ticket. A host
 * only takes the upgrade and moves frames (epic D5), so a later host reuses
 * the check.
 */
import { randomBytes } from "node:crypto";
import { assertSecret } from "../transports/auth/assert-secret";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { PUSH_MINT_MAX_TOPICS, wireTopicKey, type PushCapability, type PushMintAnswer } from "@flow-state-dev/core/internal";
import type { ResolvedPrincipal } from "../transports/types";
import type { ChangeBus } from "../bus/types";
import type { NoticeIdScopes } from "../runtime-config";
import type { FlowApiRouter } from "../routes/createFlowApiRouter";
import { authorizeManagementRoute, type RouteAuthContext } from "../routes/route-auth";
import { jsonResponse, loadCheckedSession } from "../routes/route-utils";
import { isWireTopic, openPushSocket, type PushSocket, type PushSocketIO } from "./socket-session";
import { PUSH_TICKET_TTL_MS, signPushTicket, type GrantedTopic } from "./ticket";
import { isChangeTopicResource, ownerSubscription } from "../bus/owner-topic";
import { ownResolverVerdict, type InstanceCallerResolver } from "../routes/instance-caller";
import { pinRejectsCaller } from "../context/instance-pin";
import { isWriteRecord } from "../resources/default-write-flow";

/** Options for {@link enablePushDelivery}. */
export type EnablePushDeliveryOptions = {
  /**
   * The key tickets are signed with. Every process behind one address needs
   * the same one, so a ticket minted on one is accepted by another. Read on
   * each sign and check. Default: a random key for this router.
   */
  secret?: string | (() => string);
};

/** A router's push delivery, as a host that serves the socket holds it. */
export type PushDelivery = {
  readonly transport: "websocket";
  /**
   * Start the session for a socket that just opened on
   * `/users/:userId/stream`, for the `userId` its path names.
   */
  openSocket(userId: string, io: PushSocketIO): PushSocket;
};


/** Where a router keeps its push state, read across engine copies. */
const PUSH_STATE = Symbol.for("@flow-state-dev/engine/pushState");

/**
 * A router's push state: built with its handlers, empty until a host turns
 * push on.
 */
export type PushState = {
  bus: ChangeBus;
  // FIX-2625 D2.
  /** The app's per-scope ids setting, read by every socket. */
  noticeIds?: NoticeIdScopes;
  /** The key tickets are signed and checked with, read on each use. Unset until push is on. */
  secret?: () => string;
  /** This router's random key, made once, so every host that turns push on shares it. */
  generated?: string;
};

/** Create a router's push state over its bus, with the app's per-scope ids setting. */
export function createPushState(bus: ChangeBus, noticeIds?: NoticeIdScopes): PushState {
  return { bus, ...(noticeIds !== undefined ? { noticeIds } : {}) };
}

/** Attach `state` to `router`, for {@link enablePushDelivery} to find. */
export function attachPushState(router: FlowApiRouter, state: PushState): void {
  Object.defineProperty(router, PUSH_STATE, { value: state, enumerable: false, configurable: true });
}

/**
 * Turn push delivery on for `router`: it then reports
 * `{ transport: "websocket" }` in `GET /capabilities` and answers the mint.
 * Call it from a host that serves the socket on `/users/:userId/stream`,
 * and hand each socket that opens there to the returned delivery.
 *
 * @throws When `router` was not built by `createFlowApiRouter`.
 */
export function enablePushDelivery(router: FlowApiRouter, options: EnablePushDeliveryOptions = {}): PushDelivery {
  const state = (router as Record<symbol, unknown>)[PUSH_STATE] as PushState | undefined;
  if (state === undefined) {
    throw new Error("enablePushDelivery takes a router built by createFlowApiRouter");
  }
  const given = options.secret;
  if (!("secret" in options)) state.generated ??= randomBytes(32).toString("base64url");
  else if (typeof given !== "function") assertSecret(given, "enablePushDelivery");
  const generated = state.generated;
  state.secret = (): string => {
    const secret = typeof given === "function" ? given() : given ?? generated;
    assertSecret(secret, "enablePushDelivery");
    return secret;
  };
  // Every socket checks with the router's current key, the one the mint signs
  // with, so two hosts in front of one router accept each other's tickets.
  const current = (): string => state.secret!();
  return {
    transport: "websocket",
    openSocket: (userId, io) =>
      openPushSocket({ bus: state.bus, secret: current, userId, io, ...(state.noticeIds !== undefined ? { noticeIds: state.noticeIds } : {}) })
  };
}

/** What `GET /capabilities` reports in `push`. */
export function pushCapability(state: PushState): PushCapability | null {
  return state.secret !== undefined ? { transport: "websocket" } : null;
}

/** What the mint needs from the request's dispatch. */
export type MintContext = RouteAuthContext & {
  state: PushState;
  /** The caller as each flow instance's own doors resolve it: which instances' change topics to grant. */
  callerFor: InstanceCallerResolver;
  /** The verified caller, when the app authenticates this route. */
  principal?: ResolvedPrincipal;
  /**
   * Set when the caller is anonymous in an app where some flow
   * authenticates: no user or org scope is theirs to hear.
   */
  anonymous: boolean;
};

/**
 * The flow instances whose sessions of `owner` this request would be shown,
 * by the session listing's per-row rule: an instance with a resolver of its
 * own admits when that resolver accepts these credentials as the owner
 * (`ownResolverVerdict`); any other when the verified caller is outside no
 * pin. A write session's flow is never one. A session of any other instance
 * reads as empty to a read across sessions, so its writes wake nothing.
 */
async function admittedFlows(ctx: MintContext, owner: { userId: string; orgId: string; tenantId: string | undefined }): Promise<string[]> {
  const admitted: string[] = [];
  for (const flow of ctx.registry.list()) {
    const row = { flowKind: flow.kind, flowId: flow.id, userId: owner.userId, orgId: owner.orgId, ...(owner.tenantId !== undefined ? { tenantId: owner.tenantId } : {}) };
    if (isWriteRecord(row)) continue;
    const verdict = await ownResolverVerdict(ctx.registry, ctx.callerFor, row);
    if (verdict ?? !pinRejectsCaller(flow.ownerPin, { userId: owner.userId, orgId: owner.orgId })) admitted.push(flow.id);
  }
  return admitted;
}

/**
 * `POST /users/:userId/stream`: check each topic and answer a ticket for the
 * granted ones. The route guard has already checked that the path's user is
 * the caller.
 */
export async function handleMintPush(request: Request, userId: string, ctx: MintContext): Promise<Response> {
  const secret = ctx.state.secret;
  if (secret === undefined) return jsonResponse(404, { error: "This host serves no push" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Expected a JSON body { topics }" });
  }
  const topics = (body as { topics?: unknown } | null)?.topics;
  if (!Array.isArray(topics) || topics.length > PUSH_MINT_MAX_TOPICS || !topics.every(isWireTopic)) {
    return jsonResponse(400, { error: `Expected { topics }: at most ${PUSH_MINT_MAX_TOPICS} wire topics` });
  }

  const tenantId = ctx.tenantId ?? "";
  const granted: GrantedTopic[] = [];
  for (const wire of topics) {
    const resource = wire.resource !== undefined ? { resource: wire.resource } : {};
    if (wire.scope === "session") {
      // The check the session stream answers to, on this request. A session
      // the caller may not read is dropped exactly as one that doesn't exist.
      const checked = await authorizeManagementRoute(request, { kind: "session_stream", sessionId: wire.id }, ctx);
      if (checked.denied !== undefined || checked.session === null) continue;
      // The session as it is now must be the one the check read, as on every
      // session route: one deleted and created again for someone else while
      // the caller was being signed in is dropped like a missing one.
      if ((await loadCheckedSession(ctx.stores.session, wire.id, ctx.tenantId, checked.session)) === undefined) continue;
      granted.push({ wire, bus: { scope: "session", id: wire.id, tenantId, ...resource } });
      continue;
    }
    // A user or org topic names no id: the caller's own, from the verified
    // principal (BP-031). An anonymous caller in an app that authenticates
    // anything has none to claim.
    if (ctx.anonymous) continue;
    // An owner's change topic: the caller's own user and organization, so the
    // same user in another organization never hears it, and only the flow
    // instances whose sessions this request's credentials would be shown
    // (`bus/owner-topic.ts`).
    if (wire.scope === "user" && isChangeTopicResource(wire.resource)) {
      const owner = { userId: ctx.principal?.userId ?? userId, orgId: ctx.principal?.orgId ?? DEFAULT_ORG_ID, tenantId: ctx.tenantId };
      for (const flowId of await admittedFlows(ctx, owner)) granted.push({ wire, bus: ownerSubscription(owner, flowId, wire.resource) });
      continue;
    }
    const id = wire.scope === "user" ? ctx.principal?.userId ?? userId : ctx.principal?.orgId ?? DEFAULT_ORG_ID;
    granted.push({ wire, bus: { scope: wire.scope, id, tenantId, ...resource } });
  }

  const answer: PushMintAnswer = {
    transport: "websocket",
    ticket: signPushTicket({ sub: userId, exp: Date.now() + PUSH_TICKET_TTL_MS, topics: granted }, secret()),
    path: `/users/${encodeURIComponent(userId)}/stream`,
    // A change topic is granted once per flow instance it admits; the client names it once.
    topics: [...new Map(granted.map((topic) => [wireTopicKey(topic.wire), topic.wire])).values()]
  };
  return jsonResponse(200, answer);
}
