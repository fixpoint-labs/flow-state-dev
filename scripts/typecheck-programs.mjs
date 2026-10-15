/**
 * The configs `scripts/typecheck.mjs` compiles for one package, in order:
 * `tsconfig.json`, then `tsconfig.test.json` when the package has one.
 *
 * The driver runs this list and `scripts/validate-test-typecheck.mjs` reads it,
 * so what the guard counts as covered is what the driver compiles.
 */

/**
 * The driver's programs for a package.
 * @param {(name: string) => boolean} hasConfig whether the package directory holds that config file
 * @returns {string[]}
 */
export function driverPrograms(hasConfig) {
  return hasConfig("tsconfig.test.json") ? ["tsconfig.json", "tsconfig.test.json"] : ["tsconfig.json"];
}
