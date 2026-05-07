/**
 * Errors surfaced into `RequestStore.subscribeToEvents` iterators. These
 * arrive as thrown values inside `for await` loops rather than as separate
 * callback parameters — the iterator contract is the only failure channel.
 */
import { FlowError } from "./flow-error";

export const STORE_SUBSCRIPTION_ERROR_CODES = [
  "backpressure_overflow",
  "listen_unrecoverable",
  "liveness_timeout"
] as const;

export type StoreSubscriptionErrorCode =
  (typeof STORE_SUBSCRIPTION_ERROR_CODES)[number];

/**
 * Subscription-time failures from a `RequestStore.subscribeToEvents`
 * iterator. `liveness_timeout` is internal — the iterator surfaces it as
 * a synthetic `request.interrupted` event rather than as an error.
 */
export class StoreSubscriptionError extends FlowError {
  readonly subCode: StoreSubscriptionErrorCode;

  constructor(subCode: StoreSubscriptionErrorCode, message?: string) {
    super(message ?? subCode, {
      code: `store_subscription.${subCode}`,
      retryable: false
    });
    this.name = "StoreSubscriptionError";
    this.subCode = subCode;
  }
}
