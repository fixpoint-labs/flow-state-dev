import { isAbsolute, join } from "node:path";

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
  options: { integer?: boolean; bare?: boolean } = {},
): number | undefined {
  if (raw === undefined) {
    if (options.bare) throw new EvalUsageError(`--${flag} requires a value`);
    return undefined;
  }
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

/** Resolve the single database backing used by one eval command. Sweeps default
 * to an isolated database under their output directory; read-only modes use the
 * shared application store unless the caller explicitly selects a data dir. */
export function resolveEvalDataDir(args: {
  mode: "sweep" | "eval" | "variance";
  appDir: string;
  outDir: string;
  dataDir?: string;
}): string | undefined {
  if (args.dataDir !== undefined) {
    return isAbsolute(args.dataDir) ? args.dataDir : join(args.appDir, args.dataDir);
  }
  return args.mode === "sweep" ? join(args.outDir, "data") : undefined;
}
