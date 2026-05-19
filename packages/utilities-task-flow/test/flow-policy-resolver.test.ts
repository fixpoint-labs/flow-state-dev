/**
 * Lightweight tests for `formatPriorWork` — the helper workers can use
 * to turn structured prior-work observations into a prompt-ready blob.
 */
import { describe, expect, it } from "vitest";
import { formatPriorWork, type TaskPriorWork } from "../src/index";

describe("formatPriorWork", () => {
  it("returns an empty string when there are no observations", () => {
    const pw: TaskPriorWork = { observations: [] };
    expect(formatPriorWork(pw)).toBe("");
  });

  it("produces a string containing each toolName and a cached flag where set", () => {
    const pw: TaskPriorWork = {
      observations: [
        { toolName: "search", args: { q: "foo" }, result: "ok", cached: false, ts: 1 },
        { toolName: "fetch", args: { url: "x" }, result: "data", cached: true, ts: 2 },
      ],
    };
    const out = formatPriorWork(pw);
    expect(out).toContain("search");
    expect(out).toContain("fetch");
    expect(out).toContain("(cached)");
    // Only the cached one should carry the flag.
    const lines = out.split("\n");
    const searchLine = lines.find((l) => l.includes("search"))!;
    const fetchLine = lines.find((l) => l.includes("fetch"))!;
    expect(searchLine.includes("(cached)")).toBe(false);
    expect(fetchLine.includes("(cached)")).toBe(true);
  });
});
