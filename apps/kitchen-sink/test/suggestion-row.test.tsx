// @vitest-environment happy-dom
/**
 * Flow State's suggestion chips are written for the mode they sit under, and
 * none names a thing a fresh session doesn't have. Four modes that showed the
 * same chips would fail the first case; a chip naming `doc-1` the second.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SuggestionRow } from "@/components/suggestion-row";
import type { Mode } from "@/components/mode-selector";

afterEach(cleanup);

const MODES: Mode[] = ["ask", "build", "interview", "debate"];
const chipsOf = (mode: Mode) => {
  render(<SuggestionRow mode={mode} onSuggestionClick={() => undefined} />);
  const chips = screen.getAllByRole("button").map((b) => b.textContent ?? "");
  cleanup();
  return chips;
};

describe("Flow State's suggestion chips", () => {
  it("differ in every mode", () => {
    const lists = MODES.map((mode) => chipsOf(mode));
    for (const list of lists) expect(list.length).toBeGreaterThan(0);
    for (let a = 0; a < lists.length; a += 1) {
      for (let b = a + 1; b < lists.length; b += 1) {
        expect(lists[a]!.filter((chip) => lists[b]!.includes(chip)), `${MODES[a]} and ${MODES[b]} share chips`).toEqual([]);
      }
    }
  });

  it("name nothing a fresh session lacks", () => {
    for (const mode of MODES) for (const chip of chipsOf(mode)) expect(chip).not.toMatch(/doc-\d|artifact [a-z]+-\d/i);
  });

  it("hand the chip's words to the composer when clicked", () => {
    const picked: string[] = [];
    render(<SuggestionRow mode="debate" onSuggestionClick={(text) => picked.push(text)} />);
    const first = screen.getAllByRole("button")[0]!;
    fireEvent.click(first);
    expect(picked).toEqual([first.textContent]);
  });
});
