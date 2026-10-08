/**
 * The load hook `module-patch.mjs` registers: when the process loads the
 * module at `file`, every match of the regular expression `from` in its source
 * is replaced with `to`. A load that matches nothing throws, so a patch that no
 * longer applies to the commit fails the boot instead of running unpatched.
 *
 * Works whichever side of tsx's own hooks it lands on: a string literal reads
 * the same in the TypeScript source and in tsx's JavaScript output.
 */

/** @type {{ file: string, from: string, to: string } | undefined} */
let patch;

/** Receives the patch from `register`. */
export async function initialize(data) {
  patch = data;
}

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (patch === undefined || !url.startsWith("file:") || decodeURIComponent(new URL(url).pathname) !== patch.file) return loaded;
  const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
  if (!new RegExp(patch.from).test(source)) throw new Error(`module patch: ${patch.file} has nothing matching /${patch.from}/ to patch`);
  return { ...loaded, source: source.replace(new RegExp(patch.from, "g"), patch.to), shortCircuit: true };
}
