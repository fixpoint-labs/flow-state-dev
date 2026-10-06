#!/usr/bin/env node
/**
 * Throwaway evidence for FIX-1770's restart premise. Two probes, in a temp directory:
 *   1. Re-importing a config with a cache-busting query does NOT reload a module it imports.
 *   2. `node --watch` restarts when an imported module changes, and not when an unrelated file does.
 * Prints one JSON verdict per probe. Exit 0 when both premises hold.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "fix-1770-esm-"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;

// Probe 1: cache-busted re-import of the config.
writeFileSync(join(dir, "flow.mjs"), "export const v = 1;");
writeFileSync(join(dir, "config.mjs"), 'import { v } from "./flow.mjs"; export default v;');
const url = pathToFileURL(join(dir, "config.mjs")).href;
const first = (await import(`${url}?t=1`)).default;
writeFileSync(join(dir, "flow.mjs"), "export const v = 2;");
const second = (await import(`${url}?t=2`)).default;
const reloads = second === 2;
console.log(JSON.stringify({ probe: "re-import reloads an imported flow", first, second, verdict: reloads ? "yes" : "no" }));
if (reloads) ok = false;

// Probe 2: node --watch on the module graph.
writeFileSync(join(dir, "flow.mjs"), "export const v = 1;");
writeFileSync(join(dir, "server.mjs"), 'import { v } from "./flow.mjs"; console.log("started v=" + v); setInterval(() => {}, 1000);');
const child = spawn(process.execPath, ["--watch", "server.mjs"], { cwd: dir });
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
await wait(1500);
writeFileSync(join(dir, "unrelated.txt"), "not imported");
await wait(1500);
const afterUnrelated = (log.match(/started/g) ?? []).length;
writeFileSync(join(dir, "flow.mjs"), "export const v = 2;");
await wait(2000);
const afterImported = (log.match(/started/g) ?? []).length;
child.kill();
const watchHolds = afterUnrelated === 1 && afterImported === 2 && log.includes("started v=2");
console.log(JSON.stringify({ probe: "node --watch restarts on imported module only", afterUnrelated, afterImported, verdict: watchHolds ? "yes" : "no" }));
if (!watchHolds) ok = false;

rmSync(dir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
