/**
 * The one call every projection caller makes about a failed flush: a place it
 * could not read is reported and the run goes on; a store that failed throws.
 */
import { describe, expect, it } from "vitest";
import { createMemoryPlace } from "../src/memory-place";
import { projectionSession } from "../src/projection-session";
import { PlaceUnreadableError, type Mount } from "../src/types";
import { createFakeCollection } from "./fake-collection";

function setup(seed: Record<string, string> = {}) {
  const collection = createFakeCollection("artifacts/**", seed);
  const place = createMemoryPlace();
  const mounts: Mount[] = [{ prefix: "artifacts", collectionId: "artifacts", collection, writable: true }];
  return { collection, place, session: projectionSession({ mounts, place }) };
}

describe("projectionSession", () => {
  it("hydrates, and a flush carries the run's edit back", async () => {
    const { collection, place, session } = setup({ "spec.md": "one" });
    await session.hydrate();
    await place.write("artifacts/spec.md", "two");

    const settled = await session.flush();

    expect(settled.readable).toBe(true);
    expect(collection.contents()).toEqual({ "spec.md": "two" });
  });

  it("settles an unreadable place as readable: false, deleting nothing", async () => {
    const { collection, place, session } = setup({ "spec.md": "one" });
    await session.hydrate();
    place.breakListing("find: permission denied");

    const settled = await session.flush();

    expect(settled.readable).toBe(false);
    expect(!settled.readable && settled.error).toBeInstanceOf(PlaceUnreadableError);
    expect(collection.contents()).toEqual({ "spec.md": "one" });
  });

  it("rejects when the store fails, so a lost write is never a finished run", async () => {
    const { collection, place, session } = setup({ "spec.md": "one" });
    await session.hydrate();
    await place.write("artifacts/spec.md", "edited");
    collection.breakWrites("store unavailable");

    await expect(session.flush()).rejects.toThrow(/store unavailable/);
  });
});
