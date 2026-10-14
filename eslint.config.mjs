/**
 * Repo-wide ESLint config, run by `pnpm lint` and by the pre-push hook
 * (`.husky/pre-push`).
 *
 * It applies ESLint's recommended rules to every JS/TS file in the repo,
 * test files and goal fixtures included. Those are the files typecheck does
 * not cover, and a duplicated object key or a stray label in one reaches
 * `main` with every other check green. The rules are syntactic only, so a
 * full run needs no build and no type information.
 *
 * Recommended rules that already have violations on `main` are switched off
 * by name below rather than left to block every push. Turning one back on
 * means fixing its violations in the same change.
 */

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    // ESLint does not read .gitignore; these mirror its build output, caches,
    // and other agents' checkouts under .claude/worktrees.
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
      // Retained spec POCs stay out of default lint discovery
      // (docs/contributing/orchestration.md).
      "spec-poc/**",
      "specs/**/poc/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    // Registered so existing `eslint-disable` comments that name these
    // plugins' rules resolve. None of their rules is switched on here.
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": reactHooks },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      ...js.configs.recommended.rules,
      // TypeScript checks these, and ESLint's versions misread TS code
      // (type-only globals, overloads).
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
