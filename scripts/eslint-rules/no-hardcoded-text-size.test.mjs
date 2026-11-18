/**
 * Tests for `fsd/no-hardcoded-text-size`: the lint that keeps a lab's text on
 * the type scale. Each case plants a hard-coded size where a lab's author
 * writes one (a `className`, a `cn()` call, a conditional, a template string,
 * a style object) and expects a report naming the step to use, or plants a
 * step, a colour or a non-size class and expects none. The config cases lint
 * through the repo's own `eslint.config.mjs`, so a rule that stopped reading a
 * lab fails here, not only in a hand-built config.
 *
 * Run with `node --test scripts/eslint-rules/no-hardcoded-text-size.test.mjs`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import plugin from "./no-hardcoded-text-size.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RULE = "fsd/no-hardcoded-text-size";

function lint(code) {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(
    code,
    [
      {
        files: ["**/*.tsx"],
        languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { fsd: plugin },
        rules: { [RULE]: "error" },
      },
    ],
    { filename: "plant.tsx" },
  );
}

/** The hard-coded sizes reported, in source order (style reports as `style`). */
const reported = (code) => lint(code).map((m) => /`([^`]+)`/.exec(m.message)?.[1]);

/** What the repo's own config reports for `code` at `filePath`. */
async function lintAt(filePath, code) {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === RULE);
}

const PLANT = 'export const Meta = () => <span className="font-mono text-[10px] text-muted-foreground">3m</span>;\n';

describe("fsd/no-hardcoded-text-size", () => {
  it("reports a px size in a className, and names the step at or above it", () => {
    const [message] = lint(PLANT);
    assert.match(message.message, /`text-\[10px\]`/);
    assert.match(message.message, /Use `text-xs`/);
  });

  it("maps each size to the nearest step that is not smaller", () => {
    const steps = (size) => /Use (`[^`]+`)/.exec(lint(`const c = "text-[${size}]";`)[0].message)[1];
    assert.equal(steps("9.5px"), "`text-xs`");
    assert.equal(steps("12.5px"), "`text-sm`");
    assert.equal(steps("13.5px"), "`text-sm`");
    assert.equal(steps("15px"), "`text-base`");
    assert.equal(steps("0.7rem"), "`text-xs`");
    assert.equal(steps("22px"), "`text-xl`");
  });

  it("reads cn() calls, conditionals and template strings, with any variant prefix", () => {
    const code = [
      'const a = cn("flex", busy && "md:text-[11px]");',
      'const b = on ? "text-[13px]" : "text-sm";',
      "const c = `px-2 ${on ? \"\" : \"x\"} [&_code]:text-[12.5px] dark:!text-[9px]`;",
    ].join("\n");
    assert.deepEqual(reported(code), ["text-[11px]", "text-[13px]", "text-[12.5px]", "text-[9px]"]);
  });

  it("reports a size with a line height, a CSS function, a length hint and an arbitrary property", () => {
    const code = 'const a = "text-[11px]/4 text-[clamp(12px,2vw,16px)] text-[length:var(--size)] text-(length:--size) [font-size:11px]";';
    assert.deepEqual(reported(code), ["text-[11px]", "text-[clamp(12px,2vw,16px)]", "text-[length:var(--size)]", "text-(length:--size)", "[font-size:11px]"]);
  });

  it("reports a size in every CSS length unit", () => {
    const units = [
      "px", "cm", "mm", "Q", "in", "pt", "pc",
      "em", "rem", "ex", "rex", "ch", "rch", "cap", "rcap", "ic", "ric", "lh", "rlh",
      "vw", "svw", "lvw", "dvw", "vh", "dvh", "vi", "svi", "vb", "lvb", "vmin", "dvmin", "vmax", "svmax",
      "cqw", "cqh", "cqi", "cqb", "cqmin", "cqmax", "%",
    ];
    const classes = units.map((unit) => `text-[2${unit}]`);
    assert.deepEqual(reported(`const a = "${classes.join(" ")}";`), classes);
  });

  it("reports fontSize in a JSX style object", () => {
    const messages = lint('export const A = () => <span style={{ fontSize: 11, color: "red" }}>a</span>;\n');
    assert.equal(messages.length, 1);
    assert.match(messages[0].message, /fontSize/);
  });

  it("leaves the steps, colours and other arbitrary classes alone", () => {
    const code = [
      'const a = "text-xs text-sm text-base text-lg text-2xl leading-[1.15] tracking-[0.12em]";',
      'const b = "dark:!text-[var(--shiki-dark)] text-[#e8f551] text-(--accent) size-[18px] gap-[9px] max-w-[80%]";',
      'const c = "context-[11px]";',
    ].join("\n");
    assert.deepEqual(reported(code), []);
  });
});

describe("the repo's eslint.config.mjs", () => {
  it("reports a hard-coded size in each lab, Shift Manager and the registry", async () => {
    for (const at of [
      "labs/teammates/src/components/Plant.tsx",
      "labs/claude-code-style/src/components/Plant.tsx",
      "packages/shift-manager/src/components/Plant.tsx",
      "packages/ui/registry/components/plant.tsx",
    ]) {
      assert.equal((await lintAt(at, PLANT)).length, 1, at);
    }
  });

  it("leaves Kitchen Sink's own screens and tests alone", async () => {
    for (const at of ["apps/kitchen-sink/components/Plant.tsx", "labs/teammates/test/plant.test.tsx"]) {
      assert.equal((await lintAt(at, PLANT)).length, 0, at);
    }
  });
});
