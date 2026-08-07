/**
 * Network-address validation for server-side web requests.
 *
 * The built-in fetch and crawl providers open sockets from the server to a URL
 * the model (or a crawled page's markup) chose. Without a check, that reaches
 * loopback, link-local metadata services, and RFC1918 hosts — a server-side
 * request forgery surface. Hosted providers (Firecrawl, Jina) are exempt: they
 * call a vendor API and never open a socket to the target from here.
 *
 * Known limitation — DNS rebinding. The guard resolves the hostname and then
 * hands the hostname to `fetch`, which resolves it again when it connects. A
 * short-TTL record can answer public here and private there. Closing that means
 * pinning the connection to the validated address (an undici `Agent` with a
 * custom `connect.lookup`) while preserving Host/SNI, which is a larger change
 * than this guard. Literal-IP and open-redirect SSRF are covered; rebinding is
 * not.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Injectable for tests; matches the shape of `node:dns/promises`.`lookup`. */
export type AddressLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<{ address: string }[]>;

/**
 * A URL was refused by policy — a blocked destination, not a failed request.
 *
 * Callers use this to tell a policy refusal (permanent; retrying re-refuses)
 * apart from a resolver failure like `EAI_AGAIN` (transient; worth a retry),
 * which propagates from the lookup unchanged so it can be classified as the
 * network error it is.
 */
export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/**
 * Resolves `value` and throws {@link BlockedUrlError} unless every address it
 * maps to is publicly routable. Returns the parsed URL so callers can use the
 * normalized form. A DNS lookup failure propagates as the resolver threw it.
 */
export async function assertPublicHttpUrl(
  value: string,
  resolve: AddressLookup = lookup as unknown as AddressLookup,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BlockedUrlError("Fetch URL must be an absolute HTTP(S) URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError("Fetch URL must use HTTP or HTTPS");
  }
  // Credentials in the URL are a redirect-laundering trick and never needed here.
  if (url.username !== "" || url.password !== "") {
    throw new BlockedUrlError("Fetch URL must not contain credentials");
  }

  // `url.hostname` keeps the brackets on an IPv6 literal and may carry the
  // root-zone trailing dot; strip both before classifying or resolving.
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  if (hostname === "" || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new BlockedUrlError("Fetch URL must resolve only to public IP addresses");
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await resolve(hostname, { all: true, verbatim: true });

  // Reject if ANY answer is private: a hostname with mixed A/AAAA records must
  // not be reachable through whichever record the connect path happens to pick.
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIp(address))
  ) {
    throw new BlockedUrlError("Fetch URL must resolve only to public IP addresses");
  }

  return url;
}

/** True when `address` is a publicly routable unicast IPv4 or IPv6 address. */
export function isPublicIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 192 && b === 168) || // RFC1918
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast + reserved + broadcast
  );
}

function isPublicIpv6(address: string): boolean {
  const groups = parseIpv6(address);
  if (groups === null) return false;

  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const isZeroPrefix96 =
    g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;

  // Unspecified `::` and loopback `::1`.
  if (isZeroPrefix96 && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) {
    return false;
  }
  // IPv4-mapped `::ffff:0:0/96` and deprecated IPv4-compatible `::/96`.
  // Both textual forms (`::ffff:127.0.0.1` and `::ffff:7f00:1`) land here, so
  // the embedded address is classified as IPv4 regardless of how it was written.
  if (isZeroPrefix96 && (g5 === 0xffff || g5 === 0)) {
    return isPublicIpv4(embeddedIpv4(g6, g7));
  }
  // NAT64 `64:ff9b::/96` and `64:ff9b:1::/48`.
  if (g0 === 0x0064 && g1 === 0xff9b) {
    return isPublicIpv4(embeddedIpv4(g6, g7));
  }
  // 6to4 `2002::/16` embeds its IPv4 in the next 32 bits.
  if (g0 === 0x2002) return isPublicIpv4(embeddedIpv4(g1, g2));

  // Everything below is an allowlist, not a denylist: `2000::/3` is the only
  // range IANA has allocated as global unicast, so an address outside it is
  // unassigned, reserved, or special-purpose — and a network that locally routes
  // one (SRv6 `5f00::/16`, discard-only `100::/64`, plain unassigned `4000::/3`)
  // would be reachable if an unrecognized prefix defaulted to public. Unique
  // local, link-local, site-local and multicast all fall outside `2000::/3`, so
  // this subsumes them rather than depending on enumerating each.
  if ((g0 & 0xe000) !== 0x2000) return false;

  // Carve-outs that sit *inside* the global range and still are not routable.
  return !(
    (g0 === 0x2001 && g1 === 0x0db8) || // 2001:db8::/32 documentation
    (g0 === 0x2001 && (g1 & 0xfe00) === 0x0000) || // 2001::/23 protocol assignments
    (g0 === 0x3fff && (g1 & 0xf000) === 0x0000) // 3fff::/20 documentation
  );
}

function embeddedIpv4(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/** Expands an IPv6 literal (with optional `::` and zone id) to 8 groups. */
function parseIpv6(address: string): number[] | null {
  const bare = address.toLowerCase().split("%")[0];
  const [head, tail, ...rest] = bare.split("::");
  if (rest.length > 0) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const piece of part.split(":")) {
      // A trailing dotted quad occupies the final two groups.
      if (piece.includes(".")) {
        if (isIP(piece) !== 4) return null;
        const [a, b, c, d] = piece.split(".").map(Number);
        out.push((a << 8) | b, (c << 8) | d);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(Number.parseInt(piece, 16));
    }
    return out;
  };

  const left = toGroups(head);
  const right = tail === undefined ? [] : toGroups(tail);
  if (left === null || right === null) return null;

  if (tail === undefined) return left.length === 8 ? left : null;
  const fill = 8 - left.length - right.length;
  if (fill < 1) return null;
  return [...left, ...Array<number>(fill).fill(0), ...right];
}
