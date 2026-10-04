// @vitest-environment happy-dom
/**
 * The DevTool's address reaches the page as the `fsdev-devtool-url` meta that
 * `fsdev dev --app` writes into every page it serves; the trace link reads it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readDevtoolUrl } from "../src/lib/connection";

afterEach(() => {
  for (const el of document.head.querySelectorAll("meta")) el.remove();
});

function meta(name: string, content: string): void {
  const el = document.createElement("meta");
  el.name = name;
  el.content = content;
  document.head.append(el);
}

describe("readDevtoolUrl", () => {
  it("reads the DevTool's address from the fsdev-devtool-url meta", () => {
    meta("fsdev-devtool-url", "http://127.0.0.1:51234/");
    expect(readDevtoolUrl()).toBe("http://127.0.0.1:51234/");
  });

  it("takes no address without that meta, and none that isn't http(s)", () => {
    expect(readDevtoolUrl()).toBeUndefined();
    meta("fsdev-devtool-url", "javascript:alert(1)");
    expect(readDevtoolUrl()).toBeUndefined();
  });
});
