/**
 * How the goal grades one built page against its Markdown twin: the HTML article's text, the
 * Markdown's text, the word drift between them, and what counts as JSX left in the Markdown.
 */

export function decode(text: string): string {
  return text
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** The rendered article's HTML: the `theme-doc-markdown` element, matched to its closing tag. */
export function article(html: string): string | undefined {
  const at = html.search(/<div[^>]*class="theme-doc-markdown[ "]/);
  if (at === -1) return undefined;
  const tag = /<\/?div\b[^>]*>/g;
  tag.lastIndex = at;
  let depth = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(at, m.index + m[0].length);
  }
  return undefined;
}

/** What a reader gets from the article: its text, with each drawing read as its description. */
export function htmlText(fragment: string): string {
  return decode(
    fragment
      .replace(/<svg\b[\s\S]*?<\/svg>/g, (svg) => ` ${/<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(svg)?.[1] ?? ""} `)
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

/** The Markdown's text, without what is syntax rather than prose: link targets, a fence's language, list numbers. */
export function markdownText(markdown: string): string {
  return markdown
    // A fence's language is syntax; its title is shown above the code, so it is text.
    .replace(/^([ \t]*(?:>[ \t]*)*)(```+|~~~+)(.*)$/gm, (_, indent, fence, info) => `${indent}${fence} ${/title="([^"]*)"/.exec(info)?.[1] ?? ""}`)
    // An ordered list's numbers are drawn by the page's stylesheet, not written in its text.
    .replace(/^([ \t]*(?:>[ \t]*)*)\d+[.)][ \t]/gm, "$1")
    .replace(/\]\((?:<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\)/g, "]")
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "");
}

export function words(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
  return counts;
}

/** How far the Markdown's words are from the HTML's, as a share of the HTML's word count. */
export function drift(markdown: Map<string, number>, html: Map<string, number>): number {
  let off = 0;
  let total = 0;
  for (const n of html.values()) total += n;
  for (const w of new Set([...markdown.keys(), ...html.keys()])) off += Math.abs((markdown.get(w) ?? 0) - (html.get(w) ?? 0));
  return total === 0 ? (off === 0 ? 0 : 1) : off / total;
}

/** A component tag, import/export line, or expression left outside code (a fence may sit in a blockquote). */
export function jsxLeft(markdown: string): string | undefined {
  const prose = markdown.replace(/^([ \t]*(?:>[ \t]*)*)(```+|~~~+)[\s\S]*?^\1\2[ \t]*$/gm, "").replace(/`[^`\n]*`/g, "");
  return /<[A-Z][\w.]*[\s/>]|^\s*(?:import|export)\s.+(?:from\s|=)|\{\/\*|(?<!\\)\{[^}\n]*\}/m.exec(prose)?.[0];
}

/** The Markdown URL rule: the page's URL plus `.md`; a URL ending in `/` takes `index.md`. */
export function markdownPathOf(url: string): string {
  return url.endsWith("/") ? `${url}index.md` : `${url}.md`;
}
