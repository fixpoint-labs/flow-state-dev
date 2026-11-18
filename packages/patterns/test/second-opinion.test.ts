/**
 * Public behavior for the second-opinion kit and its guarded flow.
 */
import { describe, expect, it } from "vitest";
import * as patterns from "../src/index";

describe("second opinion", () => {
  it("exports an installable secondOpinion kit", () => {
    expect(typeof (patterns as Record<string, unknown>).secondOpinion).toBe("function");
    expect(typeof (patterns as Record<string, unknown>).createSecondOpinionFlow).toBe("function");
  });
});
