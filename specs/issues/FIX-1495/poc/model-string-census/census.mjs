#!/usr/bin/env node
/**
 * FIX-1495 spec evidence: re-derive the model-string counts the spec rests on.
 *
 * Retained design evidence, not production code. Walks the same surface as
 * `scripts/validate-model-strings.mjs` (it imports that script's
 * `isScannedPath`, so the two cannot drift) and classifies every quoted
 * string whose first segment is a known gateway, provider or `intent`.
 *
 *   node specs/issues/FIX-1495/poc/model-string-census/census.mjs
 *   node specs/issues/FIX-1495/poc/model-string-census/census.mjs --control
 *   node specs/issues/FIX-1495/poc/model-string-census/census.mjs --sites
 *
 * `--control` plants one legacy string in memory and asserts the census
 * counts it, so a green run is known to be able to go red.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isScannedPath } from "../../../../../scripts/validate-model-strings.mjs";

const ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const SELF_DIR = "specs/issues/FIX-1495/";
const SKIP = new Set(["node_modules", "dist", "build", ".next", ".turbo", ".docusaurus", ".git", ".claude", "coverage"]);

const GATEWAYS = ["vercel", "openrouter"];
const PROVIDERS = ["openai", "anthropic", "google", "typesafe-ai"];

// A quoted token starting with a known first segment and a slash.
const TOKEN = new RegExp(
  `["'\`]((?:${[...GATEWAYS, ...PROVIDERS, "intent"].join("|")})/[A-Za-z0-9._:/-]+)["'\`]`,
  "g",
);

/** Lane for one model string, by today's grammar (split on "/"). */
export function classify(s) {
  const parts = s.split("/");
  const head = parts[0];
  if (head === "intent") return "intent";
  if (GATEWAYS.includes(head)) return parts.length >= 3 ? "legacy-gateway-slash" : "gateway-bare";
  if (PROVIDERS.includes(head)) return parts.length === 2 ? "provider-model" : "provider-model-extra-slash";
  return "unclassified";
}

function area(rel) {
  const p = rel.split("/");
  if (["packages", "apps", "labs", "goals", "examples"].includes(p[0])) return `${p[0]}/${p[1]}`;
  return p[0];
}

/** Count lanes over in-memory sources. Pure, so the control can reuse it. */
export function census(sources) {
  const byLane = {};
  const byArea = {};
  const sites = [];
  for (const { path, text } of sources) {
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(TOKEN)) {
        const lane = classify(m[1]);
        byLane[lane] = (byLane[lane] ?? 0) + 1;
        if (lane === "legacy-gateway-slash") {
          const a = area(path);
          byArea[a] = (byArea[a] ?? 0) + 1;
          sites.push(`${path}:${i + 1}  ${m[1]}`);
        }
      }
    });
  }
  return { byLane, byArea, sites };
}

function collect() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      const rel = relative(ROOT, abs);
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue;
        walk(abs);
      } else if (e.isFile() && isScannedPath(rel) && !rel.startsWith(SELF_DIR)) {
        out.push({ path: rel, text: readFileSync(abs, "utf8") });
      }
    }
  };
  walk(ROOT);
  return out;
}

const sources = collect();
const result = census(sources);

if (process.argv.includes("--control")) {
  const planted = census([...sources, { path: "planted.md", text: 'model: "openrouter/openai/gpt-5.6-luna"' }]);
  const before = result.byLane["legacy-gateway-slash"] ?? 0;
  const after = planted.byLane["legacy-gateway-slash"] ?? 0;
  if (after !== before + 1) {
    console.error(`CONTROL FAILED: planted legacy string not counted (${before} -> ${after})`);
    process.exit(1);
  }
  console.log(`control ok: planted legacy string counted (${before} -> ${after})`);
  process.exit(0);
}

// Totality: every matched token lands in a named lane.
if (result.byLane.unclassified) {
  console.error(`unclassified tokens: ${result.byLane.unclassified}`);
  process.exit(1);
}

// Retained history (dated records the sweep must not rewrite) vs. everything else.
const isHistory = (site) => site.startsWith("specs/") || site.startsWith("docs/internal/archive/");
const history = result.sites.filter(isHistory).length;

console.log(`files scanned: ${sources.length}`);
console.log(`legacy gateway-slash: ${result.sites.length} total · ${result.sites.length - history} to sweep · ${history} in retained history`);
console.log("by lane:", JSON.stringify(result.byLane));
console.log(
  "legacy gateway-slash by area:",
  JSON.stringify(Object.fromEntries(Object.entries(result.byArea).sort((a, b) => b[1] - a[1]))),
);
if (process.argv.includes("--sites")) console.log(result.sites.join("\n"));
