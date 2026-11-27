/**
 * Where each page's Markdown is served, and the two index files built from those pages.
 *
 * - The Markdown URL is the page's URL plus `.md` (`/docs/intro` → `/docs/intro.md`); a URL
 *   that ends in `/` takes `index.md`. The file's path in the build is that URL, so any static
 *   host serves it.
 * - `llms.txt` follows the llmstxt.org layout: the site title, a one-line summary, then one
 *   list per sidebar section, each entry a link to a page's Markdown with its description.
 * - `llms-full.txt` is the Markdown of the sections it names, whole, in one file. It is written
 *   only when it names a section.
 */

/** The page's Markdown URL path. */
export function markdownUrl(permalink) {
  return permalink.endsWith("/") ? `${permalink}index.md` : `${permalink}.md`;
}

/**
 * @typedef {object} Page
 * @property {string} title
 * @property {string} description
 * @property {string} permalink
 * @property {string} markdown
 *
 * @typedef {object} Section
 * @property {string} title
 * @property {Page[]} pages
 */

function oneLine(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * @param {object} site
 * @param {string} site.title
 * @param {string} site.summary
 * @param {string} site.origin the site's URL with its base path, no trailing slash
 * @param {Section[]} sections
 */
export function llmsTxt({ title, summary, origin }, sections) {
  const lists = sections.map(({ title: heading, pages }) => {
    const entries = pages.map((p) => {
      const description = oneLine(p.description);
      return `- [${oneLine(p.title)}](${origin}${markdownUrl(p.permalink)})${description ? `: ${description}` : ""}`;
    });
    return `## ${heading}\n\n${entries.join("\n")}`;
  });
  return `# ${title}\n\n> ${oneLine(summary)}\n\n${lists.join("\n\n")}\n`;
}

/**
 * The full file, or undefined when `names` is empty. Throws on a name no section has, so a
 * renamed section can't silently empty the file.
 *
 * @param {object} site as for {@link llmsTxt}
 * @param {Section[]} sections
 * @param {string[]} names the sections it holds, in order
 */
export function llmsFullTxt({ title, summary, origin }, sections, names) {
  if (names.length === 0) return undefined;
  const pages = names.flatMap((name) => {
    const section = sections.find((s) => s.title === name);
    if (!section) throw new Error(`llms-full.txt names the section "${name}", which the sidebars don't have`);
    return section.pages;
  });
  const parts = pages.map((p) => `<!-- ${origin}${markdownUrl(p.permalink)} -->\n\n${p.markdown.trim()}`);
  return `# ${title}\n\n> ${oneLine(summary)}\n\n${parts.join("\n\n---\n\n")}\n`;
}
