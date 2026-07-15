/** A malformed eval CLI flag. Kept distinct so the entrypoint can return the
 * usage exit code without misclassifying runtime failures. */
export class EvalUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalUsageError";
  }
}

/** Parse an optional positive finite numeric flag. Count-like flags can also
 * require an integer so `--k 1.5` cannot produce ambiguous repeat semantics. */
export function parsePositiveNumberFlag(
  raw: string | undefined,
  flag: string,
  options: { integer?: boolean } = {},
): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  const valid =
    Number.isFinite(value) &&
    value > 0 &&
    (!options.integer || Number.isInteger(value));
  if (!valid) {
    const kind = options.integer ? "a positive integer" : "a positive finite number";
    throw new EvalUsageError(`--${flag} must be ${kind}; received "${raw}"`);
  }
  return value;
}
