import { describe, expect, it } from "vitest";
import { conductorRepoLabel } from "../src/conductor/repo-label";

describe("conductorRepoLabel", () => {
  it("is unset when CONDUCTOR_REPO is missing or blank", () => {
    expect(conductorRepoLabel(undefined)).toBeUndefined();
    expect(conductorRepoLabel("")).toBeUndefined();
    expect(conductorRepoLabel("   ")).toBeUndefined();
  });

  it("uses the checkout basename, including CONDUCTOR_REPO=.", () => {
    expect(conductorRepoLabel(".", "/tmp/fsd-product")).toBe("fsd-product");
    expect(conductorRepoLabel("/tmp/fsd-product")).toBe("fsd-product");
    expect(conductorRepoLabel("  /other/app  ", "/tmp/ignored")).toBe("app");
  });
});
