/**
 * POC, throwaway: the repo's own config plus the draft rule, for ratchet.sh.
 * Shows the rule landing before the sweep, held by ESLint's bulk suppressions.
 */
import { neverPublish } from "../../../../../scripts/validate-publish-set.mjs";
import repo from "../../../../../eslint.config.mjs";
import plugin from "./no-tracker-ids.mjs";

export default [
  ...repo,
  { files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"], plugins: { fsd: plugin } },
  {
    files: ["packages/*/src/**/*.{ts,tsx,mts,js,mjs}"],
    ignores: neverPublish.map((d) => `packages/${d}/src/**`),
    rules: { "fsd/no-tracker-ids": "error" },
  },
  {
    files: ["packages/ui/registry/**/*.{ts,tsx}", "examples/**/*.{ts,tsx,mts,js,mjs}"],
    rules: { "fsd/no-tracker-ids": ["error", { comments: "all" }] },
  },
];
