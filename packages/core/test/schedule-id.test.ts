/**
 * The dispatch id of a dynamic schedule lives in core, so the engine's tick
 * (which builds the id) and the scheduled endpoint (which parses it) share
 * one format without either importing the other.
 */
import { describe, expect, it } from "vitest";
import { formatScheduleId } from "../src/types";

describe("formatScheduleId", () => {
  it("joins org, user and key with `/`, each part URL-encoded so a `/` inside one survives", () => {
    expect(formatScheduleId("Acme/EU", "u/1", "nested/key")).toBe("Acme%2FEU/u%2F1/nested%2Fkey");
  });
});
