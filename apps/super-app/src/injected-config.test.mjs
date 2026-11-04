/**
 * The connection config the DevTool page reads out of an app's served page.
 * It is parsed from the exact markup `@flow-state-dev/node` writes
 * (`injectDevtoolConfig`), so a change to that format fails here, not silently
 * in the browser as "no user".
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInjectedConfig } from "./injected-config.mjs";

/** The tag `injectDevtoolConfig` writes: JSON with `<` escaped, before `</head>`. */
const page = (config) =>
  `<html><head><title>x</title><script>window.__FSD_DEVTOOL_CONFIG__ = ${JSON.stringify(config).replace(/</g, "\\u003c")};</script></head><body></body></html>`;

describe("parseInjectedConfig", () => {
  it("reads the user an app's pages declare", () => {
    assert.deepEqual(parseInjectedConfig(page({ userId: "alice" })), { userId: "alice" });
  });

  it("reads a token as well, and values that were escaped to sit inside a script tag", () => {
    assert.deepEqual(parseInjectedConfig(page({ userId: "a<b", bearerToken: "tok}en" })), { userId: "a<b", bearerToken: "tok}en" });
  });

  it("returns nothing for a page that declares none, so the panel's own user editor stays in charge", () => {
    assert.deepEqual(parseInjectedConfig("<html><head></head><body></body></html>"), {});
  });

  it("drops blank values, as the DevTool's own reader does", () => {
    assert.deepEqual(parseInjectedConfig(page({ userId: "  ", bearerToken: "" })), {});
  });

  it("returns nothing for config that doesn't parse, instead of throwing", () => {
    assert.deepEqual(parseInjectedConfig("<script>window.__FSD_DEVTOOL_CONFIG__ = {userId: nope};</script>"), {});
  });
});
