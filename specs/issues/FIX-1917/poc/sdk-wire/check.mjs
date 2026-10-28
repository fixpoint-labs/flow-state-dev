#!/usr/bin/env node
/**
 * POC · what Cursor's SDK puts on the stream for a to-do list, and what its
 * `task` messages are. Characterization against the shipped package, not a test
 * of ours: it downloads `@cursor/sdk` at the version `@flow-state-dev/cursor`
 * pins, reads the code that turns the local runtime's events into stream
 * messages, and asserts the four facts FIX-1917's plan record rests on.
 *
 * Experimental; nothing imports it. Run from anywhere:
 *   node specs/issues/FIX-1917/poc/sdk-wire/check.mjs                # the facts: expect PASS
 *   node specs/issues/FIX-1917/poc/sdk-wire/check.mjs --control      # a planted wrong fact: expect FAIL
 *   node specs/issues/FIX-1917/poc/sdk-wire/check.mjs --sdk <dir>    # an unpacked package/ dir instead
 *
 * Exit 0 on PASS, 1 on FAIL. Needs `npm` and network access unless --sdk is given.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../..");
const args = process.argv.slice(2);
const control = args.includes("--control");
const sdkArg = args.includes("--sdk") ? args[args.indexOf("--sdk") + 1] : undefined;

// The version the package pins is the version the record is built against.
const typesSrc = readFileSync(join(repo, "packages/cursor/src/types.ts"), "utf8");
const pinned = /TESTED_SDK_VERSION = "([^"]+)"/.exec(typesSrc)?.[1];
if (!pinned) fail("could not read TESTED_SDK_VERSION from packages/cursor/src/types.ts");

let pkgDir = sdkArg;
if (!pkgDir) {
  const work = mkdtempSync(join(tmpdir(), "fix-1917-sdk-"));
  execFileSync("npm", ["pack", `@cursor/sdk@${pinned}`, "--silent"], { cwd: work, stdio: ["ignore", "pipe", "inherit"] });
  const tgz = readdirSync(work).find((f) => f.endsWith(".tgz"));
  execFileSync("tar", ["-xzf", join(work, tgz), "-C", work]);
  pkgDir = join(work, "package");
}
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
const esm = join(pkgDir, "dist/esm");
const all = readdirSync(esm).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(esm, f), "utf8")).join("\n");

const facts = [
  {
    id: "F1",
    says: "the runtime's update-todos call reaches the SDK as a call of type `updateTodos` whose args are {content, status} pairs only: the SDK keeps no item id and no merge flag",
    re: /case"updateTodosToolCall":\{[\s\S]{0,80}?type:"updateTodos",args:\{todos:[A-Za-z_$]+\.todos\.map\(\(([A-Za-z_$]+)=>\(\{content:\1\.content,status:[A-Za-z_$]+\(\1\.status\)\}\)\)\)\}/,
  },
  {
    id: "F1b",
    says: "the runtime itself does have them: its to-do item carries an id, and its update carries a merge flag, so the args alone may be a partial list",
    re: [
      // Two spellings of one protobuf descriptor: field objects through 1.0.31, a
      // compact "Name|n field type" string from 1.0.32 on.
      /typeName="agent\.v1\.UpdateTodosArgs"[\s\S]{0,120}?name:"todos"[\s\S]{0,60}?name:"merge"|"UpdateTodosArgs\|\d+ todos [^|"]*\|\d+ merge /,
      /typeName="agent\.v1\.TodoItem",[\s\S]{0,80}?name:"id"|"TodoItem\|1 id 9\|/,
    ],
  },
  {
    id: "F1c",
    says: "the call's RESULT carries the whole list after the update, as {content, status} pairs plus a count: the authoritative list",
    re: /"success"===e\.result\.case\?\{status:"success",value:\{todos:[\s\S]{0,120}?\.map\(\(e=>\(\{content:e\.content,status:[A-Za-z_$]+\(e\.status\)\}\)\)\)[\s\S]{0,60}?totalCount:/,
  },
  {
    id: "F2",
    says: "a to-do status is one of pending, inProgress, completed, cancelled",
    re: /[A-Za-z_$]+\.enum\(\["pending","inProgress","completed","cancelled"\]\)/,
  },
  {
    id: "F3",
    says: "a stream tool_call takes its `name` from the converted call's `type` when it has no name, so the to-do call reaches the stream named `updateTodos`",
    re: /"string"==typeof ([A-Za-z_$]+)\.name\?\1\.name:"string"==typeof \1\.type\?\1\.type:"unknown"/,
  },
  {
    id: "F4",
    says: "a `task` stream message is the runtime's `summary` event, text only: a summary of the run, not a to-do list",
    re: /case"summary":return\{type:"task",agent_id:[A-Za-z_$]+,run_id:[A-Za-z_$]+,text:[A-Za-z_$]+\.summary\}/,
  },
  {
    id: "F5",
    says: "plan mode's document (`createPlan`) is a separate call carrying one string, not the to-do list",
    re: /type:"createPlan",args:\{plan:t\.plan\}/,
  },
];
if (control) {
  // Negative control: a fact that is NOT true of the SDK — that to-do items carry an id.
  facts.push({
    id: "C1",
    says: "(planted) to-do items carry an id",
    re: /type:"updateTodos",args:\{todos:[A-Za-z_$]+\.todos\.map\(\(([A-Za-z_$]+)=>\(\{id:\1\.id/,
  });
}

let failed = 0;
console.log(`@cursor/sdk ${version} (pinned ${pinned})`);
if (version !== pinned) {
  console.log(`FAIL  the downloaded SDK is ${version}, not the pinned ${pinned}`);
  failed++;
}
for (const f of facts) {
  const ok = [].concat(f.re).every((re) => re.test(all));
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${f.id}  ${f.says}`);
}
console.log(failed === 0 ? "PASS" : `FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
}
