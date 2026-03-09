import { beforeEach, describe, expect, it } from "vitest";

import { readBaseUrl, writeBaseUrl } from "../src/config";

describe("base url config", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns default when unset", () => {
    expect(readBaseUrl()).toBe("http://localhost:3000");
  });

  it("persists entered base url", () => {
    writeBaseUrl("https://example.com");
    expect(readBaseUrl()).toBe("https://example.com");
  });
});
