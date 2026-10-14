// @vitest-environment happy-dom
/** The fake list refuses a stale version, so a page that writes its own list shows here. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { LabClients } from "../src/lib/connection";
import { toWorker, type LabSnapshot } from "../src/lib/reads";

type Rule = { number: number; text: string; addedAt: number; sessionId: string | null };
type Input =
  | { op: "read" }
  | { op: "add"; version: number; text: string }
  | { op: "change"; version: number; number: number; current: string; text: string }
  | { op: "remove"; version: number; number: number; current: string };

let held: { version: number; rules: Array<Omit<Rule, "number">> };
let calls: Array<{ worker: string; input: Input }>;

async function standingRules(worker: string, input: Input) {
  calls.push({ worker, input });
  const answer = () => ({ version: held.version, rules: held.rules.map((r, i) => ({ number: i + 1, ...r })) });
  if (input.op === "read") return answer();
  if (input.version !== held.version) throw new Error(`the rules changed since they were read (version ${input.version}, now ${held.version})`);
  if ("text" in input && input.text.length > 300) throw new Error(`a rule is at most 300 characters, and this one is ${input.text.length}`);
  if (input.op === "add") held = { version: held.version + 1, rules: [...held.rules, { text: input.text, addedAt: 1_000, sessionId: null }] };
  else if (input.op === "change") held = { version: held.version + 1, rules: held.rules.map((r, i) => (i === input.number - 1 ? { ...r, text: input.text } : r)) };
  else held = { version: held.version + 1, rules: held.rules.filter((_r, i) => i !== input.number - 1) };
  return answer();
}

vi.mock("../src/lib/workforce", () => ({
  useWorkforce: () => ({ roster: async () => [], standingRules }),
}));

let fixture: LabSnapshot;
vi.mock("../src/lib/reads", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/reads")>();
  return { ...real, createLabReader: () => ({ read: async () => fixture, readBoard: async () => [], resume: async () => {} }) };
});

function lab(): LabSnapshot {
  return {
    readAt: Date.UTC(2026, 9, 14, 9, 30),
    sessions: [],
    orgId: "acme",
    inventory: { ok: true, value: { workers: [toWorker({ id: "researcher", kind: "agent" })!, toWorker({ id: "eng.coder", kind: "coder" })!] } },
    boards: {},
    asks: { ok: true, value: [] },
    resources: { ok: true, value: [] },
    projects: { ok: true, value: { rows: [] } },
  };
}

async function open(path: string, devtoolUrl?: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`http://lab.local${path}`);
  render(<App clients={{ userId: "u_test" } as unknown as LabClients} devtoolUrl={devtoolUrl} />);
  await screen.findByTestId("sidebar");
}

const texts = () => screen.queryAllByTestId("rule-text").map((el) => el.textContent);

beforeEach(() => {
  fixture = lab();
  held = { version: 0, rules: [] };
  calls = [];
});
afterEach(() => cleanup());

describe("the Roster's way in (BR-20, BR-21a)", () => {
  it("offers Rules on a worker that keeps them, and says so on one whose flow doesn't", async () => {
    await open("/roster");
    const rows = await screen.findAllByTestId("roster-worker");
    const row = (id: string) => rows.find((r) => r.getAttribute("data-worker-id") === id)!;
    expect(within(row("eng.coder")).queryByTestId("roster-worker-rules")).toBeNull();
    expect(within(row("eng.coder")).getByTestId("roster-worker-no-rules").textContent).toMatch(/doesn't keep standing rules/);
    fireEvent.click(within(row("researcher")).getByTestId("roster-worker-rules"));
    expect(window.location.pathname).toBe("/roster/researcher/rules");
    expect(await screen.findByTestId("rules")).toBeTruthy();
  });

  it("draws no list for a worker whose flow keeps none, even at its address, and never asks the Lab for one", async () => {
    await open("/roster/eng.coder/rules");
    expect((await screen.findByTestId("rules-not-kept")).textContent).toMatch(/doesn't keep standing rules/);
    expect(calls).toEqual([]);
  });
});

describe("a worker's Rules (BR-19 to BR-21)", () => {
  it("says the worker keeps none and offers to add one, with the limits shown", async () => {
    await open("/roster/researcher/rules");
    expect((await screen.findByTestId("rules-empty")).textContent).toMatch(/keeps no rules for you yet/);
    expect(screen.getByTestId("rules-limits").textContent).toMatch(/Up to 20, each one line of up to 300 characters/);
    expect(screen.getByTestId("rule-add-input")).toBeTruthy();
  });

  it("adds, edits and deletes through the Lab, each write naming the version it was drawn from", async () => {
    await open("/roster/researcher/rules");
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
    await open("/roster/researcher/rules");
    await waitFor(() => expect(texts()).toEqual(["Keep replies short."]));
    // The worker drops it and adds another in a conversation, after the page drew the list.
    held = { version: 3, rules: [{ text: "Answer in French.", addedAt: 900, sessionId: "conv_def" }] };
    fireEvent.click(screen.getByTestId("rule-delete"));
    expect((await screen.findByTestId("rules-refused")).textContent).toMatch(/changed since they were read/);
    await waitFor(() => expect(texts()).toEqual(["Answer in French."]));
    expect(held.rules.map((r) => r.text)).toEqual(["Answer in French."]);
  });

  it("refuses a rule over the limit with the Lab's reason, keeping what was typed", async () => {
    await open("/roster/researcher/rules");
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
    await open("/roster/researcher/rules", "http://127.0.0.1:4100/");
    const origin = await screen.findByTestId("rule-origin");
    expect(origin.getAttribute("data-session-id")).toBe("conv_abc");
    expect(origin.getAttribute("href")).toContain("conv_abc");
  });

  it("offers no add at 20 of 20, saying why", async () => {
    held = { version: 20, rules: Array.from({ length: 20 }, (_, i) => ({ text: `rule ${i + 1}`, addedAt: i, sessionId: null })) };
    await open("/roster/researcher/rules");
    expect((await screen.findByTestId("rules-full")).textContent).toMatch(/full \(20 of 20\)/);
    expect(screen.queryByTestId("rule-add-input")).toBeNull();
  });
});
