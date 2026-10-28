/**
 * Redaction for everything an error report is built from (FIX-1983).
 *
 * The dossier, the draft and every argument the reporter's run hands the
 * tracker pass through {@link redact}. It takes out the values a Lab names as
 * secret (its environment's keys and tokens, the operator's MCP keys) wherever
 * they appear, and anything shaped like a key or a bearer token even when
 * nobody named it.
 */

/** What a removed value is replaced with. */
export const REDACTED = "[redacted]";

/** Shapes that are secrets whoever wrote them. */
const SHAPES: readonly RegExp[] = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g,
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/g,
  /\blin_(api|oauth)_[A-Za-z0-9]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{12,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(api[_-]?key|access[_-]?token|secret|password|passwd|token)(["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi
];

/** The names of environment variables that hold a secret. */
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|PRIVATE/i;

/** The shortest value treated as a secret; shorter ones would take out ordinary words. */
const MIN_SECRET = 8;

/**
 * The values of the environment variables whose names say they hold a secret
 * (`*_KEY`, `*_TOKEN`, `*SECRET*`, …), at least {@link MIN_SECRET} long.
 */
export function secretsFromEnv(env: Readonly<Record<string, string | undefined>>): string[] {
  const found: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && value.length >= MIN_SECRET && SECRET_NAME.test(name)) found.push(value);
  }
  return found;
}

function redactText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET && out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  for (const shape of SHAPES) {
    out = out.replace(shape, (match, _a: string, sep?: string) =>
      // A `name=value` match keeps its name so a reader knows what was there.
      typeof sep === "string" && /[:=]/.test(sep) ? `${match.slice(0, match.indexOf(sep) + sep.length)}${REDACTED}` : REDACTED
    );
  }
  return out;
}

/**
 * `value` with every secret taken out of every string in it, at any depth.
 * Object keys are kept; a value that is not a string, array or plain object is
 * kept as it is.
 *
 * @param secrets Values to take out wherever they appear (longest first is not required).
 */
export function redact<T>(value: T, secrets: readonly string[]): T {
  const sorted = [...new Set(secrets)].sort((a, b) => b.length - a.length);
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return redactText(node, sorted);
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object" && Object.getPrototypeOf(node) === Object.prototype) {
      return Object.fromEntries(Object.entries(node).map(([key, inner]) => [key, walk(inner)]));
    }
    return node;
  };
  return walk(value) as T;
}
