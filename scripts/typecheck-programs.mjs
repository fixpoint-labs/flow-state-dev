/** Configs `typecheck.mjs` runs. `validate-test-typecheck.mjs` counts this same list. */
export function driverPrograms(hasConfig) {
  return hasConfig("tsconfig.test.json") ? ["tsconfig.json", "tsconfig.test.json"] : ["tsconfig.json"];
}
