/**
 * The constants that are twins of something in the framework.
 *
 * These scripts ship inside a plugin and run on a stranger's machine, so they import nothing from
 * this monorepo at run time — which means a handful of values are duplicated. A duplicate is only
 * safe while something notices it drifting, so each one is checked here against the thing it
 * copies. **Parsed out of the real source, never re-typed**: a test that restated the list would
 * be a third copy rather than a check on the second.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FSDEV_CONFIG_FILENAMES,
  NEXT_MINIMUM_MAJOR,
  NODE_FLOOR,
} from "../skills/install-fsd/detect/constants.mjs";
import { parseAsCli, parseAsNextDev } from "../skills/install-fsd/detect/env-parsers.mjs";

const repoRoot = join(import.meta.dirname, "../../..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf-8");

describe("the config precedence order is the CLI's own", () => {
  it("matches CONFIG_FILENAMES in packages/cli/src/load-config.ts", () => {
    // Acting on a config the loader is not loading describes nothing that runs, so the order this
    // module reports has to be the order the loader applies. Reordering the loader moves this
    // check with it rather than leaving a stale copy behind.
    const source = read("packages/cli/src/load-config.ts");
    const raw = /const CONFIG_FILENAMES = \[([\s\S]*?)\]/.exec(source);
    expect(raw, "CONFIG_FILENAMES is no longer where this check looks for it").not.toBeNull();
    const names = [...raw[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(FSDEV_CONFIG_FILENAMES).toEqual(names);
  });
});

describe("parseAsCli is a twin of the CLI's own parser, asserted rather than described", () => {
  /**
   * The CLI's `parseEnvFile`, lifted out of `load-env.ts` and run as JavaScript.
   *
   * Extracted from the real source at test time rather than restated here, which is the whole
   * point: a hand-written expectation is a third copy of the behaviour, and it drifts with the
   * other two. This is the mechanism that was missing from this file, and all three env defects
   * in review lived in the one parser it did not cover.
   */
  const cliParser = (() => {
    const source = read("packages/cli/src/load-env.ts");
    const body = /function parseEnvFile\(content: string\): Map<string, string> \{([\s\S]*?)\n\}/.exec(source);
    expect(body, "parseEnvFile is no longer where this check looks for it").not.toBeNull();
    const js = body[1].replace(/: Map<string, string>|: string/g, "").replace(/new Map<[^>]*>\(\)/g, "new Map()");
    return new Function("content", `${js}\n`);
  })();

  it.each([
    "KEY=value",
    "KEY=",
    'KEY="quoted"',
    "KEY='single'",
    "KEY=a=b",
    "  KEY=indented  ",
    "# KEY=commented",
    "KEY=first\nKEY=second",
    "export KEY=exported",
    "KEY: colon",
    "KEY=`backtick`",
    "KEY=value # trailing",
    "KEY=$OTHER",
    "NOEQUALS",
    "",
  ])("agrees with the CLI on %j", (input) => {
    expect(Object.fromEntries(parseAsCli(input))).toEqual(Object.fromEntries(cliParser(input)));
  });
});

describe("parseAsNextDev mirrors the dotenv grammar @next/env ships", () => {
  it.each([
    ["export KEY=exported", "exported"],
    ["KEY: colon", "colon"],
    ["KEY=`backtick`", "backtick"],
    ["KEY=value # trailing", "value"],
    ['KEY="double"', "double"],
  ])("reads %j the way next dev does", (input, expected) => {
    // Every one of these is a line our CLI reads differently, which is why one parser could not
    // serve both. Taken from the regex `@next/env` bundles, not from memory.
    expect(parseAsNextDev(input).get("KEY").value).toBe(expected);
  });

  it("marks expansion unreadable instead of guessing at the value", () => {
    // `@next/env`'s processEnv runs every parsed file through dotenv's `expand`, which resolves
    // $VAR against process.env, then a `:-` default, then other keys, and falls back to "". We do
    // not run it, so we do not claim to know the answer.
    expect(parseAsNextDev("KEY=$DOES_NOT_EXIST").get("KEY").expands).toBe(true);
    expect(parseAsNextDev("KEY=${OTHER:-fallback}").get("KEY").expands).toBe(true);
    expect(parseAsNextDev("KEY=literal").get("KEY").expands).toBe(false);
    // Escaped and single-quoted forms are literal in dotenv's grammar, so they stay readable.
    expect(parseAsNextDev("KEY=\\$LITERAL").get("KEY").expands).toBe(false);
    expect(parseAsNextDev("KEY='$LITERAL'").get("KEY").expands).toBe(false);
  });
});

describe("the supported Next range is the adapters' own", () => {
  it.each(["packages/next/package.json", "packages/vercel/package.json"])(
    "matches the next peer range declared by %s",
    (manifestPath) => {
      // Asserted against the declared peer range rather than hardcoded twice, so bumping an
      // adapter moves this check with it. A project below the range fails the install after four
      // files are already on disk, which is why the report refuses instead.
      const declared = JSON.parse(read(manifestPath)).peerDependencies?.next;
      expect(declared, `${manifestPath} no longer declares a next peer`).toBeDefined();
      const major = Number(/(\d+)/.exec(declared)[1]);
      expect(NEXT_MINIMUM_MAJOR).toBe(major);
    },
  );
});

describe("the Node floor is the one the config loader's own remediation names", () => {
  it("matches the version load-config.ts tells a developer to run", () => {
    // `>=22` is the wrong number twice over: 22.0–22.17 passes it and then fails at config load,
    // because the CLI imports the emitted TypeScript config natively and that needs type
    // stripping. The loader's own error message carries the real number.
    const source = read("packages/cli/src/load-config.ts");
    const named = /Node >= (\d+\.\d+)/.exec(source);
    expect(named, "load-config.ts no longer names a Node version in its remediation").not.toBeNull();
    expect(NODE_FLOOR.startsWith(named[1])).toBe(true);
  });
});
