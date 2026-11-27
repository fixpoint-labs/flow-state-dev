// @vitest-environment happy-dom
/**
 * A worker's text renders as Markdown while it streams (FIX-2289): an
 * unfinished code fence is already a code block, never a literal "```" line,
 * and HTML the model writes stays text.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { linesOf, LinesOf, message, received } from "./lines";

afterEach(cleanup);

const said = (text: string) => linesOf([message("e1", "r1", "assistant", text, "in_progress")], [{ id: "r1", status: "in_progress" }]);
const assistant = (text: string) => render(<LinesOf lines={said(text)} />).container;

describe("a worker's text", () => {
  it("draws an unclosed code fence as a code block while it streams, and closes it in place when the fence arrives", async () => {
    const partial = "Here is the fix:\n\n```ts\nconst launch = \"18 October\";\nconsole.log(lau";
    const { container, rerender } = render(<LinesOf lines={said(partial)} />);
    await waitFor(() => expect(container.querySelector("pre code")).not.toBeNull());
    expect(container.querySelector("pre code")!.textContent).toContain("console.log(lau");
    expect(container.textContent).not.toContain("```");
    expect(container.querySelector("p")!.textContent).toBe("Here is the fix:");

    rerender(<LinesOf lines={said(`${partial}nch);\n\`\`\`\n\nDone.`)} />);
    await waitFor(() => expect(container.querySelector("pre code")!.textContent).toContain("console.log(launch);"));
    expect(container.querySelectorAll("pre").length).toBe(1);
    expect(container.textContent).toContain("Done.");
    expect(container.textContent).not.toContain("```");
  });

  it("renders Markdown structure: emphasis, lists and inline code", async () => {
    const container = assistant("**Launch** is on:\n\n- 18 October\n- in `relay`");
    await waitFor(() => expect(container.querySelector('[data-streamdown="strong"]')?.textContent).toBe("Launch"));
    expect(container.querySelectorAll("li").length).toBe(2);
    expect(container.querySelector("code")?.textContent).toBe("relay");
  });

  it("shows HTML the model writes as text, not as elements", async () => {
    const container = assistant('Look: <b>bold</b> <img src="x" onerror="alert(1)"> <script>alert(2)</script>');
    await waitFor(() => expect(container.textContent).toContain("<b>bold</b>"));
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders a message from another worker as Markdown too", async () => {
    const { container } = render(<LinesOf lines={linesOf([received("e2", "r1", { id: "m1", from: "researcher", text: "Launch is **18 October**." })])} />);
    await waitFor(() => expect(container.querySelector('[data-streamdown="strong"]')?.textContent).toBe("18 October"));
  });
});
