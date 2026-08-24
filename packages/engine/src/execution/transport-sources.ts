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

/**
 * Stamped by the relay send seam on a session-to-session delivery — a request
 * created because another session in this same system addressed this one.
 *
 * It is the whole of relay's authorization story, and everything downstream
 * depends on that: `metadata.relay` carries the correlation coordinate, the
 * sending session and the recipient incarnation, and **none of that is
 * authority** — `metadata` is the caller's own bag, spread verbatim by the HTTP
 * action route. A caller who could set this source could present a forged
 * delivery; a caller who cannot may write whatever it likes into `metadata` and
 * still be refused. Every relay guard therefore reads `source === RELAY_SOURCE`
 * first (BP-031).
 *
 * Like {@link WORKSTREAM_SOURCE} it is **never publicly re-enterable**, and for
 * the same stated reason rather than by analogy: a relay delivery has no
 * caller-facing entry at all, so it must have no caller-facing re-entry. It is
 * on the never-list rather than merely absent from the allow-list, so a
 * deployment cannot opt into it through `publicReentrySources` — retry's
 * `inputOverride` would otherwise hand a caller control of the input to a
 * request nobody outside the system originated.
 */
export const RELAY_SOURCE = "relay";
