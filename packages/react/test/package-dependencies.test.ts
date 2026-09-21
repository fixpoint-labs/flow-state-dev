/**
 * BR-16 — an app that uses no CSS framework installs this package and gets
 * none.
 *
 * Asserted as an allow-list over the whole dependency list rather than as a
 * denylist of the packages we happened to think of. The chrome this package
 * now ships is the kind of code that arrives with a styling toolchain and an
 * icon set attached, and three published packages depend on this one, so every
 * app that takes any of them would install whatever landed here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe("@flow-state-dev/react dependencies", () => {
  it("declares only our own packages as runtime dependencies", () => {
    const foreign = Object.keys(manifest.dependencies ?? {}).filter(
      (name) => !name.startsWith("@flow-state-dev/")
    );

    // Add `lucide-react`, `tailwindcss`, `clsx` or anything else here and this
    // names it.
    expect(foreign).toEqual([]);
  });

  it("asks the host for React and for nothing else", () => {
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual(["react"]);
  });
});
