/**
 * Basename of the product checkout the board is operating on.
 *
 * The lab bin fills `CONDUCTOR_REPO=.` when you stand in that checkout.
 * The header shows this so two checkouts are not interchangeable.
 */
import { basename, resolve } from "node:path";

/** Filesystem-safe checkout name, or `undefined` when the env is unset. */
export function conductorRepoLabel(
  raw: string | undefined,
  cwd: string = process.cwd(),
): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return basename(resolve(cwd, trimmed));
}
