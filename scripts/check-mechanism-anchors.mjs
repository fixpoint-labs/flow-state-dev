#!/usr/bin/env node
/**
 * Anchor check for docs/mechanisms/mechanisms.yaml (FIX-2315).
 *
 * Fails when a row's `anchor` is no longer exported from its `package`, or when
 * `file` no longer declares it, and prints the value the row should carry. These
 * are the mechanical fields CI owns; `job`, `builtOn` and `overlaps` are the
 * author's and are only checked for shape (ids that exist, no duplicate ids).
 *
 *   node scripts/check-mechanism-anchors.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { fsReader, packageExports } from "./mechanism-exports.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LIST = "docs/mechanisms/mechanisms.yaml";

/** The rows of the mechanism list. */
export function loadRows(text = readFileSync(join(ROOT, LIST), "utf8")) {
  return YAML.parse(text).mechanisms;
}

/** Every problem with the rows against an export index; empty when the list holds. */
export function checkAnchors(rows, index) {
  const problems = [];
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) problems.push(`${row.id}: duplicate id`);
    ids.add(row.id);
  }
  for (const row of rows) {
    const where = `${row.id}: ${row.package} \`${row.anchor}\``;
    const exported = index.get(row.package);
    if (!exported) problems.push(`${where}: no package ${row.package} under packages/`);
    else if (!exported.has(row.anchor)) problems.push(`${where}: no longer exported. Pick another anchor, or retire the row.`);
    else if (exported.get(row.anchor).file !== row.file) problems.push(`${where}: declared in ${exported.get(row.anchor).file}, not ${row.file}. Set file: ${exported.get(row.anchor).file}`);
    if (row.doc && !existsSync(join(ROOT, row.doc))) problems.push(`${row.id}: doc ${row.doc} does not exist`);
    const refs = [...(row.builtOn ?? []), ...(row.overlaps ?? []).map((o) => o.id)];
    for (const ref of refs) if (!ids.has(ref)) problems.push(`${row.id}: refers to unknown id \`${ref}\``);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = loadRows();
  const problems = checkAnchors(rows, packageExports(fsReader(ROOT)));
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.log(problems.length ? `\n${problems.length} problem(s) in ${LIST}.` : `${LIST}: ${rows.length} rows, every anchor exported where its row says.`);
  process.exit(problems.length ? 1 : 0);
}
