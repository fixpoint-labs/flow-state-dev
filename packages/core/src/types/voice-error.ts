/**
 * Typed error class for the voice surface. Providers throw `VoiceError` so
 * callers can branch on a discriminated `kind` instead of parsing message
 * strings, and so retry policies can inspect `retryable` without provider
 * knowledge.
 *
 * `VoiceError` extends `Error` directly rather than `FlowError` — see the
 * FIX-522 design spec §Q4 for rationale. Field naming (`retryable`, `cause`)
 * mirrors `FlowError` for consistency.
 */

/**
 * Discriminator for `VoiceError`. The taxonomy is provider-agnostic: every
 * voice provider implementation classifies its underlying failures into one
 * of these kinds before rethrowing.
 */
export type VoiceErrorKind =
  | "auth"
  | "rate_limit"
  | "not_found"
  | "invalid_input"
  | "format_unsupported"
  | "provider_unavailable"
  | "network"
  | "aborted"
  | "unknown";

/** Default `retryable` value applied when the constructor caller omits it. */
const DEFAULT_RETRYABLE: Record<VoiceErrorKind, boolean> = {
  auth: false,
  rate_limit: true,
  not_found: false,
  invalid_input: false,
  format_unsupported: false,
  provider_unavailable: true,
  network: true,
  aborted: false,
  unknown: false,
};

/** Constructor arguments for {@link VoiceError}. */
export interface VoiceErrorArgs {
  /** Discriminator for downstream branching and retry classification. */
  kind: VoiceErrorKind;
  /** Provider name (`providerName` from the underlying `VoiceProvider`). */
  provider: string;
  /** Human-readable description. */
  message: string;
  /**
   * Whether a retry could succeed. Omit to use the default for `kind`:
   * `rate_limit`, `provider_unavailable`, and `network` default to `true`;
   * all others default to `false`.
   */
  retryable?: boolean;
  /** Optional transport-layer status code (e.g. HTTP 401 / 429 / 503). */
  status?: number;
  /** Underlying error, forwarded via the standard `Error.cause` mechanism. */
  cause?: unknown;
}

/**
 * Discriminated voice error. Thrown by `VoiceProvider` method
 * implementations and `createCompositeVoiceProvider`.
 */
export class VoiceError extends Error {
  readonly kind: VoiceErrorKind;
  readonly provider: string;
  readonly retryable: boolean;
  readonly status?: number;
  override readonly cause?: unknown;

  constructor(args: VoiceErrorArgs) {
    super(args.message, args.cause !== undefined ? { cause: args.cause } : undefined);
    this.name = "VoiceError";
    this.kind = args.kind;
    this.provider = args.provider;
    this.retryable = args.retryable ?? DEFAULT_RETRYABLE[args.kind];
    this.status = args.status;
    this.cause = args.cause;
  }
}
