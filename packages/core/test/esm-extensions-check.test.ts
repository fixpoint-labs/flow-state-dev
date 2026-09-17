import { describe, expect, it } from "vitest";
// @ts-expect-error — root build script, plain .mjs with no type declarations.
import {
  rewriteSource,
  rewriteSpecifier,
} from "../../../scripts/add-esm-extensions.mjs";

type Probe = (p: string) => boolean;
const rewrite = (
  spec: string,
  files: string[] = [],
  dirs: string[] = [],
  ext = ".js",
): string | null =>
  (
    rewriteSpecifier as (
      s: string,
      d: string,
      e: string,
      f: Probe,
      g: Probe,
    ) => string | null
  )(
    spec,
    "/pkg/dist",
    ext,
    (p) => files.includes(p),
    (p) => dirs.includes(p),
  );

const rewriteText = (
  text: string,
  files: string[] = [],
  dirs: string[] = [],
): { text: string; count: number } =>
  (
    rewriteSource as (
      t: string,
      d: string,
      e: string,
      f: Probe,
      g: Probe,
    ) => { text: string; count: number }
  )(
    text,
    "/pkg/dist",
    ".js",
    (p) => files.includes(p),
    (p) => dirs.includes(p),
  );

/**
 * Published 0.1.1 failed on import because `tsc` emitted `./items/predicates`
 * into an ESM package. These cases pin both halves of the fix: the relative
 * specifier gets an extension, and a bare one never does. The bare case is not a
 * nicety — rewriting `@flow-state-dev/contracts/helpers` to a relative path is
 * what `tsc-alias` did, and it silently turned a cross-package re-export into a
 * self-reference.
 */
describe("extending relative specifiers in built output", () => {
  it("extends a relative specifier whose .js sibling exists", () => {
    expect(
      rewrite("./items/predicates", ["/pkg/dist/items/predicates.js"]),
    ).toBe("./items/predicates.js");
  });

  it("resolves a directory specifier to its index", () => {
    expect(
      rewrite("./items", ["/pkg/dist/items/index.js"], ["/pkg/dist/items"]),
    ).toBe("./items/index.js");
  });

  it("extends a parent-relative specifier", () => {
    expect(rewrite("../helpers/to-error", ["/pkg/helpers/to-error.js"])).toBe(
      "../helpers/to-error.js",
    );
  });

  it("leaves a specifier that already carries an extension", () => {
    expect(
      rewrite("./items/predicates.js", ["/pkg/dist/items/predicates.js"]),
    ).toBe(null);
  });

  it("leaves a specifier that resolves to nothing, rather than guessing", () => {
    expect(rewrite("./flow-state", [])).toBe(null);
  });

  it("probes .d.ts siblings for a declaration file but still emits .js", () => {
    expect(
      rewrite(
        "./types/resource",
        ["/pkg/dist/types/resource.d.ts"],
        [],
        ".d.ts",
      ),
    ).toBe("./types/resource.js");
  });

  it("never touches a bare package specifier", () => {
    const src = 'export * from "@flow-state-dev/contracts/helpers/to-error";\n';
    expect(rewriteText(src).count).toBe(0);
    expect(rewriteText(src).text).toBe(src);
  });

  it("never touches a bare dependency, even one sharing a name with a local file", () => {
    const src = 'import { z } from "zod";\n';
    expect(rewriteText(src, ["/pkg/dist/zod.js"]).count).toBe(0);
  });

  it("covers the three shapes a specifier appears in", () => {
    const src = [
      'export { a } from "./a";',
      'import "./b";',
      'const c = await import("./c");',
    ].join("\n");
    const files = ["/pkg/dist/a.js", "/pkg/dist/b.js", "/pkg/dist/c.js"];
    const out = rewriteText(src, files);
    expect(out.count).toBe(3);
    expect(out.text).toContain('"./a.js"');
    expect(out.text).toContain('"./b.js"');
    expect(out.text).toContain('"./c.js"');
  });

  it("preserves the original quote style", () => {
    const out = rewriteText("import './a';\n", ["/pkg/dist/a.js"]);
    expect(out.text).toBe("import './a.js';\n");
  });
});
