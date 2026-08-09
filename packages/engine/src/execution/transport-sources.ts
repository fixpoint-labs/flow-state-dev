/**
 * Transport sources stamped by the runtime, in one place (FIX-999).
 *
 * Importing these from `transports/*` would create an `execution → transports`
 * cycle, which is why they had been re-declared locally per consumer. This
 * module imports nothing at all, so depending on it cannot create a cycle in
 * either direction, and every runtime-stamped source lives here.
 *
 * A source is trusted precisely because a caller cannot set it: it is stamped by
 * the adapter (or, for the detached source below, by the injection seam itself)
 * and persisted on the request record. Every authorization branch that reads one
 * depends on that (BP-031).
 */

/** Stamped by the webhook adapter. Resolves the flow's webhook event core. */
export const WEBHOOK_SOURCE = "webhook";

/** Stamped by the chat adapter. Resolves the flow's chat event core. */
export const CHAT_SOURCE = "chat";

/** Stamped by the scheduled adapter. Resolves the flow's schedule event core. */
export const SCHEDULED_SOURCE = "scheduled";

/**
 * Stamped by the injection seam on a detached dispatch — a request started from
 * inside a running block rather than by a caller.
 *
 * It resolves exactly one pre-assembled entry, the flow's workstream core, and
 * resolution is **terminal** for it: absent core means a named refusal, never a
 * fall-through to `flow.actions`. It is also deliberately absent from the public
 * re-entry allow-list, so a detached request cannot be retried, continued or
 * resumed from a public surface.
 */
export const WORKSTREAM_SOURCE = "workstream";
