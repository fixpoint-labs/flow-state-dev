import { describe, expect, it } from "vitest";
import { parseDuration } from "../src/utils/duration";

describe("parseDuration", () => {
  it("passes through numeric values as milliseconds", () => {
    expect(parseDuration(5000)).toBe(5000);
    expect(parseDuration(0)).toBe(0);
    expect(parseDuration(1)).toBe(1);
  });

  it("parses milliseconds", () => {
    expect(parseDuration("100ms")).toBe(100);
  });

  it("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30_000);
  });

  it("parses minutes", () => {
    expect(parseDuration("5m")).toBe(300_000);
  });

  it("parses hours", () => {
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("24h")).toBe(86_400_000);
  });

  it("parses days", () => {
    expect(parseDuration("7d")).toBe(604_800_000);
  });

  it("parses fractional values", () => {
    expect(parseDuration("1.5h")).toBe(5_400_000);
    expect(parseDuration("0.5d")).toBe(43_200_000);
  });

  it("handles zero duration", () => {
    expect(parseDuration("0s")).toBe(0);
    expect(parseDuration("0m")).toBe(0);
  });

  it("throws on invalid format", () => {
    expect(() => parseDuration("abc")).toThrow('Invalid duration string: "abc"');
    expect(() => parseDuration("")).toThrow('Invalid duration string: ""');
    expect(() => parseDuration("5x")).toThrow('Invalid duration string: "5x"');
    expect(() => parseDuration("h5")).toThrow('Invalid duration string: "h5"');
    expect(() => parseDuration("-5s")).toThrow('Invalid duration string: "-5s"');
  });
});
