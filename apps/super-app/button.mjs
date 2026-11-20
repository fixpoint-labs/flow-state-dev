/**
 * The DevTool button the proxy writes into every app's pages: a round link at
 * the bottom right that opens the super app's DevTool on that app
 * (`/devtool/?app=<id>`, a new tab, so the app stays where it was).
 *
 * The apps know nothing about it. The proxy adds one inline `<script>` before
 * the page's `</body>`, and the script makes the link once the page has loaded.
 * It is made in script, appended to `<html>` rather than `<body>`, and only after
 * `load`, so a framework hydrating `<body>` (Next) never meets a node it didn't render.
 *
 * Above it sits the app switcher: a second round button that pops up the hosted
 * apps (from `/devtool/apps.json`, read each time it opens, so a stopped app shows
 * as stopped) and moves this tab to the one picked.
 *
 * For an app that can be restarted, the script also polls `/devtool/apps.json`
 * and, while the app's server code has changed since it started, shows a pill
 * beside the button that restarts it.
 */
import { StringDecoder } from "node:string_decoder";
import { Transform } from "node:stream";

/** Where the DevTool page lives on the proxy. */
export const DEVTOOL_PATH = "/devtool/";

/** `POST <RESTART_PATH><id>` restarts that app's server (`proxy.mjs`). */
export const RESTART_PATH = "/__super/restart/";

/** The header a restart request must carry: a form can't send it, and another site can't without a preflight. */
export const RESTART_HEADER = "x-super-app-restart";

/** How often an app's pages ask whether its server code changed. Under `changedTtlMs` in `lifecycle.mjs`, which reuses one answer across polls. */
const POLL_MS = 3000;

const CLOSE_BODY = /<\/body>/i;

/**
 * The `<script>` that adds the button for one app, and the changed pill when it can be restarted.
 *
 * @param {{ id: string, title: string }} app
 * @param {{ restartable?: boolean }} [options]
 */
export function buttonScript(app, { restartable = false } = {}) {
  const href = `${DEVTOOL_PATH}?app=${encodeURIComponent(app.id)}`;
  const label = `Open the DevTool for ${app.title}`;
  const list = `${DEVTOOL_PATH}apps.json`;
  const restart = restartable
    ? { id: app.id, title: app.title, list, url: `${RESTART_PATH}${encodeURIComponent(app.id)}`, header: RESTART_HEADER, every: POLL_MS }
    : undefined;
  // `<` escaped so a title can't close the tag it is written into.
  const data = JSON.stringify({ id: app.id, href, label, list, restart }).replace(/</g, "\\u003c");
  return `<script>(function(c){
var ROUND="all:initial;position:fixed;right:16px;z-index:2147483647;box-sizing:border-box;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#1c1b15;color:#e7e5e4;border:1px solid rgba(231,229,228,.3);box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:pointer;opacity:.75;";
function hover(el){el.onmouseenter=function(){el.style.opacity="1"};el.onmouseleave=function(){el.style.opacity=".75"}}
function add(){
if(document.getElementById("fsd-super-devtool"))return;
var a=document.createElement("a");
a.id="fsd-super-devtool";a.href=c.href;a.target="_blank";a.rel="noopener";a.title=c.label;a.setAttribute("aria-label",c.label);
a.style.cssText=ROUND+"bottom:16px";hover(a);
a.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
document.documentElement.appendChild(a);
switcher();
if(c.restart)watch(c.restart);
}
function switcher(){
var b=document.createElement("button");
b.id="fsd-super-switch";b.type="button";b.title="Switch app";b.setAttribute("aria-label","Switch app");b.setAttribute("aria-haspopup","menu");b.setAttribute("aria-expanded","false");
b.style.cssText=ROUND+"bottom:60px";hover(b);
b.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
var m=document.createElement("div");
m.id="fsd-super-apps";m.setAttribute("role","menu");
m.style.cssText="all:initial;position:fixed;right:60px;bottom:60px;z-index:2147483647;box-sizing:border-box;min-width:220px;padding:6px;display:none;flex-direction:column;gap:2px;border-radius:10px;background:#1c1b15;color:#e7e5e4;border:1px solid rgba(231,229,228,.2);box-shadow:0 8px 24px rgba(0,0,0,.45);font:13px/1.3 system-ui,sans-serif";
var open=false;
function item(text,note,href,current){
var el=document.createElement(href?"a":"div");
el.setAttribute("role","menuitem");
el.style.cssText="all:initial;box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 10px;border-radius:6px;color:inherit;font:inherit;text-decoration:none;"+(href?"cursor:pointer;":"")+(current?"font-weight:600;background:rgba(231,229,228,.08);":"");
var t=document.createElement("span");t.textContent=text;t.style.cssText="all:initial;color:inherit;font:inherit";el.appendChild(t);
if(note){var n=document.createElement("span");n.textContent=note;n.style.cssText="all:initial;color:#a8a29e;font:11px system-ui,sans-serif";el.appendChild(n)}
if(href){el.href=href;el.onmouseenter=function(){el.style.background="rgba(231,229,228,.12)"};el.onmouseleave=function(){el.style.background=""}}
if(current)el.setAttribute("aria-current","page");
return el;
}
function render(list){
m.textContent="";
list.forEach(function(x){
var here=x.id===c.id,up=x.status==="running";
m.appendChild(item(x.title,here?"here":up?"":x.status,here?null:x.prefix+"/",here));
});
var hr=document.createElement("div");hr.style.cssText="all:initial;display:block;height:1px;margin:4px 2px;background:rgba(231,229,228,.15)";m.appendChild(hr);
m.appendChild(item("All apps","","/",false));
}
function show(v){open=v;m.style.display=v?"flex":"none";b.setAttribute("aria-expanded",String(v))}
b.onclick=function(){
if(open)return show(false);
fetch(c.list,{cache:"no-store"}).then(function(res){return res.ok?res.json():[]},function(){return[]}).then(function(list){render(list);show(true)});
};
document.addEventListener("click",function(e){if(open&&!m.contains(e.target)&&!b.contains(e.target))show(false)},true);
document.addEventListener("keydown",function(e){if(open&&e.key==="Escape")show(false)});
document.documentElement.appendChild(b);document.documentElement.appendChild(m);
}
function watch(r){
var p=document.createElement("button");
p.id="fsd-super-changed";p.type="button";p.textContent="Server code changed · Restart";
p.title="Restart "+r.title+"'s server to run the edited code";
p.style.cssText="all:initial;position:fixed;right:60px;bottom:20px;z-index:2147483647;box-sizing:border-box;height:28px;padding:0 12px;display:none;align-items:center;border-radius:14px;background:#d97706;color:#1c1b15;font:600 12px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:pointer";
var busy=false,sent=false;
function reset(){busy=false;sent=false;p.textContent="Server code changed · Restart"}
p.onclick=function(){
if(busy||!confirm("Restart "+r.title+"? Work in progress there (a coding run, a turn) stops."))return;
busy=true;p.textContent="Restarting…";
fetch(r.url,{method:"POST",headers:(function(h){h[r.header]="1";return h})({})}).then(function(res){
if(res.ok){sent=true;return}reset();return res.text().then(function(t){alert(t)});
},function(){reset();alert("The restart request didn't reach the super app.")});
};
document.documentElement.appendChild(p);
function poll(){
fetch(r.list,{cache:"no-store"}).then(function(res){return res.ok?res.json():[]}).then(function(list){
var me=list.filter(function(x){return x.id===r.id})[0];
// Done once the new server answers, or failed if it stopped (a bad edit): either way the pill can be used again.
// An edit made since it loaded leaves it changed, and the pill offers the next restart.
if(sent&&me&&(me.status==="running"||me.status==="stopped"))reset();
p.style.display=(me&&me.changed)||busy?"flex":"none";
},function(){}).then(function(){setTimeout(poll,r.every)});
}
poll();
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
