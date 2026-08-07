/** Regression tests for server-side fetch network boundaries. */
import { lookup } from "node:dns/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertPublicHttpUrl } from "../../src/fetch/url-safety";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

const mockedLookup = vi.mocked(lookup);

describe("fetch URL safety", () => {
  beforeEach(() => {
    mockedLookup.mockReset();
  });

  it("accepts HTTP hosts only when every resolved address is public", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);

    await expect(
      assertPublicHttpUrl("https://example.com/page"),
    ).resolves.toMatchObject({
      href: "https://example.com/page",
    });
  });

  it("rejects a hostname when any resolved address is private", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.8", family: 4 },
    ]);

    await expect(
      assertPublicHttpUrl("https://attacker.example"),
    ).rejects.toThrow("Fetch URL must resolve to a public network address");
  });

  it.each([
    "file:///etc/passwd",
    "http://localhost/admin",
    "http://[::1]/admin",
    "http://[::ffff:7f00:1]/admin",
  ])("rejects non-web or local URL %s", async (url) => {
    await expect(assertPublicHttpUrl(url)).rejects.toThrow();
    expect(mockedLookup).not.toHaveBeenCalled();
  });
});
