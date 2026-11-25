/**
 * What makes an entry in a code folder a TypeScript module, and how the
 * generated file imports it — the one rule every codegen walk applies.
 *
 * The locked folders (`./discover`), the `resources/` module walk
 * (`./discover-resource-modules`) and the `blocks/` walk
 * (`./discover-worker-blocks`) all read `.ts`, `.tsx` and `.mts` as modules and
 * nothing else: the same set the kit claims (`../loader/read-workforce-folder`),
 * so a code file that starts the app is one `fsdev gen` registers. One
 * definition, so a walk cannot quietly stop finding one while the others still
 * do.
 */

/**
 * Each registered extension, mapped to the suffix its import specifier carries.
 * `.ts` and `.tsx` are imported extensionless. A `.mts` module is not found
 * that way, so it is imported as the `.mjs` it compiles to, which TypeScript
 * and the bundlers resolve back to the source file.
 */
const TYPESCRIPT_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  [".ts", ""],
  [".tsx", ""],
  [".mts", ".mjs"],
]);

/** The TypeScript extension this entry carries, or `undefined` when it is not a module the walks register. */
export function typescriptExtension(entry: string): string | undefined {
  return [...TYPESCRIPT_EXTENSIONS.keys()].find((extension) => entry.endsWith(extension));
}

/**
 * The specifier the generated file imports a module by.
 *
 * @param base The module's path without its extension, e.g. `./flows/workers/digest`.
 * @param extension What {@link typescriptExtension} returned for it.
 */
export function moduleSpecifier(base: string, extension: string): string {
  return `${base}${TYPESCRIPT_EXTENSIONS.get(extension) ?? ""}`;
}
