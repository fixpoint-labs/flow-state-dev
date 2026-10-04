#!/usr/bin/env node
/**
 * FIX-960 call-site census — re-derives the spec's counted facts from the tree.
 *
 * Every `backing: "sequencer" | "request" | "state"` literal in tracked
 * TypeScript is classified by the call, property or annotation that encloses it
 * (`"state"` is the folded spelling the implementation PR introduced; counting it
 * lets the same run describe the tree before and after):
 *   collection — an argument to getOrCreateTaskCollection (in scope: renamed/folded)
 *   board      — the task-board layer's own vocabulary (out of scope, D2)
 * Totality: a literal that is neither fails the run (exit 1), so a site nobody
 * listed cannot hide. Also reports the exported names the rename touches.
 *
 * Usage (from the repo root):
 *   node specs/issues/FIX-960/poc/call-site-census/census.mjs [--list] [--root <dir>]
 * Retained spec evidence; not part of any package, test glob, or build.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "*.ts", "*.tsx", "*.mts"],
  { cwd: ROOT, encoding: "utf8" }
)
  .split("\n")
  .filter((f) => f && !f.startsWith("specs/") && !f.includes("/dist/"));

/** Blank out comments and string/template contents (keep length and quotes) so brackets match. */
function mask(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && n === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") {
          out += "  ";
          i += 2;
        } else {
          out += src[i] === "\n" ? "\n" : "_";
          i++;
        }
      }
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const COLLECTION_CALLEES = new Set(["getOrCreateTaskCollection"]);
const BOARD_CALLEES = new Set(["createTaskBoardCapability", "buildTaskBoardAccessor"]);
const COLLECTION_TYPES = /GetOrCreateTaskCollectionOptions|SequencerBackingSpec|RequestBackingSpec|StateBackingSpec/;
const BOARD_TYPES = /TaskBoard\w*(Spec|Options)/;

// Sites the syntactic rules can't see, each classified by hand with the reason.
// Keyed by file + the text right before the enclosing brace, never by line number.
const OVERRIDES = [
  // taskBoard({ collection: cond ? defineTaskCollection(...) : { backing: "request", ... } })
  { file: "task-board-resource-wake-stale-ref.test.ts", tail: /\)\s*:$/, kind: "board", why: "ternary arm of taskBoard collection:" },
  // Array<[string, TaskBoardConfig["collection"]]> tuple rows
  { file: "task-board-unpark-and-drain.test.ts", tail: /,$/, kind: "board", why: 'TaskBoardConfig["collection"] tuple' },
  // the board's resolved-config return: { backing: TaskBoardBacking, ... }
  { file: "packages/orchestration/src/task-board/index.ts", tail: /return$/, kind: "board", why: "resolved board config (TaskBoardBacking)" },
];

// Deliberate old-spelling sites: checks that the removed literals are REJECTED
// (the type-test's @ts-expect-error rows, the runtime-rejection unit test).
// Counted apart as `negativeControl`, never as a live collection site.
const NEGATIVE_CONTROL_FILES = [
  "packages/orchestration/src/tasks/collection/tests/task-caps.type-test.ts",
  "packages/orchestration/test/collection/state-backing.test.ts",
];

const LITERAL = /backing\s*:\s*"(sequencer|request|state)"/g;
const sites = [];
const unclassified = [];

for (const file of files) {
  const src = readFileSync(join(ROOT, file), "utf8");
  if (!src.includes("backing")) continue;
  const m = mask(src);
  for (const hit of src.matchAll(LITERAL)) {
    if (m.slice(hit.index, hit.index + 7) !== "backing") continue; // inside a comment or string
    // Walk back to the unmatched `{` that encloses this property.
    let depth = 0;
    let j = hit.index - 1;
    for (; j >= 0; j--) {
      const ch = m[j];
      if (ch === "}" || ch === ")" || ch === "]") depth++;
      else if (ch === "{" || ch === "(" || ch === "[") {
        if (depth === 0) break;
        depth--;
      }
    }
    const before = m.slice(Math.max(0, j - 300), j).replace(/\s+$/, "");
    let kind = null;
    let via = "";
    const call = before.match(/([A-Za-z_$][\w$]*)\s*(<[^()]*>)?\s*\($/);
    const prop = before.match(/([A-Za-z_$][\w$]*)\s*:$/);
    const typed = before.match(/:\s*([A-Za-z_$][\w$<>,.[\] ]*)\s*=$/);
    const satisfies = before.match(/satisfies\s+([\w$<>,.[\] ]*)$/);
    if (call) {
      via = `${call[1]}(`;
      if (COLLECTION_CALLEES.has(call[1])) kind = "collection";
      else if (BOARD_CALLEES.has(call[1])) kind = "board";
    } else if (prop) {
      via = `${prop[1]}:`;
      if (prop[1] === "collection") kind = "board"; // taskBoard({ collection: { backing } })
    } else if (typed) {
      via = `typed ${typed[1].trim()}`;
      if (COLLECTION_TYPES.test(typed[1])) kind = "collection";
      else if (BOARD_TYPES.test(typed[1])) kind = "board";
    } else if (satisfies) {
      via = `satisfies ${satisfies[1].trim()}`;
    }
    const iface = before.match(/interface\s+([A-Za-z_$][\w$]*)[^{]*$/);
    if (!kind && iface) {
      via = `interface ${iface[1]}`;
      if (COLLECTION_TYPES.test(iface[1])) kind = "collection-decl";
      else if (BOARD_TYPES.test(iface[1])) kind = "board";
    }
    if (hit[1] !== "state" && NEGATIVE_CONTROL_FILES.includes(file)) {
      kind = "negative-control";
      via = "asserts the removed literal is rejected";
    }
    if (!kind) {
      const o = OVERRIDES.find((o) => file.endsWith(o.file) && o.tail.test(before));
      if (o) {
        kind = o.kind;
        via = `override: ${o.why}`;
      }
    }
    const line = src.slice(0, hit.index).split("\n").length;
    const area = /(^|\/)(test|tests)\/|\.test\.|\.spec\.|type-test/.test(file) ? "test" : "source";
    const pkg = file.split("/").slice(0, 2).join("/");
    const rec = { file, line, arm: hit[1], kind, via, area, pkg, context: before.slice(-60).replace(/\s+/g, " ") };
    (kind ? sites : unclassified).push(rec);
  }
}

const TASKS_INDEX = readFileSync(join(ROOT, "packages/orchestration/src/tasks/index.ts"), "utf8");
const EXPORTS = ["createSequencerBackedTaskCollection", "SequencerBackedOptions", "SequencerBackingSpec", "RequestBackingSpec"];
const exported = EXPORTS.filter((n) => new RegExp(`\\b${n}\\b`).test(TASKS_INDEX));

// Code (not comment/string) references to each renamed export, by area.
const references = {};
for (const name of EXPORTS) references[name] = { source: 0, test: 0, files: 0 };
for (const file of files) {
  const text = readFileSync(join(ROOT, file), "utf8");
  if (!EXPORTS.some((n) => text.includes(n))) continue;
  const code = mask(text);
  const area = /(^|\/)(test|tests)\/|\.test\.|\.spec\.|type-test/.test(file) ? "test" : "source";
  for (const name of EXPORTS) {
    const n = (code.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
    if (n > 0) {
      references[name][area] += n;
      references[name].files++;
    }
  }
}

const count = (pred) => sites.filter(pred).length;
const src = (s) => s.kind === "collection" && s.area === "source";
const byPkg = {};
for (const s of sites.filter(src)) byPkg[s.pkg] = (byPkg[s.pkg] ?? 0) + 1;

const report = {
  collection: {
    source: count(src),
    test: count((s) => s.kind === "collection" && s.area === "test"),
    sourceByPackage: byPkg,
    sourceByArm: {
      sequencer: count((s) => src(s) && s.arm === "sequencer"),
      request: count((s) => src(s) && s.arm === "request"),
      state: count((s) => src(s) && s.arm === "state"),
    },
    testByArm: {
      sequencer: count((s) => s.kind === "collection" && s.area === "test" && s.arm === "sequencer"),
      request: count((s) => s.kind === "collection" && s.area === "test" && s.arm === "request"),
      state: count((s) => s.kind === "collection" && s.area === "test" && s.arm === "state"),
    },
  },
  board: {
    source: count((s) => s.kind === "board" && s.area === "source"),
    test: count((s) => s.kind === "board" && s.area === "test"),
  },
  negativeControl: count((s) => s.kind === "negative-control"),
  exportedNamesRenamed: exported,
  references,
  unclassified: unclassified.map((u) => `${u.file}:${u.line} (${u.via || "?"}) …${u.context}`),
};

console.log(JSON.stringify(report, null, 2));
if (args.includes("--list")) {
  for (const s of sites) console.log(`${s.kind}\t${s.area}\t${s.arm}\t${s.file}:${s.line}\t${s.via}`);
}
if (unclassified.length > 0) {
  console.error(`FAIL: ${unclassified.length} backing literal(s) not classified as collection or board`);
  process.exit(1);
}
