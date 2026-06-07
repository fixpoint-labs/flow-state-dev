import { describe, it, expect } from "vitest";
import { parseRemoteDispatchOutput } from "../src/cli/parse-output";

describe("parseRemoteDispatchOutput", () => {
  it("extracts the URL and the session id embedded in it", () => {
    const stdout =
      "Dispatched cloud session.\n" +
      "View it at https://claude.ai/code/3f9a1c2d-1b2c-4d5e-8f90-abcdef012345\n";
    const { url, sessionId } = parseRemoteDispatchOutput(stdout);
    expect(url).toBe("https://claude.ai/code/3f9a1c2d-1b2c-4d5e-8f90-abcdef012345");
    expect(sessionId).toBe("3f9a1c2d-1b2c-4d5e-8f90-abcdef012345");
  });

  it("falls back to the first UUID when there is no URL", () => {
    const stdout = "Created session 3f9a1c2d-1b2c-4d5e-8f90-abcdef012345 (queued)";
    const { url, sessionId } = parseRemoteDispatchOutput(stdout);
    expect(url).toBeNull();
    expect(sessionId).toBe("3f9a1c2d-1b2c-4d5e-8f90-abcdef012345");
  });

  it("returns nulls for output it cannot recognize", () => {
    const { url, sessionId } = parseRemoteDispatchOutput("ok\n");
    expect(url).toBeNull();
    expect(sessionId).toBeNull();
  });

  it("does not include trailing punctuation/quotes in the URL", () => {
    const stdout = 'session: "https://claude.ai/code/abc" done';
    const { url } = parseRemoteDispatchOutput(stdout);
    expect(url).toBe("https://claude.ai/code/abc");
  });
});
