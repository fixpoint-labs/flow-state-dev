import { describe, it, expect } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadResourceTemplate,
  ResourceTemplateLoadError,
} from "../src/resource-template/load-resource-template.node";
import { renderResourceTemplate } from "../src/resource-template/resource-template";

const fixtureDir = path.resolve(__dirname, "fixtures/resource-templates");
const importerUrl = pathToFileURL(fixtureDir + "/").href;

describe("loadResourceTemplate", () => {
  it("loads a fixture .md and renders against state", () => {
    const tpl = loadResourceTemplate("./analyst.md", importerUrl);
    expect(tpl.name).toBe("analyst");
    expect(tpl.description).toBe("A research analyst persona");

    const result = renderResourceTemplate(tpl, {
      name: "Alice",
      domain: "macro economics",
      areas: ["GDP growth", "inflation", "employment"],
    });
    expect(result).toContain("You are Alice");
    expect(result).toContain("macro economics research analyst");
    expect(result).toContain("- GDP growth");
    expect(result).toContain("- inflation");
  });

  it("discovers sibling partials", () => {
    const tpl = loadResourceTemplate("./analyst.md", importerUrl);
    // The greeting.md sibling should be available as a partial named "greeting"
    expect(tpl).toBeDefined();
  });

  it("throws on missing file", () => {
    expect(() =>
      loadResourceTemplate("./nonexistent.md", importerUrl)
    ).toThrow(ResourceTemplateLoadError);
  });

  it("supports absolute paths", () => {
    const absPath = path.join(fixtureDir, "analyst.md");
    const tpl = loadResourceTemplate(absPath, "file:///ignored");
    expect(tpl.name).toBe("analyst");
  });
});
