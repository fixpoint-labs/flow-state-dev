/**
 * Resolve the action core to execute for a dispatched request.
 *
 * An action comes in two forms that share `ActionCore` (the handler block plus
 * execution policy), so the runtime runs them identically — it only needs to
 * find the right one:
 *
 * - a caller-addressed `ActionConfig` in `flow.actions` (HTTP / MCP), named by
 *   the caller and authorized per principal;
 * - an event-addressed webhook binding in `flow.webhooks[provider].on[event]`,
 *   selected by the provider's event type and trusted by the signature check.
 *
 * A webhook dispatch carries the `(provider, eventType)` coordinate in
 * `metadata.webhook` (stamped by the webhook adapter and persisted on the
 * request record). When present, resolution reads `flow.webhooks`; otherwise it
 * falls back to the named action. This is the single seam that lets a webhook
 * handler be a first-class action without ever appearing in `flow.actions`.
 *
 * Security: the webhook branch is gated on `source === "webhook"`. That source
 * is set only by the webhook adapter, internally, never from a request body —
 * whereas `metadata` on a caller-addressed dispatch (the HTTP action endpoint
 * spreads `body.metadata`) is attacker-controlled. Without the source gate, a
 * caller could POST `{ metadata: { webhook: { provider, eventType } } }` to the
 * public action endpoint and pivot resolution into `flow.webhooks`, running a
 * webhook handler with forged input and no signature verification. The gate is
 * the chokepoint that closes that pivot for every caller-addressed surface at
 * once, independent of which route forwards caller metadata.
 */
import type { ActionCore, FlowInstance } from "@flow-state-dev/core/types";

/**
 * Transport source set by the webhook adapter on its dispatch envelope. Kept as
 * a local literal (not imported from `transports/webhook`) to avoid an
 * `execution → transports` import cycle; it must stay in sync with
 * `WEBHOOK_TRANSPORT_SOURCE`.
 */
const WEBHOOK_SOURCE = "webhook";

type WebhookDispatchMetadata = {
  webhook?: { provider?: string; eventType?: string | null };
};

/**
 * Find the `ActionCore` for a dispatch. The webhook binding is resolved only
 * for a genuine webhook dispatch (`source === "webhook"`); every other source
 * resolves the named `flow.actions` entry, so a caller cannot reach a webhook
 * handler by injecting `metadata.webhook`. Returns `undefined` when neither a
 * webhook binding nor a named action matches — callers decide whether that is a
 * hard error (initial dispatch) or a tolerable absence (optional prefetch /
 * token-budget reads).
 */
export function resolveActionCore(
  flow: FlowInstance,
  actionName: string,
  source: string | undefined,
  metadata: unknown
): ActionCore | undefined {
  if (source === WEBHOOK_SOURCE) {
    const webhook = (metadata as WebhookDispatchMetadata | undefined)?.webhook;
    if (
      webhook !== undefined &&
      typeof webhook.provider === "string" &&
      typeof webhook.eventType === "string"
    ) {
      const binding = flow.webhooks?.[webhook.provider]?.on?.[webhook.eventType];
      if (binding !== undefined) return binding;
    }
  }
  return flow.actions[actionName];
}
