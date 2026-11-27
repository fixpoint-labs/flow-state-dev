// @vitest-environment happy-dom
/**
 * The test DOM's MutationObserver keeps reporting after a garbage collection.
 * The conversation's Jump to latest reads every change through one (`useJumpToLatest`):
 * a test DOM whose observer goes quiet after a collection leaves the button
 * hidden while text grows below the view, and the screen tests fail on
 * whenever the collector happens to run. happy-dom before 20.12 held each
 * observer's callback only through a WeakRef, so this is the floor.
 */
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

/** A full collection, without starting node with --expose-gc. */
setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc") as () => void;

it("reports a change made after a garbage collection", async () => {
  const feed = document.createElement("div");
  const text = document.createTextNode("Here is the plan");
  feed.append(text);
  document.body.append(feed);
  const seen: MutationRecord[] = [];
  new MutationObserver((records) => seen.push(...records)).observe(feed, { childList: true, subtree: true, characterData: true });

  // Out of the job that observed, so nothing the observer made is still held by it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  collect();
  text.data = "Here is the plan for the post.";
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(seen.map((record) => record.type)).toEqual(["characterData"]);
});
