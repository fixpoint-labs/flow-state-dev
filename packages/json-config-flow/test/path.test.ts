import { describe, expect, it } from "vitest";
import {
  applyMappings,
  getAtPath,
  interpolateTemplate,
  isPathExpression,
  pathSegments,
} from "../src/path";

describe("pathSegments / getAtPath", () => {
  it("parses $.a.b and a.b the same way", () => {
    expect(pathSegments("$.intent")).toEqual(["intent"]);
    expect(pathSegments("intent")).toEqual(["intent"]);
    expect(pathSegments("$.a.b.c")).toEqual(["a", "b", "c"]);
  });

  it("walks nested own properties and array indexes", () => {
    const input = { intent: "plan", items: [{ name: "x" }] };
    expect(getAtPath(input, "$.intent")).toBe("plan");
    expect(getAtPath(input, "$.items.0.name")).toBe("x");
  });

  it("does not resolve inherited Object.prototype keys as own hops", () => {
    expect(getAtPath({ a: 1 }, "$.toString")).toBeUndefined();
  });
});

describe("interpolateTemplate / applyMappings", () => {
  it("interpolates {{$.path}} placeholders", () => {
    expect(interpolateTemplate("hi {{$.name}}", { name: "Jake" })).toBe("hi Jake");
  });

  it("builds an object from path and literal mappings", () => {
    expect(
      applyMappings(
        {
          kind: "plan",
          summary: "$.message",
          greet: "Hello {{$.message}}",
        },
        { message: "ship it", intent: "plan" },
      ),
    ).toEqual({
      kind: "plan",
      summary: "ship it",
      greet: "Hello ship it",
    });
  });

  it("detects path expressions", () => {
    expect(isPathExpression("$.foo")).toBe(true);
    expect(isPathExpression("plain")).toBe(false);
  });
});
