/**
 * The substrate's id minter — one implementation, two callers.
 *
 * Task ids (`collection/internal.ts`) and write-provenance token ids
 * (`write-provenance.ts`) need the same thing: a value that is unique within a
 * process without a dependency on `crypto`. It lives here rather than being
 * inlined twice because two copies of an id generator drift, and because
 * `write-provenance.ts` cannot import `collection/internal.ts` — that module
 * imports back from it for a fresh task's initial provenance.
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
