/**
 * Public result contracts for the relay verbs (FIX-1230).
 *
 * These are surface, not internal returns: a caller branches on them directly,
 * so they are written out once here rather than described. Three things they
 * pin that prose kept leaving open.
 *
 * **`ok` is the house discriminator** — matching `startDetached` and
 * `settleParentTask` — so a caller can branch coarsely without learning the
 * outcome vocabulary. `outcome` then distinguishes the endings that share
 * `ok: true`, and that redundancy is deliberate.
 *
 * **`unknown` is `ok: true`.** A wait that ran out of clock says nothing about
 * whether the delivery happened; putting it on the failure side invites exactly
 * the blind retry the unknown-outcome contract exists to forbid. The caller
 * resolves it through the status verb instead.
 *
 * **Every refusal is RETURNED, never thrown.** A caller promised a refusal
 * value must not receive an exception — including for a recipient's own
 * `reject` policy, which throws underneath and is translated at the verb.
 */

/**
 * Why a send was refused. Fatal to that send and retryable by the caller once
 * it fixes the cause.
 *
 * `unknown-recipient` deliberately covers absent, other-owner and other-tenant
 * with one code: a distinct reason would confirm a session exists across a
 * boundary the caller cannot see past. `recipient-not-addressable` collapses the
 * door cases for the same reason — *which* door was shut is what a confined
 * sender should not learn.
 */
export type SendMessageRefusal =
  /** Absent, another owner, or another tenant — one code, on purpose. */
  | "unknown-recipient"
  /** Sender and recipient disagree on org binding, including unbound-vs-bound. */
  | "org-mismatch"
  /** The delivery would queue behind an arbitration key the sender itself holds. */
  | "key-collision"
  /** The recipient's own `reject` concurrency policy, translated from a throw. */
  | "recipient-busy"
  /**
   * The effective dispatcher is external. Never lifted by a capability flag.
   * Always refuses a blocking wait — no cross-worker wake channel exists — while
   * whether it also refuses fire-and-forget is a release-scope question.
   */
  | "external-dispatcher"
  /**
   * `timeoutMs` is not a finite integer in the supported range. Refused rather
   * than clamped: Node reduces `Infinity`, `NaN` and anything past `2**31 - 1`
   * to a 1 ms timer, so clamping would answer an unbounded wait almost
   * immediately and look like an ordinary timeout.
   */
  | "invalid-timeout"
  /** Neither a declared `relay.on[kind]` nor a `flow.actions[kind]` resolved. */
  | "no-relay-door"
  /** A door exists, but this sender/recipient pair may not use it. */
  | "recipient-not-addressable"
  /** The fallthrough resolved to an action declaring `durable`. */
  | "durable-action"
  /**
   * The sending session was not caller-supplied, so its id is known to nobody.
   * Refused for BOTH modes: status authorizes by sending session, so the
   * delivery id such a caller receives could never be queried by any later
   * request — which is as true of fire-and-forget, whose only feedback path is
   * that status, as it is of a wait's `unknown`.
   */
  | "no-durable-sender"
  /** `waitForResponse` before the waiting half ships. */
  | "mode-not-available"
  /**
   * This process executes requests but was not wired to dispatch one, so there
   * is nothing to send *through*.
   *
   * The sibling of `startDetached`'s `no-start-operation`, and here for the same
   * reason: a deployment whose capabilities dispatch must supply the operation
   * in every process that runs them, and a capability whose precondition a
   * deployment has not met is named rather than silently broken.
   */
  | "no-send-operation";

/**
 * Outcome of {@link sendMessage}. `deliveryRequestId` is present on all three
 * success arms because it is the handle every later question is asked with.
 */
export type SendMessageResult =
  /** Fire-and-forget: the system has accepted the delivery. NOT "it has run". */
  | { readonly ok: true; readonly outcome: "accepted"; readonly deliveryRequestId: string }
  /** The recipient answered, and `reply` is its payload. */
  | {
      readonly ok: true;
      readonly outcome: "replied";
      readonly deliveryRequestId: string;
      readonly reply: unknown;
    }
  /**
   * The wait ran out of clock. This does **not** mean the delivery did not
   * happen — resolve it through the status verb before deciding to retry.
   */
  | { readonly ok: true; readonly outcome: "unknown"; readonly deliveryRequestId: string }
  | {
      readonly ok: false;
      readonly outcome: "refused";
      readonly refused: SendMessageRefusal;
      /** Operator-facing detail. Not a stable contract; branch on `refused`. */
      readonly detail: string;
    };
