#!/usr/bin/env node
// FIX-2852 spec evidence, retained with the spec. Not production code.
//
// Counts the source each app writes to draw a conversation's lines, leaving
// out the UI registry's copies, as the issue asks. Three rules:
//
//  1. A file under an app's `components/flow-state/` that is byte-identical to
//     its registry source counts 0. A copy the app changed counts only the
//     lines it changed (against a longest common subsequence with the source).
//  2. Each app's line files (LINE_FILES) count every non-blank line.
//  3. Totality: every other file that draws or wires a line (DRAWS: any prop typed as a line's
//     item or value, under any name, so markup moved out of a line file is caught) must be in
//     LINE_FILES or in DECLARED_OUT with its reason, or the run fails. A line
//     renderer added under a new name can't hide from the count.
//
// Run from the repo root, against any checkout (a worktree of the branch):
//   node specs/issues/FIX-2852/poc/line-count/count.mjs --root <checkout> [--files] [--base <checkout>]
// Negative control (plants in memory; every plant must be caught):
//   node specs/issues/FIX-2852/poc/line-count/count.mjs --root <checkout> --control
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const ROOT = arg("--root") ?? process.cwd();
const control = process.argv.includes("--control");
const listFiles = process.argv.includes("--files");

const APPS = {
  "Shift Manager": ["packages/shift-manager/src"],
  Teammates: ["labs/teammates/src"],
  "Claude Code-style": ["labs/claude-code-style/src"],
  "Kitchen Sink": ["apps/kitchen-sink/app", "apps/kitchen-sink/components", "apps/kitchen-sink/lib"],
};
const REGISTRY = "packages/ui/registry/components";
/** The shared files this issue adds, extends or removes: the only ones the net's "shared" side counts. */
const SHARED = [
  ...["conversation-lines.tsx", "workforce-lines.tsx", "request-recovery.tsx", "approval.tsx", "tool.tsx", "tool-grouping.ts"].map((f) => `${REGISTRY}/${f}`),
  "packages/workforce/src/react/components/lines.ts",
];

/** The files whose job is drawing a conversation's lines, or wiring what a line needs. A file deleted later simply counts 0. */
const LINE_FILES = new Set([
  "packages/shift-manager/src/components/lines.tsx",
  "packages/shift-manager/src/components/ToolLine.tsx",
  "packages/shift-manager/src/components/TurnLines.tsx",
  "packages/shift-manager/src/components/TaskBrief.tsx",
  "packages/shift-manager/src/components/ReceivedMessage.tsx",
  "packages/shift-manager/src/components/CoordinatorRoute.tsx",
  "packages/shift-manager/src/components/TaskBoardMeta.tsx",
  "packages/shift-manager/src/components/Conversation.tsx",
  "packages/shift-manager/src/surfaces/TaskSession.tsx",
  "labs/teammates/src/components/lines.tsx",
  "labs/teammates/src/components/ToolRun.tsx",
  "labs/teammates/src/components/Steps.tsx",
  "labs/teammates/src/components/Conversation.tsx",
  "labs/claude-code-style/src/components/Entry.tsx",
  "labs/claude-code-style/src/components/Thread.tsx",
  "labs/claude-code-style/src/lib/thread-entries.ts",
  "labs/claude-code-style/src/lib/tool-steps.ts",
  "apps/kitchen-sink/components/chat-agent/failed-turn.tsx",
  "apps/kitchen-sink/components/chat-agent/message.tsx",
  // Gone after FIX-2848's second slice; listed so an earlier checkout counts them.
  "labs/teammates/src/components/Entry.tsx",
  "labs/teammates/src/lib/items.ts",
  "labs/teammates/src/lib/steps.ts",
]);

/** Files that touch lines but whose job is something else, each with why. */
const DECLARED_OUT = {
  "packages/shift-manager/src/surfaces/ShiftCoordinator.tsx": "the coordinator screen; its lines draw through Conversation.tsx",
  "packages/shift-manager/src/lib/reads.ts": "reads; draws nothing",
  "labs/teammates/src/components/Popups.tsx": "popup frames; their lines draw through Steps.tsx",
  "labs/teammates/src/app/tasks.ts": "reads; draws nothing",
  "labs/teammates/src/app/conversations.ts": "reads; draws nothing",
  "labs/teammates/src/lib/status.ts": "a teammate's status word, read from lines; draws none",
  "labs/teammates/src/lib/talk.ts": "the message log read; draws nothing",
  "labs/claude-code-style/src/app/sessions.ts": "reads; draws nothing",
  "labs/claude-code-style/src/app/tasks.ts": "reads; draws nothing",
  "apps/kitchen-sink/app/flow-state/page.tsx": "a page; its registry wiring is a dozen lines of it",
  "apps/kitchen-sink/components/harness-session.tsx": "the coding-harness modes' screen, harness lines (outside this issue)",
  "apps/kitchen-sink/components/background-work-panel.tsx": "a panel of background work; no conversation line",
};

// Draws or wires a line: a renderer's props, the model, the registry, the
// recovery line, the brief, a decoder, the tool-run words.
const DRAWS =
  /\b\w+\??: *(readonly )?(DataItem|ErrorItem|MessageItem|SuspensionItem|ToolOutputItem)\b|\b(SentMessageValue|ReceivedMessageValue|FiledTaskValue|TaskResultValue)\b|\bline\??: *(ItemLine|Extract<ItemLine)|RendererRegistry|toolGroupRenderer|<ItemsRenderer|<ItemRenderer|conversationLines\(|entriesOf\(|<RequestRecovery|taskBriefOf\(|flow-state\/tool-grouping"|createContext<(LineScreen|TurnLineActions)/;

const isSource = (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".d.ts") && !/\.(test|spec|stories)\.tsx?$/.test(p);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (!["node_modules", "dist", ".next", "__tests__", "test", "tests"].includes(e)) walk(p, out);
    } else if (isSource(p)) out.push(p);
  }
  return out;
}

const nonBlank = (text) => text.split("\n").filter((l) => l.trim() !== "");

/** Lines of `copy` outside a longest common subsequence with `source`: what the app changed. */
function changedLines(copy, source) {
  const a = nonBlank(copy);
  const b = nonBlank(source);
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  return a.length - dp[0][0];
}

/** One file's class and the lines it counts; `unclassified` for a line file nobody listed. */
function classify(rel, text) {
  const m = rel.match(/components\/flow-state\/(.+)$/);
  if (m && existsSync(join(ROOT, REGISTRY, m[1]))) {
    const source = readFileSync(join(ROOT, REGISTRY, m[1]), "utf8");
    return source === text ? { rel, kind: "registry copy", count: 0 } : { rel, kind: "changed copy", count: changedLines(text, source) };
  }
  if (LINE_FILES.has(rel)) return { rel, kind: "line file", count: nonBlank(text).length };
  if (DECLARED_OUT[rel] !== undefined) return { rel, kind: "declared out", count: 0 };
  if (DRAWS.test(text)) return { rel, kind: "unclassified", count: 0 };
  return { rel, kind: "other", count: 0 };
}

function census(plants = []) {
  const byApp = {};
  for (const [app, dirs] of Object.entries(APPS)) {
    const files = dirs.flatMap((d) => walk(join(ROOT, d))).map((p) => [relative(ROOT, p), readFileSync(p, "utf8")]);
    for (const plant of plants.filter((pl) => pl.app === app)) {
      const at = files.findIndex(([rel]) => rel === plant.path);
      if (at >= 0) files[at] = [plant.path, plant.text];
      else files.push([plant.path, plant.text]);
    }
    byApp[app] = files.map(([rel, text]) => classify(rel, text));
  }
  const loose = Object.values(byApp).flat().filter((c) => c.kind === "unclassified").map((c) => c.rel);
  if (loose.length > 0) throw new Error(`draws a line but is neither a line file nor declared out:\n  ${loose.join("\n  ")}`);
  return byApp;
}

const sum = (cs) => cs.reduce((n, c) => n + c.count, 0);

function report(byApp) {
  let total = 0;
  for (const [app, cs] of Object.entries(byApp)) {
    const of = (k) => cs.filter((c) => c.kind === k);
    const n = sum(cs);
    total += n;
    console.log(
      `${app.padEnd(18)} ${String(n).padStart(5)} counted · ${of("line file").length} line files · ${of("changed copy").length} changed copies (${sum(of("changed copy"))}) · ${of("registry copy").length} identical copies (0) · ${of("declared out").length} declared out · ${cs.length} files classified`,
    );
    if (listFiles) for (const c of cs.filter((c) => c.count > 0).sort((x, y) => y.count - x.count)) console.log(`   ${String(c.count).padStart(5)}  ${c.kind.padEnd(12)} ${c.rel}`);
  }
  console.log(`${"Apps, counted".padEnd(18)} ${String(total).padStart(5)}`);
  const sharedOf = (root) => SHARED.map((f) => join(root, f)).filter(existsSync).reduce((n, p) => n + nonBlank(readFileSync(p, "utf8")).length, 0);
  const shared = sharedOf(ROOT);
  console.log(`${"Shared homes".padEnd(18)} ${String(shared).padStart(5)}   the shared files this issue adds, extends or removes (SHARED); not app source, reported for the net`);
  const baseRoot = arg("--base");
  if (baseRoot !== undefined) {
    const before = sharedOf(baseRoot);
    console.log(`${"Shared, delta".padEnd(18)} ${String(shared - before >= 0 ? `+${shared - before}` : shared - before).padStart(5)}   against --base ${baseRoot} (${before})`);
  }
}

if (!control) {
  report(census());
} else {
  const base = Object.fromEntries(Object.entries(census()).map(([a, cs]) => [a, sum(cs)]));
  const reg = readFileSync(join(ROOT, REGISTRY, "request-recovery.tsx"), "utf8");
  const changedCopy = { app: "Kitchen Sink", path: "apps/kitchen-sink/components/flow-state/request-recovery.tsx", text: `${reg}\n// planted one\n// planted two\n// planted three\n` };
  const identicalCopy = { app: "Kitchen Sink", path: "apps/kitchen-sink/components/flow-state/request-recovery.tsx", text: reg };
  const renamed = { app: "Shift Manager", path: "packages/shift-manager/src/components/PlantedLine.tsx", text: 'import type { ItemLine } from "@flow-state-dev/react";\nexport function PlantedLine({ line }: { line: ItemLine }) {\n  return line.id;\n}\n' };
  const extracted = { app: "Shift Manager", path: "packages/shift-manager/src/components/MovedMarkup.tsx", text: 'import type { DataItem } from "@flow-state-dev/core/items";\nexport function MovedMarkup({ record }: { record: DataItem }) {\n  return <p>{String(record.value)}</p>;\n}\n' };
  const byValue = { app: "Teammates", path: "labs/teammates/src/components/MovedValue.tsx", text: 'import type { ReceivedMessageValue } from "@flow-state-dev/workforce/browser";\nexport function MovedValue({ v }: { v: Partial<ReceivedMessageValue> }) {\n  return <p>{v.text}</p>;\n}\n' };
  const counted = (plants) => Object.fromEntries(Object.entries(census(plants)).map(([a, cs]) => [a, sum(cs)]));
  const throws = (plants) => {
    try {
      census(plants);
      return false;
    } catch {
      return true;
    }
  };
  const checks = [
    ["a changed registry copy counts its 3 changed lines", counted([changedCopy])["Kitchen Sink"] - base["Kitchen Sink"] === 3],
    ["a byte-identical copy counts 0", counted([identicalCopy])["Kitchen Sink"] === base["Kitchen Sink"]],
    ["a line renderer under a new, unlisted name fails the run", throws([renamed])],
    ["markup moved out of a line file into an unlisted component fails the run", throws([extracted])],
    ["a component reading a line's value under any prop name fails the run", throws([byValue])],
    ["a listed line file grown by 4 lines counts 4 more", (() => {
      // The first Teammates line file this checkout has, so the control runs before and after FIX-2848's second slice.
      const path = [...LINE_FILES].find((p) => p.startsWith("labs/teammates/") && existsSync(join(ROOT, p)));
      if (path === undefined) return false;
      const text = readFileSync(join(ROOT, path), "utf8");
      return counted([{ app: "Teammates", path, text: `${text}\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n` }]).Teammates - base.Teammates === 4;
    })()],
  ];
  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
    ok &&= pass;
  }
  console.log(ok ? "CONTROL OK: every plant was caught" : "CONTROL FAILED");
  process.exit(ok ? 0 : 1);
}
