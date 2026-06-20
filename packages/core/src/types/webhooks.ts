/**
 * Per-flow webhook-transport configuration types.
 *
 * A flow declares which inbound webhook events trigger which of its actions
 * directly on its definition (`webhooks: { <provider>: { on: { ... } } }`),
 * mirroring the per-flow declarative pattern Chat (`chat`), MCP (`mcp`), and
 * Scheduled (`schedules`) already use. The `@flow-state-dev/server` webhook
 * adapter discovers these declarations by reading the flow registry at
 * request time — the flowKind is carried in the URL — and dispatches the
 * matching event to the named action.
 *
 * Division of labour (the webhook transport's defining trait): the *flow*
 * declares routing only — which event maps to which action — and carries no
 * secrets. Signature verification and payload mechanics (how to read a
 * provider's event type, delivery id, and handshake) are supplied by the
 * *host* at adapter mount, keyed by the same provider name. See
 * `WebhookProviderDefinition` in `@flow-state-dev/server`. Verification needs
 * Node `crypto`, which is not isomorphic, so it cannot live in this package;
 * the routing declaration here stays browser-safe.
 *
 * Unlike chat, the inbound event shape is framework-owned, so
 * `WebhookInboundEvent` is concrete here. `payload` is `unknown` and is
 * narrowed via `defineWebhookBinding<TPayload>()`.
 */

/**
 * The normalized inbound webhook event handed to a flow's webhook bindings.
 * The adapter builds it after verifying the signature and parsing the body.
 */
export interface WebhookInboundEvent<TPayload = unknown> {
  /** Provider key — the `:provider` URL segment and `webhooks` map key (e.g. `"stripe"`). */
  provider: string;
  /** Discriminator produced by the host provider's `eventType` extractor, or `null`. */
  eventType: string | null;
  /** Parsed request body. `unknown` by default; narrow via `defineWebhookBinding<T>()`. */
  payload: TPayload;
  /** Raw request headers. */
  headers: Headers;
  /** Exact request bytes, preserved for advanced re-verification. */
  rawBody: Uint8Array;
  /** Stable per-delivery id from the host provider's `deliveryId` extractor, if configured. */
  deliveryId?: string;
}

/**
 * Binding from one event-type key to one action. Mirrors `ChatEventBinding`.
 *
 * `input` and `sessionId` may return a value or a Promise — the adapter
 * awaits before constructing the dispatch envelope. `when` is synchronous:
 * the adapter evaluates it in the hot path before any async work so the
 * no-match case stays cheap.
 */
export interface WebhookEventBinding {
  /**
   * Action to invoke when this binding matches. Must be a key in
   * `flow.actions`; validated at registration via `validateWebhookConfig`.
   */
  action: string;
  /**
   * Map the inbound event to the action's input. May return a value or a
   * Promise. The result is validated against the action's `inputSchema` by
   * the runtime, the same way HTTP request bodies are.
   */
  input: (event: WebhookInboundEvent) => unknown | Promise<unknown>;
  /**
   * Derive the session id from the event. May return a value or a Promise.
   * When omitted (or it resolves to `undefined`), the runtime creates a
   * fresh ephemeral session — a webhook has no thread to key on.
   */
  sessionId?: (event: WebhookInboundEvent) => string | Promise<string> | undefined;
  /**
   * Synchronous predicate. When provided and falsy for an event, the binding
   * does not match and no flow runs. Use it to narrow a coarse event type to
   * a sub-action, e.g. `when: (e) => e.payload.action === "opened"`.
   */
  when?: (event: WebhookInboundEvent) => boolean;
}

/** Result of the imperative `route` escape hatch. */
export interface WebhookRouteResult {
  action: string;
  input: unknown;
  sessionId?: string;
}

/**
 * Per-provider routing declared on the flow. Pure routing — no secrets, no
 * crypto. Verification and payload mechanics live on the host's
 * `WebhookProviderDefinition`, keyed by the same provider name.
 */
export interface WebhookSubscriptionConfig {
  /**
   * Declarative event → action map. Each key is matched by exact string
   * equality against the host provider's extracted `eventType`. Primary
   * surface; takes precedence over `route` when a key matches. Keys are
   * opaque strings — a typo simply never matches.
   */
  on?: Record<string, WebhookEventBinding>;
  /**
   * Imperative routing escape hatch. Consulted only when no `on` binding
   * matched. Returns an action invocation, or `null` to acknowledge and
   * ignore the event.
   */
  route?: (event: WebhookInboundEvent) => WebhookRouteResult | null;
}

/**
 * Per-flow webhook configuration. Carried on `FlowDefinition.webhooks`,
 * keyed by provider — the `:provider` URL segment the adapter mounts.
 */
export type WebhookConfig = Record<string, WebhookSubscriptionConfig>;

// ---------------------------------------------------------------------------
// Typed binding helper
// ---------------------------------------------------------------------------

/**
 * Construct a `WebhookEventBinding` whose handlers receive an event with a
 * typed `payload` instead of `unknown`. Place the result directly in a
 * flow's `webhooks[provider].on` map. Compile-time convenience only — the
 * runtime is a single passthrough. (The cast bridges the function-parameter
 * variance that prevents a typed binding from being assignable directly.)
 */
export function defineWebhookBinding<TPayload = unknown>(binding: {
  action: string;
  input: (event: WebhookInboundEvent<TPayload>) => unknown | Promise<unknown>;
  sessionId?: (event: WebhookInboundEvent<TPayload>) => string | Promise<string> | undefined;
  when?: (event: WebhookInboundEvent<TPayload>) => boolean;
}): WebhookEventBinding {
  return binding as unknown as WebhookEventBinding;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a flow's `webhooks` config at registration time. No-op when
 * `webhooks` is absent. Throws when a provider declares neither `on` nor
 * `route`, a `route` is not a function, an `on` binding references an unknown
 * action, a binding's `input`/`sessionId`/`when` is present-but-not-a-function,
 * or a provider/event key is empty. Event-key spelling is NOT validated
 * against any provider vocabulary — keys are opaque strings.
 *
 * Throws plain `Error`, matching `validateChatConfig` / `validateSchedulesConfig`;
 * the adapter translates a registration failure into a hard startup abort.
 */
export function validateWebhookConfig(
  flowKind: string,
  webhooks: WebhookConfig | undefined,
  actions: Record<string, unknown>
): void {
  if (webhooks === undefined) return;

  for (const [provider, sub] of Object.entries(webhooks)) {
    if (provider.length === 0) {
      throw new Error(
        `Flow "${flowKind}" declares a webhook provider with an empty name. ` +
          `Use a non-empty provider key (e.g. "stripe", "github").`
      );
    }

    if (sub === null || typeof sub !== "object") {
      throw new Error(
        `Flow "${flowKind}" webhook provider "${provider}" must be an object with ` +
          `at least an \`on\` map or a \`route\` function.`
      );
    }

    const hasOn = sub.on !== undefined;
    const hasRoute = sub.route !== undefined;
    if (!hasOn && !hasRoute) {
      throw new Error(
        `Flow "${flowKind}" webhook provider "${provider}" declares neither \`on\` ` +
          `nor \`route\`. Add an \`on\` event map or a \`route\` function.`
      );
    }

    if (hasRoute && typeof sub.route !== "function") {
      throw new Error(
        `Flow "${flowKind}" webhook provider "${provider}" has a \`route\` that is ` +
          `not a function. Provide a function mapping the event to an action, or omit it.`
      );
    }

    if (sub.on === undefined) continue;

    for (const [eventKey, binding] of Object.entries(sub.on)) {
      if (eventKey.length === 0) {
        throw new Error(
          `Flow "${flowKind}" webhook provider "${provider}" has a subscription with ` +
            `an empty event key. Use a non-empty event name (e.g. "invoice.paid").`
        );
      }

      if (binding === null || typeof binding !== "object") {
        throw new Error(
          `Flow "${flowKind}" webhook subscription "${provider}.${eventKey}" must be an ` +
            `object with at least an \`action\` and \`input\`.`
        );
      }

      if (!(binding.action in actions)) {
        const known = Object.keys(actions).join(", ") || "<none>";
        throw new Error(
          `Flow "${flowKind}" webhook subscription "${provider}.${eventKey}" references ` +
            `action "${binding.action}" but no such action is declared. Defined actions: ${known}.`
        );
      }

      if (typeof binding.input !== "function") {
        throw new Error(
          `Flow "${flowKind}" webhook subscription "${provider}.${eventKey}" must declare ` +
            `\`input\` as a function mapping the event to the action's input.`
        );
      }

      if (binding.sessionId !== undefined && typeof binding.sessionId !== "function") {
        throw new Error(
          `Flow "${flowKind}" webhook subscription "${provider}.${eventKey}" has a ` +
            `\`sessionId\` that is not a function. Provide a function deriving the session ` +
            `id from the event, or omit it.`
        );
      }

      if (binding.when !== undefined && typeof binding.when !== "function") {
        throw new Error(
          `Flow "${flowKind}" webhook subscription "${provider}.${eventKey}" has a \`when\` ` +
            `that is not a function. Provide a synchronous predicate over the event, or omit it.`
        );
      }
    }
  }
}
