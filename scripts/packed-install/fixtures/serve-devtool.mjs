/**
 * Runs inside the packed-install consumer project. Asks the installed
 * `@flow-state-dev/devtool` for its client assets, requires that directory to
 * sit inside the installed package, and serves it the way `fsdev dev` does.
 *
 * Every script and stylesheet `index.html` references must come back as that
 * type. `serve()` answers an unknown path with `index.html` (SPA fallback), so
 * a missing asset would otherwise look like a 200.
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
if (!realpathSync(assetDir).startsWith(installed + sep))
  fail("getAssetPath", `${assetDir} is not inside the installed package at ${installed}`);

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

  const refs = [
    ...[...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => ({ url: m[1], type: /javascript/ })),
    ...[...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*\shref="([^"]+)"/g)].map((m) => ({ url: m[1], type: /text\/css/ })),
  ];
  if (!refs.some((r) => r.type.source === "javascript"))
    fail("index", `no <script src> in index.html: ${html.slice(0, 300)}`);

  for (const ref of refs) {
    const res = await fetch(new URL(ref.url, base));
    const type = res.headers.get("content-type") ?? "";
    const body = await res.arrayBuffer();
    if (!res.ok) fail("asset", `${ref.url}: status ${res.status}`);
    if (!ref.type.test(type)) fail("asset", `${ref.url}: content-type ${type}, expected ${ref.type.source}`);
    if (body.byteLength === 0) fail("asset", `${ref.url}: empty body`);
  }
  console.log(`devtool: ok (${refs.length} asset(s) from ${assetDir})`);
} finally {
  await handle.close();
}
