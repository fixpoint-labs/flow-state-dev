/**
 * One docs page's source as plain Markdown: what a coding agent reads in place of the HTML.
 *
 * The page is parsed the way Docusaurus parses it (MDX, GFM, directives, after Docusaurus's
 * own preprocessing), and only the parts that are not Markdown are rewritten. Everything else
 * is copied from the source as written, so the prose is the page's prose.
 *
 * Each MDX component has one text form:
 * - `<Figure caption description />`: the caption as a bold line, then the description. The
 *   drawing itself is not linked: it takes its colours from the page's stylesheet, so on its
 *   own it would render unstyled.
 * - an admonition (`:::note[Title]`): a blockquote opening with its title in bold.
 * - `<Tabs>` / `<TabItem label>`: one heading per tab, one level below the heading before it.
 * Imports, exports, front matter and `{/* comments *\/}` are dropped. Any other component, or
 * an expression, throws naming the file and line, so a new component can't leak JSX into the
 * Markdown copy: give it a text form here.
 *
 * Links to other docs pages (a relative `.md` file, or a site path) are rewritten to that
 * page's Markdown URL; `resolveLink` decides which.
 */
import { dirname } from "node:path";
import { admonitionTitleToDirectiveLabel, escapeMarkdownHeadingIds, unwrapMdxCodeBlocks } from "@docusaurus/utils";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** Docusaurus's default admonition keywords (`@docusaurus/mdx-loader`'s admonitions plugin). */
export const ADMONITIONS = ["secondary", "info", "success", "danger", "note", "tip", "warning", "important", "caution"];

const parser = unified().use(remarkParse).use(remarkFrontmatter).use(remarkMdx).use(remarkGfm).use(remarkDirective);

/**
 * @param {object} page
 * @param {string} page.source the page's source text, front matter included
 * @param {string} page.filePath where it was read from, for errors and relative links
 * @param {string} page.title the page's title, used as its `#` heading when the source has none
 * @param {(url: string, fromDir: string) => string | undefined} [page.resolveLink] a link's
 *   Markdown URL, or undefined to leave it as written
 * @returns {string} the page as Markdown
 */
export function toMarkdown({ source, filePath, title, resolveLink = () => undefined }) {
  const text = admonitionTitleToDirectiveLabel(escapeMarkdownHeadingIds(unwrapMdxCodeBlocks(source)), ADMONITIONS);
  let tree;
  try {
    tree = parser.parse(text);
  } catch (error) {
    throw new Error(`${filePath}: cannot parse as MDX: ${error.message}`);
  }
  const headings = [];
  collect(tree, (n) => n.type === "heading", headings);
  const ctx = { text, filePath, headings, fromDir: dirname(filePath), resolveLink };
  const body = renderRange(ctx, tree, tree.position.start.offset, tree.position.end.offset).trim();
  const first = tree.children.find((n) => n.type !== "yaml" && n.type !== "mdxjsEsm");
  const hasTitle = first?.type === "heading" && first.depth === 1;
  return `${hasTitle ? "" : `# ${title}\n\n`}${body}\n`;
}

function collect(node, test, into) {
  if (test(node)) into.push(node);
  for (const child of node.children ?? []) collect(child, test, into);
}

/** The source between `start` and `end`, with each rewritten node inside it replaced. */
function renderRange(ctx, node, start, end) {
  const replaced = [];
  for (const child of node.children ?? []) findRewrites(ctx, child, replaced);
  let out = "";
  let at = start;
  for (const n of replaced) {
    const s = n.position.start.offset;
    const e = n.position.end.offset;
    if (s < start || e > end) continue;
    out += ctx.text.slice(at, s) + rewrite(ctx, n);
    at = e;
  }
  return out + ctx.text.slice(at, end);
}

/** The outermost nodes under `node` (itself included) that are not copied as written. */
function findRewrites(ctx, node, into) {
  if (needsRewrite(ctx, node)) into.push(node);
  else for (const child of node.children ?? []) findRewrites(ctx, child, into);
}

function needsRewrite(ctx, node) {
  switch (node.type) {
    case "yaml":
    case "mdxjsEsm":
    case "mdxFlowExpression":
    case "mdxTextExpression":
    case "mdxJsxFlowElement":
    case "mdxJsxTextElement":
      return true;
    case "containerDirective":
      return ADMONITIONS.includes(node.name);
    case "heading":
      return /\\\{#[^}]*\}/.test(slice(ctx, node));
    case "link":
    case "definition":
      return ctx.resolveLink(node.url, ctx.fromDir) !== undefined;
    default:
      return false;
  }
}

function slice(ctx, node) {
  return ctx.text.slice(node.position.start.offset, node.position.end.offset);
}

function where(ctx, node) {
  return `${ctx.filePath}:${node.position.start.line}`;
}

function rewrite(ctx, node) {
  switch (node.type) {
    case "yaml":
    case "mdxjsEsm":
      return "";
    case "mdxFlowExpression":
    case "mdxTextExpression":
      if (node.data?.estree?.body?.length === 0) return ""; // a comment
      throw new Error(`${where(ctx, node)}: the expression {${node.value}} has no Markdown form`);
    case "mdxJsxFlowElement":
    case "mdxJsxTextElement":
      return component(ctx, node);
    case "containerDirective":
      return admonition(ctx, node);
    case "heading":
      // Docusaurus's explicit heading id (`## Title {#id}`) names the HTML anchor; it isn't prose.
      return renderRange(ctx, node, node.position.start.offset, node.position.end.offset).replace(/\s*\\\{#[^}]*\}/, "");
    case "link":
    case "definition":
      return relink(ctx, node);
    default:
      throw new Error(`${where(ctx, node)}: no rewrite for ${node.type}`);
  }
}

/**
 * A component attribute's text: a quoted value, or an expression that is only a string
 * (`{"…"}`, a template with no substitutions, or a `+` of those). Throws when it is missing
 * or computed, since a computed value has no fixed text.
 */
function stringProp(ctx, node, name, { optional = false } = {}) {
  const attr = node.attributes.find((a) => a.type === "mdxJsxAttribute" && a.name === name);
  if (attr === undefined && optional) return undefined;
  const value =
    typeof attr?.value === "string" ? attr.value : constantString(attr?.value?.data?.estree?.body?.[0]?.expression);
  if (value === undefined) {
    throw new Error(`${where(ctx, node)}: <${node.name}> needs ${name} as a plain string for its Markdown form`);
  }
  return value;
}

function constantString(expr) {
  if (expr?.type === "Literal" && typeof expr.value === "string") return expr.value;
  if (expr?.type === "TemplateLiteral" && expr.expressions.length === 0) return expr.quasis[0].value.cooked;
  if (expr?.type === "BinaryExpression" && expr.operator === "+") {
    const [left, right] = [constantString(expr.left), constantString(expr.right)];
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function component(ctx, node) {
  switch (node.name) {
    case "Figure":
      return `**${stringProp(ctx, node, "caption")}**\n\n${stringProp(ctx, node, "description")}`;
    case "Tabs":
      return inner(ctx, node).trim();
    case "TabItem": {
      const label = stringProp(ctx, node, "label", { optional: true }) ?? stringProp(ctx, node, "value");
      return `${"#".repeat(headingDepth(ctx, node))} ${label}\n\n${inner(ctx, node).trim()}\n`;
    }
    default:
      if (/^[a-z]/.test(node.name ?? "")) return html(ctx, node);
      throw new Error(
        `${where(ctx, node)}: <${node.name ?? ""}> has no Markdown form. Add one to apps/docs/scripts/agent-docs/to-markdown.mjs`,
      );
  }
}

/** A plain HTML element (`<a id="…">`), which Markdown carries as is, written as HTML. */
function html(ctx, node) {
  const attrs = node.attributes.map((a) => {
    if (a.type !== "mdxJsxAttribute" || (a.value !== null && typeof a.value !== "string")) {
      throw new Error(`${where(ctx, node)}: <${node.name}> has a computed attribute, which has no Markdown form`);
    }
    const name = a.name === "className" ? "class" : a.name;
    return a.value === null ? ` ${name}` : ` ${name}="${a.value.replace(/"/g, "&quot;")}"`;
  });
  const children = node.children.length === 0 ? "" : inner(ctx, node).trim();
  return `<${node.name}${attrs.join("")}>${children}</${node.name}>`;
}

/** One level below the last heading before `node`, between 2 and 6. */
function headingDepth(ctx, node) {
  const before = ctx.headings.filter((h) => h.position.start.offset < node.position.start.offset).at(-1);
  return Math.min(6, Math.max(2, (before?.depth ?? 1) + 1));
}

/** A JSX element's children, rendered and dedented. */
function inner(ctx, node) {
  if (node.children.length === 0) return "";
  const start = node.children[0].position.start.offset;
  const end = node.children.at(-1).position.end.offset;
  // The first line starts at its child's column; restore its indentation before dedenting.
  const lead = " ".repeat(node.children[0].position.start.column - 1);
  return dedent(lead + renderRange(ctx, node, start, end));
}

function dedent(block) {
  const lines = block.split("\n");
  const indents = lines.filter((l) => l.trim() !== "").map((l) => /^ */.exec(l)[0].length);
  const cut = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((l) => l.slice(Math.min(cut, /^ */.exec(l)[0].length))).join("\n");
}

function admonition(ctx, node) {
  const [label, ...body] = node.children[0]?.data?.directiveLabel ? node.children : [undefined, ...node.children];
  const title = label
    ? renderRange(ctx, label, label.children[0].position.start.offset, label.children.at(-1).position.end.offset)
    : node.name[0].toUpperCase() + node.name.slice(1);
  const indent = " ".repeat(node.position.start.column - 1);
  const content =
    body.length === 0
      ? ""
      : dedent(
          " ".repeat(body[0].position.start.column - 1) +
            renderRange(ctx, node, body[0].position.start.offset, body.at(-1).position.end.offset),
        );
  const lines = [`**${title}**`, "", ...(content === "" ? [] : content.split("\n"))];
  return lines.map((l, i) => `${i === 0 ? "" : indent}${l === "" ? ">" : `> ${l}`}`).join("\n");
}

/** A link with its URL replaced by the target page's Markdown URL. */
function relink(ctx, node) {
  const to = ctx.resolveLink(node.url, ctx.fromDir);
  const raw = slice(ctx, node);
  if (node.type === "definition") return raw.replace(/^(\s*\[[^\]]*\]:\s*)(<[^>]*>|\S+)/, `$1${to}`);
  const open = raw.lastIndexOf("](");
  if (open === -1) return raw; // a reference link: its definition is rewritten instead
  const label = renderRange(ctx, node, node.position.start.offset, node.position.start.offset + open + 1);
  const rest = raw.slice(open + 2).replace(/^(<[^>]*>|[^\s)]+)/, to);
  return `${label}(${rest}`;
}
