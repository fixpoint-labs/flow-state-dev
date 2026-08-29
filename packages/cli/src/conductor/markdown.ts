/**
 * Markdown → wrapped lines for inspect. Questions and transcript
 * messages arrive as markdown; wrapping them as one blob made a
 * heading, a list, and a code span read as the same paragraph.
 */
import { ACCENT, BOLD, DIM, INK, TEAL, UNDERLINE, link, paint, wrap } from "./theme";

/**
 * Render markdown into lines that already fit `width`. Headings, lists,
 * fences, quotes, and inline code / emphasis / links. Unknown markup
 * stays visible as typed.
 */
export function renderMarkdown(text: string, width: number): string[] {
  return layoutMarkdown(text, width, true);
}

/**
 * Same blocks as `renderMarkdown`, without ANSI. Transcript find
 * highlights these lines; the ASK band uses the painted form.
 */
export function layoutMarkdown(text: string, width: number, painted = false): string[] {
  if (width <= 0) return [];
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (src.trim() === "") return [""];
  const lines: string[] = [];
  for (const block of splitBlocks(src)) {
    if (lines.length > 0) lines.push("");
    lines.push(...(painted ? renderBlock(block, width) : layoutBlock(block, width)));
  }
  return lines.length === 0 ? [""] : lines;
}

type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "fence"; lines: string[] }
  | { kind: "rule" };

function splitBlocks(src: string): Block[] {
  const raw = src.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < raw.length) {
    const line = raw[i]!;
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (/^```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < raw.length && !/^```/.test(raw[i]!)) {
        body.push(raw[i]!);
        i += 1;
      }
      if (i < raw.length) i += 1;
      blocks.push({ kind: "fence", lines: body });
      continue;
    }
    if (/^#{1,6}\s+\S/.test(line)) {
      blocks.push({ kind: "heading", text: line.replace(/^#{1,6}\s+/, "").trim() });
      i += 1;
      continue;
    }
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }
    if (/^\s{0,3}>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < raw.length && /^\s{0,3}>\s?/.test(raw[i]!) && raw[i]!.trim() !== "") {
        quoted.push(raw[i]!.replace(/^\s{0,3}>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: quoted.join(" ") });
      continue;
    }
    if (/^\s*[-*]\s+\S/.test(line) || /^\s*\d+\.\s+\S/.test(line)) {
      const items: string[] = [];
      while (i < raw.length && (/^\s*[-*]\s+\S/.test(raw[i]!) || /^\s*\d+\.\s+\S/.test(raw[i]!))) {
        items.push(raw[i]!.replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    const para: string[] = [];
    while (i < raw.length && raw[i]!.trim() !== "") {
      const next = raw[i]!;
      if (
        /^```/.test(next) ||
        /^#{1,6}\s+\S/.test(next) ||
        /^\s{0,3}>\s?/.test(next) ||
        /^\s*[-*]\s+\S/.test(next) ||
        /^\s*\d+\.\s+\S/.test(next) ||
        /^[-*_]{3,}\s*$/.test(next.trim())
      ) {
        break;
      }
      para.push(next.trim());
      i += 1;
    }
    if (para.length > 0) blocks.push({ kind: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

function layoutBlock(block: Block, width: number): string[] {
  switch (block.kind) {
    case "heading":
    case "paragraph":
      return wrap(block.text, width);
    case "quote":
      return wrap(block.text, Math.max(1, width - 2)).map((line) => `│ ${line}`);
    case "rule":
      return ["─".repeat(Math.max(1, width))];
    case "list":
      return block.items.flatMap((item) => {
        const mark = `• `;
        const rest = wrap(item, Math.max(1, width - mark.length));
        return rest.map((line, j) => (j === 0 ? `${mark}${line}` : `  ${line}`));
      });
    case "fence":
      return block.lines.map((line) =>
        line.length <= width ? line : `${line.slice(0, Math.max(1, width - 1))}…`,
      );
  }
}

function renderBlock(block: Block, width: number): string[] {
  switch (block.kind) {
    case "heading":
      return wrap(block.text, width).map((line) => paint(BOLD + ACCENT, line));
    case "paragraph":
      return wrap(block.text, width).map(paintInline);
    case "quote":
      return wrap(block.text, Math.max(1, width - 2)).map((line) => paint(DIM, `│ ${line}`));
    case "rule":
      return [paint(DIM, "─".repeat(Math.max(1, width)))];
    case "list":
      return block.items.flatMap((item) => {
        const mark = `• `;
        const rest = wrap(item, Math.max(1, width - mark.length));
        return rest.map((line, j) => (j === 0 ? `${mark}${paintInline(line)}` : `  ${paintInline(line)}`));
      });
    case "fence":
      return block.lines.map((line) => {
        const body = line.length <= width ? line : `${line.slice(0, Math.max(1, width - 1))}…`;
        return paint(TEAL, body);
      });
  }
}

/** Inline code, bold, italic, and http(s) links. */
export function paintInline(text: string): string {
  const codes: string[] = [];
  const withCodes = text.replace(/`([^`]+)`/g, (_, body: string) => {
    codes.push(paint(TEAL, body));
    return `\0C${codes.length - 1}\0`;
  });
  const links: string[] = [];
  const withLinks = withCodes.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, label: string, url: string) => {
    links.push(link(url, paint(UNDERLINE + INK, label)));
    return `\0L${links.length - 1}\0`;
  });
  let out = withLinks.replace(/\*\*([^*]+)\*\*/g, (_, body: string) => paint(BOLD, body));
  out = out.replace(/\*([^*]+)\*/g, (_, body: string) => paint(DIM, body));
  out = out.replace(/_([^_]+)_/g, (_, body: string) => paint(DIM, body));
  out = out.replace(/\0L(\d+)\0/g, (_, i: string) => links[Number(i)] ?? "");
  out = out.replace(/\0C(\d+)\0/g, (_, i: string) => codes[Number(i)] ?? "");
  return out;
}
