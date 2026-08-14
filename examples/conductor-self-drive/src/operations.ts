/**
 * The example's whole subject: a registry of named string operations.
 *
 * This file is deliberately the smallest thing a work item can be about. When
 * conductor is handed "add the `reverse` operation to the example app", this is
 * the file it edits, and the change is either there or it is not — `apply` runs
 * or throws, and the registry lists the name or it does not. No judgement call
 * is involved in deciding whether the work was done.
 *
 * Kept dependency-free on purpose. The change conductor makes has to be
 * runnable from a bare git worktree with no `node_modules` in it, which is
 * where a dispatched phase does its work.
 */

/** One named transformation of a string. */
export interface Operation {
  /** How the operation is named on the command line. Unique within the registry. */
  readonly name: string;
  /** One line, shown by `--list`. */
  readonly summary: string;
  /** The transformation itself. Total — every string has an answer. */
  apply(input: string): string;
}

/**
 * Every operation the example knows.
 *
 * Adding one means adding an entry here. That is the entire extension point,
 * and it is what a work item against this example asks for.
 */
export const operations: readonly Operation[] = [
  {
    name: "upper",
    summary: "Uppercase every character.",
    apply: (input) => input.toUpperCase(),
  },
  {
    name: "lower",
    summary: "Lowercase every character.",
    apply: (input) => input.toLowerCase(),
  },
];

/** Asked for an operation the registry does not have. */
export class UnknownOperationError extends Error {
  constructor(readonly requested: string) {
    super(
      `Unknown operation ${JSON.stringify(requested)}. Known: ` +
        operations.map((operation) => operation.name).join(", "),
    );
    this.name = "UnknownOperationError";
  }
}

/** The operation registered under `name`, or `undefined`. */
export function findOperation(name: string): Operation | undefined {
  return operations.find((operation) => operation.name === name);
}

/**
 * Run one operation.
 *
 * @throws {UnknownOperationError} when nothing is registered under `name`.
 */
export function applyOperation(name: string, input: string): string {
  const operation = findOperation(name);
  if (!operation) throw new UnknownOperationError(name);
  return operation.apply(input);
}

/**
 * Check the registry still holds together — unique names, a summary on each,
 * and an `apply` that returns a string.
 *
 * This is what "did the change break anything" means for this example, and it
 * is a command rather than a review: `cli.ts --verify` exits non-zero on any
 * failure. An operation added carelessly (a duplicate name, a missing summary,
 * an `apply` that returns `undefined`) fails here.
 *
 * @returns One line per violation. Empty means the registry is sound.
 */
export function verifyRegistry(): string[] {
  const failures: string[] = [];
  const seen = new Set<string>();

  for (const operation of operations) {
    if (operation.name.trim() === "") {
      failures.push("an operation has an empty name");
      continue;
    }
    if (seen.has(operation.name)) failures.push(`duplicate operation name "${operation.name}"`);
    seen.add(operation.name);

    if (operation.summary.trim() === "") {
      failures.push(`operation "${operation.name}" has no summary`);
    }
    if (typeof operation.apply !== "function") {
      failures.push(`operation "${operation.name}" has no apply function`);
      continue;
    }

    let probe: unknown;
    try {
      probe = operation.apply("flow state");
    } catch (error) {
      failures.push(`operation "${operation.name}" threw on a plain input: ${String(error)}`);
      continue;
    }
    if (typeof probe !== "string") {
      failures.push(`operation "${operation.name}" returned ${typeof probe}, not a string`);
    }
  }

  if (operations.length === 0) failures.push("the registry is empty");
  return failures;
}
