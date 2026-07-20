/**
 * Registration/prospectus disclosure surfacing (FIX-898).
 *
 * `fetchEdgarFilings` must surface S-1 / 424B* primaries in a sibling
 * `registrationFilings` array WITHOUT weakening the existing periodic path:
 * 10-K/10-Q/8-K still populate `recentFilings` + material events + the latest
 * periodic extraction. SEC HTTP is mocked by URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchEdgarFilings } from "../lib/providers/edgar-filings";

const submissions = {
  cik: 1750000,
  name: "SpaceCo Exploration Inc.",
  filings: {
    recent: {
      form: ["8-K", "424B4", "S-1/A", "S-1", "10-K"],
      filingDate: ["2026-03-01", "2026-02-10", "2026-01-20", "2026-01-05", "2026-02-15"],
      accessionNumber: [
        "0000000000-26-000005",
        "0000000000-26-000004",
        "0000000000-26-000003",
        "0000000000-26-000002",
        "0000000000-26-000006",
      ],
      primaryDocument: ["ev.htm", "424b4.htm", "s1a.htm", "s1.htm", "10k.htm"],
      primaryDocDescription: ["8-K", "424B4", "S-1/A", "S-1", "10-K"],
      items: ["2.02", "", "", "", ""],
    },
  },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("company_tickers.json")) {
      return json({ "0": { cik_str: 1750000, ticker: "SPCX", title: "SpaceCo Exploration Inc." } });
    }
    if (url.includes("/submissions/")) return json(submissions);
    if (url.includes("efts.sec.gov")) return json({ hits: { total: { value: 0 }, hits: [] } });
    // The 10-K primary document HTML (latest-periodic extraction).
    return text("<html>Item 1A. Risk Factors " + "x".repeat(200) + " Item 7. Management's Discussion " + "y".repeat(200) + "</html>");
  }));
});

afterEach(() => vi.unstubAllGlobals());

function json(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
function text(body: string): Response {
  return { ok: true, status: 200, text: async () => body, json: async () => ({}) } as Response;
}

describe("fetchEdgarFilings — registration surfacing", () => {
  it("surfaces S-1 / 424B* in registrationFilings while periodic forms stay in recentFilings", async () => {
    const payload = await fetchEdgarFilings("SPCX", "2026-05-06");

    const regForms = payload.registrationFilings.map((f) => f.form);
    expect(regForms).toEqual(expect.arrayContaining(["424B4", "S-1/A", "S-1"]));
    // Registration primaries are NOT mixed into the periodic list...
    const recentForms = payload.recentFilings.map((f) => f.form);
    expect(recentForms).not.toEqual(expect.arrayContaining(["424B4", "S-1"]));
    // ...and the periodic path is unchanged: the 10-K and 8-K still appear.
    expect(recentForms).toEqual(expect.arrayContaining(["10-K", "8-K"]));
    expect(payload.materialEvents.length).toBeGreaterThan(0);
    expect(payload.latestPeriodic?.form).toBe("10-K");
  });
});
