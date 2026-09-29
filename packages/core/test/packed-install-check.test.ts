/**
 * Pins the judgement rules of the packed-install check
 * (`scripts/packed-install/run.mjs`): which entry points of a published
 * package it imports, and which import failures it may excuse. The check
 * itself runs in CI against real tarballs; these rules are where it could go
 * quietly lenient, so they are fixed here against fixture manifests.
 */
import { describe, expect, it } from "vitest";
import {
  classifyImport,
  importSpecifiers,
  resolvedGraph,
  // @ts-expect-error — root script, plain .mjs with no type declarations.
} from "../../../scripts/packed-install/run.mjs";

const manifest = {
  name: "@scope/pkg",
  publishConfig: {
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./testing": { import: "./dist/testing.js" },
      "./items/*": { import: "./dist/items/*.js" },
      "./styles.css": "./dist/styles.css",
    },
  },
  peerDependencies: { vitest: "^3.0.0", react: "^19.0.0" },
  peerDependenciesMeta: { vitest: { optional: true } },
};

const notFound = (spec: string, message: string) => ({
  spec,
  ok: false,
  name: "Error",
  code: "ERR_MODULE_NOT_FOUND",
  message,
});

describe("importSpecifiers", () => {
  it("imports the root and every concrete JavaScript subpath from the published exports", () => {
    const { specs, skipped } = importSpecifiers(manifest);
    expect(specs).toEqual(["@scope/pkg", "@scope/pkg/testing"]);
    // Named, not silently dropped: a reader of the log sees what went unchecked.
    expect(skipped.map((s: { spec: string }) => s.spec)).toEqual([
      "@scope/pkg/items/*",
      "@scope/pkg/styles.css",
    ]);
  });

  it("reads publishConfig.exports over the source-pointing exports", () => {
    const { specs } = importSpecifiers({
      name: "@scope/pkg",
      exports: { ".": "./src/index.ts", "./dev-only": "./src/dev.ts" },
      publishConfig: { exports: { ".": "./dist/index.js" } },
    });
    expect(specs).toEqual(["@scope/pkg"]);
  });
});

describe("classifyImport", () => {
  it("fails an extensionless relative import inside dist, the 0.1.1 defect", () => {
    const result = notFound(
      "@scope/pkg/testing",
      "Cannot find module '/p/node_modules/@scope/pkg/dist/items/predicates' imported from /p/node_modules/@scope/pkg/dist/testing.js",
    );
    expect(classifyImport(result, manifest)).toBe("fail");
  });

  it("excuses a subpath only for an optional peer its own package declares", () => {
    const vitest = notFound("@scope/pkg/testing", "Cannot find package 'vitest' imported from /p/x.js");
    expect(classifyImport(vitest, manifest)).toBe("optional-peer");
    // A required peer, or an undeclared package, is a packaging bug.
    const react = notFound("@scope/pkg/testing", "Cannot find package 'react' imported from /p/x.js");
    expect(classifyImport(react, manifest)).toBe("fail");
    const undeclared = notFound("@scope/pkg/testing", "Cannot find package 'lodash' imported from /p/x.js");
    expect(classifyImport(undeclared, manifest)).toBe("fail");
  });

  it("never excuses the root entry, which must import with no optional peer installed", () => {
    const root = notFound("@scope/pkg", "Cannot find package 'vitest' imported from /p/x.js");
    expect(classifyImport(root, manifest)).toBe("fail");
  });
});

describe("resolvedGraph", () => {
  it("accepts a throw from the module's own code, since ESM links the whole graph first", () => {
    expect(
      resolvedGraph({ spec: "s", ok: false, name: "Error", code: null, message: "Vitest failed to access its internal state." }),
    ).toBe(true);
  });

  it("rejects link-time failures: a missing file or a missing named export", () => {
    expect(resolvedGraph(notFound("s", "Cannot find module '/p/dist/x'"))).toBe(false);
    expect(
      resolvedGraph({ spec: "s", ok: false, name: "SyntaxError", code: null, message: "does not provide an export named 'x'" }),
    ).toBe(false);
  });
});
