/**
 * One compiler: the rule `validate-package-boundaries.mjs` applies to every
 * workspace member's package.json.
 *
 * Only the members that import the TypeScript API declare it, at the root's range. Examples
 * declare it too, at exactly the root's specifier: they are copied out of the repository, and
 * a copy needs a compiler of its own. Any other version, or any other member, fails.
 * An `npm:` alias counts as the package it installs (`@typescript-eslint/*` is not `@typescript/`).
 */
const TYPESCRIPT_IMPORTERS = new Set(["packages/orchestration/package.json", "goals/package.json"]);
const declaresOwnCompiler = (manifestPath) =>
  TYPESCRIPT_IMPORTERS.has(manifestPath) || manifestPath.startsWith("examples/");
const isCompilerPackage = (name) => name === "typescript" || name.startsWith("@typescript/");
const aliasTarget = (range) => (/^npm:(@?[^@]+)/.exec(range) ?? [])[1] ?? null;

/**
 * The errors one member's manifest earns under the one-compiler rule.
 *
 * @param {string} manifestPath - the manifest's path relative to the repository root
 * @param {object} manifest - the parsed package.json
 * @param {string | undefined} rootTypescript - the root's `typescript` devDependency specifier
 * @returns {string[]} one message per offending declaration; empty when the manifest complies
 */
export function compilerDeclarationErrors(manifestPath, manifest, rootTypescript) {
  const errors = [];
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (name === "typescript" && declaresOwnCompiler(manifestPath)) {
        if (range !== rootTypescript) {
          const why = manifestPath.startsWith("examples/")
            ? " (an example declares its own compiler because it is copied out, but at the root's version)"
            : "";
          errors.push(`${manifestPath}: declares typescript ${range} in ${field}; it must match the root's ${rootTypescript}${why}`);
        }
      } else if (isCompilerPackage(name) || isCompilerPackage(aliasTarget(String(range)) ?? "")) {
        errors.push(`${manifestPath}: declares ${name} (${range}) in ${field}; the compiler is declared only at the root`);
      }
    }
  }
  return errors;
}
