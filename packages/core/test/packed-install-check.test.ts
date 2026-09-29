/**
 * Pins the judgement rules of the packed-install check
 * (`scripts/packed-install/run.mjs`): which entry points of a published
 * package it imports, and which import failures it may excuse. The check
 * itself runs in CI against real tarballs; these rules are where it could go
 * quietly lenient, so they are fixed here against fixture manifests.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  classifyImport,
  isExtensionlessDistImport,
  importSpecifiers,
  retryWithPeers,
  // @ts-expect-error — root script, plain .mjs with no type declarations.
} from "../../../scripts/packed-install/run.mjs";

const REPO = join(__dirname, "../../..");

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

describe("isExtensionlessDistImport", () => {
  it("names the 0.1.1 defect, which the control must see", () => {
    expect(
      isExtensionlessDistImport(
        notFound(
          "@flow-state-dev/core",
          "Cannot find module '/p/node_modules/@flow-state-dev/core/dist/items/predicates' imported from /p/node_modules/@flow-state-dev/core/dist/index.js",
        ),
      ),
    ).toBe(true);
  });

  it("does not count a missing package or a crash as the defect, so neither passes the control", () => {
    expect(
      isExtensionlessDistImport(notFound("@flow-state-dev/core", "Cannot find package 'zod' imported from /p/node_modules/@flow-state-dev/core/dist/index.js")),
    ).toBe(false);
    expect(
      isExtensionlessDistImport({ spec: "s", ok: false, name: "Error", code: "NOT_REACHED", message: "" }),
    ).toBe(false);
  });
});

describe("importSpecifiers with wildcard subpaths", () => {
  it("expands a wildcard export against the files in the packed package", () => {
    const contracts = {
      name: "@scope/contracts",
      publishConfig: {
        exports: {
          ".": { default: "./dist/index.js" },
          "./items/*": { types: "./dist/items/*.d.ts", default: "./dist/items/*.js" },
        },
      },
    };
    const files = [
      "dist/index.js",
      "dist/items/content.js",
      "dist/items/content.d.ts",
      "dist/items/internal.js",
      "dist/items/deep/nested.js",
      "dist/other.js",
    ];
    const { specs, skipped } = importSpecifiers(contracts, files);
    // Node's `*` matches across `/`, so a nested file is reachable too.
    expect(specs).toEqual([
      "@scope/contracts",
      "@scope/contracts/items/content",
      "@scope/contracts/items/internal",
      "@scope/contracts/items/deep/nested",
    ]);
    expect(skipped).toEqual([]);
  });

  it("reports a wildcard that matches no packed file, rather than passing it silently", () => {
    const { specs, skipped } = importSpecifiers(
      { name: "@scope/p", publishConfig: { exports: { "./x/*": "./dist/x/*.js" } } },
      ["dist/index.js"],
    );
    expect(specs).toEqual([]);
    expect(skipped).toEqual([{ spec: "@scope/p/x/*", reason: "wildcard matches no packed file" }]);
  });
});

/**
 * The optional-peer retry, run for real against throwaway modules. Each module
 * imports vitest (the one optional peer our packages declare), then does what
 * its name says. The retry is where a lenient rule would let a broken testing
 * entry point ship, so these run the real probe rather than a stub.
 */
describe("retryWithPeers", () => {
  let dir: string;
  const url = (name: string) => pathToFileURL(join(dir, name)).href;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "fsd-peer-retry-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "probe", private: true, type: "module" }));
    mkdirSync(join(dir, "node_modules"));
    symlinkSync(realpathSync(join(REPO, "node_modules", "vitest")), join(dir, "node_modules", "vitest"));
    const header = `import { describe, expect } from "vitest";\n`;
    writeFileSync(join(dir, "good.mjs"), `${header}export const run = () => describe("x", () => expect(1).toBe(1));\n`);
    writeFileSync(join(dir, "type-error.mjs"), `${header}const cfg = undefined;\nexport const name = cfg.name;\n`);
    writeFileSync(join(dir, "exits.mjs"), `${header}process.exit(0);\n`);
    writeFileSync(join(dir, "exits-plain.mjs"), `process.exit(0);\n`);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const retry = (names: string[]) =>
    (retryWithPeers as (d: string, m: Map<string, string>) => string[])(
      dir,
      new Map(names.map((n) => [url(n), "vitest@^3.0.0"])),
    );

  it("passes an entry point that loads cleanly once its peer is installed", () => {
    expect(retry(["good.mjs"])).toEqual([]);
  }, 60_000);

  it("fails an entry point whose own top-level code throws, even with the peer installed", () => {
    const failures = retry(["type-error.mjs"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("type-error.mjs");
  }, 60_000);

  it("fails an entry point that exits the process under the vitest probe", () => {
    const failures = retry(["exits.mjs"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("exits.mjs");
  }, 60_000);

  it("fails an entry point the probe never reported on, as when the import crashes or hangs", () => {
    // A peer other than vitest retries in plain Node, where exiting mid-import
    // leaves the spec with no result at all (NOT_REACHED).
    const spec = url("exits-plain.mjs");
    const failures = (retryWithPeers as (d: string, m: Map<string, string>) => string[])(
      dir,
      new Map([[spec, "some-peer@^1.0.0"]]),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("NOT_REACHED");
  }, 60_000);
});
