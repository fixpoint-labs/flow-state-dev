// @vitest-environment happy-dom
/**
 * A worker's settings page and its Rules section (FIX-1945 S6, BR-19 to BR-21a; FIX-2007).
 * The Lab is a fake that keeps one list and refuses as the rules action does, so a page that drew its own
 * idea of the list, or wrote without the version, shows here.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { Client } from "@flow-state-dev/client";
import { toWorker, type LabSnapshot, type Worker } from "../src/lib/reads";
import { MAX_RULE_CHARS } from "@flow-state-dev/workforce/browser";

type Rule = { number: number; text: string; addedAt: number; sessionId: string | null };
type Input =
  | { op: "read" }
  | { op: "add"; version: number; text: string }
  | { op: "change"; version: number; number: number; current: string; text: string }
  | { op: "remove"; version: number; number: number; current: string };

/** The Lab's list for the worker, and every call the page made. */
let held: { version: number; rules: Array<Omit<Rule, "number">> };
let calls: Array<{ worker: string; input: Input }>;

/** The rules action, as a fake: the version check and the character limit. */
async function standingRules(worker: string, input: Input) {
  calls.push({ worker, input });
  const answer = () => ({ version: held.version, rules: held.rules.map((r, i) => ({ number: i + 1, ...r })) });
  if (input.op === "read") return answer();
  if (input.version !== held.version) throw new Error(`the rules changed since they were read (version ${input.version}, now ${held.version})`);
  if ("text" in input && input.text.length > MAX_RULE_CHARS) throw new Error(`a rule is at most ${MAX_RULE_CHARS} characters, and this one is ${input.text.length}`);
  if (input.op === "add") held = { version: held.version + 1, rules: [...held.rules, { text: input.text, addedAt: 1_000, sessionId: null }] };
  else if (input.op === "change") held = { version: held.version + 1, rules: held.rules.map((r, i) => (i === input.number - 1 ? { ...r, text: input.text } : r)) };
  else held = { version: held.version + 1, rules: held.rules.filter((_r, i) => i !== input.number - 1) };
  return answer();
}

/** The user's own roster read: empty, unless a test makes it fail. */
let roster: () => Promise<unknown[]>;

// One client for the page, as the app's own hook keeps one: a new one per render would read the list again on every render.
const workforce = { roster: () => roster(), standingRules };
vi.mock("../src/lib/workforce", () => ({
  useWorkforce: () => workforce,
}));

let fixture: LabSnapshot;
vi.mock("../src/lib/reads", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/reads")>();
  return { ...real, createLabReader: () => ({ read: async () => fixture, readBoard: async () => [], resume: async () => {} }) };
});

function lab(...more: Worker[]): LabSnapshot {
  return {
    readAt: Date.UTC(2026, 9, 14, 9, 30),
    sessions: [],
    orgId: "acme",
    inventory: { ok: true, value: { workers: [toWorker({ id: "researcher", kind: "agent", rules: true })!, toWorker({ id: "eng.coder", kind: "coder" })!, toWorker({ id: "eng.helper", kind: "agent", rules: false })!, ...more] } },
    boards: {},
    asks: { ok: true, value: [] },
    inbox: { ok: true, value: [] },
    resources: { ok: true, value: [] },
    projects: { ok: true, value: { rows: [] } },
  };
}

async function open(path: string, devtoolUrl?: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`http://lab.local${path}`);
  render(<App connection={{ userId: "u_test" }} devtoolUrl={devtoolUrl} />);
  await screen.findByTestId("sidebar");
}

const texts = () => screen.queryAllByTestId("rule-text").map((el) => el.textContent);

beforeEach(() => {
  fixture = lab();
  held = { version: 0, rules: [] };
  calls = [];
  roster = async () => [];
});
afterEach(() => cleanup());

describe("the Roster's way in (BR-20, BR-21a)", () => {
  it("offers Settings on every worker, and the researcher's opens its settings page with its Rules", async () => {
    await open("/roster");
    const rows = await screen.findAllByTestId("roster-worker");
    const row = (id: string) => rows.find((r) => r.getAttribute("data-worker-id") === id)!;
    for (const id of ["researcher", "eng.coder", "eng.helper"]) expect(within(row(id)).getByTestId("roster-worker-settings").textContent).toBe("Settings");
    expect(screen.queryByTestId("roster-worker-no-rules")).toBeNull();
    expect(screen.queryByTestId("roster-worker-rules")).toBeNull();
    fireEvent.click(within(row("researcher")).getByTestId("roster-worker-settings"));
    expect(window.location.pathname).toBe("/roster/researcher/settings");
    const page = await screen.findByTestId("worker-settings");
    expect(page.getAttribute("data-worker-id")).toBe("researcher");
    expect(within(page).getByTestId("worker-settings-tag").textContent).toBe("SETTINGS");
    expect(await within(page).findByTestId("rules")).toBeTruthy();
  });

  it("opens the same settings page at the old /rules address, leaving the address as typed", async () => {
    await open("/roster/researcher/rules");
    const page = await screen.findByTestId("worker-settings");
    expect(page.getAttribute("data-worker-id")).toBe("researcher");
    expect(await within(page).findByTestId("rules")).toBeTruthy();
    expect(screen.queryByTestId("shift-coordinator")).toBeNull();
    expect(window.location.pathname).toBe("/roster/researcher/rules");
    // Roster stays highlighted, as on the page's own address.
    expect(screen.getByTestId("nav-roster").getAttribute("aria-current")).toBe("page");
  });

  it("says the roster didn't load, not that the worker is missing, when the user's own roster read fails", async () => {
    roster = async () => {
      throw new Error("the roster store is down");
    };
    await open("/roster/hired.helper/settings");
    expect((await screen.findByTestId("worker-settings-roster-failure")).textContent).toMatch(/the roster store is down/);
    expect(screen.queryByTestId("worker-settings-no-worker")).toBeNull();
  });

  it("draws no list for a worker whose flow keeps none, says so in its Rules section, and never asks the Lab for one", async () => {
    await open("/roster/eng.coder/settings");
    expect((await screen.findByTestId("rules-not-kept")).textContent).toMatch(/doesn't keep standing rules/);
    expect(screen.queryByTestId("rules")).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("a worker's Rules (BR-19 to BR-21)", () => {
  it("says the worker keeps none and offers to add one, with the limits shown", async () => {
    await open("/roster/researcher/settings");
    expect((await screen.findByTestId("rules-empty")).textContent).toMatch(/keeps no rules for you yet/);
    expect(screen.getByTestId("rules-limits").textContent).toMatch(/Up to 20, each one line of up to 300 characters/);
    expect(screen.getByTestId("rule-add-input")).toBeTruthy();
  });

  it("adds, edits and deletes through the Lab, each write naming the version it was drawn from", async () => {
    await open("/roster/researcher/settings");
    await screen.findByTestId("rules-empty");

    fireEvent.change(screen.getByTestId("rule-add-input"), { target: { value: "Name the project first." } });
    fireEvent.click(screen.getByTestId("rule-add"));
    await waitFor(() => expect(texts()).toEqual(["Name the project first."]));
    expect(screen.getByTestId("rule-origin").textContent).toBe("added here");
    expect(screen.getByTestId("rules-count").textContent).toBe("1 of 20");

    fireEvent.click(screen.getByTestId("rule-edit"));
    fireEvent.change(screen.getByTestId("rule-input"), { target: { value: "Name the project before the status." } });
    fireEvent.click(screen.getByTestId("rule-save"));
    await waitFor(() => expect(texts()).toEqual(["Name the project before the status."]));

    fireEvent.click(screen.getByTestId("rule-delete"));
    await screen.findByTestId("rules-empty");

    expect(calls.filter((c) => c.input.op !== "read").map((c) => c.input)).toEqual([
      { op: "add", version: 0, text: "Name the project first." },
      { op: "change", version: 1, number: 1, current: "Name the project first.", text: "Name the project before the status." },
      { op: "remove", version: 2, number: 1, current: "Name the project before the status." },
    ]);
    expect(new Set(calls.map((c) => c.worker))).toEqual(new Set(["researcher"]));
  });

  it("shows the Lab's refusal and draws the list the Lab holds when the worker changed it first", async () => {
    held = { version: 1, rules: [{ text: "Keep replies short.", addedAt: 500, sessionId: "conv_abc" }] };
    await open("/roster/researcher/settings");
    await waitFor(() => expect(texts()).toEqual(["Keep replies short."]));
    // The worker drops it and adds another in a conversation, after the page drew the list.
    held = { version: 3, rules: [{ text: "Answer in French.", addedAt: 900, sessionId: "conv_def" }] };
    fireEvent.click(screen.getByTestId("rule-delete"));
    expect((await screen.findByTestId("rules-refused")).textContent).toMatch(/changed since they were read/);
    await waitFor(() => expect(texts()).toEqual(["Answer in French."]));
    expect(held.rules.map((r) => r.text)).toEqual(["Answer in French."]);
  });

  it("refuses a rule over the limit with the Lab's reason, keeping what was typed", async () => {
    await open("/roster/researcher/settings");
    await screen.findByTestId("rules-empty");
    fireEvent.change(screen.getByTestId("rule-add-input"), { target: { value: "x".repeat(301) } });
    expect(screen.getByTestId("rule-add-chars").textContent).toBe("301/300");
    fireEvent.click(screen.getByTestId("rule-add"));
    expect((await screen.findByTestId("rules-refused")).textContent).toMatch(/at most 300 characters/);
    expect((screen.getByTestId("rule-add-input") as HTMLInputElement).value).toHaveLength(301);
    expect(held.rules).toEqual([]);
  });

  it("links a rule to the conversation it came from in the DevTool", async () => {
    held = { version: 1, rules: [{ text: "Keep replies short.", addedAt: 500, sessionId: "conv_abc" }] };
    await open("/roster/researcher/settings", "http://127.0.0.1:4100/");
    const origin = await screen.findByTestId("rule-origin");
    expect(origin.getAttribute("data-session-id")).toBe("conv_abc");
    expect(origin.getAttribute("href")).toContain("conv_abc");
  });

  it("offers no add at 20 of 20, saying why", async () => {
    held = { version: 20, rules: Array.from({ length: 20 }, (_, i) => ({ text: `rule ${i + 1}`, addedAt: i, sessionId: null })) };
    await open("/roster/researcher/settings");
    expect((await screen.findByTestId("rules-full")).textContent).toMatch(/full \(20 of 20\)/);
    expect(screen.queryByTestId("rule-add-input")).toBeNull();
  });
});

describe("the Shift Coordinator: no rules in its panel, a gear to its settings", () => {
  const withShiftCoordinator = (id: string, kind: string, rules: boolean) => lab(toWorker({ id, kind, rules })!);
  // The panel opens beside the conversation only on a wide window.
  beforeEach(() => {
    (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width: 1600, height: 900 });
  });

  it("draws no rules section in the panel, and never asks the Lab, even for a Shift Coordinator that keeps them", async () => {
    fixture = withShiftCoordinator("shift-coordinator", "agent", true);
    await open("/shift-coordinator");
    const panel = await screen.findByTestId("shift-coordinator-panel");
    expect(within(panel).getByTestId("shift-coordinator-panel-empty")).toBeTruthy();
    expect(within(panel).queryByTestId("rules")).toBeNull();
    expect(panel.textContent).not.toMatch(/RULES/);
    expect(calls).toEqual([]);
  });

  it("opens the org coordinator's settings, with its Rules, from the gear in its header", async () => {
    fixture = withShiftCoordinator("shift-coordinator", "agent", true);
    await open("/shift-coordinator");
    fireEvent.click(await within(await screen.findByTestId("shift-coordinator-header")).findByTestId("shift-coordinator-settings"));
    expect(window.location.pathname).toBe("/roster/shift-coordinator/settings");
    const page = await screen.findByTestId("worker-settings");
    expect(within(page).getByTestId("worker-settings-title").textContent).toBe("Shift Coordinator");
    expect((await within(page).findByTestId("rules")).getAttribute("data-worker-id")).toBe("shift-coordinator");
    await waitFor(() => expect(calls).toEqual([{ worker: "shift-coordinator", input: { op: "read" } }]));
  });

  it("links the gear to a team's coordinator by its own id, and shows it even when its flow keeps no rules", async () => {
    fixture = withShiftCoordinator("ops.shift-coordinator", "coordinator", false);
    await open("/shift-coordinator");
    fireEvent.click(await within(await screen.findByTestId("shift-coordinator-header")).findByTestId("shift-coordinator-settings"));
    expect(window.location.pathname).toBe("/roster/ops.shift-coordinator/settings");
    expect((await screen.findByTestId("rules-not-kept")).textContent).toMatch(/doesn't keep standing rules/);
    expect(calls).toEqual([]);
  });

  it("offers no gear when several workers could be the coordinator, rather than guessing one", async () => {
    fixture = lab(toWorker({ id: "shift-coordinator", kind: "agent", rules: true })!, toWorker({ id: "ops.shift-coordinator", kind: "agent", rules: true })!);
    await open("/shift-coordinator");
    const header = await screen.findByTestId("shift-coordinator-header");
    await within(header).findByTestId("shift-coordinator-watching");
    expect(within(header).queryByTestId("shift-coordinator-settings")).toBeNull();
  });
});
