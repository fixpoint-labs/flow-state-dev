/**
 * The one source-scanning walker, shared by everything that reads a fact out of somebody else's
 * config without executing it.
 *
 * This existed twice — once in `next-project.mjs` for `pageExtensions`/`basePath`, once in
 * `fsdev-config.mjs` for `flows` — and both copies carried the same defect: they took the **first
 * textual match**, so a commented-out `// basePath: '/old'` or a helper `const example = { flows:
 * {} }` sitting above the real one won. One walker, one anchoring rule, one place to fix.
 *
 * **Comments are removed before anything is searched.** A value inside a comment is not a value;
 * matching one is reading source rather than reading a setting. Comment bodies are replaced with
 * spaces rather than deleted so every offset in the stripped text still lines up with the
 * original, which is what lets a caller report a line number.
 *
 * **Ambiguity is reported, never resolved.** If a key is assigned more than once after comments
 * are gone, or the anchor a caller asked for is not unique, the answer is `unreadable`. That is
 * the same posture the rest of this module already takes toward a setting it cannot read
 * statically: refuse and say why, rather than pick one and be silently wrong.
 */

/**
 * Blank out line and block comments — and, when `strings` is set, the insides of string and
 * template literals too. Length is preserved either way, so every offset still lines up with the
 * original and a caller can report a line number.
 *
 * **The two modes exist because the callers want opposite things.** Looking for an *assignment*
 * wants string bodies gone, so a `basePath` mentioned inside an error message or a doc URL cannot
 * be mistaken for one. Looking for an *import specifier* wants them kept, because the specifier
 * **is** a string — blanking it leaves `import x from "      "` and the entry resolves to nothing.
 * That was a real defect in the first version of this refactor, caught by the registry tests.
 */
export function blankNonCode(source, { strings = true } = {}) {
  const out = source.split("");
  let index = 0;
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== "\n") out[i] = " ";
  };

  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (two === "//") {
      const end = source.indexOf("\n", index);
      blank(index, end === -1 ? source.length : end);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", index + 2);
      blank(index, end === -1 ? source.length : end + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    const ch = source[index];
    if (ch === '"' || ch === "'" || ch === "`") {
      let i = index + 1;
      for (; i < source.length; i++) {
        if (source[i] === "\\") {
          i++;
          continue;
        }
        if (source[i] === ch) break;
      }
      // Always skip past the literal so a `//` or `/*` inside it is not read as a comment; only
      // blank its body when the caller asked for it.
      if (strings) blank(index + 1, i);
      index = i + 1;
      continue;
    }
    index++;
  }
  return out.join("");
}

/**
 * Read the value starting at `start`: balanced brackets, ending at a comma or a closing bracket
 * at depth 0. Returns the raw slice of the **original** source, so string contents are intact.
 */
export function valueAt(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[" || ch === "{" || ch === "(") depth++;
    else if (ch === "]" || ch === "}" || ch === ")") {
      if (depth === 0) return source.slice(start, i).trim();
      depth--;
    } else if (ch === "," && depth === 0) return source.slice(start, i).trim();
  }
  return source.slice(start).trim();
}

/**
 * Every assignment of `key` in `source`, after comments and string bodies are blanked, optionally
 * restricted to the region after `anchor`'s single occurrence.
 *
 * @returns `{ raw, line }` when exactly one assignment exists; `{ unreadable: <why> }` when none
 *   is anchorable or more than one is.
 */
export function settingValue(source, key, { anchor = null } = {}) {
  const code = blankNonCode(source);

  let from = 0;
  if (anchor !== null) {
    const occurrences = [...code.matchAll(new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))];
    if (occurrences.length === 0) return { unreadable: `no ${anchor} call found` };
    // More than one anchor and we cannot say which object is the exported one. Reporting the
    // first is how a helper defined above the real call came to win.
    if (occurrences.length > 1) return { unreadable: `${occurrences.length} ${anchor} calls found` };
    from = occurrences[0].index;
  }

  const pattern = new RegExp(`(^|[\\s{,;(])${key}\\s*:\\s*`, "g");
  pattern.lastIndex = from;
  const hits = [];
  let match;
  while ((match = pattern.exec(code)) !== null) hits.push(match.index + match[0].length);

  if (hits.length === 0) return { raw: null, line: null };
  if (hits.length > 1) {
    const lines = hits.map((at) => code.slice(0, at).split("\n").length);
    return { unreadable: `${key} is assigned ${hits.length} times (lines ${lines.join(", ")})` };
  }
  return { raw: valueAt(source, hits[0]), line: code.slice(0, hits[0]).split("\n").length };
}

/** A plain array of string literals → its values. Anything else → `null`: we cannot read it. */
export function plainStringArray(raw) {
  if (raw === null || !raw.startsWith("[")) return null;
  const inner = raw.slice(1, raw.lastIndexOf("]"));
  if (inner.trim() === "") return [];
  const values = [];
  for (const part of splitTopLevel(inner)) {
    const match = /^(['"])([^'"]*)\1$/.exec(part);
    if (match === null) return null;
    values.push(match[2]);
  }
  return values;
}

/** The escapes a JS string literal can carry that change what the value MEANS. */
const ESCAPES = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" };

/**
 * A plain string literal → its value, with escape sequences decoded.
 *
 * Decoded because the value is what the setting *means*, not how it was typed: `basePath:
 * "/docs\\x2fv1"` is the path `/docs/v1` to Next, and returning the literal characters `\\x2f`
 * would advertise a URL nobody can open. An escape we do not understand returns `null`, which the
 * callers already treat as "cannot read this statically" and refuse on.
 *
 * A template literal or an expression → `null`.
 */
export function plainString(raw) {
  if (raw === null) return null;
  const match = /^(['"])(.*)\1$/s.exec(raw);
  if (match === null) return null;
  const body = match[2];
  if (!body.includes("\\")) return body;

  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      out += body[i];
      continue;
    }
    const next = body[++i];
    if (next === undefined) return null;
    if (next === "x" || next === "u") {
      const braced = next === "u" && body[i + 1] === "{";
      const digits = braced
        ? body.slice(i + 2, body.indexOf("}", i))
        : body.slice(i + 1, i + 1 + (next === "x" ? 2 : 4));
      const code = Number.parseInt(digits, 16);
      if (!/^[0-9a-fA-F]+$/.test(digits) || Number.isNaN(code)) return null;
      out += String.fromCodePoint(code);
      i += braced ? digits.length + 2 : digits.length;
      continue;
    }
    out += ESCAPES[next] ?? next;
  }
  return out;
}

/**
 * `import x from "./y"` / `import { x } from "./y"` — identifier → specifier.
 *
 * Comments are blanked; string bodies are **not**, because a specifier *is* a string and blanking
 * it leaves `import x from "      "`.
 */
export function importMap(source) {
  const map = new Map();
  const pattern = /import\s+(?:(\w+)|\{([^}]*)\})\s+from\s+["']([^"']+)["']/g;
  const code = blankNonCode(source, { strings: false });
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const specifier = match[3];
    if (match[1] !== undefined) map.set(match[1], specifier);
    for (const name of (match[2] ?? "").split(",")) {
      const local = name.split(" as ").pop().trim();
      if (local.length > 0) map.set(local, specifier);
    }
  }
  return map;
}

/**
 * A string-literal property read out of a foreign module — `kind: "hello"` and its like.
 *
 * Goes through {@link settingValue} rather than a regex of its own, so it inherits the comment
 * blanking and the ambiguity rule. A commented-out `// kind: "hello"` is exactly as misleading
 * here as it was for `basePath`; this was the sibling scan that still read raw first-match after
 * the config-level one was fixed.
 *
 * @returns the literal, `null` when unassigned, or `{ unreadable }` when it cannot be resolved
 */
export function declaredLiteral(source, key, { anchor = null } = {}) {
  const hit = settingValue(source, key, { anchor });
  if (hit.unreadable) return { unreadable: hit.unreadable };
  if (hit.raw === null) return null;
  const literal = plainString(hit.raw);
  return literal === null ? { unreadable: `${key} is not a plain string literal` } : literal;
}

/** Split on commas at depth 0, so a nested object or call in one entry does not split it. */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "[" || ch === "{" || ch === "(") depth++;
    else if (ch === "]" || ch === "}" || ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}
