/**
 * The DevTool button the proxy writes into every app's pages: a round link at
 * the bottom right that opens the super app's DevTool on that app
 * (`/devtool/?app=<id>`, a new tab, so the app stays where it was).
 *
 * The apps know nothing about it. The proxy adds one inline `<script>` before
 * the page's `</body>`, and the script makes the link once the page has loaded.
 * It is made in script, appended to `<html>` rather than `<body>`, and only after
 * `load`, so a framework hydrating `<body>` (Next) never meets a node it didn't render.
 */
import { StringDecoder } from "node:string_decoder";
import { Transform } from "node:stream";

/** Where the DevTool page lives on the proxy. */
export const DEVTOOL_PATH = "/devtool/";

const CLOSE_BODY = /<\/body>/i;

/**
 * The `<script>` that adds the button for one app.
 *
 * @param {{ id: string, title: string }} app
 */
export function buttonScript(app) {
  const href = `${DEVTOOL_PATH}?app=${encodeURIComponent(app.id)}`;
  const label = `Open the DevTool for ${app.title}`;
  // `<` escaped so a title can't close the tag it is written into.
  const data = JSON.stringify({ href, label }).replace(/</g, "\\u003c");
  return `<script>(function(c){
function add(){
if(document.getElementById("fsd-super-devtool"))return;
var a=document.createElement("a");
a.id="fsd-super-devtool";a.href=c.href;a.target="_blank";a.rel="noopener";a.title=c.label;a.setAttribute("aria-label",c.label);
a.style.cssText="all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;box-sizing:border-box;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#1c1b15;color:#e7e5e4;border:1px solid rgba(231,229,228,.3);box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:pointer;opacity:.75";
a.onmouseenter=function(){a.style.opacity="1"};a.onmouseleave=function(){a.style.opacity=".75"};
a.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
document.documentElement.appendChild(a);
}
function later(){setTimeout(add,0)}
if(document.readyState==="complete")later();else addEventListener("load",later);
})(${data});</script>`;
}

/**
 * `html` with `snippet` just before its `</body>`. A document with no `</body>`
 * (a fragment, an error body) comes back as it was: the button belongs in pages.
 *
 * @param {string} html
 * @param {string} snippet
 */
export function insertBeforeBodyClose(html, snippet) {
  const at = html.search(CLOSE_BODY);
  return at === -1 ? html : html.slice(0, at) + snippet + html.slice(at);
}

/**
 * A stream transform that writes `snippet` before the first `</body>` of an
 * HTML stream, for a response that can't be buffered (a streamed page keeps
 * arriving for as long as the app is rendering it). A page with no `</body>`
 * is passed through as it was. The last few characters are held back between
 * chunks, so a tag split across two of them is still found.
 *
 * @param {string} snippet
 * @returns {Transform}
 */
export function bodyCloseInjector(snippet) {
  const decoder = new StringDecoder("utf8");
  const keep = "</body>".length - 1;
  let held = "";
  let done = false;
  return new Transform({
    transform(chunk, _encoding, callback) {
      // Still through the decoder: a character split across chunks is rejoined, not cut in two.
      if (done) return callback(null, decoder.write(chunk));
      const text = held + decoder.write(chunk);
      const at = text.search(CLOSE_BODY);
      if (at !== -1) {
        done = true;
        held = "";
        return callback(null, text.slice(0, at) + snippet + text.slice(at));
      }
      held = text.slice(Math.max(0, text.length - keep));
      callback(null, text.slice(0, text.length - held.length));
    },
    flush(callback) {
      const rest = held + decoder.end();
      callback(null, rest);
    },
  });
}
