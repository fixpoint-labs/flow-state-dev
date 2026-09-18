/**
 * Failures from the TypeSafe / OpenRouter Decisions call or its host config.
 * Extends FlowError so `code` survives engine normalization.
 */

import { FlowError } from "@flow-state-dev/core";

export type TypeSafeErrorCode =
  | "missing_api_key"
  | "missing_questions"
  | "http"
  | "invalid_response";

/**
 * Typed failure for the decision client and the evaluate block.
 * `missing_api_key` means the host did not supply `OPENROUTER_API_KEY`.
 */
export class TypeSafeError extends FlowError {
  override readonly code: TypeSafeErrorCode;

  constructor(
    code: TypeSafeErrorCode,
    message: string,
    extras: { status?: number; body?: string } = {},
  ) {
    super(message, {
      code,
      details:
        extras.status !== undefined || extras.body !== undefined
          ? { status: extras.status, body: extras.body }
          : undefined,
    });
    this.name = "TypeSafeError";
    this.code = code;
  }

  get status(): number | undefined {
    const value = this.details?.status;
    return typeof value === "number" ? value : undefined;
  }

  get body(): string | undefined {
    const value = this.details?.body;
    return typeof value === "string" ? value : undefined;
  }
}
