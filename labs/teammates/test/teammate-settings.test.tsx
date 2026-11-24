// @vitest-environment happy-dom
/**
 * A teammate's model is its setting, changed in the dialog that hires or edits
 * it, not per message. A reply on a model with no key or gateway fails only
 * once it's sent, so the form shows where each model's calls would go and
 * won't take one that can't go anywhere. A save names only the settings it
 * changed (`settingsPatch`), because a whole `settings` would wipe the ones the
 * page never sees (Lead's delegates and capabilities). A teammate has no coding
 * harness of its own: the lab's default is the one default, so neither form
 * offers one, and the composer's "Code with" starts on the lab's. Each case
 * fails if a route or reason stops showing, an unreachable model can be
 * picked, a save sends settings it didn't change, a form offers a coding
 * harness, or the dialog stops closing or giving focus back.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withModelRoutes } from "../flows/lab-context.mts";
import { Composer } from "../src/components/Composer";
import { EditForm, HireForm, shortModelName, TeammateDialog, type SettingsChoices } from "../src/components/TeammateForms";
import type { HarnessReadinessChipRow } from "../src/components/flow-state/harness-readiness";

afterEach(cleanup);

const MODELS = [
  { id: "openai/gpt-6-luna", available: true, via: "Vercel AI Gateway" },
  { id: "anthropic/claude-opus-5-5", available: true, via: "anthropic key" },
  { id: "xai/grok-5", available: false, reason: "no key or gateway for xai" },
];
const chip = (harness: string, label: string, ready: boolean): HarnessReadinessChipRow => ({ harness, label, ready, reason: ready ? null : "not signed in", remedy: null, unanswered: false });
const HARNESSES = [chip("claude-code", "Claude Code", true), chip("cursor", "Cursor", false)];
const CHOICES: SettingsChoices = { models: MODELS };

const options = (select: HTMLElement) => [...(select as HTMLSelectElement).options].map((o) => ({ text: o.textContent, disabled: o.disabled }));

describe("the model field", () => {
  it("lists every model with its route, and an unreachable one with why, which can't be picked", () => {
    render(<EditForm name="Lead" choices={CHOICES} current={{ model: "openai/gpt-6-luna" }} onSave={vi.fn()} onCancel={() => {}} />);
    expect(options(screen.getByLabelText("Model for Lead"))).toEqual([
      { text: "gpt-6-luna · via Vercel AI Gateway", disabled: false },
      { text: "claude-opus-5-5 · via anthropic key", disabled: false },
      { text: "grok-5 · no key or gateway for xai", disabled: true },
    ]);
  });

  it("is the only setting either form offers: no coding harness of a teammate's own", () => {
    render(<EditForm name="Lead" choices={CHOICES} current={{ model: "openai/gpt-6-luna" }} onSave={vi.fn()} onCancel={() => {}} />);
    render(<HireForm choices={CHOICES} defaults={{ model: "openai/gpt-6-luna" }} onHire={vi.fn()} onCancel={() => {}} />);
    expect(screen.queryAllByLabelText(/coding harness/i)).toEqual([]);
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("saves only the settings changed, so the ones the page can't see survive", async () => {
    const onSave = vi.fn(async () => {});
    render(<EditForm name="Lead" choices={CHOICES} current={{ model: "openai/gpt-6-luna" }} onSave={onSave} onCancel={() => {}} />);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Model for Lead"), { target: { value: "anthropic/claude-opus-5-5" } });
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ settingsPatch: { model: "anthropic/claude-opus-5-5" } }));
  });

  it("still shows a teammate's own model the lab's list doesn't name", () => {
    render(<EditForm name="Lead" choices={CHOICES} current={{ model: "openai/gpt-6-sol" }} onSave={vi.fn()} onCancel={() => {}} />);
    expect((screen.getByLabelText("Model for Lead") as HTMLSelectElement).value).toBe("openai/gpt-6-sol");
  });

  it("hires with the lab's defaults left alone, and with a pick as the teammate's own", async () => {
    const onHire = vi.fn(async () => {});
    render(<HireForm choices={CHOICES} defaults={{ model: "openai/gpt-6-luna" }} onHire={onHire} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Teammate name"), { target: { value: "Tester" } });
    fireEvent.change(screen.getByLabelText("Teammate role"), { target: { value: "Writes tests" } });
    fireEvent.change(screen.getByLabelText("Model for the new teammate"), { target: { value: "anthropic/claude-opus-5-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Hire" }));
    await waitFor(() => expect(onHire).toHaveBeenCalledWith({ id: "tester", description: "Writes tests", instructions: "", settings: { model: "anthropic/claude-opus-5-5" } }));
  });

  it("reads a model by its name alone, whatever its provider or route", () => {
    expect(shortModelName("openrouter:openai/gpt-6-sol")).toBe("gpt-6-sol");
    expect(shortModelName("vercel:gpt-6-luna")).toBe("gpt-6-luna");
  });
});

describe("the dialog", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Edit teammate
        </button>
        <TeammateDialog open={open} onOpenChange={setOpen} title="Edit Lead" description="Lead's settings.">
          <EditForm name="Lead" choices={CHOICES} current={{}} onSave={async () => setOpen(false)} onCancel={() => setOpen(false)} />
        </TeammateDialog>
      </>
    );
  }

  it("opens over the page, and Cancel closes it and gives focus back to the button that opened it", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Edit teammate" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "Edit Lead" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("closes on Escape", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Edit teammate" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Code with", () => {
  it("starts on the lab's default harness, and the line goes as typed", async () => {
    const onSend = vi.fn(async () => {});
    render(<Composer sessionId="s1" workerName="Lead" running={false} onStop={() => {}} onSend={onSend} harnesses={HARNESSES} defaultHarness="claude-code" />);
    expect(screen.getByRole("button", { name: /^Code with Claude Code/ })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Fix the flaky test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Fix the flaky test", []));
  });
});

describe("the lab's context", () => {
  // The page gets each model's route from the server, which has the keys; the page never does.
  it("gives each model its route by key name, and never the key", () => {
    const env = { AI_GATEWAY_API_KEY: "gateway-secret" };
    const answer = withModelRoutes({ folder: "/w", folderProblem: null, model: "openai/gpt-6-luna", models: ["openai/gpt-6-luna", "openrouter:openai/gpt-6-sol"], harness: "cursor", delegates: {} }, env);
    expect(answer).toMatchObject({
      models: [
        { id: "openai/gpt-6-luna", available: true, via: "Vercel AI Gateway" },
        { id: "openrouter:openai/gpt-6-sol", available: false, reason: "OPENROUTER_API_KEY is not set" },
      ],
    });
    expect(JSON.stringify(answer)).not.toContain("gateway-secret");
  });
});
