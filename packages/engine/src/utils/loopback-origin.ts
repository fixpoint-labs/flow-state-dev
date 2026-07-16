/**
 * Browser-origin helpers shared by the privileged debug gate and the
 * development-auth resolver override. Both need the same question answered —
 * "is this request driven from a page on a non-loopback origin?" — so the
 * `Origin`-header logic lives here once rather than being re-derived per site.
 */

/**
 * Read the `Origin` header. Browsers set it on cross-origin requests and a real
 * page cannot forge it, so we trust it. We deliberately do NOT fall back to
 * `Referer` (trivially spoofable from a non-browser client). Headerless
 * requests (e.g. curl) return `null` — callers decide how to treat those.
 */
export function pickOrigin(request: Request): string | null {
  const o = request.headers.get("origin");
  if (o !== null && o.length > 0 && o !== "null") return o;
  return null;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopbackHostname(host: string): boolean {
  return (
    LOOPBACK_HOSTS.has(host) ||
    host === "::1" ||
    host.startsWith("127.")
  );
}

/**
 * Whether a full URL string's host is a loopback interface. Used for both the
 * `Origin` header and a request's own `url` (whose host reflects the `Host` the
 * client connected to). The latter answers "is this request served over
 * loopback?" for originless (non-browser) clients too — the signal that keeps a
 * leaked `FSDEV_DEV_AUTH=1` from bypassing auth on a network-facing deployment.
 */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHostname(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}
