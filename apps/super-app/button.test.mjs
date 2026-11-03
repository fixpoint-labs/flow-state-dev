/**
 * The DevTool button written into every app's pages. What matters: it lands
 * inside the document whichever way the page arrives (whole, or in chunks that
 * split the closing tag), exactly once, and an app's name can't break out of
 * the script it is written into.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bodyCloseInjector, buttonScript, insertBeforeBodyClose } from "./button.mjs";

const MARK = "<!--button-->";

/** Runs `chunks` through the injector and returns what came out. */
async function inject(chunks) {
  const stream = bodyCloseInjector(MARK);
  const out = [];
  stream.on("data", (c) => out.push(Buffer.from(c)));
  const ended = new Promise((resolve) => stream.on("end", resolve));
  for (const c of chunks) stream.write(c);
  stream.end();
  await ended;
  return Buffer.concat(out).toString("utf8");
}

describe("insertBeforeBodyClose", () => {
  it("puts the snippet inside the body, not after the document", () => {
    assert.equal(insertBeforeBodyClose("<body>x</body></html>", MARK), `<body>x${MARK}</body></html>`);
  });

  it("finds a closing tag in any case", () => {
    assert.equal(insertBeforeBodyClose("<BODY>x</BODY>", MARK), `<BODY>x${MARK}</BODY>`);
  });

  it("appends to a page with no body to close, so the button still shows", () => {
    assert.equal(insertBeforeBodyClose("<p>hi</p>", MARK), `<p>hi</p>${MARK}`);
  });
});

describe("bodyCloseInjector (a page that arrives in pieces)", () => {
  it("writes the snippet once, before </body>, when the page is one chunk", async () => {
    assert.equal(await inject(["<body>x</body></html>"]), `<body>x${MARK}</body></html>`);
  });

  it("finds </body> split across chunks at every position", async () => {
    const page = "<html><body>content</body></html>";
    const at = page.indexOf("</body>");
    for (let cut = at + 1; cut < at + "</body>".length; cut++) {
      assert.equal(await inject([page.slice(0, cut), page.slice(cut)]), `<html><body>content${MARK}</body></html>`, `cut at ${cut - at}`);
    }
  });

  it("leaves everything else as it was, a multi-byte character split between chunks included", async () => {
    const bytes = Buffer.from("<body>héllo→</body>");
    const at = bytes.indexOf(Buffer.from("→")) + 1; // inside the 3-byte arrow
    assert.equal(await inject([bytes.subarray(0, at), bytes.subarray(at)]), `<body>héllo→${MARK}</body>`);
  });

  it("writes it once even if a later chunk holds another </body>", async () => {
    const out = await inject(["<body>a</body>", "<script>'</body>'</script>"]);
    assert.equal(out.split(MARK).length - 1, 1);
  });

  it("appends it at the end of a page that never closes its body", async () => {
    assert.equal(await inject(["<p>one", "two</p>"]), `<p>onetwo</p>${MARK}`);
  });

  it("holds back only the tail, so a long page is not delayed until it ends", async () => {
    const stream = bodyCloseInjector(MARK);
    const seen = [];
    stream.on("data", (c) => seen.push(c.toString()));
    stream.write("<body>" + "x".repeat(100));
    await new Promise((r) => setImmediate(r));
    assert.ok(seen.join("").length >= 100, "the page's start has already gone out");
    stream.destroy();
  });
});

describe("buttonScript", () => {
  it("opens the DevTool on this app, in a new tab so the app stays where it was", () => {
    const script = buttonScript({ id: "shift-manager", title: "Shift Manager" });
    assert.match(script, /\/devtool\/\?app=shift-manager/);
    assert.match(script, /target="_blank"|\.target="_blank"/);
    assert.match(script, /noopener/);
  });

  it("can't be broken out of by an app title", () => {
    const script = buttonScript({ id: "x", title: "</script><img src=x onerror=alert(1)>" });
    // The only `</script>` is the one that ends the snippet.
    assert.equal(script.split("</script>").length - 1, 1);
    assert.ok(script.endsWith("</script>"));
  });
});
