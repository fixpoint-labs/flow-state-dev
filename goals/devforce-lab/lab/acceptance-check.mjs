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
 * ## The artifact runs in this process, so it must not be able to end it
 *
 * Judging an implementation means importing it, which means artifact-controlled
 * code executes here. A first version of this file took **exit status alone**
 * as the verdict, and that was defeatable in one line: a `src/greeting.js`
 * containing `process.exit(0)` at module scope terminated this process with
 * status 0 before a single assertion ran, and the caller read that as ACCEPT.
 * A wrong implementation passed.
 *
 * Two independent defences close it, because either alone leaves a channel:
 *
 * 1. **Exit-code honesty.** An `exit` hook forces a non-zero status unless the
 *    assertions actually finished, so ending the process early can never leave
 *    a zero behind.
 * 2. **An unforgeable completion record.** ACCEPT is a *positive* signal — a
 *    line naming a caller-generated nonce and the number of cases actually
 *    executed — rather than the absence of a failure. The caller refuses any
 *    verdict whose record is missing, mis-nonced or short of the full case
 *    count, so silence is never success.
 *
 * **The nonce arrives on stdin and is consumed before the artifact is
 * imported** — never through `argv` or the environment, both of which the
 * imported module could read back (`/proc/self/cmdline`, `process.env`) and
 * use to print a convincing forgery.
 *
 * The honest residual limit: this is not a sandbox. Artifact code that runs
 * before the assertions could, in principle, monkey-patch this process. What it
 * cannot do is manufacture a verdict the caller will accept without having let
 * the real assertions run.
 *
 *   node acceptance-check.mjs <tree>      # nonce on stdin
 *
 * Exit 0 with `ACCEPT <nonce> <run>/<total> — …` when the tree satisfies the
 * brief; exit 1 with `REJECT <nonce> — <reason>` when it does not. A reason,
 * never a stack trace: the leg that runs this reports it verbatim, and both
 * outcomes are expected — the base-ref half of BR-3 requires a REJECT to pass.
 */
import { readFileSync } from "node:fs";
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

// ---------------------------------------------------------------------------
// Read the nonce, then make the exit status incapable of lying
// ---------------------------------------------------------------------------

/** Consumed from stdin before any artifact code exists in this process. */
let nonce = "";
try {
  nonce = readFileSync(0, "utf8").trim();
} catch {
  nonce = "";
}

/** How many cases actually executed, and whether we reached a real verdict. */
let casesRun = 0;
let finished = false;

// Defence 1. Reached however the process ends — a normal return, a throw, or
// an artifact's own `process.exit(0)`. Setting `exitCode` here overrides the
// status an explicit exit asked for, so "ended early" can never read as "passed".
process.on("exit", () => {
  if (!finished) {
    process.exitCode = 1;
  }
});

const reject = (reason) => {
  finished = true;
  console.log(`REJECT ${nonce} — ${reason}`);
  process.exit(1);
};

if (nonce === "") {
  reject("no verification nonce was supplied on stdin, so no verdict can be trusted");
}

const tree = process.argv[2];
if (tree === undefined) reject("no tree was given to check");

const target = join(resolve(tree), MODULE_PATH);

// ---------------------------------------------------------------------------
// Everything below this line may execute artifact-controlled code
// ---------------------------------------------------------------------------

let module;
try {
  module = await import(pathToFileURL(target).href);
} catch (error) {
  reject(
    `${MODULE_PATH} could not be imported — ${error instanceof Error ? error.message : String(error)}`,
  );
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
    reject(
      `${EXPORT_NAME}(${JSON.stringify(input)}) threw — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (actual !== expected) {
    reject(
      `${EXPORT_NAME}(${JSON.stringify(input)}) returned ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`,
    );
  }
  casesRun += 1;
}

// Defence 2. The only line that reports success, printed only from here, after
// every case has actually run. The caller checks the nonce and the count.
finished = true;
console.log(
  `ACCEPT ${nonce} ${casesRun}/${CASES.length} — ${EXPORT_NAME} from ${MODULE_PATH} ` +
    `satisfies all ${CASES.length} stated behaviours`,
);
