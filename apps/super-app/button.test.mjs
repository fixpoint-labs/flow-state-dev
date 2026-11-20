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

/**
 * Just enough of a loaded page to run the button script in: elements that know whether they are
 * attached to `<html>` and carry their attributes and text, the document's listeners (to send a key
 * or a click to), and the MutationObservers the script registers, to be fired by hand. `fetch` is
 * whatever the test hands `run`.
 */
function fakePage() {
  const make = (tag) => {
    const el = {
      tagName: tag.toUpperCase(), id: "", style: {}, children: [], parent: null, attrs: {}, text: "",
      setAttribute(name, value) { el.attrs[name] = String(value); },
      getAttribute(name) { return el.attrs[name] ?? null; },
      get textContent() { return el.text + el.children.map((c) => c.textContent).join(""); },
      set textContent(value) { el.text = value; el.children = []; },
      appendChild(child) { child.parent = el; el.children.push(child); return child; },
      contains(other) { for (let n = other; n; n = n.parent) if (n === el) return true; return false; },
      get isConnected() { return el === root || (el.parent !== null && el.parent.children.includes(el) && el.parent.isConnected); },
    };
    return el;
  };
  const root = make("html");
  const observers = [];
  const listeners = {};
  const document = {
    readyState: "complete",
    documentElement: root,
    createElement: make,
    getElementById: (id) => root.children.find((c) => c.id === id && c.isConnected) ?? null,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
  };
  const dispatch = (type, event) => { for (const fn of listeners[type] ?? []) fn(event); };
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { observers.push(() => this.callback([])); }
  }
  const run = (script, fetch = () => new Promise(() => {})) => {
    const body = script.replace(/^<script>/, "").replace(/<\/script>$/, "");
    new Function("document", "addEventListener", "setTimeout", "MutationObserver", "fetch", body)(document, () => {}, (fn) => fn(), MutationObserver, fetch);
  };
  return { root, observers, run, dispatch };
}

describe("insertBeforeBodyClose", () => {
  it("puts the snippet inside the body, not after the document", () => {
    assert.equal(insertBeforeBodyClose("<body>x</body></html>", MARK), `<body>x${MARK}</body></html>`);
  });

  it("finds a closing tag in any case", () => {
    assert.equal(insertBeforeBodyClose("<BODY>x</BODY>", MARK), `<BODY>x${MARK}</BODY>`);
  });

  it("leaves a document with no body to close as it was: a fragment isn't a page", () => {
    assert.equal(insertBeforeBodyClose("<p>hi</p>", MARK), "<p>hi</p>");
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

  it("passes a stream that never closes a body through untouched", async () => {
    assert.equal(await inject(["<p>one", "two</p>"]), "<p>onetwo</p>");
  });

  it("keeps a multi-byte character intact when it is split after the button went in", async () => {
    // The chunk holding </body> ends inside the é of a script that follows it. Once the button is written,
    // the rest must still go through the decoder, or the two halves of é arrive as two replacement characters.
    const tail = Buffer.from("</body><script>caf\u00e9</script>");
    const cut = tail.indexOf(0xc3) + 1;
    const out = await inject([tail.subarray(0, cut), tail.subarray(cut)]);
    assert.equal(out, `${MARK}</body><script>caf\u00e9</script>`);
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

  it("offers the hosted apps to switch to, from the live list, and knows which one this page is", () => {
    const script = buttonScript({ id: "shift-manager", title: "Shift Manager" });
    // Read from the list the proxy serves when the menu opens, so a stopped app shows as stopped.
    assert.match(script, /"list":"\/devtool\/apps\.json"/);
    // The page's own app id is carried, so the menu can mark it "here" rather than link to itself.
    assert.match(script, /"id":"shift-manager"/);
    assert.match(script, /fsd-super-switch/);
  });

  it("writes a script that parses, with and without the restart pill", () => {
    for (const restartable of [false, true]) {
      const body = buttonScript({ id: "lab", title: "Lab" }, { restartable }).replace(/^<script>/, "").replace(/<\/script>$/, "");
      assert.doesNotThrow(() => new Function(body), `restartable: ${restartable}`);
    }
  });

  it("puts its buttons back when the page clears them from <html>", () => {
    // React renders Next's document root on the client to recover from a hydration error, and that
    // removes every child of <html> it didn't render. The buttons have to survive it.
    const { root, observers, run } = fakePage();
    run(buttonScript({ id: "kitchen-sink", title: "Kitchen Sink" }));
    const ids = () => root.children.map((c) => c.id);
    assert.deepEqual(ids(), ["fsd-super-devtool", "fsd-super-switch", "fsd-super-apps"]);
    root.children.length = 0; // what React does to nodes it didn't render
    for (const o of observers) o();
    assert.deepEqual(ids(), ["fsd-super-devtool", "fsd-super-switch", "fsd-super-apps"]);
  });

  it("offers only apps it can open: this one marked here, a stopped one shown but not a link", async () => {
    // The list is read when the menu opens so it can say which apps are up. A stopped app as a link
    // would land the tab on the proxy's error page, and a list that arrives after the menu was
    // dismissed (a slow answer) must not open it again.
    const { root, run, dispatch } = fakePage();
    const pending = [];
    const fetch = () => new Promise((resolve) => pending.push(resolve));
    run(buttonScript({ id: "kitchen-sink", title: "Kitchen Sink" }), fetch);
    const byId = (id) => root.children.find((c) => c.id === id);
    const button = byId("fsd-super-switch");
    const menu = byId("fsd-super-apps");
    const answer = async (list) => {
      pending.shift()({ ok: true, json: async () => list });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    const apps = [
      { id: "kitchen-sink", title: "Kitchen Sink", prefix: "/kitchen-sink", status: "running" },
      { id: "teammates", title: "Teammates", prefix: "/teammates", status: "running" },
      { id: "shift-manager", title: "Shift Manager", prefix: "/shift-manager", status: "stopped" },
    ];

    button.onclick();
    await answer(apps);
    assert.equal(menu.style.display, "flex");
    const rows = menu.children.filter((c) => c.attrs.role === "menuitem");
    const row = (title) => rows.find((r) => r.textContent.startsWith(title));
    assert.equal(row("Kitchen Sink").tagName, "DIV", "this app isn't a link to itself");
    assert.equal(row("Kitchen Sink").attrs["aria-current"], "page");
    assert.match(row("Kitchen Sink").textContent, /here$/);
    assert.equal(row("Teammates").tagName, "A");
    assert.equal(row("Teammates").href, "/teammates/");
    assert.equal(row("Shift Manager").tagName, "DIV", "a stopped app isn't a link");
    assert.equal(row("Shift Manager").attrs["aria-disabled"], "true");
    assert.match(row("Shift Manager").textContent, /stopped$/);
    assert.equal(row("All apps").href, "/");

    dispatch("keydown", { key: "Escape" });
    assert.equal(menu.style.display, "none");

    button.onclick(); // asked for again, then dismissed before the list arrives
    dispatch("keydown", { key: "Escape" });
    await answer(apps);
    assert.equal(menu.style.display, "none", "a late answer doesn't reopen a dismissed menu");
  });

  it("can't be broken out of by an app title", () => {
    const script = buttonScript({ id: "x", title: "</script><img src=x onerror=alert(1)>" });
    // The only `</script>` is the one that ends the snippet.
    assert.equal(script.split("</script>").length - 1, 1);
    assert.ok(script.endsWith("</script>"));
  });
});
