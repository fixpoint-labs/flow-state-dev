/**
 * The substrate's task-id minter.
 *
 * Task ids (`collection/internal.ts`) are the one caller: a value that is
 * unique within a process without a dependency on `crypto`, never persisted
 * for cross-process comparison. Write-provenance token ids
 * (`write-provenance.ts`) used to share this — they no longer do, because a
 * receipt id is persisted (in `task.writeLog`) and compared across processes
 * by `didWriteLand`, which this generator's per-process counter and 24-bit
 * random tail cannot guarantee against a collision on. That id is minted with
 * `crypto.randomUUID()` instead. Task ids stay on this generator — that
 * scheme is pre-existing and changing its format is a separate compatibility
 * question.
 */

let counter = 0;

/**
 * A process-unique id under `prefix`.
 *
 * Three parts, and each is doing something: the timestamp keeps ids roughly
 * ordered when a human reads them, the counter guarantees uniqueness within a
 * millisecond, and the random tail keeps two processes minting at the same
 * millisecond from colliding. Not a UUID and not claimed to be — nothing
 * compares these across machines.
 */
export function generateId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}_${Math.random().toString(16).slice(2, 8)}`;
}
