#!/usr/bin/env node
/**
 * Census for this spec's factual base: every place a conversation's
 * jump-to-latest control, or its scroll rule, is written by hand, and every
 * file that imports a name this spec moves off `@flow-state-dev/react`'s root.
 *
 * Totality: every source file that mentions a scroll rule's markers is
 * classified (the hook, a hook caller, a hand-written button, the registry's
 * rule, a registry copy) or the census fails, so a new copy can't hide.
 *
 *   node specs/issues/FIX-2456/poc/census/census.mjs           # report; exit 1 only on an unclassified file
 *   node specs/issues/FIX-2456/poc/census/census.mjs --plant   # negative control for totality: must exit 1
 *   node specs/issues/FIX-2456/poc/census/census.mjs --after   # the end state: must exit 1 on today's main
 *
 * Retained design evidence, not production code. Not run by CI.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const tracked = execFileSync("git", ["ls-files", "packages", "labs", "apps", "goals"], { cwd: repo, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(tsx?|mts)$/.test(f) && !/(^|\/)(test|tests|__tests__|stories)\//.test(f) && !/\.(test|stories)\.tsx?$/.test(f));

const files = tracked.map((f) => ({ path: f, text: readFileSync(join(repo, f), "utf8") }));
if (process.argv.includes("--plant")) {
  // A third scroll rule nobody listed: a hand-rolled at-the-bottom check in a new app.
  const dir = mkdtempSync(join(tmpdir(), "census-plant-"));
  const text = 'export const atBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 40;\n';
  writeFileSync(join(dir, "Planted.tsx"), text);
  files.push({ path: "labs/planted/src/Planted.tsx", text });
  rmSync(dir, { recursive: true });
}

const REGISTRY = "packages/ui/registry/components/conversation.tsx";
const read = (p) => readFileSync(join(repo, p), "utf8");
const rootText = read("packages/react/src/index.ts");
const registryText = readFileSync(join(repo, REGISTRY), "utf8");

/** What makes a file part of the scroll rule's census. */
const MARKERS = /useJumpToLatest|onClick=\{\w+\.jump\}|\bScrollOnNewRequest\b|scrollHeight - el\.scrollTop - el\.clientHeight/;

const kinds = {
  hook: (f) => f.path === "packages/react/src/hooks/useJumpToLatest.ts",
  "react root export": (f) => f.path === "packages/react/src/index.ts",
  "registry rule (50px + ScrollOnNewRequest)": (f) => f.path === REGISTRY,
  "registry copy (byte-equal)": (f) => f.path !== REGISTRY && f.text === registryText,
  "hand-written jump button": (f) => /onClick=\{\w+\.jump\}/.test(f.text),
  "ScrollOnNewRequest call site": (f) => /<ScrollOnNewRequest\b/.test(f.text),
  "hook caller, no button": (f) => /useJumpToLatest|JumpToLatest\b/.test(f.text),
};

const table = Object.fromEntries(Object.keys(kinds).map((k) => [k, []]));
const unclassified = [];
for (const f of files.filter((f) => MARKERS.test(f.text))) {
  const kind = Object.keys(kinds).find((k) => kinds[k](f));
  (kind ? table[kind] : unclassified).push(f.path);
}

// Importers of the names this spec moves off react's root.
const MOVED = ["Roster", "BoardColumns", "BoardList", "WorkerDetail", "groupIntoColumns", "BOARD_STATUS_COLUMNS", "rosterPropNames", "boardColumnsPropNames", "boardListPropNames",
  "BoardCard", "BoardCardRow", "BoardColumn", "BoardColumnsProps", "BoardColumnsSlots", "BoardListProps", "BoardListSlots", "BoardStatus",
  "PanelRowSource", "PanelItemSource", "PanelLiveSource", "RosterProps", "RosterWorker", "RosterWorkerRow", "RosterSlots", "WorkerDetailProps"];
const rootImport = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']@flow-state-dev\/react["']/g;
const importers = [];
for (const f of tracked.map((p) => ({ path: p, text: readFileSync(join(repo, p), "utf8") })).concat(
  execFileSync("git", ["ls-files", "packages/*/README.md", "apps/docs/docs", "apps/docs/guides"], { cwd: repo, encoding: "utf8" })
    .split("\n").filter((p) => /\.mdx?$/.test(p)).map((p) => ({ path: p, text: readFileSync(join(repo, p), "utf8") })),
  // stories and tests import the root too: count them, they move with the names
  execFileSync("git", ["ls-files", "packages/ui/stories"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean).map((p) => ({ path: p, text: readFileSync(join(repo, p), "utf8") })),
)) {
  for (const m of f.text.matchAll(rootImport)) {
    const names = m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter((n) => MOVED.includes(n));
    if (names.length) importers.push(`${f.path}: ${names.join(", ")}`);
  }
}

for (const [k, v] of Object.entries(table)) console.log(`${k} (${v.length})\n${v.map((p) => `  ${p}`).join("\n")}`);
console.log(`importers of moved panel names from the react root (${new Set(importers).size})\n${[...new Set(importers)].map((p) => `  ${p}`).join("\n")}`);
if (process.argv.includes("--after")) {
  // The end state this spec promises. Each line names what is still there.
  const left = [
    // DevTool keeps its own button by design: a published package takes no copy-in (E4).
    ...table["hand-written jump button"].filter((p) => !p.startsWith("packages/devtool/")).map((p) => `hand-written jump button: ${p}`),
    ...table["ScrollOnNewRequest call site"].map((p) => `ScrollOnNewRequest call site: ${p}`),
    ...(/\bScrollOnNewRequest\b|scrollHeight - el\.scrollTop - el\.clientHeight/.test(registryText) ? [`registry keeps its own rule: ${REGISTRY}`] : []),
    ...(/useJumpToLatest/.test(registryText) ? [] : [`registry Conversation is not on useJumpToLatest: ${REGISTRY}`]),
    ...[...new Set(importers)].map((p) => `moved name imported from the react root: ${p}`),
    // The root itself: a moved name is gone, or (Q1's alias option) carries @deprecated naming the subpath.
    ...MOVED.filter((n) => new RegExp(`\\b${n}\\b`).test(rootText) && !/@deprecated[^*]*react\/workforce/.test(rootText)).map((n) => `still a plain react root export: ${n}`),
    // The registry composer sends by the one rule.
    ...(/\bisSendKey\b/.test(read("packages/ui/registry/components/prompt-input.tsx")) ? [] : ["registry prompt-input keeps its own Enter rule"]),
    // Kitchen Sink's copies are the registry's, byte for byte.
    ...["conversation.tsx", "request-group.tsx", "prompt-input.tsx"].filter((f) => read(`apps/kitchen-sink/components/flow-state/${f}`) !== read(`packages/ui/registry/components/${f}`)).map((f) => `Kitchen Sink's ${f} differs from the registry`),
  ];
  if (left.length) {
    console.error(`NOT THE END STATE (${left.length}):\n${left.map((p) => `  ${p}`).join("\n")}`);
    process.exit(1);
  }
}
if (unclassified.length) {
  console.error(`UNCLASSIFIED (${unclassified.length}):\n${unclassified.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
