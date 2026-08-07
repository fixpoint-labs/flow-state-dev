import { describe, expect, it, vi } from "vitest";
import { assertPublicHttpUrl } from "../../../src/fetch/providers/public-url";

describe("assertPublicHttpUrl", () => {
  it.each([
    "http://127.0.0.1/secret",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1/secret",
    "http://[::1]/secret",
    "http://localhost/secret",
    "file:///etc/passwd",
  ])("rejects non-public destination %s", async (url) => {
    await expect(assertPublicHttpUrl(url)).rejects.toThrow();
  });

  it("rejects a hostname when DNS returns a private address", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValue([{ address: "192.168.1.10", family: 4 }]);
    await expect(
      assertPublicHttpUrl("https://example.test", resolve),
    ).rejects.toThrow("public IP addresses");
  });

  it("accepts a hostname only when every resolved address is public", async () => {
    const resolve = vi.fn().mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    await expect(
      assertPublicHttpUrl("https://example.com/page", resolve),
    ).resolves.toMatchObject({
      hostname: "example.com",
    });
  });
});
