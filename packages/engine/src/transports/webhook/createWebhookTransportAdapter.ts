/**
 * Webhook inbound transport adapter. Mounts a single parameterized route,
 * `POST /api/flows/:flowKind/webhooks/:provider`, and dispatches verified
 * inbound webhooks to the action a flow declared in its `webhooks` config.
 *
 * The flow declares routing only (`webhooks: { <provider>: { on } }` in
 * `@flow-state-dev/core`); the host supplies provider mechanics — signature
 * verification, payload parsing, event-type and delivery-id extraction, and
 * optional handshake — here at mount time, keyed by the same provider name.
 * This keeps secrets and Node `crypto` out of the (isomorphic) flow
 * definition. Sibling of the HTTP adapter in `../http`.
 */
import type { WebhookConfig, WebhookInboundEvent } from "@flow-state-dev/core/types";
import type {
  InboundTransportAdapter,
  InboundTransportHost,
  TransportBindings,
  TransportRoute
} from "../types";
import { handleWebhook } from "./routes";

export const WEBHOOK_TRANSPORT_SOURCE = "webhook" as const;

/**
 * How to speak one provider's webhook protocol. Supplied by the host at
 * adapter mount, keyed by the provider name that matches the flow's
 * `webhooks[provider]` declaration.
 */
export interface WebhookProviderDefinition {
  /**
   * Verify the request is authentically from the provider over its raw bytes.
   * Returning `false` (or throwing) rejects the delivery with 401. Compose
   * `stripeWebhookVerifier` / `githubWebhookVerifier` / `slackWebhookVerifier`
   * / `createWebhookVerifier`, or supply your own.
   */
  verify: (rawBody: Uint8Array, headers: Headers) => boolean | Promise<boolean>;
  /**
   * Extract the event-type discriminator used to match the flow's `on` keys.
   * Required when any subscribed flow uses `on`. Provider-specific: Stripe
   * `payload.type`, GitHub `headers.get("x-github-event")`, etc.
   */
  eventType?: (payload: unknown, headers: Headers) => string | null;
  /** Parse the raw body to a payload. Default: `JSON.parse(utf8(rawBody))`. */
  parse?: (rawBody: Uint8Array, headers: Headers) => unknown;
  /** Extract a stable per-delivery id for provenance / downstream dedup. */
  deliveryId?: (payload: unknown, headers: Headers) => string | undefined;
  /**
   * Optional handshake. When it returns a non-null body, the adapter responds
   * 200 with that body and does NOT dispatch — used for Slack's
   * `url_verification` challenge.
   */
  acknowledge?: (event: WebhookInboundEvent) => BodyInit | null;
}

export interface CreateWebhookTransportAdapterOptions {
  /** Provider mechanics, keyed by provider name (the `:provider` URL segment). */
  providers: Record<string, WebhookProviderDefinition>;
  /** Base path for webhook routes. Default `"/api/flows"`. */
  basePath?: string;
}

/**
 * Build an `InboundTransportAdapter` for inbound webhooks. Pass to
 * `createFlowApiRouter({ adapters: [...] })` / `createFlowState`.
 */
export function createWebhookTransportAdapter(
  options: CreateWebhookTransportAdapterOptions
): InboundTransportAdapter {
  const basePath = normalizeBasePath(options.basePath ?? "/api/flows");
  const providers = options.providers;

  return {
    source: WEBHOOK_TRANSPORT_SOURCE,
    createBindings(host: InboundTransportHost): TransportBindings {
      const routes: TransportRoute[] = [
        {
          method: "POST",
          path: `${basePath}/:flowKind/webhooks/:provider`,
          handler: (req, ctx) => handleWebhook(req, ctx, host, providers)
        }
      ];
      return {
        routes,
        // Registration check: fail fast at startup if a flow declares a
        // provider the mount didn't configure, rather than 404-ing at request
        // time when the provider is already live and retrying.
        start: () => assertProvidersCoverSubscriptions(host, providers)
      };
    }
  };
}

/**
 * Fail fast at startup if any registered flow declares a webhook provider the
 * mount didn't configure, or declares `on` subscriptions against a provider
 * whose definition has no `eventType` extractor (without it, `on` keys can
 * never match and events would silently fall through as ignored).
 */
function assertProvidersCoverSubscriptions(
  host: InboundTransportHost,
  providers: Record<string, WebhookProviderDefinition>
): void {
  for (const flow of host.registry.list()) {
    const webhooks = (flow as { webhooks?: WebhookConfig }).webhooks;
    if (webhooks === undefined) continue;
    for (const [provider, sub] of Object.entries(webhooks)) {
      const def = providers[provider];
      if (def === undefined) {
        throw new Error(
          `Webhook adapter: flow "${flow.kind}" declares webhooks for provider ` +
            `"${provider}" but no provider definition was supplied. Add it to ` +
            `createWebhookTransportAdapter({ providers: { "${provider}": { verify, ... } } }).`
        );
      }
      if (sub.on !== undefined && def.eventType === undefined) {
        throw new Error(
          `Webhook adapter: flow "${flow.kind}" provider "${provider}" declares an \`on\` ` +
            `event map, but its provider definition has no \`eventType\` extractor — the ` +
            `\`on\` keys could never match. Add \`eventType\` to the provider definition.`
        );
      }
    }
  }
}

function normalizeBasePath(basePath: string): string {
  let normalized = basePath.trim();
  if (normalized.length === 0) return "";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
