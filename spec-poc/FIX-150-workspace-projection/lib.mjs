/**
 * THROWAWAY POC SUPPORT CODE — FIX-150. NOT PRODUCTION. Never merged.
 *
 * Shared helpers for the six FIX-150 spec POCs: temp-workspace setup, a
 * content-hash directory walk (the "diffing" side of change detection), and
 * a tiny verdict printer.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Make a throwaway workspace dir seeded with `files` (relative path -> content). */
export function makeWorkspace(label, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `fix150-${label}-`));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

/**
 * Walk a directory and return { relPath: sha256 } for every file.
 * This is the "diffing" change-detection strategy, standing in for what
 * `packages/tools/src/bash` does today with its per-entry content hashes.
 */
export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        walk(full);
      } else if (e.isFile()) {
        const buf = fs.readFileSync(full);
        out[path.relative(dir, full)] = createHash("sha256").update(buf).digest("hex").slice(0, 12);
      }
    }
  };
  walk(dir);
  return out;
}

/** Paths added / changed between two snapshots. */
export function diff(before, after) {
  const added = Object.keys(after).filter((k) => !(k in before));
  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]);
  const removed = Object.keys(before).filter((k) => !(k in after));
  return { added, changed, removed };
}

/** Print a labelled result line. */
export function report(name, value) {
  console.log(`  ${name}:`, typeof value === "string" ? value : JSON.stringify(value));
}

/** Print the POC's verdict. */
export function verdict(v, why) {
  console.log(`\nVERDICT: ${v}`);
  console.log(`WHY: ${why}\n`);
}

/**
 * Auto-approve every tool call.
 *
 * `permissionMode: "bypassPermissions"` is refused when the process runs as
 * root ("--dangerously-skip-permissions cannot be used with root/sudo
 * privileges"), which is exactly the shape an FSD server container has. A
 * `canUseTool` callback is the supported programmatic equivalent and works
 * as root — worth knowing for the real implementation, not just the POC.
 */
export const allowAll = async (_name, input) => ({ behavior: "allow", updatedInput: input });

/** Drain a query, collecting the messages the POCs care about. Never throws. */
export async function drain(iter) {
  const toolCalls = [];
  let result = null;
  let text = "";
  const errors = [];
  try {
    for await (const m of iter) {
      if (m.type === "assistant") {
        for (const c of m.message?.content ?? []) {
          if (c.type === "text") text += c.text;
          if (c.type === "tool_use") toolCalls.push({ name: c.name, input: c.input });
        }
      }
      if (m.type === "result") result = m;
      if (m.type === "system" && m.subtype === "error") errors.push(m);
    }
  } catch (err) {
    errors.push({ thrown: String(err?.message ?? err).slice(0, 300) });
  }
  return { toolCalls, result, text, errors };
}
