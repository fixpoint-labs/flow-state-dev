/**
 * The one source-scanning reader — and it reads a **narrow, enumerated set of config shapes**,
 * not whatever it finds.
 *
 * > *"I'm fine on shrinking the claim for now. I still think having an agent do the work will be
 * > the long term solution, this is used when we have simple enough projects to add to."*
 * > — the owner, on this detector's scope
 *
 * **The detector's job is simple projects.** A config past the accepted shapes is not a gap to
 * close by parsing harder — it is out of scope by design, and the right response is to say so and
 * hand the project to an agent or to the by-hand docs. Being turned away is cheap; being
 * scaffolded into the wrong directory is not.
 *
 * That inversion is what makes this surface finite. The earlier version tried to handle whatever
 * it met and got it wrong in a new way each round — a commented-out setting, a helper object
 * above the real call, a second live assignment, an unanchored read. Those are not four bugs;
 * they are one open-ended promise. **A shape is `undetermined` unless it is on the list below.**
 *
 * ## The accepted shapes
 *
 * For a settings module (`next.config.*`), exactly one of:
 *   1. `module.exports = { … }`  — a direct object literal
 *   2. `export default { … }`    — a direct object literal
 *   3. `const NAME = { … }` (with or without a TypeScript type annotation) followed by
 *      `export default NAME` or `module.exports = NAME`
 *
 * For a call's options (`createFlowState({ … })`), exactly one of:
 *   4. a single call in the file, given a direct object literal
 *
 * Within an accepted object, a setting's value is read only when it is a plain string literal or
 * a plain array of string literals. Everything else — a function export, a wrapper call like
 * `withMDX({…})`, a ternary, a spread, a computed value, two live assignments of one key — is
 * `undetermined`, and the caller refuses with the reason attached.
 *
 * **Comments and string bodies are blanked before anything is searched**, so a value inside a
 * comment or an unrelated string is never mistaken for an assignment.
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
 * The region of `source` that holds the exported settings object, or why it is not on the list.
 *
 * This is the whitelist. It matches the three accepted module shapes and nothing else — so a
 * config wrapped in `withMDX(...)`, exporting a function, or picking between objects at runtime is
 * turned away by construction rather than parsed hopefully.
 */
export function exportedObjectRegion(source) {
  const code = blankNonCode(source);

  // Shapes 1 and 2: a direct object literal on the export.
  const direct = /(?:module\s*\.\s*exports|export\s+default)\s*=?\s*\{/.exec(code);
  if (direct !== null) {
    const start = direct.index + direct[0].length - 1;
    const end = matchingBrace(code, start);
    if (end === -1) return { unreadable: "the exported object literal is not closed" };
    // A second export of any kind means we cannot say which one runs.
    const exports = [...code.matchAll(/(?:module\s*\.\s*exports|export\s+default)\s*=?/g)];
    if (exports.length > 1) return { unreadable: `${exports.length} exports found; only one is readable` };
    if (hasTopLevelSpread(code, start, end)) return { unreadable: "the exported object spreads in another value" };
    return { start, end };
  }

  // Shape 3: `const NAME = { … }` exported by name.
  const named = /(?:module\s*\.\s*exports\s*=|export\s+default)\s+([A-Za-z_$][\w$]*)\s*;?/.exec(code);
  if (named !== null) {
    // A TypeScript type annotation sits between the name and the `=` —
    // `const nextConfig: NextConfig = { … }` is what `create-next-app` emits for a TS project,
    // so refusing it turns away the single most ordinary shape there is. Found by running the
    // whitelist against real-world configs rather than against our own three.
    const declaration = new RegExp(
      `(?:const|let|var)\\s+${named[1]}\\s*(?::[^=]+)?=\\s*\\{`,
    ).exec(code);
    if (declaration === null) {
      return { unreadable: `the exported value \`${named[1]}\` is not a plain object literal` };
    }
    const start = declaration.index + declaration[0].length - 1;
    const end = matchingBrace(code, start);
    if (end === -1) return { unreadable: "the exported object literal is not closed" };
    if (hasTopLevelSpread(code, start, end)) return { unreadable: "the exported object spreads in another value" };
    return { start, end };
  }

  return { unreadable: "no plain object export found" };
}

/**
 * The region holding the object literal passed to the single `name(...)` call in `source`.
 *
 * More than one call, or an argument that is not a direct object literal, is `undetermined` — a
 * helper defined above the real call is exactly how a live registry came to read as empty.
 */
export function callArgumentRegion(source, name) {
  const code = blankNonCode(source);
  const calls = [...code.matchAll(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`, "g"))];
  if (calls.length === 0) return { unreadable: `no ${name}(...) call found` };
  if (calls.length > 1) return { unreadable: `${calls.length} ${name}(...) calls found; only one is readable` };

  const afterParen = calls[0].index + calls[0][0].length;
  const braceAt = code.slice(afterParen).search(/\S/);
  if (braceAt === -1 || code[afterParen + braceAt] !== "{") {
    return { unreadable: `${name}(...) is not given a plain object literal` };
  }
  const start = afterParen + braceAt;
  const end = matchingBrace(code, start);
  if (end === -1) return { unreadable: `the object given to ${name}(...) is not closed` };
  if (hasTopLevelSpread(code, start, end)) {
    return { unreadable: `the object given to ${name}(...) spreads in another value` };
  }
  return { start, end };
}

/**
 * Does the object literal at `[start, end]` spread something in at its top level?
 *
 * A spread is accepted syntax and an unaccepted *shape*: `{ ...base, basePath: '/portal' }` reads
 * cleanly and tells us nothing, because `base` can set any key — including the one we just read,
 * if it appears after. The object being right there is what makes this worth checking rather than
 * assuming; the earlier whitelist accepted it for exactly that reason.
 */
function hasTopLevelSpread(code, start, end) {
  return splitTopLevel(code.slice(start + 1, end)).some((part) => part.startsWith("..."));
}

/** Index of the `}` closing the `{` at `open`, or -1. */
function matchingBrace(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * The value of `key` inside an **already-accepted region**, or why it cannot be read.
 *
 * `region` is required and has no default. That is the enforcement: a caller cannot read a
 * setting without first having the shape accepted by {@link exportedObjectRegion} or
 * {@link callArgumentRegion}, so "went through the shared entry point" and "applied the whole
 * rule" are the same thing. Consolidating the duplicated walkers into this file did not achieve
 * that by itself — the entry point still accepted an unanchored read, which is how an incomplete
 * rule kept passing through it.
 *
 * @returns `{ raw, line }` for exactly one assignment, `{ raw: null }` when unassigned, or
 *   `{ unreadable }` when the region is not on the list or the key is assigned more than once.
 */
export function settingValue(source, key, region) {
  if (region === undefined || region === null) {
    throw new Error(
      `settingValue("${key}") was called with no region. Read the shape first with ` +
        `exportedObjectRegion() or callArgumentRegion(); an unanchored read is how a ` +
        `commented-out or helper value came to win.`,
    );
  }
  if (region.unreadable !== undefined) return { unreadable: region.unreadable };

  const code = blankNonCode(source);
  const scope = code.slice(region.start, region.end + 1);

  const pattern = new RegExp(`(^|[\\s{,;(])${key}\\s*:\\s*`, "g");
  const hits = [];
  let match;
  while ((match = pattern.exec(scope)) !== null) hits.push(region.start + match.index + match[0].length);

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
export function declaredLiteral(source, key, region) {
  const hit = settingValue(source, key, region);
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
