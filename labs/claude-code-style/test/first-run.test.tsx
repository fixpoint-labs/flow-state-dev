// @vitest-environment happy-dom
/**
 * A first run teaches (FIX-2403): the picker says what its view does and which
 * coding harnesses can run, checks a repository as you leave the field (and
 * keeps Create off while the check says no), and an empty session offers lines
 * that fill the composer without sending them.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { PICKER_COPY, STARTER_LINES } from "../src/lib/first-run";
import { createFakeLab } from "./fake-lab";

afterEach(cleanup);

describe("the first run", () => {
  it("says what the view does, and shows each harness's readiness with its remedy", async () => {
    render(<App adapter={createFakeLab({ speed: 0.01 })} />);
    const picker = await screen.findByRole("region", { name: "Choose a project" });
    expect(within(picker).getByTestId("picker-copy").textContent).toContain(PICKER_COPY.session);
    const chips = await within(picker).findByRole("group", { name: "Coding harnesses" });
    await waitFor(() => expect(chips.textContent).toContain("Codex: Run `codex login`"));
    expect(chips.querySelector('[data-harness="codex"]')?.getAttribute("data-ready")).toBe("false");
    expect(chips.querySelector('[data-harness="claude-code"]')?.getAttribute("data-ready")).toBe("true");
  });

  it("shows the server's problem before Create, and keeps Create off for that repository", async () => {
    const lab = createFakeLab({ speed: 0.01 });
    let creates = 0;
    render(<App adapter={{ ...lab, createProject: async (...args) => (creates++, lab.createProject(...args)) }} />);
    const form = await screen.findByRole("form", { name: "New project" });
    fireEvent.change(within(form).getByLabelText("Project name"), { target: { value: "notes" } });
    const field = within(form).getByLabelText("Repository");
    fireEvent.change(field, { target: { value: "file:///tmp/not-a-repo" } });
    fireEvent.blur(field);
    expect((await within(form).findByTestId("repository-problem")).textContent).toContain("Run `git init` there");
    const create = within(form).getByRole("button", { name: "Create project" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    fireEvent.change(field, { target: { value: "file:///tmp/notes" } });
    fireEvent.blur(field);
    expect((await within(form).findByTestId("repository-disclosure")).textContent).toContain("never changed");
    await waitFor(() => expect(create.disabled).toBe(false));
    fireEvent.click(create);
    await waitFor(() => expect(creates).toBe(1));
  });

  it("asks again when the field is left after a refusal, so a fixed repository can be made", async () => {
    const lab = createFakeLab({ speed: 0.01 });
    let fixed = false;
    let checks = 0;
    const onCheck = async (_repository: string) => {
      checks++;
      return fixed ? { usable: true as const, how: "worktree" as const } : lab.checkRepository("file:///tmp/not-a-repo");
    };
    render(<App adapter={{ ...lab, checkRepository: onCheck }} />);
    const form = await screen.findByRole("form", { name: "New project" });
    fireEvent.change(within(form).getByLabelText("Project name"), { target: { value: "notes" } });
    const field = within(form).getByLabelText("Repository");
    fireEvent.change(field, { target: { value: "file:///tmp/notes" } });
    fireEvent.blur(field);
    await within(form).findByTestId("repository-problem");
    const create = within(form).getByRole("button", { name: "Create project" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    // The person commits the rule and leaves the field again, same address.
    fixed = true;
    fireEvent.blur(field);
    await within(form).findByTestId("repository-disclosure");
    await waitFor(() => expect(create.disabled).toBe(false));
    expect(checks).toBe(2);
  });

  it("offers starter lines in an empty session; a click fills the composer and sends nothing", async () => {
    const lab = createFakeLab({ speed: 0.01 });
    let sends = 0;
    render(<App adapter={{ ...lab, send: async (...args) => (sends++, lab.send(...args)) }} />);
    const picker = await screen.findByRole("region", { name: "Choose a project" });
    await act(async () => fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" })));
    const lines = await screen.findByRole("list", { name: "Starter lines" });
    const line = STARTER_LINES.session[0]!;
    fireEvent.click(within(lines).getByRole("button", { name: line }));
    await waitFor(() => expect((screen.getByLabelText("Message the main session") as HTMLTextAreaElement).value).toBe(line));
    expect(sends).toBe(0);
  });
});
