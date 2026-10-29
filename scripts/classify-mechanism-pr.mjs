#!/usr/bin/env node
/**
 * PR classifier for the mechanism list (FIX-2315). Advisory: it never fails a run.
 *
 * Diffs the PR's public package exports against the base and maps each new one to
 * a row of docs/mechanisms/mechanisms.yaml. Type-only exports and `…Schema`
 * and ALL_CAPS constants are skipped; they shape a mechanism rather than add one.
 *
 * Mapping, first rule that gives one row wins:
 *   1. a row whose `file` is the export's declaring file;
 *   2. the one row that lists the export's package under `adapters`;
 *   3. among rows of the same package, the one whose `file` shares the deepest
 *      directory with the export's file. A tie is no match; the tied rows are
 *      named as the nearest.
 *
 * Labels:
 *   new-mechanism      an export matched no row.
 *   mechanism-overlap  the PR touches two rows whose `overlaps` name each other
 *                      (a row is touched when a new export maps to it or its
 *                      `file` changed), or an unmatched export's name shares a
 *                      word with a row's id or anchor once filler words
 *                      (create, define, get, …) are dropped.
 *
 * Posts or updates one comment (found by its marker) with the matched rows and a
 * stub row per unmatched export, mechanical fields filled. Without GITHUB_TOKEN, or
 * on a fork PR, it prints the report and posts nothing.
 *
 *   node scripts/classify-mechanism-pr.mjs [base-ref]   (default HEAD^1)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fsReader, gitReader, packageExports } from "./mechanism-exports.mjs";
import { ROOT, loadRows } from "./check-mechanism-anchors.mjs";

export const LABELS = { added: "new-mechanism", overlap: "mechanism-overlap" };
const MARKER = "<!-- mechanism-classifier -->";
const FILLER = new Set(["create", "define", "make", "build", "get", "set", "use", "with", "from", "to", "of", "on", "for", "and", "or", "is", "has", "the", "a", "an", "by", "new", "default", "config", "options", "input", "output", "result", "type", "fn", "id"]);

/** Content words of an identifier: camelCase and kebab-case split, lowercased, a plural `s` dropped. */
const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_-]+/)
  .map((w) => w.toLowerCase().replace(/(?<=...)s$/, "")).filter((w) => w && !FILLER.has(w));

const depth = (a, b) => { const x = a.split("/"), y = b.split("/"); let i = 0; while (i < x.length && x[i] === y[i]) i++; return i; };

/** The row an export belongs to, or { row: null, near: [rows] }. */
function mapExport(rows, pkg, file) {
  const one = (list) => (list.length === 1 ? { row: list[0], near: [] } : null);
  const own = rows.filter((r) => r.package === pkg || r.adapters?.includes(pkg));
  const scored = own.map((r) => [r, depth(dirname(file), dirname(r.file))]);
  const best = Math.max(0, ...scored.map(([, d]) => d));
  const nearest = scored.filter(([, d]) => d === best).map(([r]) => r);
  return one(rows.filter((r) => r.file === file)) ?? one(rows.filter((r) => r.adapters?.includes(pkg))) ?? one(nearest) ?? { row: null, near: nearest };
}

/** Classify a PR from its base and head export indexes and its changed files. */
export function classify(rows, base, head, changedFiles) {
  const added = [];
  for (const [pkg, names] of head) {
    for (const [name, { file, type }] of names) {
      if (type || /Schema$|^[A-Z0-9_]+$/.test(name) || base.get(pkg)?.has(name)) continue;
      added.push({ pkg, name, file, ...mapExport(rows, pkg, file) });
    }
  }
  const touched = new Set([...added.filter((a) => a.row).map((a) => a.row.id), ...rows.filter((r) => changedFiles.includes(r.file)).map((r) => r.id)]);
  const overlaps = rows.flatMap((r) => (touched.has(r.id) ? r.overlaps ?? [] : []).filter((o) => touched.has(o.id) && r.id < o.id).map((o) => ({ a: r.id, b: o.id, note: o.note })));
  const lookalikes = added.filter((a) => !a.row).map((a) => ({
    name: a.name,
    rows: rows.map((r) => ({ id: r.id, shared: words(a.name).filter((w) => [...words(r.id), ...words(r.anchor)].includes(w)) })).filter((r) => r.shared.length),
  })).filter((l) => l.rows.length);
  const labels = [];
  if (added.some((a) => !a.row)) labels.push(LABELS.added);
  if (overlaps.length || lookalikes.length) labels.push(LABELS.overlap);
  return { added, overlaps, lookalikes, labels };
}

/** The PR comment for a classification. */
export function renderComment({ added, overlaps, lookalikes, labels }) {
  const out = [MARKER, "### Mechanism check (advisory, never blocks)", ""];
  if (!added.length && !overlaps.length) return [...out, "No new public exports, and no overlapping rows touched."].join("\n");
  out.push(`Rows from \`docs/mechanisms/mechanisms.yaml\` · labels: ${labels.map((l) => `\`${l}\``).join(", ") || "none"}`, "");
  if (added.length) {
    out.push("| New export | Package | Mechanism |", "|---|---|---|");
    for (const a of added) out.push(`| \`${a.name}\` | ${a.pkg} | ${a.row ? `\`${a.row.id}\`` : `**none**${a.near.length ? ` (nearest: ${a.near.map((r) => `\`${r.id}\``).join(", ")})` : ""}`} |`);
    out.push("");
  }
  for (const o of overlaps) out.push(`- Touches \`${o.a}\` and \`${o.b}\`, which the list marks as overlapping: ${o.note}`);
  for (const l of lookalikes) out.push(`- \`${l.name}\` reads like ${l.rows.map((r) => `\`${r.id}\` (*${r.shared.join(", ")}*)`).join(", ")}. Is it one of those jobs?`);
  const stubs = added.filter((a) => !a.row);
  if (stubs.length) {
    out.push("", "If an export is a new mechanism, add a row. CI filled the mechanical fields; `job`, `builtOn` and `overlaps` are yours. If it belongs to an existing row, say which in the PR.", "", "```yaml");
    for (const s of stubs) out.push(`  - id: TODO`, `    job: TODO`, `    package: "${s.pkg}"`, `    anchor: ${s.name}`, `    file: ${s.file}`, `    builtOn: []  # TODO`, `    overlaps: []  # TODO`, `    status: canonical`, `    doc: TODO`);
    out.push("```");
  }
  return out.join("\n");
}

async function publish(report, { added, overlaps, labels }) {
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
  const pr = event.pull_request;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!process.env.GITHUB_TOKEN || !pr || pr.head.repo?.full_name !== repo) return console.log("No token, no PR, or a fork PR: nothing posted.");
  const api = async (path, method = "GET", body) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, { method, body: body && JSON.stringify(body), headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json" } });
    if (!res.ok && res.status !== 404) throw new Error(`${method} ${path}: ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  const comments = await api(`/issues/${pr.number}/comments?per_page=100`);
  const mine = comments.find((c) => c.body?.startsWith(MARKER));
  if (mine) await api(`/issues/comments/${mine.id}`, "PATCH", { body: report });
  else if (added.length || overlaps.length) await api(`/issues/${pr.number}/comments`, "POST", { body: report });
  const current = new Set((await api(`/issues/${pr.number}/labels`)).map((l) => l.name));
  if (labels.length) await api(`/issues/${pr.number}/labels`, "POST", { labels });
  for (const l of Object.values(LABELS)) if (current.has(l) && !labels.includes(l)) await api(`/issues/${pr.number}/labels/${l}`, "DELETE");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const baseRef = process.argv[2] ?? "HEAD^1";
    const changed = execFileSync("git", ["diff", "--name-only", baseRef, "HEAD"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    const result = classify(loadRows(), packageExports(gitReader(ROOT, baseRef)), packageExports(fsReader(ROOT)), changed);
    const report = renderComment(result);
    console.log(report);
    await publish(report, result);
  } catch (error) {
    console.log(`Mechanism classifier skipped: ${error.message}`); // advisory: never fail the run
  }
}
