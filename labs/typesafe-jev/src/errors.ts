/**
 * Failures from the evaluate call, the System 2 fallback, or host config.
 * Extends FlowError so `code` survives engine normalization.
 */

import { FlowError } from "@flow-state-dev/core";

export type TypeSafeErrorCode =
  | "missing_api_key"
  | "missing_questions"
  | "invalid_routes"
  | "invalid_state"
  | "unexpected_answer"
  | "http"
  | "invalid_response";

/**
 * Typed failure for the evaluator. `missing_api_key` means the host did
 * not supply a Gateway / TypeSafe / language-model credential.
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
