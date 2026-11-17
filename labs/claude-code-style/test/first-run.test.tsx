// @vitest-environment happy-dom
/**
 * A first run teaches (FIX-2403): the picker says what its view does and which
 * coding harnesses can run, checks a repository as you leave the field (and
 * keeps Create off while the check says no), and an empty session offers lines
 * that fill the composer without sending them.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ClientFetch } from "@flow-state-dev/client";
import { App } from "../src/components/App";
import { PICKER_COPY, STARTER_LINES } from "../src/lib/first-run";
import { closeApps, openTestApp, repository } from "./app-host";

afterEach(async () => {
  cleanup();
  window.history.replaceState(null, "", "/");
  await closeApps();
});

/** Which harnesses this machine can run, as the readiness view answers here: a test can't rely on the machine's own. */
const READINESS = [
  { harness: "claude-code", label: "Claude Code", ready: true, reason: null, remedy: null, unanswered: false },
  { harness: "codex", label: "Codex", ready: false, reason: "Codex has no credential", remedy: "Run `codex login`", unanswered: false },
];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const pathOf = (input: RequestInfo | URL) => new URL(String(input instanceof Request ? input.url : input), "http://x").pathname;

/**
 * The host, with what the page asked of it counted by path and the readiness
 * view answered with {@link READINESS}. `hold(path)` keeps that call's answer
 * until the returned release is called.
 */
async function countingApp() {
  const asked: string[] = [];
  const held = new Map<string, Promise<void>>();
  const lab = await openTestApp({
    noProject: true,
    intercept: (inner) =>
      (async (input, init) => {
        const path = pathOf(input);
        asked.push(`${init?.method ?? "GET"} ${path}`);
        if (path.endsWith("/views/readiness")) return json({ output: READINESS, topics: [] });
        await held.get(path);
        return inner(input, init);
      }) as ClientFetch,
  });
  const count = (match: string) => asked.filter((call) => call.includes(match)).length;
  const hold = (path: string) => {
    let release!: () => void;
    held.set(path, new Promise<void>((resolve) => (release = resolve)));
    return () => {
      held.delete(path);
      release();
    };
  };
  return { lab, count, hold };
}

const CHECK = "/views/checkRepository";
const CREATE = "createProject";

describe("the first run", () => {
  it("says what the view does, and shows each harness's readiness with its remedy", async () => {
    const { lab } = await countingApp();
    render(lab.wrap(<App />));
    const picker = await screen.findByRole("region", { name: "Choose a project" });
    expect(within(picker).getByTestId("picker-copy").textContent).toContain(PICKER_COPY.session);
    const chips = await within(picker).findByRole("group", { name: "Coding harnesses" });
    await waitFor(() => expect(chips.textContent).toContain("Codex: Run `codex login`"));
    expect(chips.querySelector('[data-harness="codex"]')?.getAttribute("data-ready")).toBe("false");
    expect(chips.querySelector('[data-harness="claude-code"]')?.getAttribute("data-ready")).toBe("true");
  });

  it("shows the server's problem before Create, and keeps Create off for that repository", async () => {
    const { lab, count } = await countingApp();
    const notARepo = join(lab.data, "not-a-repo");
    mkdirSync(notARepo);
    const notes = repository(join(lab.data, "notes"));
    render(lab.wrap(<App />));
    const form = await screen.findByRole("form", { name: "New project" });
    fireEvent.change(within(form).getByLabelText("Project name"), { target: { value: "notes" } });
    const field = within(form).getByLabelText("Repository");
    fireEvent.change(field, { target: { value: `file://${notARepo}` } });
    fireEvent.blur(field);
    expect((await within(form).findByTestId("repository-problem", undefined, { timeout: 10_000 })).textContent).toContain("git init");
    const create = within(form).getByRole("button", { name: "Create project" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    fireEvent.change(field, { target: { value: `file://${notes}` } });
    fireEvent.blur(field);
    // Not one of the host's listed repositories: a run works in a clone of it.
    expect((await within(form).findByTestId("repository-disclosure", undefined, { timeout: 10_000 })).textContent).toContain("is only read");
    await waitFor(() => expect(create.disabled).toBe(false));
    fireEvent.click(create);
    await waitFor(() => expect(count(CREATE)).toBe(1), { timeout: 10_000 });
  });

  it("asks again when the field is left after a refusal, so a fixed repository can be made", async () => {
    const { lab, count } = await countingApp();
    const notes = join(lab.data, "notes");
    mkdirSync(notes);
    render(lab.wrap(<App />));
    const form = await screen.findByRole("form", { name: "New project" });
    fireEvent.change(within(form).getByLabelText("Project name"), { target: { value: "notes" } });
    const field = within(form).getByLabelText("Repository");
    fireEvent.change(field, { target: { value: `file://${notes}` } });
    fireEvent.blur(field);
    await within(form).findByTestId("repository-problem", undefined, { timeout: 10_000 });
    const create = within(form).getByRole("button", { name: "Create project" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    // The person makes it a repository and leaves the field again, same address.
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    execFileSync("git", ["init", "-q", "-b", "main", notes]);
    writeFileSync(join(notes, ".gitignore"), "**/.fsdev/\n");
    execFileSync("git", ["-C", notes, "add", "-A"], { env });
    execFileSync("git", ["-C", notes, "commit", "-q", "-m", "init"], { env });
    fireEvent.blur(field);
    await within(form).findByTestId("repository-disclosure", undefined, { timeout: 10_000 });
    await waitFor(() => expect(create.disabled).toBe(false));
    expect(count(CHECK)).toBe(2);
  });

  it("lets Create through while the check its own click started is still out", async () => {
    const { lab, count, hold } = await countingApp();
    const notes = repository(join(lab.data, "notes"));
    const release = hold("/api/flows/projects/views/checkRepository");
    render(lab.wrap(<App />));
    const form = await screen.findByRole("form", { name: "New project" });
    fireEvent.change(within(form).getByLabelText("Project name"), { target: { value: "notes" } });
    const field = within(form).getByLabelText("Repository");
    fireEvent.change(field, { target: { value: `file://${notes}` } });
    // Clicking Create leaves the field: its blur starts a check that is still out when the click lands.
    await act(async () => fireEvent.blur(field));
    const create = within(form).getByRole("button", { name: "Create project" }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    await act(async () => fireEvent.click(create));
    await act(async () => release());
    await waitFor(() => expect(count(CREATE)).toBe(1), { timeout: 10_000 });
  });

  it("offers starter lines in an empty session; a click fills the composer and sends nothing", async () => {
    const { lab, count } = await countingApp();
    await lab.calls.createProject("vendor-notes", `file://${lab.repo}`);
    render(lab.wrap(<App />));
    const picker = await screen.findByRole("region", { name: "Choose a project" });
    await act(async () => fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" })));
    const lines = await screen.findByRole("list", { name: "Starter lines" }, { timeout: 10_000 });
    const line = STARTER_LINES.session[0]!;
    fireEvent.click(within(lines).getByRole("button", { name: line }));
    await waitFor(() => expect((screen.getByLabelText("Message the main session") as HTMLTextAreaElement).value).toBe(line));
    expect(count("/respond")).toBe(0);
  });
});
