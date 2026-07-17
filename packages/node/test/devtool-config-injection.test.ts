import { describe, expect, it } from "vitest";
import { injectDevtoolConfig } from "../src/devtool-config-injection";

const HTML = "<!doctype html><html><head><title>DevTool</title></head><body></body></html>";

describe("injectDevtoolConfig", () => {
  it("injects the config global before </head>", () => {
    const out = injectDevtoolConfig(HTML, { userId: "owner", bearerToken: "s3cret" });
    expect(out).toContain('<script>window.__FSD_DEVTOOL_CONFIG__ = {"userId":"owner","bearerToken":"s3cret"};</script></head>');
    // Inserted exactly once, before </head>.
    expect(out.indexOf("__FSD_DEVTOOL_CONFIG__")).toBeLessThan(out.indexOf("</head>"));
  });

  it("drops empty/missing fields and keeps present ones", () => {
    expect(injectDevtoolConfig(HTML, { userId: "owner" })).toContain('{"userId":"owner"}');
    expect(injectDevtoolConfig(HTML, { bearerToken: "t" })).toContain('{"bearerToken":"t"}');
  });

  it("returns the HTML unchanged when no usable fields are present", () => {
    expect(injectDevtoolConfig(HTML, {})).toBe(HTML);
    expect(injectDevtoolConfig(HTML, { userId: "", bearerToken: "" })).toBe(HTML);
    // Whitespace-only values are ignored by the reader, so they must not be
    // injected (they would silently shadow the default otherwise).
    expect(injectDevtoolConfig(HTML, { userId: "   ", bearerToken: "  " })).toBe(HTML);
  });

  it("escapes < so a token containing </script> cannot break out of the tag", () => {
    const out = injectDevtoolConfig(HTML, { bearerToken: "a</script><script>alert(1)" });
    expect(out).not.toContain("</script><script>alert(1)");
    expect(out).toContain("\\u003c/script>");
  });

  it("falls back to before </body> when there is no </head>", () => {
    const noHead = "<html><body><div id=root></div></body></html>";
    const out = injectDevtoolConfig(noHead, { userId: "owner" });
    expect(out.indexOf("__FSD_DEVTOOL_CONFIG__")).toBeLessThan(out.indexOf("</body>"));
  });
});
