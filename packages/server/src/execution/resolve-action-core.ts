/**
 * Resolve the action core to execute for a dispatched request.
 *
 * An action comes in two forms that share `ActionCore` (the handler block plus
 * execution policy), so the runtime runs them identically — it only needs to
 * find the right one:
 *
 * - a caller-addressed `ActionConfig` in `flow.actions` (HTTP / MCP), named by
 *   the caller;
 * - an event-addressed webhook binding in `flow.webhooks[provider].on[event]`,
 *   selected by the provider's event type.
 *
 * A webhook dispatch carries the `(provider, eventType)` coordinate in
 * `metadata.webhook` (stamped by the webhook adapter and persisted on the
 * request record). When present, resolution reads `flow.webhooks`; otherwise it
 * falls back to the named action. This is the single seam that lets a webhook
 * handler be a first-class action without ever appearing in `flow.actions`.
 */
import type { ActionCore, FlowInstance, WebhookConfig } from "@flow-state-dev/core/types";

type WebhookDispatchMetadata = {
  webhook?: { provider?: string; eventType?: string | null };
};

/**
 * Find the `ActionCore` for a dispatch. Returns `undefined` when neither a
 * webhook binding nor a named action matches — callers decide whether that is
 * a hard error (initial dispatch) or a tolerable absence (optional prefetch /
 * token-budget reads).
 */
export function resolveActionCore(
  flow: FlowInstance,
  actionName: string,
  metadata: unknown
): ActionCore | undefined {
  const webhook = (metadata as WebhookDispatchMetadata | undefined)?.webhook;
  if (
    webhook !== undefined &&
    typeof webhook.provider === "string" &&
    typeof webhook.eventType === "string"
  ) {
    const binding = (flow as { webhooks?: WebhookConfig }).webhooks?.[webhook.provider]?.on?.[
      webhook.eventType
    ];
    if (binding !== undefined) return binding;
  }
  return flow.actions[actionName];
}
