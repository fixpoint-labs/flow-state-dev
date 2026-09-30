/**
 * Tiny path helper for config authors — not a full JSONPath/JMESPath engine.
 *
 * Supported forms:
 * - `$.a.b.c` or `a.b.c` — nested property walk (own properties only for each hop)
 * - `$.items.0.name` — numeric segments treated as array indexes
 * - template strings: `"Hello {{$.name}}"` — interpolate `{{...}}` path expressions
 */

const PATH_PREFIX = /^\$\.?/;

export function isPathExpression(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("$.") || value.startsWith("$"));
}

/** Normalize `$.a.b` / `$a.b` / `a.b` → segment list. */
export function pathSegments(path: string): string[] {
  const trimmed = path.trim();
  if (trimmed === "$" || trimmed === "") return [];
  const withoutRoot = trimmed.replace(PATH_PREFIX, "");
  if (withoutRoot === "") return [];
  return withoutRoot.split(".").filter((s) => s.length > 0);
}

export function getAtPath(root: unknown, path: string): unknown {
  const segments = pathSegments(path);
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
      continue;
    }
    const obj = cur as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(obj, seg)) return undefined;
    cur = obj[seg];
  }
  return cur;
}

const TEMPLATE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * Interpolate `{{$.path}}` placeholders. Non-string / missing values are
 * stringified with `String(...)`; undefined → empty string.
 */
export function interpolateTemplate(template: string, root: unknown): string {
  return template.replace(TEMPLATE_RE, (_m, expr: string) => {
    const value = getAtPath(root, expr.trim());
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
  });
}

/**
 * Resolve a mapping value against input:
 * - path expression → getAtPath
 * - template with `{{...}}` → interpolate
 * - anything else → literal
 */
export function resolveMappingValue(spec: unknown, input: unknown): unknown {
  if (typeof spec === "string") {
    if (isPathExpression(spec) && !spec.includes("{{")) {
      return getAtPath(input, spec);
    }
    if (spec.includes("{{")) {
      return interpolateTemplate(spec, input);
    }
    return spec;
  }
  if (Array.isArray(spec)) {
    return spec.map((item) => resolveMappingValue(item, input));
  }
  if (spec !== null && typeof spec === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(spec as Record<string, unknown>)) {
      out[k] = resolveMappingValue(v, input);
    }
    return out;
  }
  return spec;
}

export function applyMappings(
  mappings: Record<string, unknown>,
  input: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(mappings)) {
    out[key] = resolveMappingValue(spec, input);
  }
  return out;
}
