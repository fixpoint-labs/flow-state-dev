import type { BlockDefinition } from "../../types/block";

export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return new Error(value);
  }

  return new Error("Unknown block execution error");
}

export function withTimeout<TValue>(
  promise: Promise<TValue>,
  timeoutMs: number | undefined,
  label: string
): Promise<TValue> {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return promise;
  }

  return new Promise<TValue>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

export function isBlockDefinition(value: unknown): value is BlockDefinition<any, any> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.kind === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.config === "object" &&
    candidate.config !== null
  );
}
