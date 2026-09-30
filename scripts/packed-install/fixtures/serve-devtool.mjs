/**
 * Runs inside the consumer project the packed-install check builds, and does
 * what `fsdev dev` does with an installed DevTool: ask
 * `@flow-state-dev/devtool` for its client assets, serve them beside the flow
 * API, and load the page.
 *
 * Everything resolves from the installed tarballs in `node_modules`. The asset
 * directory must be inside the installed devtool package, so a copy left in the
 * repository cannot stand in for one the tarball did not carry.
 *
 * Every script and stylesheet `index.html` references is fetched, then every
 * `/assets/` file those reference, and each must come back as its own type.
 * `serve()` answers any unknown path with `index.html` (SPA fallback), so a
 * missing asset would otherwise look like a 200.
 *
 * Exits 0 and prints `devtool: ok` on success; anything else exits 1 with the
 * step that failed.
 */
import { realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { defineFlow } from "@flow-state-dev/core";
import { getAssetPath } from "@flow-state-dev/devtool";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";

/**
 * The content type each kind of asset must come back as. Any other kind only
 * has to not be HTML, which is what the SPA fallback answers for a missing file.
 */
const EXPECTED = { js: /javascript/, css: /text\/css/, svg: /image\/svg\+xml/ };

/** `js`, `css` or `svg` by file extension; `other` for anything else. */
const kindOf = (url) => {
  const ext = /\.(\w+)(?:[?#].*)?$/.exec(url)?.[1];
  if (ext === "js" || ext === "mjs") return "js";
  return ext === "css" || ext === "svg" ? ext : "other";
};

const fail = (step, detail) => {
  console.error(`devtool: FAIL at ${step}: ${detail}`);
  process.exit(1);
};

let assetDir;
try {
  assetDir = getAssetPath();
} catch (error) {
  fail("getAssetPath", String(error?.message ?? error));
}
const installed = realpathSync(join(process.cwd(), "node_modules", "@flow-state-dev", "devtool"));
const resolved = realpathSync(assetDir);
if (!resolved.startsWith(installed + sep))
  fail("getAssetPath", `${resolved} is not inside the installed package at ${installed}`);

const flow = defineFlow({ kind: "packed-install-devtool", actions: {} })();

const flowState = createFlowState({
  flows: { "packed-install-devtool": flow },
  stores: { default: { primary: inMemoryStores() } },
});

// The options `fsdev dev` passes, minus its connection config.
const handle = await serve(flowState, {
  port: 0,
  host: "127.0.0.1",
  basePath: "/api/flows",
  staticDir: assetDir,
  handleSignals: false,
});
const base = `http://127.0.0.1:${handle.port}`;

try {
  const page = await fetch(`${base}/`);
  const html = await page.text();
  if (!page.ok) fail("index", `status ${page.status}`);
  if (!/text\/html/.test(page.headers.get("content-type") ?? ""))
    fail("index", `content-type ${page.headers.get("content-type")}`);

  // Every asset URL reachable from the page: what index.html references, then
  // what each fetched script or stylesheet references in turn (the bundle's own
  // imports, images, fonts). Vite writes those as `/assets/<file>` strings, so a
  // scan of the text finds them without a browser.
  const queue = [
    ...[...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*\shref="([^"]+)"/g)].map((m) => m[1]),
  ];
  if (!queue.some((url) => kindOf(url) === "js"))
    fail("index", `no <script src> in index.html: ${html.slice(0, 300)}`);

  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i += 1) {
    const url = queue[i];
    const kind = kindOf(url);
    const res = await fetch(new URL(url, base));
    const type = res.headers.get("content-type") ?? "";
    const body = await res.text();
    if (!res.ok) fail("asset", `${url}: status ${res.status}`);
    const want = EXPECTED[kind];
    if (want ? !want.test(type) : /text\/html/.test(type))
      fail("asset", `${url}: content-type ${type}, expected ${kind}`);
    if (body.length === 0) fail("asset", `${url}: empty body`);
    if (kind !== "js" && kind !== "css") continue;
    for (const [ref] of body.matchAll(/\/assets\/[\w.-]+\.\w+/g)) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      queue.push(ref);
    }
  }
  console.log(`devtool: ok (${queue.length} asset(s) from ${assetDir})`);
} finally {
  await handle.close();
}
