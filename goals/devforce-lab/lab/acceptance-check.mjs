/**
 * The requester's acceptance check — the executable half of the feature brief.
 *
 * **This file is the contract, and it is deliberately not TypeScript, not a
 * test file, and not inside anything the run can reach.** It lives with the
 * lab, is spawned as its own process against a tree the run produced, and is
 * never copied into a checkout. A check the coding agent could open is a check
 * the coding agent could satisfy by rewriting it, and then `ignores-the-brief`
 * — the control whose whole job is proving irrelevant work gets rejected —
 * cannot fail (D2, BR-3a).
 *
 * It names the module path, the export and the behaviour for both a non-empty
 * and an empty name. It deliberately does NOT run the produced tree's own
 * tests: "the repository's tests pass" is satisfied by any unrelated passing
 * test, and by a vacuous test sitting beside a broken `greet`.
 *
 *   node acceptance-check.mjs <tree>
 *
 * Exit 0 and `ACCEPT` on stdout when the tree satisfies the brief; exit 1 and
 * `REJECT — <reason>` when it does not. A reason, never a stack trace: the leg
 * that runs this reports it verbatim, and both outcomes are expected — the
 * base-ref half of BR-3 requires a REJECT to pass.
 */
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

/** The path the brief names. Changing it changes the contract. */
const MODULE_PATH = "src/greeting.js";
/** The export the brief names. */
const EXPORT_NAME = "greet";

/** What the brief promises, as [input, expected] — more than one non-empty name on purpose. */
const CASES = [
  ["Ada", "Hello, Ada!"],
  ["Grace", "Hello, Grace!"],
  ["", "Hello!"],
];

const reject = (reason) => {
  console.log(`REJECT — ${reason}`);
  process.exit(1);
};

const tree = process.argv[2];
if (tree === undefined) reject("no tree was given to check");

const target = join(resolve(tree), MODULE_PATH);

let module;
try {
  module = await import(pathToFileURL(target).href);
} catch (error) {
  reject(`${MODULE_PATH} could not be imported — ${error instanceof Error ? error.message : String(error)}`);
}

const greet = module[EXPORT_NAME];
if (typeof greet !== "function") {
  reject(`${MODULE_PATH} exports no function named ${EXPORT_NAME} (got ${typeof greet})`);
}

for (const [input, expected] of CASES) {
  let actual;
  try {
    actual = greet(input);
  } catch (error) {
    reject(`${EXPORT_NAME}(${JSON.stringify(input)}) threw — ${error instanceof Error ? error.message : String(error)}`);
  }
  if (actual !== expected) {
    reject(`${EXPORT_NAME}(${JSON.stringify(input)}) returned ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);
  }
}

console.log(`ACCEPT — ${EXPORT_NAME} from ${MODULE_PATH} satisfies all ${CASES.length} stated behaviours`);
