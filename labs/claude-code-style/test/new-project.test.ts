/**
 * Two project names can meet on one id. Creating the second must fail, or the
 * picker lists a new entry whose sessions work in the first project's repository.
 */
import { describe, expect, it } from "vitest";
import { projectIdOf, refuseExisting } from "../src/lib/new-project";

describe("a new project from the picker", () => {
  it("gives names that differ only in case or punctuation the same id", () => {
    expect(projectIdOf("Acme")).toBe("acme");
    expect(projectIdOf("Acme!")).toBe("acme");
    expect(projectIdOf("  Acme Web  ")).toBe("acme-web");
  });

  it("refuses when the id was already taken, naming the project that holds it", () => {
    const existing = { created: false, project: { id: "acme", title: "Acme" } };
    expect(() => refuseExisting(existing, "Acme!")).toThrow(/"Acme" already uses the id "acme"/);
  });

  it("lets a project it just made through", () => {
    expect(() => refuseExisting({ created: true, project: { id: "acme", title: "Acme" } }, "Acme")).not.toThrow();
  });
});
