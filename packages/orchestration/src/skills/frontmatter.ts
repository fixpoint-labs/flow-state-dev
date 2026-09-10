/**
 * The frontmatter dialect the hand-written convention files share.
 *
 * `SKILL.md` and `WORKER.md` are both written by hand, so they accept the same
 * frontmatter: YAML-subset settings between `---` fences, Markdown body below.
 * This module owns that dialect — splitting the two halves and parsing the
 * settings — so learning one file teaches the other. It is deliberately not
 * core's `gray-matter` path: full YAML in one file and this subset in the other
 * is the divergence the shared module exists to prevent.
 *
 * Extracted verbatim from `skill-md.ts`, which still parses `SKILL.md` on top
 * of it. No behaviour changed in the move.
 */

/**
 * A record with no prototype, for anything keyed by names a file chose.
 *
 * Assigning `__proto__` into a `{}` hits `Object.prototype`'s legacy setter: it
 * creates no own key, and every later read of an *undeclared* key can resolve
 * through the object the file supplied. For frontmatter that is both a lost key
 * and a value arriving from nowhere. With no prototype there is no setter, so
 * `__proto__` is stored and read back like any other key, and an undeclared key
 * reads as `undefined`.
 */
function emptyRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

/**
 * Tiny YAML-subset parser sufficient for convention-file frontmatter.
 *
 * Supports:
 *   - Scalar `key: value` pairs.
 *   - Inline arrays `[a, b, c]` and inline objects (preserved as strings).
 *   - Block arrays of scalars (`- a` per line).
 *   - Block arrays of mappings (`- key: value` followed by indented fields).
 *   - Block-scalar literals (`|` / `|-`) for multi-line strings.
 *   - Nested mappings to arbitrary depth via indentation.
 *
 * NOT a general-purpose YAML implementation — intentionally narrow to keep
 * this package dependency-free.
 */
export function parseFrontmatterYaml(text: string): Record<string, unknown> {
  const rawLines = text.split(/\r?\n/);
  // Strip comments (full-line and trailing `#` outside strings) but preserve
  // intra-string content. Block scalars (`|`) are handled later and must
  // ignore comment stripping inside their bodies.
  const result = parseBlock(rawLines, 0, rawLines.length, 0) as Record<string, unknown>;
  return result;
}

/** Number of leading space characters on a line. Tabs count as one space. */
function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && (line[n] === " " || line[n] === "\t")) n++;
  return n;
}

/**
 * Parse a contiguous YAML block delimited by `[start, end)` whose entries
 * all sit at indentation `>= baseIndent`. Returns a mapping (object) when
 * the block's first non-blank line is a `key:` pair, or an array when it's
 * a `- item` sequence.
 */
function parseBlock(
  lines: string[],
  start: number,
  end: number,
  baseIndent: number,
): unknown {
  let i = start;
  while (i < end && (lines[i]!.trim() === "" || lines[i]!.trim().startsWith("#"))) i++;
  if (i >= end) return {};
  const first = lines[i]!;
  const trimmed = first.trim();
  if (trimmed.startsWith("- ") || trimmed === "-") {
    return parseSequenceBlock(lines, start, end, baseIndent);
  }
  return parseMappingBlock(lines, start, end, baseIndent);
}

function parseMappingBlock(
  lines: string[],
  start: number,
  end: number,
  baseIndent: number,
): Record<string, unknown> {
  // Null-prototype: a `__proto__:` key in a hand-written file would
  // otherwise hit the legacy prototype setter instead of creating an own
  // key, so a setting nobody declared could resolve through the chain —
  // and the key the file did write would vanish. See `emptyRecord`.
  const result = emptyRecord();
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indent = indentOf(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      // Lines at deeper indent without a preceding key are skipped to stay
      // resilient against partial inputs.
      i++;
      continue;
    }

    const colonIdx = findKeyColon(trimmed);
    if (colonIdx === -1) {
      i++;
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();

    if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") {
      const [value, next] = readBlockScalar(lines, i + 1, end, baseIndent, rest);
      result[key] = value;
      i = next;
      continue;
    }

    if (rest === "" || rest === "~" || rest.toLowerCase() === "null") {
      // Either a null scalar or a nested block.
      const childStart = i + 1;
      const childIndent = nextNonBlankIndent(lines, childStart, end);
      if (childIndent !== -1 && childIndent > baseIndent) {
        const nested = parseBlock(lines, childStart, end, childIndent);
        result[key] = nested;
        i = consumeBlock(lines, childStart, end, childIndent);
        continue;
      }
      result[key] = rest === "" ? null : null;
      i++;
      continue;
    }

    result[key] = parseScalar(rest);
    i++;
  }
  return result;
}

function parseSequenceBlock(
  lines: string[],
  start: number,
  end: number,
  baseIndent: number,
): unknown[] {
  const out: unknown[] = [];
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indent = indentOf(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      i++;
      continue;
    }
    if (!(trimmed.startsWith("- ") || trimmed === "-")) break;

    // Item body — what follows the `- ` marker.
    const after = trimmed === "-" ? "" : trimmed.slice(2);
    // A sequence-of-mappings item looks like `- key: value` and may carry
    // further fields on subsequent lines indented deeper than this dash.
    const dashColumn = indent;
    const itemIndent = dashColumn + 2;

    if (after === "") {
      // Either empty item or a nested mapping/sequence on the next lines.
      const childStart = i + 1;
      const childIndent = nextNonBlankIndent(lines, childStart, end);
      if (childIndent !== -1 && childIndent > dashColumn) {
        out.push(parseBlock(lines, childStart, end, childIndent));
        i = consumeBlock(lines, childStart, end, childIndent);
        continue;
      }
      out.push(null);
      i++;
      continue;
    }

    const afterColon = findKeyColon(after);
    if (afterColon === -1) {
      // Plain scalar item.
      out.push(parseScalar(after));
      i++;
      continue;
    }

    // Mapping item: rebuild a virtual block whose first line is the `- ` part
    // re-indented to `itemIndent`, plus subsequent lines that are indented
    // deeper than the dash column.
    const firstLineRebuilt = " ".repeat(itemIndent) + after;
    const virtual: string[] = [firstLineRebuilt];
    let j = i + 1;
    while (j < end) {
      const nl = lines[j]!;
      const nt = nl.trim();
      if (nt === "" || nt.startsWith("#")) {
        virtual.push(nl);
        j++;
        continue;
      }
      const ni = indentOf(nl);
      if (ni <= dashColumn) break;
      virtual.push(nl);
      j++;
    }
    const itemMap = parseMappingBlock(virtual, 0, virtual.length, itemIndent);
    out.push(itemMap);
    i = j;
  }
  return out;
}

/** Locate the indent of the next non-blank line, or -1 if none. */
function nextNonBlankIndent(lines: string[], start: number, end: number): number {
  for (let k = start; k < end; k++) {
    const t = lines[k]!.trim();
    if (t === "" || t.startsWith("#")) continue;
    return indentOf(lines[k]!);
  }
  return -1;
}

/** Advance past every line at `>= blockIndent`. */
function consumeBlock(
  lines: string[],
  start: number,
  end: number,
  blockIndent: number,
): number {
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    if (indentOf(line) < blockIndent) break;
    i++;
  }
  return i;
}

/**
 * Read a `|` / `|-` / `>` / `>-` block scalar. Returns `[bodyText, nextIndex]`.
 * Folded (`>`) scalars collapse interior newlines to spaces; literal (`|`)
 * scalars preserve them. The trailing-newline indicator (`-`) strips the
 * final newline.
 */
function readBlockScalar(
  lines: string[],
  start: number,
  end: number,
  parentIndent: number,
  marker: string,
): [string, number] {
  const literal = marker.startsWith("|");
  const strip = marker.endsWith("-");
  const collected: string[] = [];
  let bodyIndent = -1;
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    if (line.trim() === "") {
      collected.push("");
      i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind <= parentIndent) break;
    if (bodyIndent === -1) bodyIndent = ind;
    collected.push(line.slice(Math.min(ind, bodyIndent)));
    i++;
  }
  // Trim trailing blank lines.
  while (collected.length > 0 && collected[collected.length - 1] === "") {
    collected.pop();
  }
  let body = literal
    ? collected.join("\n")
    : collected.reduce((acc, l, idx) => {
        if (idx === 0) return l;
        if (l === "") return acc + "\n";
        return acc.endsWith("\n") ? acc + l : acc + " " + l;
      }, "");
  if (!strip) body += "\n";
  return [body, i];
}

/**
 * Find the index of the `:` that ends a YAML mapping key. Skips colons
 * inside `[...]` / `{...}` / quotes so inline structures don't false-match.
 */
function findKeyColon(text: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === ":" && depth === 0) {
      // Must be followed by whitespace or end-of-line to count as the
      // mapping colon (avoids matching `http://...` etc).
      if (i + 1 >= text.length || text[i + 1] === " " || text[i + 1] === "\t") {
        return i;
      }
    }
  }
  return -1;
}

/** Parse a single scalar, inline array, or quoted string. */
export function parseScalar(raw: string): unknown {
  const text = raw.trim();
  if (text.length === 0) return "";

  // Inline array: [a, b, c]
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return splitTopLevelCommas(inner).map((item) => parseScalar(item));
  }

  // Inline object: { a: 1, b: 2 } — coerce to a string for forward-compat
  if (text.startsWith("{") && text.endsWith("}")) {
    return text;
  }

  // Quoted string
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }

  // Booleans
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;

  // Numbers
  if (/^-?\d+$/.test(text)) return parseInt(text, 10);
  if (/^-?\d+\.\d+$/.test(text)) return parseFloat(text);

  // Bare string
  return text;
}

/**
 * Parse a flow-style mapping (`{ a: 1, b: "two" }`) into an object of parsed
 * scalars. Returns `null` when the text isn't a well-formed mapping (a bare
 * `{`, an entry without a key), so callers can fall through to their
 * mistyped-field handling.
 */
export function parseInlineMapping(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const inner = trimmed.slice(1, -1).trim();
  const out = emptyRecord();
  if (inner.length === 0) return out;
  for (const entry of splitTopLevelCommas(inner)) {
    const colon = findKeyColon(entry);
    if (colon === -1) return null;
    const key = entry.slice(0, colon).trim().replace(/^["']|["']$/g, "");
    if (key.length === 0) return null;
    out[key] = parseScalar(entry.slice(colon + 1));
  }
  return out;
}

/** Split a string on commas not inside brackets/braces/quotes. */
function splitTopLevelCommas(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let buf = "";

  for (let k = 0; k < input.length; k++) {
    const c = input[k]!;
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "[" || c === "{") {
      depth++;
      buf += c;
      continue;
    }
    if (c === "]" || c === "}") {
      depth--;
      buf += c;
      continue;
    }
    if (c === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim().length > 0) out.push(buf.trim());
  return out;
}

// ---------------------------------------------------------------------------
// Frontmatter extraction
// ---------------------------------------------------------------------------

/**
 * Split a convention file's text into a YAML frontmatter block and the
 * remaining body. Frontmatter is delimited by `---` lines at the start of the
 * file; a file without them is all body.
 */
export function splitFrontmatter(text: string): { yaml: string; body: string } {
  // Normalize leading whitespace but preserve trailing for body fidelity.
  if (!text.startsWith("---")) {
    return { yaml: "", body: text };
  }

  // Find the closing `---` on its own line.
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { yaml: "", body: text };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { yaml: "", body: text };
  }

  const yaml = lines.slice(1, endIdx).join("\n");
  // Drop the leading newline after the closing `---`.
  const body = lines.slice(endIdx + 1).join("\n").replace(/^\r?\n/, "");
  return { yaml, body };
}
