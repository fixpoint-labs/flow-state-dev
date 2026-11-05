// @vitest-environment happy-dom
/**
 * A first run teaches (FIX-2403): a strip over the conversation says what the
 * lab works on and with, the harness chips say which can run, and an empty
 * conversation names who its worker hands work to, from the roster and the
 * declared delegates as read, and offers lines that fill the composer without
 * sending them.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkerRow } from "../src/adapter";
import { App } from "../src/App";
import { delegatesOf, emptyLine, starterLines } from "../src/lib/first-run";
import { createFixtureLab } from "./fake-lab";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const row = (id: string, name: string, extra: Partial<WorkerRow> = {}): WorkerRow => ({ id, name, role: "", ...extra });
const context = (delegates: Record<string, "all" | string[]>) => ({ folder: "/x", folderProblem: null, model: "m", harness: "cursor", delegates });

describe("the first run's lines", () => {
  it("names the delegates the roster and the declared list give, so two rosters read differently", () => {
    const lead = row("t.lead", "Lead");
    const one = [lead, row("t.scout", "Scout"), row("t.forge", "Forge", { takesTasks: true })];
    const two = [lead, row("t.scribe", "Scribe"), row("t.anvil", "Anvil", { takesTasks: true })];
    const a = emptyLine(lead, delegatesOf(lead, one, context({ "t.lead": "all" })));
    const b = emptyLine(lead, delegatesOf(lead, two, context({ "t.lead": "all" })));
    expect(a).toBe("Lead runs the work with you: it asks Scout and starts coding tasks on Forge. This is your one conversation with it.");
    expect(b).toContain("asks Scribe and starts coding tasks on Anvil");
    expect(starterLines(lead, delegatesOf(lead, two, context({ "t.lead": "all" })))).toContain("Ask Scribe to look into something for me");
  });

  it("names only the listed delegates, and none for a worker that declares none", () => {
    const lead = row("t.lead", "Lead");
    const roster = [lead, row("t.scout", "Scout"), row("t.other", "Other")];
    expect(delegatesOf(lead, roster, context({ "t.lead": ["t.scout"] })).map((w) => w.name)).toEqual(["Scout"]);
    expect(delegatesOf(row("t.scout", "Scout"), roster, context({ "t.lead": "all" }))).toEqual([]);
    expect(emptyLine(row("t.scout", "Scout", { role: "Finds facts." }), [])).toBe("Say hello to Scout. This is your one conversation with it. Finds facts.");
  });
});

describe("the context strip", () => {
  it("shows the folder, model and harness the server read, and the harness chips with their remedy", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.05 })} />);
    const strip = await screen.findByRole("region", { name: "Working context" });
    await waitFor(() => expect(within(strip).getByTestId("context-folder").textContent).toBe("folder /work/launch-site"));
    expect(within(strip).getByTestId("context-model").textContent).toBe("model openai/gpt-6-luna");
    expect(within(strip).getByTestId("context-harness").textContent).toBe("default harness Cursor");
    const chips = within(strip).getByRole("group", { name: "Coding harnesses" });
    await waitFor(() => expect(chips.querySelector('[data-harness="codex"]')?.textContent).toContain("Run `codex login`"));
  });

  it("warns when a coding run's checkout of the folder would be refused", async () => {
    const lab = createFixtureLab({ speed: 0.05 });
    render(<App adapter={{ ...lab, readContext: async () => ({ ...(await lab.readContext()), folderProblem: "the repository does not ignore .fsdev/ask" }) }} />);
    expect((await screen.findByTestId("context-folder-problem")).textContent).toContain("does not ignore .fsdev/ask");
  });
});

describe("an empty conversation", () => {
  it("offers starter lines; a click fills the composer and sends nothing", async () => {
    const lab = createFixtureLab({ speed: 0.05 });
    let sends = 0;
    render(<App adapter={{ ...lab, send: async (...args) => (sends++, lab.send(...args)) }} />);
    // A teammate hired now has an empty conversation.
    await screen.findByRole("region", { name: "Working context" });
    const hired = await lab.hire({ name: "scout", role: "Finds facts.", instructions: "Find facts." });
    cleanup();
    render(<App adapter={{ ...lab, send: async (...args) => (sends++, lab.send(...args)) }} />);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${hired.name}`) }));
    const lines = await screen.findByRole("list", { name: "Starter lines" });
    fireEvent.click(within(lines).getByRole("button", { name: "What can you help me with?" }));
    await waitFor(() => expect((screen.getByLabelText(`Message ${hired.name}`) as HTMLTextAreaElement).value).toBe("What can you help me with?"));
    expect(sends).toBe(0);
  });
});
