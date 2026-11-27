/**
 * Shared commander option helpers for the fsdev CLI commands.
 *
 * Flat module alongside `exit-codes.ts` / `load-config.ts`. Extracted so the
 * repeatable-option accumulator lives in one place rather than being copied into
 * each command (`run` / `dev` / `chat` / `serve`).
 */

/** Commander accumulator for repeatable options (e.g. `--flow-dir`, `--dotenv`). */
export function collectValues(value: string, previous: string[] | undefined): string[] {
  return (previous ?? []).concat(value);
}
