/**
 * V9 · the rail and the right panel come from the package, not from the app.
 *
 * The shell's rail and panel are the parts a reader copies, so they have to be
 * components anyone can import. This reads the shell's source and fails when
 * one of those regions is drawn by an app-defined component that lists flows
 * or sessions itself.
 *
 * Red state: on the tree before the shell was rebuilt, the page imports
 * `components/session-sidebar.tsx`, which types and draws a session list of
 * its own. The first and last cases both fail there.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(appDir, path), "utf8");

/** The names a module imports from one specifier, across multi-line import lists. */
function importedFrom(source: string, specifier: string): string[] {
  const pattern = new RegExp(
    `import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*["']${specifier.replace(/[/@-]/g, "\\$&")}["']`,
    "g",
  );
  return [...source.matchAll(pattern)].flatMap((match) =>
    match[1]!
      .split(",")
      .map((name) => name.replace(/^\s*type\s+/, "").trim())
      .filter((name) => name.length > 0),
  );
}

/** The app modules the shell's rail and panel are made of. */
const REGION_MODULES = ["app/page.tsx", "components/team-panel.tsx"];

describe("V9 · the shell's rail and panel are package components", () => {
  it("draws the rail with the package's navigator", () => {
    const page = read("app/page.tsx");
    expect(importedFrom(page, "@flow-state-dev/react")).toContain("FlowNavigator");
    expect(page).toContain("<FlowNavigator");
    expect(page).not.toMatch(/components\/session-sidebar/);
  });

  it("draws the panel with the package's roster and board columns", () => {
    const panel = read("components/team-panel.tsx");
    const fromReact = importedFrom(panel, "@flow-state-dev/react");
    expect(fromReact).toEqual(expect.arrayContaining(["Roster", "BoardColumns"]));
    expect(panel).toContain("<Roster");
    expect(panel).toContain("<BoardColumns");
  });

  it("lists no flows or sessions in app code for those regions", () => {
    for (const path of REGION_MODULES) {
      const source = read(path);
      expect(source, path).not.toMatch(/\.listSessions\(|\.listFlows\(/);
      const fromClient = importedFrom(source, "@flow-state-dev/client");
      expect(fromClient, path).not.toContain("SessionSummary");
      expect(fromClient, path).not.toContain("FlowListEntry");
    }
    expect(existsSync(join(appDir, "components/session-sidebar.tsx"))).toBe(false);
  });
});
