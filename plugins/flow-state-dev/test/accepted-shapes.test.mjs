/**
 * What the narrowed detector accepts and turns away, measured against config shapes real Next
 * apps actually use — not against our own three, which are all one shape.
 *
 * **This test exists to keep the cost of the whitelist visible.** The owner's scope call is that
 * a config past the accepted shapes is an agent's job, not a gap to close by parsing harder. That
 * is a defensible trade only if we know what it costs, so the turn-away set is enumerated here
 * rather than discovered by a developer. A change that widens or narrows it moves these numbers,
 * which is the point.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exportedObjectRegion, settingValue } from "../skills/install-fsd/detect/source-scan.mjs";

const repoRoot = join(import.meta.dirname, "../../..");

/** Config shapes seen in the wild, each named for what a developer would call it. */
const WILD = {
  "create-next-app default": `/** @type {import('next').NextConfig} */\nconst nextConfig = {};\nexport default nextConfig;\n`,
  "plain module.exports": `module.exports = { reactStrictMode: true, basePath: '/app' };\n`,
  "TypeScript, type-annotated": `import type { NextConfig } from "next";\nconst nextConfig: NextConfig = {\n  pageExtensions: ["ts", "tsx", "mdx"],\n};\nexport default nextConfig;\n`,
  "const with a commented-out setting": `const nextConfig = {\n  // basePath: '/old',\n  basePath: '/portal',\n};\nexport default nextConfig;\n`,
  "@next/mdx wrapper": `import createMDX from '@next/mdx';\nconst withMDX = createMDX({});\nconst nextConfig = { pageExtensions: ['ts','tsx','mdx'] };\nexport default withMDX(nextConfig);\n`,
  "@sentry/nextjs wrapper": `const { withSentryConfig } = require('@sentry/nextjs');\nconst nextConfig = { reactStrictMode: true };\nmodule.exports = withSentryConfig(nextConfig, { silent: true });\n`,
  "@next/bundle-analyzer wrapper": `const withBundleAnalyzer = require('@next/bundle-analyzer')({});\nmodule.exports = withBundleAnalyzer({ basePath: '/docs' });\n`,
  "next-intl wrapper": `import createNextIntlPlugin from 'next-intl/plugin';\nconst withNextIntl = createNextIntlPlugin();\nconst nextConfig = {};\nexport default withNextIntl(nextConfig);\n`,
  "async function config": `export default async function config(phase) {\n  return { reactStrictMode: true };\n}\n`,
  "spread over a base object": `const base = { reactStrictMode: true };\nexport default { ...base, basePath: process.env.BASE_PATH ?? '' };\n`,
};

/** The four that are on the list, and why each is a shape a beginner's project really has. */
const ACCEPTED = [
  "create-next-app default",
  "plain module.exports",
  "TypeScript, type-annotated",
  "const with a commented-out setting",
];

/** The six that are handed off. Four are wrapper plugins — the real cost of this scope call. */
const TURNED_AWAY = [
  "@next/mdx wrapper",
  "@sentry/nextjs wrapper",
  "@next/bundle-analyzer wrapper",
  "next-intl wrapper",
  "async function config",
  "spread over a base object",
];

describe("the accepted-shape list, measured against configs real apps use", () => {
  it.each(ACCEPTED)("accepts: %s", (name) => {
    expect(exportedObjectRegion(WILD[name]).unreadable).toBeUndefined();
  });

  it.each(TURNED_AWAY)("hands off: %s", (name) => {
    expect(exportedObjectRegion(WILD[name]).unreadable).toEqual(expect.any(String));
  });

  it("turns away 6 of 10, and four of those are wrapper plugins", () => {
    // The headline number, asserted so it cannot drift without someone deciding it should.
    const refused = Object.keys(WILD).filter(
      (name) => exportedObjectRegion(WILD[name]).unreadable !== undefined,
    );
    expect(refused).toHaveLength(6);
    expect(refused.filter((name) => name.includes("wrapper"))).toHaveLength(4);
  });

  it("hands off a conditional CommonJS export rather than reading the assignment that may not run", () => {
    const source =
      "if (process.env.CI) module.exports = { basePath: '/ci' }\nmodule.exports = { reactStrictMode: true }\n";
    expect(exportedObjectRegion(source).unreadable).toEqual(expect.any(String));
  });

  it("reads the setting correctly on every shape it accepts", () => {
    // Accepting a shape is worth nothing if the value read from it is wrong — the commented-out
    // case is the one that used to win.
    const region = exportedObjectRegion(WILD["const with a commented-out setting"]);
    expect(settingValue(WILD["const with a commented-out setting"], "basePath", region).raw).toBe(
      "'/portal'",
    );
    const ts = WILD["TypeScript, type-annotated"];
    expect(settingValue(ts, "pageExtensions", exportedObjectRegion(ts)).raw).toBe(
      `["ts", "tsx", "mdx"]`,
    );
  });
});

describe("this repository's own Next apps", () => {
  it.each([
    "examples/hello-chat/next.config.mjs",
    "apps/kitchen-sink/next.config.mjs",
    "labs/trading-desk/next.config.mjs",
  ])("accepts %s", (path) => {
    // Real configs, not fixtures — each is a `const nextConfig = {…}; export default nextConfig`
    // carrying nested objects and a function-valued key, which the region walk handles.
    const source = readFileSync(join(repoRoot, path), "utf-8");
    const region = exportedObjectRegion(source);
    expect(region.unreadable, `${path} should be readable`).toBeUndefined();
    // Neither setting is assigned, so Next's documented defaults apply — not "unreadable".
    expect(settingValue(source, "basePath", region).raw).toBeNull();
    expect(settingValue(source, "pageExtensions", region).raw).toBeNull();
  });
});
