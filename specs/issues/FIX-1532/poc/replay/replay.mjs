#!/usr/bin/env node
/**
 * FIX-1532 POC — price D1 by replaying the proposed rule over merged history.
 *
 * Retained spec evidence, not production code: nothing imports it and no CI job
 * runs it. Run from the repository root:
 *
 *   git fetch origin main && node specs/issues/FIX-1532/poc/replay/replay.mjs
 *
 * For every PR merged to main since the changeset reset (b3e6e2279) that ADDED
 * a fragment, it reads the PR's issue ids from its branch (case-insensitive,
 * number must end at a separator, one trailing letter stripped) and its title,
 * and reports each added fragment none of whose ids is one of them.
 *
 * Titles come from the merge commit body. GitHub leaves that blank for some
 * merges, so a blank title can only ADD failures: #1662 is one (its real title
 * names FIX-1336, which its fragment cites). Re-check any FAIL line against
 * the PR before counting it.
 */
import { execFileSync } from "node:child_process";

const SINCE = "b3e6e2279";
const g = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });

const TITLE_ID = /\b([A-Z]{2,6})-(\d+)[a-z]?\b/g;
const BRANCH_ID = /(?<![A-Za-z])([A-Za-z]{2,6})-(\d+)[a-z]?(?![0-9A-Za-z])/g;
const FRAGMENT_ID = /\b[A-Z]{2,6}-\d+\b/g;

const merges = g(["log", "--first-parent", "--merges", "--format=%H%x1f%s%x1f%b%x1e", `${SINCE}..origin/main`])
  .split("\x1e")
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => r.split("\x1f"));

let prs = 0;
let noOwn = 0;
let pass = 0;
const failingPrs = new Set();
for (const [sha, subject, body = ""] of merges) {
  const m = subject.match(/^Merge pull request #(\d+) from [^/]+\/(.+)$/);
  if (!m) continue;
  const [, pr, branch] = m;
  const title = body.split("\n")[0];
  const added = g(["diff", "--diff-filter=A", "--name-only", `${sha}^1`, sha, "--", ".changeset"])
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".md") && !f.endsWith("README.md"));
  if (added.length === 0) continue;
  prs++;

  const own = new Set();
  for (const x of branch.matchAll(BRANCH_ID)) own.add(`${x[1].toUpperCase()}-${x[2]}`);
  for (const x of title.matchAll(TITLE_ID)) own.add(`${x[1]}-${x[2]}`);
  if (own.size === 0) noOwn++;

  for (const f of added) {
    const src = g(["show", `${sha}:${f}`]);
    const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n?---/);
    if (!fm || !/:\s*(patch|minor|major)\s*$/m.test(fm[1])) continue; // empty fragment
    const ids = [...new Set([...src.slice(fm[0].length).matchAll(FRAGMENT_ID)].map((x) => x[0]))];
    if (own.size === 0 || ids.some((id) => own.has(id))) {
      pass++;
      continue;
    }
    failingPrs.add(pr);
    console.log(`FAIL #${pr} ${branch} | ${title || "(blank title)"} | ${f} | cites ${ids.join(",")} | PR ids ${[...own].join(",")}`);
  }
}
console.log({ prsWithAddedFragments: prs, prsWithNoOwnId: noOwn, fragmentsPassing: pass, failingPrs: [...failingPrs] });
