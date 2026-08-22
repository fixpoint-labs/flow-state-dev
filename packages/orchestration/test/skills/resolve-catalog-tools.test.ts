/**
 * Shared catalog-key resolution (FIX-977). Both skills and workforce
 * call this helper; the miss path must stay warn-and-skip.
 */
import { describe, expect, it, vi } from "vitest";
import { resolveCatalogTools } from "../../src/skills/resolve-catalog-tools";

const search = { config: { name: "search" } } as never;
const catalog = { search };

describe("resolveCatalogTools", () => {
  it("returns [] when toolKeys is empty or absent", () => {
    expect(resolveCatalogTools("a", undefined, catalog, "skills")).toEqual([]);
    expect(resolveCatalogTools("a", [], catalog, "skills")).toEqual([]);
  });

  it("collects catalog hits in key order", () => {
    const fetch = { config: { name: "fetch" } } as never;
    expect(
      resolveCatalogTools("a", ["search", "fetch"], { search, fetch }, "skills"),
    ).toEqual([search, fetch]);
  });

  it("warns and skips unknown keys, keeping the hits", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveCatalogTools("analyst", ["search", "ghost"], catalog, "skills")).toEqual(
      [search],
    );
    expect(warn).toHaveBeenCalledWith(
      '[skills] agent "analyst": unknown tool "ghost" — skipped',
    );
    warn.mockRestore();
  });

  it.each(["constructor", "toString", "valueOf", "hasOwnProperty"])(
    "treats prototype-named key %j as a miss",
    (protoKey) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(resolveCatalogTools("a", [protoKey], catalog, "workforce")).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        `[workforce] agent "a": unknown tool "${protoKey}" — skipped`,
      );
      warn.mockRestore();
    },
  );
});
