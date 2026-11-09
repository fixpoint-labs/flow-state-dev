/**
 * Workforce's root carries no entry-key constant. An entry the framework calls
 * is named by its documented string, the way an action is (`respond`), so an
 * app author autocompleting the root finds no `*_ENTRY` beside the factories.
 *
 * Read off the root module's runtime exports rather than a list in this file,
 * so a constant re-exported through any barrel fails here on arrival. The
 * packed-install census cannot hold this alone: it clears a name the README
 * mentions, and the README documents the entry strings.
 */
import { describe, expect, it } from "vitest";
import * as root from "../src/index";

describe("workforce's root", () => {
  it("exports no *_ENTRY constant", () => {
    expect(Object.keys(root).filter((name) => /_ENTRY$/.test(name))).toEqual([]);
  });
});
