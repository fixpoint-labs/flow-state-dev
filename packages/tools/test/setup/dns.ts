/**
 * Keeps the suite off the network's resolver.
 *
 * The built-in fetch and crawl providers validate a URL's resolved addresses
 * before opening a socket (see `_internal/public-url.ts`). Test URLs like
 * `https://example.com` would otherwise perform a real DNS lookup, making the
 * suite fail on a runner without resolution and depend on what those names
 * happen to point at. Every hostname resolves to one public address here.
 *
 * Literal IPs never reach the resolver, so tests asserting that a private
 * address is blocked still exercise the real classification. `public-url.test.ts`
 * injects its own resolver and is unaffected by this stub.
 */
import { vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));
