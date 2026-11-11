/**
 * Syntactic recommended rules, so a full run needs no build. Test files and
 * goal fixtures are included: typecheck does not cover them. Rules off below
 * already fail on main; turn one on only in the change that fixes it.
 */

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import oneCoalescer, { LIVE_READ_SOURCE } from "./scripts/eslint-rules/one-coalescer.mjs";
import trackerIds, { COPIED_WHOLE, SHIPPED_SOURCE } from "./scripts/eslint-rules/no-tracker-ids.mjs";

export default defineConfig(
  {
    // ESLint does not read .gitignore. The worktrees entry keeps a run in the
    // main checkout from linting every other agent's checkout.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-client/**",
      "**/.next/**",
      // The super app's sub-route build of Kitchen Sink (`apps/super-app/build.mjs`).
      "**/.next-super-app/**",
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
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
      fsd: { rules: { ...trackerIds.rules, ...oneCoalescer.rules } },
    },
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
  {
    // A block's own ctx is a BlockContext however the block is typed, so the
    // framework's source passes it as it is. Three spellings, so a cast can't
    // move to another one. The two BlockContext casts are refused whatever the
    // variable is named (`rawCtx`, `given`); building a context from an object
    // literal is not a cast of one, and stays allowed. `as never` is keyed on
    // `ctx`, since packages use it on other values. Tests are out: their mocks
    // are partial on purpose.
    files: ["packages/*/src/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression[expression.name='ctx'] > TSNeverKeyword",
          message: "Pass ctx as it is; it is a BlockContext.",
        },
        {
          selector: "TSAsExpression[expression.type='Identifier'][typeAnnotation.typeName.name='BlockContext']",
          message: "Pass ctx as it is; it is a BlockContext.",
        },
        {
          selector:
            "TSAsExpression[expression.expression.type='Identifier'][typeAnnotation.typeName.name='BlockContext']",
          message: "Pass ctx as it is; it is a BlockContext.",
        },
      ],
    },
  },
  {
    // No tracker or process id where an adopter reads it: a hover, an error, a
    // test title, a file they copy. A pointer lives in a `//` comment (BP-006).
    ...SHIPPED_SOURCE,
    rules: { "fsd/no-tracker-ids": "error" },
  },
  {
    ...COPIED_WHOLE,
    rules: { "fsd/no-tracker-ids": ["error", { comments: "all" }] },
  },
  {
    // One coalescer, in the client: a live screen calls `client.live`.
    ...LIVE_READ_SOURCE,
    rules: { "fsd/one-coalescer": "error" },
  },
);
