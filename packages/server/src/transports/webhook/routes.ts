/**
 * Request pipeline for the webhook transport. Order of operations is
 * load-bearing: flow + provider lookup → raw body → verify → parse → build
 * event → handshake → route (declarative `on` first, then `route`) → resolve
 * input/session → principal → validate → ensure session → fire-and-forget
 * dispatch → 202. The action runs asynchronously, so the 202 returns well
 * within provider timeout budgets (Slack 3s, GitHub 10s) regardless of how
 * long the action takes.
 */
import type {
  WebhookConfig,
  WebhookEventBinding,
  WebhookInboundEvent,
  WebhookSubscriptionConfig
} from "@flow-state-dev/core/types";
import type { InboundRequestEnvelope, InboundTransportHost, ResolvedPrincipal } from "../types";
import { PrincipalResolutionError } from "../errors";
import {
  WEBHOOK_TRANSPORT_SOURCE,
  type WebhookProviderDefinition
} from "./createWebhookTransportAdapter";
import { ensureSessionForWebhook } from "./session-resolver";

export async function handleWebhook(
  req: Request,
  ctx: { params: Record<string, string> },
  host: InboundTransportHost,
  providers: Record<string, WebhookProviderDefinition>
): Promise<Response> {
  const flowKind = ctx.params.flowKind ?? "";
  const provider = ctx.params.provider ?? "";

  const flow = host.registry.get(flowKind);
  if (!flow) {
    return jsonResponse(404, { error: "flow_not_found" });
  }

  const sub = (flow as { webhooks?: WebhookConfig }).webhooks?.[provider];
  const def = providers[provider];
  if (sub === undefined || def === undefined) {
    return jsonResponse(404, { error: "webhook_not_found", provider });
  }

  const rawBody = new Uint8Array(await req.arrayBuffer());

  // 1. Verify the signature — authenticate the sender. A throwing verifier is
  //    treated as invalid (never a 500: a bad signature is a caller error).
  let valid: boolean;
  try {
    valid = await def.verify(rawBody, req.headers);
  } catch {
    valid = false;
  }
  if (!valid) {
    return jsonResponse(401, { error: "invalid_signature" });
  }

  // 2. Parse the body.
  let payload: unknown;
  try {
    payload = def.parse
      ? def.parse(rawBody, req.headers)
      : JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return jsonResponse(400, { error: "invalid_payload" });
  }

  // 3. Build the normalized event. A throwing eventType/deliveryId extractor is
  //    treated as "not extracted" (logged), consistent with the other host
  //    callbacks — never a 5xx — and it keeps the `acknowledge` handshake below
  //    reachable even when the extractor isn't null-safe.
  let eventType: string | null = null;
  if (def.eventType) {
    try {
      eventType = def.eventType(payload, req.headers);
    } catch (err) {
      host.logger?.warn?.("webhook `eventType` extractor threw — treating as null", {
        provider,
        error: errorMessage(err)
      });
    }
  }
  let deliveryId: string | undefined;
  if (def.deliveryId) {
    try {
      deliveryId = def.deliveryId(payload, req.headers);
    } catch (err) {
      host.logger?.warn?.("webhook `deliveryId` extractor threw — omitting", {
        provider,
        error: errorMessage(err)
      });
    }
  }
  const event: WebhookInboundEvent = {
    provider,
    eventType,
    payload,
    headers: req.headers,
    rawBody,
    ...(deliveryId !== undefined ? { deliveryId } : {})
  };

  // 4. Provider handshake (e.g. Slack url_verification) short-circuits dispatch.
  //    A throwing `acknowledge` is treated as "no handshake" and routing
  //    continues — consistent with the other pre-dispatch callbacks, never a 5xx.
  if (def.acknowledge) {
    let ack: BodyInit | null;
    try {
      ack = def.acknowledge(event);
    } catch (err) {
      host.logger?.warn?.("webhook `acknowledge` threw — skipping handshake", {
        provider,
        eventType,
        error: errorMessage(err)
      });
      ack = null;
    }
    if (ack !== null) {
      return new Response(ack, { status: 200 });
    }
  }

  // 5. Match the event to a declarative `on` binding.
  const binding = matchBinding(sub, event, host.logger);
  if (binding === null) {
    return jsonResponse(202, { status: "ignored", provider, eventType });
  }

  // 6. Resolve the handler's input and session id. `action` carries the
  //    handler block's name purely as provenance on the request record — the
  //    runtime resolves the actual handler from `flow.webhooks[provider].on`
  //    via the `metadata.webhook` coordinate, not by this name.
  const action = binding.block.name;
  let input: unknown;
  let sessionId: string | undefined;
  try {
    input = await binding.input(event);
    sessionId = binding.sessionId ? await binding.sessionId(event) : undefined;
  } catch (err) {
    return jsonResponse(500, { error: "route_failed", message: errorMessage(err) });
  }

  const metadata = {
    webhook: {
      provider,
      eventType,
      ...(deliveryId !== undefined ? { deliveryId } : {})
    }
  };

  // 7. Resolve the principal (the userId to run as). For typical webhook flows
  //    this returns `authentication.defaultUserId`.
  let principal: ResolvedPrincipal;
  try {
    principal = await host.resolvePrincipal({
      source: WEBHOOK_TRANSPORT_SOURCE,
      request: req,
      rawBody,
      envelope: { flowKind, action, sessionId, metadata, input }
    });
  } catch (err) {
    if (err instanceof PrincipalResolutionError) {
      return jsonResponse(err.status, { error: "unauthorized", message: err.message });
    }
    throw err;
  }

  // 8. Build the envelope, enforce org binding, ensure the session, dispatch.
  const envelope: InboundRequestEnvelope = {
    source: WEBHOOK_TRANSPORT_SOURCE,
    flowKind,
    action,
    input,
    ...(sessionId !== undefined ? { sessionId } : {}),
    principal,
    rawBody,
    responseEmitter: null,
    metadata,
    signal: req.signal
  };

  try {
    await host.validateDispatch(envelope);
  } catch (err) {
    return jsonResponse(403, { error: "dispatch_rejected", message: errorMessage(err) });
  }

  if (sessionId !== undefined) {
    try {
      await ensureSessionForWebhook({
        stores: host.stores,
        sessionId,
        flowKind,
        principal,
        provider,
        eventType
      });
    } catch (err) {
      // The session store is unavailable; the action can't run coherently
      // without its session. A 503 lets the provider retry once the store
      // recovers; the underlying error is logged, not leaked in the body.
      host.logger?.error?.("webhook session upsert failed", {
        provider,
        eventType,
        sessionId,
        error: errorMessage(err)
      });
      return jsonResponse(503, { error: "session_unavailable" });
    }
  }

  let handle;
  try {
    handle = host.dispatch(envelope);
  } catch (err) {
    return jsonResponse(503, { error: "flow_unregistered", message: errorMessage(err) });
  }

  // Wait for durable request recording (when the dispatcher surfaces it) before
  // acking, so a crash after the 202 doesn't silently drop the delivery. The
  // action itself still runs asynchronously; we never await `finished`. A
  // rejection means the request was not durably recorded (the action did not
  // durably start), so a 503 lets the provider retry safely; the underlying
  // error is logged rather than returned, to avoid leaking store internals.
  if (handle.accepted) {
    try {
      await handle.accepted;
    } catch (err) {
      host.logger?.error?.("webhook dispatch was not durably recorded", {
        provider,
        eventType,
        error: errorMessage(err)
      });
      return jsonResponse(503, { error: "dispatch_not_durable" });
    }
  }

  return jsonResponse(202, {
    status: "accepted",
    provider,
    eventType,
    requestId: handle.requestId
  });
}

/**
 * Match an event to its declarative `on[eventType]` binding, gated by `when`.
 * Returns `null` when nothing matches (the event is acknowledged and ignored).
 *
 * Matching is best-effort: a throwing `when` predicate is a benign
 * routing-logic bug, so it's treated as a non-match (logged), not a 5xx — a
 * 5xx would make providers retry an event that can never match. This mirrors
 * the chat transport's "throwing `when` is a non-match" stance. Throws from
 * `input`/`sessionId` (the post-match invocation phase) stay a hard 500.
 */
function matchBinding(
  sub: WebhookSubscriptionConfig,
  event: WebhookInboundEvent,
  logger: InboundTransportHost["logger"]
): WebhookEventBinding | null {
  if (event.eventType === null) return null;
  const binding = sub.on[event.eventType];
  if (binding === undefined) return null;
  try {
    if (binding.when ? binding.when(event) : true) return binding;
  } catch (err) {
    logger?.warn?.("webhook `when` predicate threw — treating as non-match", {
      provider: event.provider,
      eventType: event.eventType,
      error: errorMessage(err)
    });
  }
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
