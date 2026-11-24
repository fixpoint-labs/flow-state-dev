/**
 * The docs as text for a coding agent: each page's Markdown beside its HTML, `llms.txt`, and
 * (once it names its sections) `llms-full.txt`.
 *
 * Reads every page of every docs-content instance (Docs, Guides and, when built, the API
 * reference), converts its source once all content has loaded, so a component with no
 * Markdown form fails the build before the slow part starts, and writes the files after the
 * build. The index files are made from the same pages, so they can't list a page the site
 * doesn't serve. See `to-markdown.mjs` for the text forms and `index-files.mjs` for the URLs
 * and layouts.
 *
 * Options:
 * - `full: string[]`: the `llms.txt` sections `llms-full.txt` holds, in order. Empty writes no
 *   full file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { llmsFullTxt, llmsTxt, markdownUrl } from "./index-files.mjs";
import { toMarkdown } from "./to-markdown.mjs";

const DOCS_PLUGIN = "docusaurus-plugin-content-docs";

/**
 * @param {import("@docusaurus/types").LoadContext} context
 * @param {{ full?: string[] }} options
 * @returns {import("@docusaurus/types").Plugin}
 */
export default function agentDocsPlugin(context, { full = [] } = {}) {
  const { siteConfig, siteDir } = context;
  const origin = `${siteConfig.url}${siteConfig.baseUrl}`.replace(/\/$/, "");
  const site = { title: siteConfig.title, summary: siteConfig.tagline, origin };
  /** @type {{ pages: import("./index-files.mjs").Page[]; sections: import("./index-files.mjs").Section[] }} */
  let loaded = { pages: [], sections: [] };

  return {
    name: "agent-docs",

    async allContentLoaded({ allContent }) {
      loaded = loadPages(allContent[DOCS_PLUGIN] ?? {}, { siteDir, navbar: siteConfig.themeConfig?.navbar?.items ?? [] });
      llmsFullTxt(site, loaded.sections, full); // a misnamed section fails here, not after the build
    },

    async postBuild({ outDir }) {
      const base = siteConfig.baseUrl;
      const write = (url, text) => {
        const path = join(outDir, url.slice(base.length));
        if (existsSync(path)) throw new Error(`agent docs: ${url} would overwrite a file the site already builds`);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      };
      for (const page of loaded.pages) write(markdownUrl(page.permalink), page.markdown);
      write(`${base}llms.txt`, llmsTxt(site, loaded.sections));
      const fullText = llmsFullTxt(site, loaded.sections, full);
      if (fullText !== undefined) write(`${base}llms-full.txt`, fullText);
    },
  };
}

/**
 * Every listed page, converted, and the `llms.txt` sections: one per top-level sidebar
 * category, the sidebar's loose pages under its navbar label, and a last section for pages no
 * sidebar lists.
 */
export function loadPages(instances, { siteDir, navbar }) {
  const docs = [];
  for (const [pluginId, content] of Object.entries(instances)) {
    for (const version of content.loadedVersions) {
      for (const doc of version.docs) if (!doc.unlisted) docs.push({ pluginId, version, doc });
    }
  }
  const sourcePath = (doc) => resolve(siteDir, doc.source.replace(/^@site\//, ""));
  const bySource = new Map(docs.map(({ doc }) => [sourcePath(doc), doc.permalink]));
  const permalinks = new Set(docs.map(({ doc }) => doc.permalink));

  /** A link to another page, as that page's Markdown URL; undefined leaves it as written. */
  const resolveLink = (url, fromDir) => {
    if (/^[a-z][a-z+.-]*:/i.test(url) || url.startsWith("#") || url.startsWith("//")) return undefined;
    const [path, hash] = url.split("#");
    let permalink;
    if (/\.mdx?$/.test(path)) {
      const file = path.startsWith("@site/") ? resolve(siteDir, path.slice(6)) : isAbsolute(path) ? resolve(siteDir, `.${path}`) : resolve(fromDir, decodeURI(path));
      permalink = bySource.get(file);
    } else if (path.startsWith("/")) {
      permalink = [path, path.replace(/\/$/, ""), `${path}/`].find((p) => permalinks.has(p));
    }
    return permalink === undefined ? undefined : `${markdownUrl(permalink)}${hash ? `#${hash}` : ""}`;
  };

  const pages = new Map();
  for (const { pluginId, doc } of docs) {
    const filePath = sourcePath(doc);
    const markdown = toMarkdown({ source: readFileSync(filePath, "utf8"), filePath, title: doc.title, resolveLink });
    pages.set(`${pluginId}\0${doc.id}`, { title: doc.title, description: doc.description ?? "", permalink: doc.permalink, markdown });
  }

  const sections = [];
  const listed = new Set();
  const take = (pluginId, id, into) => {
    const key = `${pluginId}\0${id}`;
    if (!pages.has(key) || listed.has(key)) return;
    listed.add(key);
    into.push(pages.get(key));
  };
  const flatten = (pluginId, items, into) => {
    for (const item of items) {
      if (item.type === "doc" || item.type === "ref") take(pluginId, item.id, into);
      else if (item.type === "category") {
        if (item.link?.type === "doc") take(pluginId, item.link.id, into);
        flatten(pluginId, item.items, into);
      }
    }
  };
  for (const [pluginId, content] of Object.entries(instances)) {
    for (const version of content.loadedVersions) {
      for (const [sidebarId, items] of Object.entries(version.sidebars)) {
        const label =
          navbar.find((n) => n.sidebarId === sidebarId && (n.docsPluginId ?? "default") === pluginId)?.label ?? sidebarId;
        const loose = { title: label, pages: [] };
        for (const item of items) {
          if (item.type === "category") {
            // Two sidebars can both have an "Orchestration"; the later one is named for its sidebar.
            const taken = sections.some((s) => s.title === item.label);
            const section = { title: taken ? `${label}: ${item.label}` : item.label, pages: [] };
            flatten(pluginId, [item], section.pages);
            sections.push(section);
          } else {
            if (!sections.includes(loose)) sections.push(loose);
            flatten(pluginId, [item], loose.pages);
          }
        }
      }
    }
  }
  const unlisted = [...pages.entries()].filter(([key]) => !listed.has(key)).map(([, page]) => page);
  if (unlisted.length > 0) sections.push({ title: "Other pages", pages: unlisted });
  return { pages: [...pages.values()], sections: sections.filter((s) => s.pages.length > 0) };
}
