// @vitest-environment happy-dom
/**
 * Agent text renders as Markdown: while it streams, an unfinished code fence
 * already draws as code, and HTML in the text shows as text, never as an element.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Entry } from "../src/components/Entry";

afterEach(cleanup);

const say = (text: string) => render(<Entry entry={{ kind: "assistant", id: "a1", text }} />).container;

describe("agent Markdown", () => {
  it("draws headings, lists and emphasis as elements, not as marks", () => {
    const view = say("## Findings\n\n- **Acme** ships weekly\n- Globex ships monthly");
    expect(view.querySelector("h2")?.textContent).toBe("Findings");
    expect(view.querySelectorAll("li")).toHaveLength(2);
    expect(view.querySelector('[data-streamdown="strong"]')?.textContent).toBe("Acme");
    expect(view.textContent).not.toContain("**");
    expect(view.textContent).not.toContain("##");
  });

  it("draws a code fence that hasn't closed yet as code while the text streams in", async () => {
    // The text as it stands mid-stream: the fence is open and its last line half written.
    const view = say("Here is the change:\n\n```ts\nconst answer = 4");
    await waitFor(() => expect(view.querySelector("pre")).not.toBeNull());
    expect(view.querySelector("pre")!.textContent).toContain("const answer = 4");
    // No stray fence marks leak into the prose around it.
    expect(view.textContent).not.toContain("```");
    expect(view.textContent).toContain("Here is the change:");
  });

  it("shows HTML in agent text as the text it is, instead of building it into elements", () => {
    const view = say('Plain <b>bold</b> text <img src="x" onerror="alert(1)"> and <a href="javascript:alert(1)">a link</a>.');
    expect(view.querySelector("b")).toBeNull();
    expect(view.querySelector("img")).toBeNull();
    expect(view.querySelector('a[href^="javascript"]')).toBeNull();
    expect(view.textContent).toContain("<b>bold</b>");
  });

  it("renders a background result's summary as Markdown too", () => {
    const view = render(
      <Entry
        entry={{ kind: "result", id: "r1", taskId: "t1", title: "Research Acme", status: "completed", summary: "Acme ships **weekly**.", duringTurn: true }}
      />,
    ).container;
    expect(view.querySelector('[data-streamdown="strong"]')?.textContent).toBe("weekly");
  });
});
