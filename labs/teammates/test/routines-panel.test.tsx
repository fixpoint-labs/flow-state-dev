// @vitest-environment happy-dom
/**
 * A teammate's panel lists the routines that act through it, read from
 * Workforce's routines view: a clock routine it files and an event routine it
 * hears, never another teammate's. Red before this: the section was a fixed
 * "Schedule a routine" prompt that read nothing, so a routine that fired every
 * morning never showed anywhere in the app.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rosterEntry } from "./scripted-server";
import { POPUP_READ, stubServer, TestProvider } from "./stub-server";
import { TeammatePanel } from "../src/components/TeammatePanel";

afterEach(() => cleanup());

const ROUTINES = [
  {
    id: "clock:daily-tweet-draft",
    name: "daily-tweet-draft",
    worker: "chief",
    paused: false,
    description: "Draft one tweet every morning.",
    trigger: { clock: { cron: "0 9 * * *", timezone: "America/New_York", nextRunAt: "2026-11-28T14:00:00.000Z" } },
    task: { filer: "chief", goal: "Draft a tweet" },
  },
  {
    id: "event:sub_1",
    name: "github:o/r#7",
    worker: "chief",
    paused: true,
    trigger: { event: { provider: "github", thread: "github:o/r#7", screens: [], interest: "Reviews on #7" } },
  },
  {
    id: "clock:someone-elses",
    name: "someone-elses",
    worker: "researcher",
    paused: false,
    trigger: { clock: { cron: "0 8 * * 1", timezone: "UTC", nextRunAt: null } },
  },
];

describe("a teammate's routines in its panel", () => {
  it("lists the routines acting through this teammate, with when each acts, and no one else's", async () => {
    const { client } = stubServer({ routines: ROUTINES });
    render(
      <TestProvider client={client}>
        <TeammatePanel worker={rosterEntry({ id: "chief", name: "Lead", description: "Routes work" })} sessionId="s1" openTask={undefined} nameOf={(id) => id} isCoding={() => false} onOpen={() => {}} />
      </TestProvider>,
    );
    const list = await screen.findByRole("list", { name: "Lead's routines" }, POPUP_READ);
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-routine"))).toEqual(["clock:daily-tweet-draft", "event:sub_1"]);
    expect(items[0]!.textContent).toMatch(/0 9 \* \* \* \(America\/New_York\) · next/);
    expect(items[0]!.textContent).toMatch(/Draft one tweet every morning\./);
    expect(items[1]!.textContent).toMatch(/github:o\/r#7/);
    expect(items[1]!.textContent).toMatch(/Reviews on #7/);
    expect(within(items[1]!).getByText("Paused")).toBeTruthy();
    expect(list.textContent).not.toMatch(/someone-elses/);
  });

  it("draws no list for a teammate with none, leaving the prompt to set one up", async () => {
    const { client } = stubServer({ routines: ROUTINES.slice(2) });
    render(
      <TestProvider client={client}>
        <TeammatePanel worker={rosterEntry({ id: "chief", name: "Lead", description: "Routes work" })} sessionId="s1" openTask={undefined} nameOf={(id) => id} isCoding={() => false} onOpen={() => {}} />
      </TestProvider>,
    );
    expect(await screen.findByText(/Schedule a routine for Lead/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Lead's routines" })).toBeNull();
  });
});
