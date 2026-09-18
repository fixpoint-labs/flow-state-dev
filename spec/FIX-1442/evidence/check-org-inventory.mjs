/** Spec-only inventory: derive org-bearing tracked source/docs; reject unreviewed drift. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const snapshot = fileURLToPath(new URL('./org-inventory.json', import.meta.url));
const matcher = /\borgId\b|\brequires?Org\b|\bctx\.org\b|org[^\n]{0,25}optional|optional[^\n]{0,25}org/i;
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const extra = process.argv.find(a => a.startsWith('--extra='))?.slice(8);
if (extra) tracked.push(extra);
const rows = {};
const skipped = {};
for (const path of [...new Set(tracked)].sort()) {
  if (!/\.(?:[cm]?[jt]sx?|md|mdx)$/.test(path)) { skipped.nonText = (skipped.nonText ?? 0) + 1; continue; }
  if (/^(?:graft|spec|spec-poc|\.agents|\.claude|\.codex)\//.test(path) || /(?:^|\/)(?:archive|internal)\//.test(path)) { skipped.contextOrHistory = (skipped.contextOrHistory ?? 0) + 1; continue; }
  const lines = readFileSync(`${root}/${path}`, 'utf8').split('\n');
  const hits = lines.flatMap((text, i) => matcher.test(text) ? [{ line: i + 1, text: text.trim() }] : []);
  if (!hits.length) { skipped.noMatch = (skipped.noMatch ?? 0) + 1; continue; }
  const area = /^packages\/[^/]+\/(?:test|tests)\//.test(path) || /(?:\.test\.|\.spec\.|type-test)/.test(path) ? 'checks'
    : /^packages\/[^/]+\/src\//.test(path) ? 'framework'
    : /^(?:apps|examples|labs|goals|plugins)\//.test(path) ? 'consumer-or-site'
    : /^(?:docs|packages)\//.test(path) || /^[^/]+\.md$/.test(path) ? 'reference'
    : 'tooling';
  rows[path] = { area, hits };
}
if (process.argv.includes('--record')) {
  writeFileSync(snapshot, JSON.stringify(rows, null, 2) + '\n');
  console.log(`Recorded ${Object.keys(rows).length} org-bearing files; exclusions ${JSON.stringify(skipped)}`);
} else {
  const expected = JSON.parse(readFileSync(snapshot, 'utf8'));
  const changed = [...new Set([...Object.keys(rows), ...Object.keys(expected)])].filter(p => JSON.stringify(rows[p]) !== JSON.stringify(expected[p]));
  if (changed.length) { console.error(`Unreviewed inventory drift: ${changed.join(', ')}`); process.exitCode = 1; }
  else console.log(`PASS ${Object.keys(rows).length} org-bearing files match the reviewed snapshot; exclusions ${JSON.stringify(skipped)}`);
}
