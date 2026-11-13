/**
 * Plants for `check-cut-readmes.mjs`: each rule must refuse a cut README that breaks it, on the
 * real tree, or the check could pass because it stopped reading that rule.
 *
 *   node --test scripts/check-cut-readmes.test.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CUT_DIR,
  ROOT,
  SITEMAP,
  publishedPackages,
  readmeOnlyExports,
  readmeProblems,
  referenceSlugs,
  shapeProblems,
  unsyncedReadmes,
} from "./check-cut-readmes.mjs";
import { rootReport } from "./check-root-exports.mjs";
import { fsReader, overlayReader } from "./mechanism-exports.mjs";

const real = fsReader(ROOT);
const good = real(`${CUT_DIR}/engine.md`);
const name = "@flow-state-dev/engine";

/** `overlayReader` with `list` seeing the planted files too, so an added or removed cut copy shows. */
const planted = (files) => {
  const read = overlayReader(real, files);
  read.list = (dir) => [...new Set([...real.list(dir), ...Object.keys(files).filter((f) => f.startsWith(`${dir}/`))])]
    .filter((f) => read(f) != null);
  return read;
};

test("the real cut READMEs hold their shape", () => {
  assert.deepEqual(shapeProblems(real), []);
});

test("every published package has a slug, and contracts reads under core", () => {
  const slugs = referenceSlugs(real(SITEMAP));
  for (const [, pkg] of publishedPackages(real)) assert.ok(slugs.has(pkg), `${pkg} has no slug in the sitemap`);
  assert.equal(slugs.get("@flow-state-dev/contracts"), "core");
  assert.equal(slugs.get("@flow-state-dev/engine"), "engine");
});

test("a cut README is refused for each broken rule", () => {
  assert.deepEqual(readmeProblems(good, name, "engine"), []);
  const refused = (text, slug = "engine") => readmeProblems(text, name, slug).length > 0;
  assert.ok(refused(good.replace(`# ${name}`, "# Engine")), "wrong first line");
  assert.ok(refused(good.replace("pnpm add @flow-state-dev/engine", "pnpm add something-else")), "no install line");
  assert.ok(refused(good.replace("reference/api/engine", "reference/api/server")), "link to another section");
  assert.ok(refused(good, "core"), "slug the sitemap gives is not the one linked");
  assert.ok(readmeProblems(good, name, undefined).length > 0, "no slug in the sitemap");
  assert.ok(refused(`${good}\n\`\`\`ts\nconst second = 1;\n\`\`\`\n`), "two examples");
  const long = good.replace("```ts\n", `\`\`\`ts\n${"// pad\n".repeat(20)}`);
  assert.ok(refused(long), "example of 20 lines or more");
});

test("a published package with no cut README, and a cut README with no package, are refused", () => {
  const missing = shapeProblems(planted({ [`${CUT_DIR}/core.md`]: null }));
  assert.ok(missing.some((p) => p.startsWith(`${CUT_DIR}/core.md: missing`)), missing.join("\n"));
  const extra = shapeProblems(planted({ [`${CUT_DIR}/integration-tests.md`]: good }));
  assert.ok(extra.some((p) => p.startsWith(`${CUT_DIR}/integration-tests.md: no published package`)), extra.join("\n"));
});

test("a long README edited without its cut copy is refused; both, or no cut copy, pass", () => {
  const hasCut = (dir) => dir !== "ui";
  assert.deepEqual(unsyncedReadmes(["packages/core/README.md"], hasCut), ["packages/core/README.md"]);
  assert.deepEqual(unsyncedReadmes(["packages/core/README.md", `${CUT_DIR}/core.md`], hasCut), []);
  assert.deepEqual(unsyncedReadmes(["packages/ui/README.md"], hasCut), []);
  assert.deepEqual(unsyncedReadmes(["packages/core/src/index.ts"], hasCut), []);
});

test("the export listing reads the cut copy in the long README's place", (t) => {
  // A root name nothing clears today, that the cut copy doesn't name. Planted into the long
  // README alone, it is cleared there and not by the cut copy, so it must be listed.
  const pick = [...rootReport(real).roots].flatMap(([pkg, m]) => {
    const dir = [...publishedPackages(real)].find(([, n]) => n === pkg)?.[0];
    const cut = real(`${CUT_DIR}/${dir}.md`) ?? "";
    return [...m].filter(([n, v]) => v.why === "failing" && !cut.includes(n)).map(([n]) => ({ pkg, dir, name: n }));
  })[0];
  if (!pick) return t.skip("no root name fails today, so there is nothing to plant");
  const longPath = `packages/${pick.dir}/README.md`;
  const long = `${real(longPath) ?? ""}\n\`${pick.name}\`\n`;
  const listed = readmeOnlyExports(overlayReader(real, { [longPath]: long }));
  assert.ok(listed.some((e) => e.pkg === pick.pkg && e.name === pick.name), `${pick.pkg} ${pick.name} is not listed`);
  // Plant: the cut copy says everything the long README says. Then nothing of that package is listed.
  const same = readmeOnlyExports(overlayReader(real, { [longPath]: long, [`${CUT_DIR}/${pick.dir}.md`]: long }));
  assert.equal(same.filter((e) => e.pkg === pick.pkg).length, 0);
});
