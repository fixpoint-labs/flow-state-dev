/**
 * What makes an entry in a code folder a TypeScript module — the one rule every
 * codegen walk applies.
 *
 * The locked folders (`./discover`), the `resources/` module walk
 * (`./discover-resource-modules`) and the `blocks/` walk
 * (`./discover-seat-blocks`) all read `.ts` and `.tsx` as modules and nothing
 * else. One definition, so a walk cannot quietly stop finding `.tsx` while the
 * others still do.
 */

/** Extensions that denote a TypeScript module. Anything else in a code folder is a note beside the code, or another reader's. */
const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx"];

/** The TypeScript extension this entry carries, or `undefined` when it is not a TypeScript module. */
export function typescriptExtension(entry: string): string | undefined {
  return TYPESCRIPT_EXTENSIONS.find((extension) => entry.endsWith(extension));
}
