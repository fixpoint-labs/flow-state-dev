/**
 * Tests for the docs page checker (`check-docs-page.mjs`), run the way CI runs it: as a command
 * over a planted tree, reading what it prints and its exit code. Each planted page breaks one
 * rule, and its run must fail naming that rule; the clean page with a full record must pass.
 *
 * Run with `node --test scripts/check-docs-page.test.mjs`.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./check-docs-page.mjs", import.meta.url));
const PAGES = "docs/contributing/docs-revamp/pages";
const SITEMAP = "specs/epics/FIX-2696/SITEMAP";

/** Write `files` (path → text) under `root`. */
function plant(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** Run the checker in `root` with `args`; returns its exit code and output. */
function check(root, ...args) {
  const res = spawnSync(process.execPath, [SCRIPT, "--root", root, ...args], { cwd: root, encoding: "utf8" });
  return { status: res.status, out: res.stdout + res.stderr };
}

const page = (title, body, type = "concept") => `---\ntitle: ${title}\ntype: ${type}\n---\n\n# ${title}\n\n${body}\n`;
const PASS_NAMES = ["Fact sheet", "Cold-read questions", "Draft", "Machine checks", "Fact check", "Depth pass", "docs-editor", "Revise", "Cold read", "Owner read"];

/** A record with every pass filled in, `over` replacing a pass's body (`null` drops the section). */
function record(id, over = {}) {
  const sections = PASS_NAMES.map((name, i) => {
    const n = i + 1;
    const body = n in over ? over[n] : n === 10 ? "Not sampled." : `Pass ${n} found nothing.`;
    return body === null ? "" : `## ${n} · ${name}\n\n${body}\n`;
  });
  return `# Record\n\nSitemap: ${id}\n\n${sections.join("\n")}\n## Reference rows\n\nNone.\n`;
}

const SITEMAP_CONCEPTS = `# Sitemap · Concepts

### C-02 · Blocks

\`concepts/blocks\` · concept · 900 words · drafted (pages/blocks.md)

**Sources.** \`fundamentals/blocks\` (rewrite).

### C-07 · State and scopes

\`concepts/state-and-scopes\` · concept · 1,100 words

**Sources.** \`fundamentals/state-and-scopes\` (rewrite to about 1,000) · \`state/mutation-model\` (to Reference).

### C-11 · Capabilities

\`concepts/capabilities\` · concept · 900 words

**Sources.** \`fundamentals/capabilities\` (keep; later in the order) · \`advanced/capabilities-authoring\` (to Reference).

### C-06 · Sessions

\`concepts/sessions\` · concept · 1,000 words

**Sources.** \`streaming/overview\` (keep, trim) · \`server/connection-resilience\` (the guarantee).
`;
const SITEMAP_CATALOG = `# Sitemap · Catalog

| Id | Page | Words | Job | Source verdict |
| --- | --- | --- | --- | --- |
| K-22 | Plan and Execute | 1,300 | Plan a task graph | Keep; trim |
| K-23 | Debate | 1,300 | Argue | Merge |

**B-09 · Deploy to Railway** · \`build/deploy/railway\` · 600 words
Steps: a Node server. Source: \`guides/deploying-to-railway\` (keep).
`;
const SITEMAP_REFERENCE = `# Sitemap · Reference

**R-32 · Webhooks and inbound transports** · \`reference/webhooks\`
Tables: binding fields · verification. Lookups: What is returned? · Who calls? Sources: \`server/webhooks\` (keep, trim) · \`advanced/inbound-transports\`. From: C-13, B-12 to B-14.
`;

describe("check-docs-page", () => {
  let root;
  const at = (name) => join(PAGES, name);
  before(() => {
    root = mkdtempSync(join(tmpdir(), "docs-page-"));
    const clean = page("State and scopes", "A session holds what one conversation keeps.");
    plant(root, {
      [`${SITEMAP}/README.md`]: "# Sitemap\n",
      [`${SITEMAP}/concepts.md`]: SITEMAP_CONCEPTS,
      [`${SITEMAP}/catalog.md`]: SITEMAP_CATALOG,
      [`${SITEMAP}/reference.md`]: SITEMAP_REFERENCE,
      [at("clean.md")]: clean,
      [at("clean.record.md")]: record("C-07"),
      [at("clean.facts.md")]: "# Facts\n",
      [at("over.md")]: page("Over", "word ".repeat(1501)),
      [at("over.record.md")]: record("C-07"),
      [at("over-recipe.md")]: page("Over recipe", "step ".repeat(801), "recipe"),
      [at("untyped.md")]: page("Untyped", "Prose.", "essay"),
      [at("indented.md")]: page("Indented", "1. A step:\n\n   ```ts\n   const a = 1;\n   ```\n\n2. Another:\n\n    ```tsx title=\"app/page.tsx\"\n    export {};\n    ```"),
      [at("no-pass-9.md")]: clean,
      [at("no-pass-9.record.md")]: record("C-07", { 9: null }),
      [at("empty-pass.md")]: clean,
      [at("empty-pass.record.md")]: record("C-07", { 5: "" }),
      [at("no-record.md")]: clean,
      [at("owner-blank.md")]: clean,
      [at("owner-blank.record.md")]: record("C-07", { 10: "Later." }),
      [at("owner-read.md")]: clean,
      [at("owner-read.record.md")]: record("C-07", { 10: "Read by the owner; no changes." }),
      [at("skip-fresh.md")]: clean,
      [at("skip-fresh.record.md")]: record("C-07", { 3: "Skipped: already written." }),
      [at("skip-drafted.md")]: page("Blocks", "A block is one step."),
      [at("skip-drafted.record.md")]: record("C-02", { 3: "Skipped: drafted before the loop." }),
      [at("skip-kept-trim.md")]: page("Plan and Execute", "Plan, then work.", "catalog"),
      [at("skip-kept-trim.record.md")]: record("K-22", { 3: "Skipped: the audit kept it." }),
      [at("skip-kept-recipe.md")]: page("Deploy to Railway", "1. Deploy.", "recipe"),
      [at("skip-kept-recipe.record.md")]: record("B-09", { 3: "Skipped: the audit kept it." }),
      [at("skip-kept-note.md")]: page("Capabilities", "A capability bundles tools."),
      [at("skip-kept-note.record.md")]: record("C-11", { 3: "Skipped: the audit kept it." }),
      [at("skip-merge.md")]: page("Debate", "Argue.", "catalog"),
      [at("skip-merge.record.md")]: record("K-23", { 3: "Skipped: kept." }),
      [at("skip-partly-kept.md")]: page("Sessions", "A session."),
      [at("skip-partly-kept.record.md")]: record("C-06", { 3: "Skipped: kept." }),
      [at("skip-wrong-title.md")]: page("Something else", "Text."),
      [at("skip-wrong-title.record.md")]: record("K-22", { 3: "Skipped: kept." }),
      [at("skip-no-id.md")]: clean,
      [at("skip-no-id.record.md")]: record("C-07", { 3: "Skipped: kept." }).replace(/^Sitemap: .*\n/m, ""),
      [at("skip-unknown-id.md")]: clean,
      [at("skip-unknown-id.record.md")]: record("C-99", { 3: "Skipped: kept." }),
      [at("skip-unmoved-source.md")]: page("Webhooks and inbound transports", "Tables.", "reference"),
      [at("skip-unmoved-source.record.md")]: record("R-32", { 3: "Skipped: kept." }),
      [at("skip-cold-read.md")]: clean,
      [at("skip-cold-read.record.md")]: record("C-07", { 9: "Skipped: no cold-read agents were run." }),
      [at("not-sampled-early.md")]: clean,
      [at("not-sampled-early.record.md")]: record("C-07", { 5: "Not sampled." }),
      [at("four-backticks.md")]: page("Four", "Shown:\n\n````md\n```ts\nconst a = 1;\n```\n````\n\nAfter.\n\n```ts\nconst b = 2;\n```"),
      [at("four-backticks.record.md")]: record("C-07"),
      [at("tildes.md")]: page("Tildes", "~~~ts\nconst a = 1;\n~~~\n\n~~~ts title=\"a.ts\"\n```\n~~~"),
      [at("tildes.record.md")]: record("C-07"),
      [at("unclosed.md")]: page("Unclosed", "Text.\n\n```ts title=\"a.ts\"\nconst a = 1;"),
      [at("unclosed.record.md")]: record("C-07"),
    });
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  // A named page gets the page rules only, as pass 4 runs it; `--record` adds its record.
  const fails = (name, signal, ...args) => {
    const { status, out } = check(root, at(name), "--record", ...args);
    assert.equal(status, 1, out);
    assert.match(out, signal);
    return out;
  };
  const passes = (name, ...args) => {
    const { status, out } = check(root, at(name), "--record", ...args);
    assert.equal(status, 0, out);
    assert.match(out, /^ok {3}/m);
  };

  it("passes a clean page with a full record", () => passes("clean.md"));

  it("reads the page a record or fact sheet is named for", () => {
    passes("clean.record.md");
    passes("clean.facts.md");
  });

  it("fails a page over its type's budget, naming the count and the budget", () => {
    fails("over.md", /\b15\d\d words, budget 1500/);
    fails("over-recipe.md", /\b8\d\d words, budget 800/);
  });

  it("fails a page with an unknown type", () => fails("untyped.md", /unknown `type` "essay"/));

  it("counts an untitled TypeScript example fenced inside a list item, and not a titled one", () => {
    const out = fails("indented.md", /1 ts code block\(s\) with no title="path"/);
    assert.doesNotMatch(out, /2 ts code block/);
  });

  it("fails a record missing a pass, or with a pass left empty", () => {
    fails("no-pass-9.md", /record: no pass 9/);
    fails("empty-pass.md", /record: pass 5 is empty/);
  });

  it("fails a page with no record, unless the run is pass 4's check of a named page", () => {
    fails("no-record.md", /no record: no-record\.record\.md/);
    const { status, out } = check(root, at("no-record.md"));
    assert.equal(status, 0, out);
  });

  it("fails an owner pass that says neither read nor not sampled", () => {
    fails("owner-blank.md", /pass 10 says neither/);
    passes("owner-read.md");
  });

  it("accepts a skipped draft only on a page the sitemap lists as kept, piloted or drafted", () => {
    passes("skip-drafted.md");
    passes("skip-kept-trim.md");
    passes("skip-kept-recipe.md");
    passes("skip-kept-note.md");
    fails("skip-fresh.md", /sitemap lists C-07 as neither kept, piloted nor drafted/);
    fails("skip-merge.md", /sitemap lists K-23 as neither/);
    fails("skip-partly-kept.md", /sitemap lists C-06 as neither/);
  });

  it("refuses a skipped draft that names another page's entry, or none", () => {
    fails("skip-wrong-title.md", /skipped for K-22 "Plan and Execute", and the page's title is "Something else"/);
    fails("skip-no-id.md", /no `Sitemap: <id>` line/);
    fails("skip-unknown-id.md", /the sitemap has no entry C-99/);
  });

  it("refuses a skipped draft whose entry leaves a source with no verdict on the page", () => {
    fails("skip-unmoved-source.md", /sitemap lists R-32 as neither/);
  });

  it("refuses a skip mark on any pass but the draft, and `Not sampled` on any but the owner read", () => {
    fails("skip-cold-read.md", /record: pass 9 is marked skipped; only pass 3 may be/);
    fails("not-sampled-early.md", /record: pass 5 says `Not sampled`; only pass 10 may/);
  });

  it("closes a fence only on its own character at its length or longer", () => {
    // Only the heading and the prose around the fences count as words.
    assert.match(fails("four-backticks.md", /1 ts code block\(s\) with no title="path"/), /\(concept, 3 words\)/);
    assert.match(fails("tildes.md", /1 ts code block\(s\) with no title="path"/), /\(concept, 1 words\)/);
  });

  it("fails a page that ends inside a fence", () => {
    fails("unclosed.md", /a ```ts fence opened on line \d+ is never closed/);
  });

  it("fails a record or fact sheet whose page is gone, in a default run", () => {
    const orphanRoot = mkdtempSync(join(tmpdir(), "docs-page-orphan-"));
    try {
      plant(orphanRoot, {
        [at("a.md")]: page("A", "Fine."),
        [at("a.record.md")]: record("C-07"),
        [at("gone.record.md")]: record("C-07"),
        [at("gone.facts.md")]: "# Facts\n",
      });
      const { status, out } = check(orphanRoot);
      assert.equal(status, 1, out);
      assert.match(out, /FAIL docs\/contributing\/docs-revamp\/pages\/gone\.record\.md: its page gone\.md does not exist/);
      assert.match(out, /FAIL docs\/contributing\/docs-revamp\/pages\/gone\.facts\.md: its page gone\.md does not exist/);
      assert.match(out, /ok {3}docs\/contributing\/docs-revamp\/pages\/a\.md/);
    } finally {
      rmSync(orphanRoot, { recursive: true, force: true });
    }
  });

  describe("--sitemap, the parse the skipped-draft rule reads", () => {
    // Golden test against the real sitemap: a reword of its prose that flips an entry to kept (and
    // so lets a pass-3 skip through) changes this list, and the change has to be made here too.
    it("parses the repository's sitemap into the pinned kept, piloted and drafted entries", () => {
      const res = spawnSync(process.execPath, [SCRIPT, "--sitemap"], { encoding: "utf8" });
      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.deepEqual(res.stdout.trim().split("\n"), [
        "151 entries: 51 kept, 3 piloted, 1 drafted",
        "kept: B-08 B-09 B-10 B-11 B-12 B-13 B-14 B-15 B-16 B-17 B-19 B-20 B-21 B-22 B-23 B-24 B-28 B-29 B-30 B-33 B-34 B-35 B-36 B-37 C-11 K-09 K-20 K-21 K-22 K-23 K-24 K-25 K-26 K-27 K-28 K-29 K-30 K-31 K-32 K-33 K-34 K-35 K-36 K-37 K-38 K-39 K-40 K-41 K-43 R-18 R-39",
        "piloted: C-21 C-22 S-1",
        "drafted: C-02",
      ]);
    });

    it("fails loudly on a line that names an entry in a shape it cannot read", () => {
      const odd = mkdtempSync(join(tmpdir(), "docs-page-sitemap-"));
      try {
        plant(odd, { [`${SITEMAP}/x.md`]: "# X\n\n### C-03: Generators\n\n| Id | Page | Notes |\n| --- | --- | --- |\n| K-50 | Odd | n |\n" });
        const res = check(odd, "--sitemap");
        assert.equal(res.status, 1, res.out);
        assert.match(res.out, /x\.md:3: an entry the sitemap parse cannot read: ### C-03: Generators/);
        assert.match(res.out, /x\.md:7: an entry the sitemap parse cannot read: \| K-50/);
      } finally {
        rmSync(odd, { recursive: true, force: true });
      }
    });
  });

  it("fails a named file that does not exist", () => {
    const { status, out } = check(root, at("missing.md"));
    assert.equal(status, 1, out);
    assert.match(out, /missing\.md: no such page/);
  });

  it("checks every page under the default root, skipping records and fact sheets", () => {
    const { status, out } = check(root);
    assert.equal(status, 1, out);
    assert.match(out, /ok {3}docs\/contributing\/docs-revamp\/pages\/clean\.md/);
    assert.doesNotMatch(out, /clean\.(record|facts)\.md/);
  });

  it("fails when the default root holds no page", () => {
    const empty = mkdtempSync(join(tmpdir(), "docs-page-empty-"));
    try {
      const { status, out } = check(empty);
      assert.equal(status, 1, out);
      assert.match(out, /FAIL no page found under/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  describe("--changed-since, as CI runs it on a PR", () => {
    let repo;
    const git = (...a) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: repo, encoding: "utf8" });
    /** Commit `files` (null deletes one) on top of the repo, and run the PR check against the commit before. */
    const change = (files) => {
      for (const [path, text] of Object.entries(files)) if (text === null) rmSync(join(repo, path));
      plant(repo, Object.fromEntries(Object.entries(files).filter(([, t]) => t !== null)));
      git("add", "-A");
      git("commit", "-qm", "change", "--allow-empty");
      return check(repo, "--changed-since", "HEAD^1");
    };
    before(() => {
      repo = mkdtempSync(join(tmpdir(), "docs-page-git-"));
      git("init", "-q");
      plant(repo, {
        [`${SITEMAP}/concepts.md`]: SITEMAP_CONCEPTS,
        [at("a.md")]: page("A", "Fine."),
        [at("a.record.md")]: record("C-07"),
        [at("b.md")]: page("B", "Fine."),
        [at("b.record.md")]: record("C-07"),
        "README.md": "x\n",
      });
      git("add", ".");
      git("commit", "-qm", "base");
    });
    after(() => rmSync(repo, { recursive: true, force: true }));

    it("says so, and passes, when the change touches no page", () => {
      const res = change({ "README.md": "y\n" });
      assert.equal(res.status, 0, res.out);
      assert.match(res.out, /nothing to check/);
    });

    it("checks a page whose record changed, once, and a new page with no record", () => {
      const res = change({ [at("a.record.md")]: record("C-07", { 9: null }), [at("new.md")]: page("New", "Fine.") });
      assert.equal(res.status, 1, res.out);
      assert.match(res.out, /FAIL docs\/contributing\/docs-revamp\/pages\/a\.md[\s\S]*no pass 9/);
      assert.match(res.out, /FAIL docs\/contributing\/docs-revamp\/pages\/new\.md[\s\S]*no record/);
      assert.doesNotMatch(res.out, /pages\/b\.md/);
      assert.equal(res.out.match(/pages\/a\.md/g).length, 1, "a page and its record are one page");
      change({ [at("a.record.md")]: record("C-07"), [at("new.md")]: null });
    });

    it("fails a page edited after its loop closed, until passes 4 and 5 run again", () => {
      let res = change({ [at("b.md")]: page("B", "Fine, and edited.") });
      assert.equal(res.status, 1, res.out);
      assert.match(res.out, /the page changed and pass 4 did not/);
      assert.match(res.out, /the page changed and pass 5 did not/);
      res = change({
        [at("b.md")]: page("B", "Fine, edited twice."),
        [at("b.record.md")]: record("C-07", { 4: "Re-run: clean.", 5: "Re-run: no wrong claim." }),
      });
      assert.equal(res.status, 0, res.out);
    });

    it("fails a change that deletes a record and leaves its page", () => {
      const res = change({ [at("a.record.md")]: null });
      assert.equal(res.status, 1, res.out);
      assert.match(res.out, /FAIL docs\/contributing\/docs-revamp\/pages\/a\.md[\s\S]*no record/);
      change({ [at("a.record.md")]: record("C-07") });
    });

    it("fails a change that deletes a page and leaves its record", () => {
      const res = change({ [at("a.md")]: null });
      assert.equal(res.status, 1, res.out);
      assert.match(res.out, /FAIL docs\/contributing\/docs-revamp\/pages\/a\.record\.md: its page a\.md does not exist/);
      change({ [at("a.md")]: page("A", "Fine.") });
    });

    it("stops on a git failure reading the base record, other than the record not being there", () => {
      const broken = mkdtempSync(join(tmpdir(), "docs-page-git-broken-"));
      const run = (...a) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: broken, encoding: "utf8" });
      try {
        run("init", "-q");
        plant(broken, { [at("a.md")]: page("A", "Fine."), [at("a.record.md")]: record("C-07") });
        run("add", ".");
        run("commit", "-qm", "base");
        plant(broken, { [at("a.md")]: page("A", "Fine, and edited.") });
        run("commit", "-qam", "edit");
        // Drop the base record's blob: the diff still names the page, and reading the record fails.
        const blob = run("rev-parse", `HEAD^1:${at("a.record.md")}`).stdout.trim();
        rmSync(join(broken, ".git/objects", blob.slice(0, 2), blob.slice(2)));
        const res = check(broken, "--changed-since", "HEAD^1");
        assert.notEqual(res.status, 0, res.out);
        assert.doesNotMatch(res.out, /^ok /m);
        assert.match(res.out, /git show/);
      } finally {
        rmSync(broken, { recursive: true, force: true });
      }
    });

    it("checks every page when the change edits the sitemap", () => {
      const res = change({ [`${SITEMAP}/concepts.md`]: `${SITEMAP_CONCEPTS}\n` });
      assert.equal(res.status, 0, res.out);
      assert.match(res.out, /ok {3}docs\/contributing\/docs-revamp\/pages\/a\.md/);
      assert.match(res.out, /ok {3}docs\/contributing\/docs-revamp\/pages\/b\.md/);
    });
  });
});
