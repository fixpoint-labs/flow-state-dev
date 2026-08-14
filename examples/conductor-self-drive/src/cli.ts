/**
 * The example's command surface — the thing you run to see whether the work got
 * done.
 *
 * ```
 * tsx src/cli.ts --list                # every registered operation
 * tsx src/cli.ts --verify              # registry invariants; exit 1 on any violation
 * tsx src/cli.ts <operation> <input>   # run one operation, print the result
 * ```
 *
 * Output is deliberately bare: an operation's result is printed alone, with no
 * label and no decoration, so "did it work" is a string comparison rather than
 * a reading exercise. That is the property the goal check depends on, and the
 * reason it can grade a change conductor made without inspecting the diff.
 */

import { applyOperation, operations, UnknownOperationError, verifyRegistry } from "./operations";

const USAGE = [
  "Usage:",
  "  cli.ts --list",
  "  cli.ts --verify",
  "  cli.ts <operation> <input>",
].join("\n");

/**
 * Run the CLI.
 *
 * @param argv Arguments after the script name.
 * @returns The process exit code — 0 on success, 1 on any failure.
 */
export function main(argv: readonly string[]): number {
  const [first, ...rest] = argv;

  if (first === undefined || first === "--help") {
    console.log(USAGE);
    return first === undefined ? 1 : 0;
  }

  if (first === "--list") {
    for (const operation of operations) {
      console.log(`${operation.name}\t${operation.summary}`);
    }
    return 0;
  }

  if (first === "--verify") {
    const failures = verifyRegistry();
    if (failures.length === 0) {
      console.log(`ok — ${operations.length} operation(s) registered`);
      return 0;
    }
    for (const failure of failures) console.error(`- ${failure}`);
    return 1;
  }

  if (rest.length !== 1) {
    console.error(`Expected exactly one input for operation "${first}".\n${USAGE}`);
    return 1;
  }

  try {
    console.log(applyOperation(first, rest[0]!));
    return 0;
  } catch (error) {
    console.error(error instanceof UnknownOperationError ? error.message : String(error));
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
