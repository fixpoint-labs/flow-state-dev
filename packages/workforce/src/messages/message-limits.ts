/**
 * The two limits on worker messages (FIX-1989 D2) an app sets through
 * `hireWorkforce`'s `messages`: how many messages a chain may pass with no
 * user in between (`hopLimit`), and how many one turn may send
 * (`perTurn`). A leaf module, so the session kit reads them without importing
 * the installation.
 */

/** A chain of worker messages with no user in between stops after this many, when the app sets none. */
export const DEFAULT_MESSAGE_HOP_LIMIT = 6;

/** One turn sends at most this many messages, when the app sets none. */
export const DEFAULT_MESSAGES_PER_TURN = 3;

/** What `hireWorkforce`'s `messages` takes. */
export interface MessageLimits {
  /** The most worker messages in a chain with no user's turn between them. Omitted, 6. */
  readonly hopLimit?: number;
  /** The most messages one turn sends. Omitted, 3. */
  readonly perTurn?: number;
}

const limits = new WeakMap<object, Required<MessageLimits>>();

/**
 * Set the message limits for `installation`. `hireWorkforce`'s `messages` calls it.
 *
 * @throws When a limit isn't a whole number of at least one.
 */
export function setMessageLimits(installation: object, given: MessageLimits): void {
  for (const [key, value] of Object.entries(given)) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new Error(`hireWorkforce: messages.${key} must be a whole number of at least 1; got ${String(value)}.`);
    }
  }
  limits.set(installation, {
    hopLimit: given.hopLimit ?? DEFAULT_MESSAGE_HOP_LIMIT,
    perTurn: given.perTurn ?? DEFAULT_MESSAGES_PER_TURN
  });
}

/** The message limits `installation`'s `hireWorkforce` set, or the defaults. */
export function messageLimitsOf(installation: object): Required<MessageLimits> {
  return limits.get(installation) ?? { hopLimit: DEFAULT_MESSAGE_HOP_LIMIT, perTurn: DEFAULT_MESSAGES_PER_TURN };
}
