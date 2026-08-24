/**
 * Per-flow relay-transport configuration types (FIX-1230).
 *
 * A flow declares which inbound relay message kinds it accepts directly on its
 * definition (`relay: { on: { <kind>: binding } }`). Each binding *is an action
 * in relay form*: it carries the shared `ActionCore` (the handler block plus
 * execution policy) inline, alongside the relay-specific input mapping. A relay
 * action lives here, on `flow.relay`, and never in `flow.actions` — so it is
 * message-addressed (selected by the sender's `kind`) and transport-gated (by
 * the framework-stamped relay `source`), not caller-addressed like an HTTP/MCP
 * action.
 *
 * The shape mirrors `webhooks` deliberately: the same `on` map, the same
 * carries-`ActionCore`-inline binding, the same definition-only placement. What
 * differs is who is on the other end — a webhook arrives from outside and is
 * authenticated by signature, a relay message arrives from another session in
 * this same system and is authorized by the seam that stamped its `source`.
 *
 * **Nothing in this file carries authority.** `RelayInboundMessage.from` is
 * informational: it names the sending session, and it is trustworthy only
 * because the transport seam stamps a relay `source` that no caller can set. A
 * binding must never make an authorization decision from `from` alone.
 */

import type { ActionCore } from "./flow";

/**
 * The normalized inbound relay message handed to a flow's relay bindings.
 * Built by the send seam after the recipient's door has been resolved.
 */
export interface RelayInboundMessage<TPayload = unknown> {
  /** The message kind — the `relay.on` map key the sender addressed. */
  kind: string;
  /** The sender's payload. `unknown` by default; narrow via `defineRelayBinding<T>()`. */
  payload: TPayload;
  /** The sending session's id. Informational only — see this file's header. */
  from: string;
}

/**
 * A relay message binding — an action in relay form. It extends the shared
 * `ActionCore` (the handler `block` plus execution policy) with the relay input
 * mapping. Because it carries the core inline, the handler needs no entry in
 * `flow.actions`: it is reached only through a relay delivery, never the public
 * action endpoint or MCP.
 *
 * `durable: true` is REFUSED on a relay binding at construction
 * (see {@link validateRelayConfig}). A relay request is stamped with the relay
 * source, which is never publicly re-enterable, so a suspended relay delivery
 * could never be resumed by retry / continue / resume.
 *
 * That check covers only what a flow definition can express. A handler calling
 * `ctx.suspend()` without declaring `durable` is invisible here and is refused
 * at runtime instead, by the suspend guard. **The two cover different sets, not
 * one set at two times** — neither is redundant, and the construction check is
 * not sufficient on its own.
 */
export interface RelayMessageBinding extends ActionCore {
  /**
   * Map the inbound message to the handler's input. May return a value or a
   * Promise. The result is validated against the binding's `inputSchema`
   * (falling back to `block.inputSchema`) by the runtime, the same way HTTP
   * request bodies are.
   */
  input: (message: RelayInboundMessage) => unknown | Promise<unknown>;
}

/**
 * Per-flow relay configuration. Carried on `FlowDefinition.relay`.
 *
 * Keyed by message kind rather than by provider — unlike `webhooks` there is no
 * third party to namespace against. A kind is an opaque string agreed between
 * sender and recipient; a typo simply never matches, and an unmatched kind is a
 * named refusal rather than a silent drop.
 */
export interface RelayConfig {
  on: Record<string, RelayMessageBinding>;
}

/**
 * Construct a `RelayMessageBinding` whose `input` mapper receives a message with
 * a narrowed `payload`, without annotating the parameter at every call site.
 */
export function defineRelayBinding<TPayload = unknown>(
  binding: Omit<RelayMessageBinding, "input"> & {
    input: (message: RelayInboundMessage<TPayload>) => unknown | Promise<unknown>;
  }
): RelayMessageBinding {
  return binding as RelayMessageBinding;
}

/**
 * Validate a flow's relay declaration at construction.
 *
 * Refuses a binding declaring `durable: true`, by name and with its reason, and
 * refuses a structurally unusable declaration. See {@link RelayMessageBinding}
 * for why the durable check covers only the declared case.
 */
export function validateRelayConfig(
  relay: RelayConfig | undefined,
  flowKind: string
): void {
  if (relay === undefined) return;

  if (relay.on === undefined || typeof relay.on !== "object") {
    throw new Error(
      `Flow "${flowKind}" declares "relay" without an "on" map. ` +
        `Relay bindings are declared as relay: { on: { <kind>: binding } }.`
    );
  }

  for (const [kind, binding] of Object.entries(relay.on)) {
    if (binding === undefined || binding === null) {
      throw new Error(`Flow "${flowKind}" relay binding "${kind}" is empty.`);
    }
    if (typeof binding.input !== "function") {
      throw new Error(
        `Flow "${flowKind}" relay binding "${kind}" has no "input" mapper. ` +
          `A relay binding must map the inbound message to its handler's input.`
      );
    }
    if (binding.durable === true) {
      throw new Error(
        `Flow "${flowKind}" relay binding "${kind}" declares durable: true, which relay refuses. ` +
          `A relay delivery is stamped with the relay source, which is never publicly ` +
          `re-enterable, so a suspended relay request could never be resumed by ` +
          `retry/continue/resume. Remove durable from this binding, or handle the work ` +
          `without ctx.suspend().`
      );
    }
  }
}
