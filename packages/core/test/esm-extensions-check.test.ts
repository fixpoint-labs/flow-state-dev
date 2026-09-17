import { describe, expect, it } from "vitest";
// @ts-expect-error — root build script, plain .mjs with no type declarations.
import {
  maskedPositions,
  publishableDists,
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
): { text: string; count: number; unresolved: string[] } =>
  (
    rewriteSource as (
      t: string,
      d: string,
      e: string,
      f: Probe,
      g: Probe,
    ) => { text: string; count: number; unresolved: string[] }
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

/**
 * `rewriteSpecifier` returns null for two opposite cases — already settled, and
 * pointing at nothing — and only the first is harmless. A check that cannot
 * tell them apart passes on output Node rejects, which is the bug this suite
 * was written for in the first place.
 */
describe("relative imports that match no file", () => {
  it("reports an extensionless specifier that resolves to nothing", () => {
    const out = rewriteText('export * from "./nowhere";\n');
    expect(out.count).toBe(0);
    expect(out.unresolved).toEqual(["./nowhere"]);
  });

  it("does not report one that already carries an extension", () => {
    const out = rewriteText('export * from "./gone.js";\n');
    expect(out.unresolved).toEqual([]);
  });

  it("does not report a bare package specifier", () => {
    expect(rewriteText('import { z } from "zod";\n').unresolved).toEqual([]);
  });
});

/**
 * Emitted output carries JSDoc, and `@flow-state-dev/node`'s aws-lambda entry
 * documents `import { flowState } from "./flow-state"` in an `@example`. That
 * is prose about the consumer's own file, not a module this package loads —
 * it must neither be rewritten nor reported.
 */
describe("code and not-code", () => {
  const docComment = [
    "/**",
    " * @example",
    ' * import { flowState } from "./flow-state";',
    " */",
    'export * from "./real";',
  ].join("\n");

  it("leaves an import inside a doc comment alone", () => {
    const out = rewriteText(docComment, ["/pkg/dist/real.js"]);
    expect(out.count).toBe(1);
    expect(out.unresolved).toEqual([]);
    expect(out.text).toContain('"./flow-state"');
    expect(out.text).toContain('"./real.js"');
  });

  it("leaves an import inside a line comment alone", () => {
    const out = rewriteText('// import x from "./a";\n', ["/pkg/dist/a.js"]);
    expect(out.count).toBe(0);
  });

  it("masks a string's interior but not the code around it", () => {
    const mask = (maskedPositions as (t: string) => Uint8Array)('a "bc";');
    expect(mask[0]).toBe(0);
    expect(mask[3]).toBe(1);
  });
});

/**
 * A shell glob cannot report what is missing: a package that emits no dist
 * drops out of `packages/*\/dist` and the check passes without ever seeing it.
 * Discovery asks which packages publish, so the absence becomes a failure.
 */
describe("which packages must have output", () => {
  const find = (manifests: Record<string, { private?: boolean }>): string[] =>
    (
      publishableDists as (
        dirs: string[],
        read: (dir: string) => { private?: boolean },
      ) => string[]
    )(Object.keys(manifests), (dir) => manifests[dir]!);

  it("includes a package that publishes", () => {
    expect(find({ core: {} })).toEqual(["core"]);
  });

  it("excludes a private package, whose dist nobody installs", () => {
    expect(find({ core: {}, ui: { private: true } })).toEqual(["core"]);
  });
});
