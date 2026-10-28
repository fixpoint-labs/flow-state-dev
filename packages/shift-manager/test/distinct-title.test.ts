/**
 * A task row filed with no title reads its goal as its title, so a Brief that
 * printed both said the same sentence twice. It shows a title only when the
 * row has one of its own.
 */
import { describe, expect, it } from "vitest";
import { toBoardRow } from "../src/lib/reads";
import { distinctTitle } from "../src/lib/tasks";

const row = (data: Record<string, unknown>) => toBoardRow("s1.tasks", "s1", "t1", data);

describe("the Brief's title", () => {
  it("is nothing for a row filed with no title, whose title is its goal", () => {
    expect(distinctTitle(row({ id: "t1", goal: "Take a quick look at the repo" }))).toBeNull();
  });

  it("is the row's own title when it has one apart from its goal", () => {
    expect(distinctTitle(row({ id: "t1", title: "Repo look", goal: "Take a quick look at the repo" }))).toBe("Repo look");
  });

  it("is nothing before the row has loaded", () => {
    expect(distinctTitle(undefined)).toBeNull();
  });
});
