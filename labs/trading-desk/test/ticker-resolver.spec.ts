/**
 * Unit test for the pre-flight ticker resolver's mode dispatch: record mode
 * resolves live, never via the fixture probe. Fixture-mode admit/reject
 * behavior against the real corpus is covered in
 * record-replay-roundtrip.spec.ts; here the live providers are module-mocked
 * so the record path is provable without network — a ticker/date the fixture
 * probe rejects must get past the probe in record mode and resolve through
 * the provider chain.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTicker } from "../src/flows/analysis/lib/ticker-resolver";
import { hasFinnhubKey } from "../src/providers/finnhub";
import { fetchYahooFundamentals } from "../src/providers/yahoo";

vi.mock("../src/providers/finnhub", () => ({
  hasFinnhubKey: vi.fn(() => false),
  fetchFinnhubFundamentals: vi.fn(),
}));
vi.mock("../src/providers/yahoo", () => ({
  fetchYahooFundamentals: vi.fn(),
}));

describe("resolveTicker record mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasFinnhubKey).mockReturnValue(false);
  });

  it("bypasses the fixture probe and resolves through the live provider chain", async () => {
    const input = { ticker: "ZZZZ", date: "2099-01-01" };

    // The same tuple is unresolvable in fixture mode (no corpus snapshot),
    // and fixture mode never touches a provider...
    const fixture = await resolveTicker({ ...input, dataSource: "fixture" });
    expect(fixture.resolved).toBe(false);
    expect(fetchYahooFundamentals).not.toHaveBeenCalled();

    // ...but record mode never consults the probe: it resolves live.
    vi.mocked(fetchYahooFundamentals).mockResolvedValue(
      {} as Awaited<ReturnType<typeof fetchYahooFundamentals>>,
    );
    const record = await resolveTicker({ ...input, dataSource: "record" });
    expect(record).toEqual({ resolved: true, reason: null });
    expect(fetchYahooFundamentals).toHaveBeenCalledWith(input);
  });

  it("treats a malformed fixture date as unresolvable without probing the path", async () => {
    const result = await resolveTicker({
      ticker: "NVDA",
      date: "../etc",
      dataSource: "fixture",
    });
    expect(result.resolved).toBe(false);
    expect(result.reason).toMatch(/YYYY-MM-DD/);
  });
});
