/**
 * The load hook `module-patch.mjs` registers. For each patch, when the process
 * loads the module at `file`, every match of the regular expression `from` in
 * its source is replaced with `to`, and, when `mark` is set, `file` is
 * appended to the `mark` file. A load that matches nothing throws, so a patch
 * that no longer applies fails the process instead of running unpatched.
 *
 * `from` matches the TypeScript source and tsx's JavaScript output alike, so
 * it works whichever side of tsx's own hooks it lands on. Several patches may
 * name one file; they apply in order.
 */
import { appendFileSync } from "node:fs";

/** @type {{ patches: Array<{ file: string, from: string, to: string }>, mark?: string }} */
let spec = { patches: [] };

/** Receives the patches from `register`. */
export async function initialize(data) {
  spec = data;
}

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (!url.startsWith("file:")) return loaded;
  const path = decodeURIComponent(new URL(url).pathname);
  const mine = spec.patches.filter((patch) => patch.file === path);
  if (mine.length === 0) return loaded;
  let source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
  for (const patch of mine) {
    if (!new RegExp(patch.from).test(source)) throw new Error(`module patch: ${patch.file} has nothing matching /${patch.from}/ to patch`);
    source = source.replace(new RegExp(patch.from, "g"), patch.to);
  }
  if (spec.mark !== undefined) appendFileSync(spec.mark, `${path}\n`);
  return { ...loaded, source, shortCircuit: true };
}
