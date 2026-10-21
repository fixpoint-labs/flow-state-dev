import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import { deferred, findGaps, typecheckPrograms } from "../../../scripts/validate-test-typecheck.mjs";
// @ts-expect-error — root script, plain .mjs with no type declarations.
import { driverPrograms } from "../../../scripts/typecheck-programs.mjs";

type Pkg = { dir: string; tests: string[]; covered: string[] };
type Gap = { dir: string; reason: "uncovered" | "stale-deferral" | "unknown-deferral"; files?: string[] };

const gaps = (packages: Pkg[], deferredList: Record<string, string> = {}): Gap[] =>
  (findGaps as (p: Pkg[], d: Record<string, string>) => Gap[])(packages, deferredList);

const programs = (script: string | undefined, present: string[] = ["tsconfig.json"]): string[] =>
  (typecheckPrograms as (s: string | undefined, has: (name: string) => boolean) => string[])(
    script,
    (name) => present.includes(name),
  );

describe("every package's tests are in a program its typecheck compiles", () => {
  it("flags a package whose tests no program opens, naming the files", () => {
    const found = gaps([{ dir: "engine", tests: ["test/a.test.ts", "test/b.test.ts"], covered: [] }]);
    expect(found).toEqual([
      { dir: "engine", reason: "uncovered", files: ["test/a.test.ts", "test/b.test.ts"] },
    ]);
  });

  it("flags a package that is wired but partly covered, as ui's render exclude was", () => {
    const found = gaps([
      {
        dir: "ui",
        tests: ["test/tool-grouping.test.ts", "test/render/card.test.tsx"],
        covered: ["test/tool-grouping.test.ts"],
      },
    ]);
    expect(found).toEqual([{ dir: "ui", reason: "uncovered", files: ["test/render/card.test.tsx"] }]);
  });

  it("stays quiet when every test is covered", () => {
    expect(gaps([{ dir: "core", tests: ["test/a.test.ts"], covered: ["test/a.test.ts"] }])).toEqual([]);
  });

  it("lets a package with gaps through only when it is deferred by name", () => {
    const pkg = { dir: "workforce", tests: ["test/a.test.ts"], covered: [] };
    expect(gaps([pkg], { workforce: "FIX-2016" })).toEqual([]);
    expect(gaps([pkg], { engine: "FIX-1343" }).map((g) => g.reason)).toContain("uncovered");
  });

  it("flags a stale deferral: a deferred package whose programs already cover every test", () => {
    const found = gaps(
      [{ dir: "workforce", tests: ["test/a.test.ts"], covered: ["test/a.test.ts"] }],
      { workforce: "FIX-2016" },
    );
    expect(found).toEqual([{ dir: "workforce", reason: "stale-deferral" }]);
  });

  it("flags a deferral that names no package, so a rename cannot leave an entry behind", () => {
    expect(gaps([], { "no-such-package": "FIX-1343" })).toEqual([
      { dir: "no-such-package", reason: "unknown-deferral" },
    ]);
  });
});

describe("the programs a typecheck script compiles", () => {
  it("runs tsconfig.test.json after tsconfig.json when the package has one", () => {
    expect(programs("node ../../scripts/typecheck.mjs", ["tsconfig.json", "tsconfig.test.json"])).toEqual([
      "tsconfig.json",
      "tsconfig.test.json",
    ]);
  });

  it("runs only tsconfig.json for a package without a test config", () => {
    expect(programs("node ../../scripts/typecheck.mjs")).toEqual(["tsconfig.json"]);
  });

  it("takes the shared driver's programs from the list the driver itself runs, so the two cannot drift", () => {
    const driver = (present: string[]): string[] =>
      (driverPrograms as (has: (name: string) => boolean) => string[])((name) => present.includes(name));
    for (const present of [["tsconfig.json"], ["tsconfig.json", "tsconfig.test.json"]]) {
      expect(programs("node ../../scripts/typecheck.mjs", present)).toEqual(driver(present));
    }
  });

  it("counts every chained tsc program, and a bare tsc as tsconfig.json", () => {
    expect(
      programs("node ../../scripts/typecheck.mjs && tsc -p tsconfig.test-d.json", [
        "tsconfig.json",
        "tsconfig.test-d.json",
      ]),
    ).toEqual(["tsconfig.json", "tsconfig.test-d.json"]);
    expect(programs("tsc --noEmit")).toEqual(["tsconfig.json"]);
  });

  it("reads --project like -p", () => {
    expect(programs("tsc --project tsconfig.test-d.json", ["tsconfig.test-d.json"])).toEqual(["tsconfig.test-d.json"]);
  });

  it("throws on a tsc form it cannot read, rather than guessing the program", () => {
    expect(() => programs("tsc -b")).toThrow(/unrecognised tsc form/);
    expect(() => programs("node ../../scripts/typecheck.mjs && tsc --build tsconfig.json")).toThrow(/unrecognised tsc form/);
    expect(() => programs("tsc-alias -p tsconfig.json")).toThrow(/unrecognised tsc form/);
    expect(() => programs("tsc -p")).toThrow(/unrecognised tsc form/);
  });

  it("finds no program for a package with no typecheck script", () => {
    expect(programs(undefined)).toEqual([]);
  });
});

describe("the DEFERRED list", () => {
  it("names an issue for every entry", () => {
    for (const [dir, reason] of Object.entries(deferred as Record<string, string>)) {
      expect(reason, dir).toMatch(/FIX-\d+/);
    }
  });

  it("defers workforce with FIX-2016, the issue that wires it", () => {
    expect((deferred as Record<string, string>).workforce).toMatch(/FIX-2016/);
  });

  it("does not defer a package that is wired", () => {
    for (const dir of [
      "core",
      "contracts",
      "workspace",
      "voice-openai",
      "client",
      "react",
      "ui",
      "engine",
      "testing",
      "scheduled",
      "mcp",
      "next",
      "node",
      "store-sqlite",
      "store-postgres",
      "bullmq",
      "vercel",
      "orchestration",
      "patterns",
      "tools",
      "memory",
      "thought-fabric-core",
      "claude-code",
      "cli",
      "codex",
      "cursor",
      "devtool",
      "harness-manager",
    ]) {
      expect(deferred, dir).not.toHaveProperty(dir);
    }
  });
});
