/**
 * Syntactic recommended rules, so a full run needs no build. Test files and
 * goal fixtures are included: typecheck does not cover them. Rules off below
 * already fail on main; turn one on only in the change that fixes it.
 */

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    // ESLint does not read .gitignore. The worktrees entry keeps a run in the
    // main checkout from linting every other agent's checkout.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-client/**",
      "**/.next/**",
      "**/.docusaurus/**",
      "**/.turbo/**",
      "**/.fsdev/**",
      "**/coverage/**",
      "**/storybook-static/**",
      "**/*.d.ts",
      "apps/docs/build/**",
      ".claude/worktrees/**",
      ".orchestration/**",
      ".agents/orchestration/**",
      ".tmp/**",
      "graft/**",
      "graphify-out/**",
      ".goal-*.mts",
      // Retained spec POCs stay out of default discovery (docs/contributing/orchestration.md).
      "spec-poc/**",
      "specs/**/poc/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    // Existing eslint-disable comments name these plugins. Neither plugin's rules are on.
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": reactHooks },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      ...js.configs.recommended.rules,
      // TypeScript checks these. ESLint's versions misread it (type-only globals, overloads).
      "no-undef": "off",
      "no-redeclare": "off",
      "no-unused-vars": "off",
      // Violations on main today; see the file header.
      "no-control-regex": "off",
      "no-empty": "off",
      "no-empty-pattern": "off",
      "no-fallthrough": "off",
      "no-irregular-whitespace": "off",
      "no-regex-spaces": "off",
      "no-setter-return": "off",
      "no-sparse-arrays": "off",
      "no-useless-catch": "off",
      "no-useless-escape": "off",
      "require-yield": "off",
      "use-isnan": "off",
    },
  },
);
