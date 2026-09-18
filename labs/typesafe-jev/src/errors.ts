/**
 * Failures from the TypeSafe / OpenRouter Decisions call or its host config.
 */

export type TypeSafeErrorCode =
  | "missing_api_key"
  | "missing_questions"
  | "http"
  | "invalid_response";

/**
 * Typed failure for the decision client and the evaluate block.
 * `missing_api_key` means the host did not supply `OPENROUTER_API_KEY`.
 */
export class TypeSafeError extends Error {
  readonly code: TypeSafeErrorCode;
  readonly status?: number;
  readonly body?: string;

  constructor(
    code: TypeSafeErrorCode,
    message: string,
    extras: { status?: number; body?: string } = {},
  ) {
    super(message);
    this.name = "TypeSafeError";
    this.code = code;
    this.status = extras.status;
    this.body = extras.body;
  }
}
