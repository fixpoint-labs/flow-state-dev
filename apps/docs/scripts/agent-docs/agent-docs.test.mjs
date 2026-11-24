/**
 * The docs-as-text step: each MDX component's one text form, the refusal of any component
 * without one, the Markdown URL rule, and the two index layouts.
 *
 *   node --test apps/docs/scripts/agent-docs/agent-docs.test.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { llmsFullTxt, llmsTxt, markdownUrl } from "./index-files.mjs";
import { loadPages } from "./plugin.mjs";
import { toMarkdown } from "./to-markdown.mjs";

const md = (source, extra = {}) => toMarkdown({ source, filePath: "/site/docs/page.md", title: "The page", ...extra });

/** No JSX tag, import or expression is left outside code. */
function assertNoJsx(text) {
  const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  assert.doesNotMatch(prose, /<[A-Z][A-Za-z.]*[\s/>]|^import\s|^export\s|\{\/\*/m, text);
}

test("a figure is its caption and description, as text", () => {
  const out = md(`---
title: Scopes
---
import Figure from "@site/src/components/Figure";
import Scopes from "./scopes.svg";

Before.

<Figure svg={Scopes} caption="The four state scopes" description="Request inside session inside user inside project." />

After.
`);
  assertNoJsx(out);
  assert.match(out, /\*\*The four state scopes\*\*\n\nRequest inside session inside user inside project\./);
  const quoted = md(`<Figure svg={X} caption={\`The "big" one\`} description={"Says \\"hi\\". " + "Then more."} />\n`);
  assert.match(quoted, /\*\*The "big" one\*\*\n\nSays "hi"\. Then more\./, "a string written as an expression is still text");
  assert.match(out, /^# The page\n\nBefore\./, "the title heads the page; front matter and imports are gone");
  assert.match(out, /After\.\n$/);
});

test("an admonition is a blockquote under its title", () => {
  const out = md(`Intro.

:::note One skills surface
Don't mount **both**.

Pick one.
:::

:::tip
Plain.
:::
`);
  assert.match(out, /> \*\*One skills surface\*\*\n>\n> Don't mount \*\*both\*\*\.\n>\n> Pick one\./);
  assert.match(out, /> \*\*Tip\*\*\n>\n> Plain\./, "an untitled one takes its kind as title");
  assert.doesNotMatch(out, /:::/);
});

test("tabs are one heading per tab, a level below the heading before them", () => {
  const out = md(`## Install

import Tabs from "@theme/Tabs";
import TabItem from "@theme/TabItem";

<Tabs>
  <TabItem value="npm" label="npm">
    \`\`\`bash
    npm i x
    \`\`\`
  </TabItem>
  <TabItem value="pnpm">
    \`\`\`bash
    pnpm add x
    \`\`\`
  </TabItem>
</Tabs>
`);
  assertNoJsx(out);
  assert.match(out, /### npm\n\n```bash\nnpm i x\n```/);
  assert.match(out, /```\n\n### pnpm\n\n```bash\npnpm add x\n```/, "a tab with no label is headed by its value, at the margin");
});

test("a component with no text form fails, naming the file and line", () => {
  assert.throws(() => md(`Text.\n\n<Callout kind="x">Hi</Callout>\n`), /\/site\/docs\/page\.md:3: <Callout> has no Markdown form/);
  assert.throws(() => md(`Inline <Badge /> here.\n`), /<Badge> has no Markdown form/);
  assert.throws(() => md(`Value: {1 + 1}\n`), /expression \{1 \+ 1\} has no Markdown form/);
  assert.throws(() => md(`<div style={{ color: "red" }}>x</div>\n`), /<div> has a computed attribute/);
  assert.throws(
    () => md(`<Figure svg={X} caption={name} description="d" />\n`),
    /<Figure> needs caption as a plain string/,
    "a figure whose caption is computed has no fixed text",
  );
});

test("code, comments and heading ids: code is kept as written, the rest dropped", () => {
  const out = md(`{/* a note to editors */}

## Evaluator {#evaluator}

\`\`\`tsx
<Figure svg={X} />
import x from "y";
\`\`\`

The path \`/sessions/:id\` and /sessions/:id/manifest stay.
`);
  assert.match(out, /^## Evaluator$/m);
  assert.match(out, /```tsx\n<Figure svg=\{X\} \/>\nimport x from "y";\n```/, "code shows components verbatim");
  assert.match(out, /\/sessions\/:id\/manifest stay\./, "a colon in prose is not a directive");
  assert.doesNotMatch(out, /editors/);
  assert.match(md(`<a id="old-anchor"></a>\n\nText.\n`), /<a id="old-anchor"><\/a>\n\nText\./, "plain HTML stays HTML");
});

test("links to other pages lead to their Markdown", () => {
  const resolveLink = (url) => ({ "./other.md": "/docs/other.md", "/docs/intro": "/docs/intro.md" })[url.split("#")[0]];
  const out = md(
    `See [the *other* page](./other.md#part "t"), [intro](/docs/intro), [ext](https://x.dev) and [ref][r].\n\n[r]: ./other.md\n`,
    { resolveLink: (url) => (resolveLink(url) ? `${resolveLink(url)}${url.includes("#") ? `#${url.split("#")[1]}` : ""}` : undefined) },
  );
  assert.match(out, /\[the \*other\* page\]\(\/docs\/other\.md#part "t"\)/);
  assert.match(out, /\[intro\]\(\/docs\/intro\.md\)/);
  assert.match(out, /\[ext\]\(https:\/\/x\.dev\)/);
  assert.match(out, /^\[r\]: \/docs\/other\.md$/m);
});

test("the Markdown URL is the page's URL plus .md; a trailing slash takes index.md", () => {
  assert.equal(markdownUrl("/docs/intro"), "/docs/intro.md");
  assert.equal(markdownUrl("/docs/reference/api/core/"), "/docs/reference/api/core/index.md");
});

const site = { title: "flow-state.dev", summary: "Composable AI workflows.\nBlocks in.", origin: "https://flow-state.dev" };
const page = (title, permalink, description = `${title} in a line.`) => ({ title, permalink, description, markdown: `# ${title}\n\nBody of ${title}.\n` });

test("llms.txt: title, summary, one list per section, each entry a Markdown link with its description", () => {
  const out = llmsTxt(site, [
    { title: "Getting Started", pages: [page("Install", "/docs/install"), page("Quick start", "/docs/quick", "")] },
    { title: "Guides", pages: [page("Chat", "/guides/chat")] },
  ]);
  assert.equal(
    out,
    `# flow-state.dev

> Composable AI workflows. Blocks in.

## Getting Started

- [Install](https://flow-state.dev/docs/install.md): Install in a line.
- [Quick start](https://flow-state.dev/docs/quick.md)

## Guides

- [Chat](https://flow-state.dev/guides/chat.md): Chat in a line.
`,
  );
});

test("llms-full.txt holds the named sections whole, and nothing until it names one", () => {
  const sections = [
    { title: "Start", pages: [page("Install", "/docs/install")] },
    { title: "Recipes", pages: [page("Chat", "/guides/chat")] },
  ];
  assert.equal(llmsFullTxt(site, sections, []), undefined);
  const out = llmsFullTxt(site, sections, ["Start"]);
  assert.match(out, /Body of Install\./);
  assert.doesNotMatch(out, /Body of Chat\./);
  assert.throws(() => llmsFullTxt(site, sections, ["Concepts"]), /names the section "Concepts"/);
});

test("pages are listed by sidebar section; a page no sidebar lists still gets listed", () => {
  const siteDir = mkdtempSync(join(tmpdir(), "agent-docs-"));
  mkdirSync(join(siteDir, "docs"));
  for (const id of ["intro", "a", "b", "hidden", "loose", "g"]) writeFileSync(join(siteDir, "docs", `${id}.md`), `Text of ${id}, see [a](./a.md).\n`);
  const doc = (id, extra = {}) => ({ id, title: id.toUpperCase(), description: `${id} page`, source: `@site/docs/${id}.md`, permalink: `/docs/${id}`, ...extra });
  const { pages, sections } = loadPages(
    {
      default: {
        loadedVersions: [
          {
            docs: [doc("intro"), doc("a"), doc("b"), doc("hidden", { unlisted: true }), doc("loose")],
            sidebars: {
              docsSidebar: [
                { type: "doc", id: "intro" },
                { type: "category", label: "Core", link: { type: "doc", id: "a" }, items: [{ type: "category", label: "Deep", items: [{ type: "doc", id: "b" }] }] },
              ],
            },
          },
        ],
      },
      guides: {
        loadedVersions: [
          {
            docs: [doc("g", { permalink: "/guides/g" })],
            sidebars: { guidesSidebar: [{ type: "category", label: "Core", items: [{ type: "doc", id: "g" }] }] },
          },
        ],
      },
    },
    {
      siteDir,
      navbar: [
        { type: "docSidebar", sidebarId: "docsSidebar", label: "Docs" },
        { type: "docSidebar", sidebarId: "guidesSidebar", docsPluginId: "guides", label: "Guides" },
      ],
    },
  );
  assert.deepEqual(
    sections.map((s) => [s.title, s.pages.map((p) => p.title)]),
    [["Docs", ["INTRO"]], ["Core", ["A", "B"]], ["Guides: Core", ["G"]], ["Other pages", ["LOOSE"]]],
    "a section name two sidebars share is told apart by its sidebar",
  );
  assert.equal(pages.length, 5, "an unlisted page is not published as Markdown");
  assert.match(pages[0].markdown, /\[a\]\(\/docs\/a\.md\)/, "a relative .md link resolves through the page's source path");
});
