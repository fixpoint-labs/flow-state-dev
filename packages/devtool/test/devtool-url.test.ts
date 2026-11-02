/**
 * The DevTool's address and the trace link built from it.
 *
 * `fsdev dev --app` writes the DevTool's address into every app page as the
 * `fsdev-devtool-url` meta. Every app that links a session into the DevTool
 * reads it here and builds the link here, so the meta name, the http(s) guard
 * and the `?session=` parameter the DevTool follows live in one place.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readDevtoolUrl, readSessionAddress, traceHref } from "../src/react";

afterEach(() => {
  for (const el of document.head.querySelectorAll("meta")) el.remove();
  window.history.replaceState(null, "", "/");
});

function meta(name: string, content: string): void {
  const el = document.createElement("meta");
  el.name = name;
  el.content = content;
  document.head.append(el);
}

describe("readDevtoolUrl", () => {
  it("reads the DevTool's address from the fsdev-devtool-url meta", () => {
    meta("fsdev-devtool-url", " http://127.0.0.1:51234/ ");
    expect(readDevtoolUrl()).toBe("http://127.0.0.1:51234/");
  });

  it("takes no address without that meta, so a trace link stays hidden when no DevTool is served", () => {
    meta("some-other-meta", "http://127.0.0.1:51234/");
    expect(readDevtoolUrl()).toBeUndefined();
  });

  it("takes no address that isn't http(s), so a page's meta can't plant a script link", () => {
    meta("fsdev-devtool-url", "javascript:alert(1)");
    expect(readDevtoolUrl()).toBeUndefined();
  });
});

describe("traceHref", () => {
  it("opens the session the DevTool's own address reader then finds", () => {
    const href = traceHref("http://127.0.0.1:51234/", "sess 1&x");
    // The round trip is the contract: the DevTool shell reads the link with readSessionAddress.
    window.history.replaceState(null, "", new URL(href).search);
    expect(readSessionAddress()).toBe("sess 1&x");
    expect(new URL(href).origin).toBe("http://127.0.0.1:51234");
  });

  it("keeps the DevTool address's own path and query", () => {
    const href = new URL(traceHref("http://127.0.0.1:51234/devtool?theme=dark", "s1"));
    expect(href.pathname).toBe("/devtool");
    expect(href.searchParams.get("theme")).toBe("dark");
    expect(href.searchParams.get("session")).toBe("s1");
  });

  it("opens the DevTool itself when there is no session yet", () => {
    expect(traceHref("http://127.0.0.1:51234/")).toBe("http://127.0.0.1:51234/");
  });
});
