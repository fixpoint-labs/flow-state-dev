// @vitest-environment happy-dom
/**
 * Each tool and task state is coloured by what it means.
 *
 * "A person must act" (a tool call awaiting approval, a task parked for
 * review) reads `attention`; "something is off, nobody is asked" (a denied
 * call, a blocked task) reads `warning`. They were one yellow-amber family, so
 * a theme could not make the first stand out without every warning looking
 * like a request. Asserted per state so a swap of the two fails here.
 *
 * Renders registry source, which imports shadcn primitives through `@/`; the
 * vitest config aliases those to Storybook's stubs, the way Storybook builds.
 * This folder is outside the package's typecheck for the same reason stories
 * are: registry files resolve `@/` only inside an app.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getStatusBadge, type ToolState } from "../../registry/components/tool";
import { SessionItemsProvider } from "../../registry/components/session-items-context";
import { TaskPlan } from "../../registry/components/task-plan";
import { makeBoardMeta, makeTask, makeTaskChange } from "../../stories/fixtures/tasks";

afterEach(cleanup);

/** The colour-token utilities on an element's classes: `text-attention` → `attention`. */
function tokensOn(element: Element | null): string[] {
  const classes = element?.getAttribute("class")?.split(/\s+/) ?? [];
  return classes.filter((c) => /^text-(success|warning|info|attention|destructive|muted-foreground)$/.test(c))
    .map((c) => c.slice("text-".length));
}

describe("tool card states", () => {
  const expected: Array<[ToolState, string]> = [
    ["awaiting", "attention"],
    ["denied", "warning"],
    ["completed", "success"],
    ["error", "destructive"],
  ];

  it.each(expected)("%s reads %s", (state, token) => {
    const { container } = render(<>{getStatusBadge(state)}</>);
    expect(tokensOn(container.querySelector("svg"))).toEqual([token]);
  });
});

describe("task plan states", () => {
  const expected: Array<[string, string]> = [
    ["parked", "attention"],
    ["blocked", "warning"],
    ["in_progress", "info"],
    ["completed", "success"],
    ["errored", "destructive"],
  ];

  it.each(expected)("a %s task reads %s", (status, token) => {
    const goal = `a ${status} task`;
    render(
      <SessionItemsProvider
        value={[
          makeBoardMeta({ collectionId: "board" }),
          makeTaskChange({ collectionId: "board", task: makeTask({ id: "t1", goal, status: status as never }) }),
        ]}
      >
        <TaskPlan collectionId="board" />
      </SessionItemsProvider>
    );
    const row = screen.getByText(goal).closest("li");
    expect(tokensOn(row?.querySelector("svg") ?? null)).toEqual([token]);
  });

  // Planning is ordinary progress; only a plan sent back is something off.
  it.each([
    ["planning", "info"],
    ["active", "info"],
    ["reviewing", "info"],
    ["replanning", "warning"],
  ])("a board that is %s reads %s", (status, token) => {
    render(
      <SessionItemsProvider
        value={[
          makeBoardMeta({ collectionId: "board", meta: { status } as never }),
          makeTaskChange({ collectionId: "board", task: makeTask({ id: "t1", goal: "a task", status: "pending" }) }),
        ]}
      >
        <TaskPlan collectionId="board" />
      </SessionItemsProvider>
    );
    expect(tokensOn(screen.getByText(/…$/))).toEqual([token]);
  });

  it("colours a blocked task's notes as a warning, never as an ask", () => {
    render(
      <SessionItemsProvider
        value={[
          makeBoardMeta({ collectionId: "board" }),
          makeTaskChange({
            collectionId: "board",
            task: makeTask({ id: "t1", goal: "blocked", status: "blocked", feedback: "needs the schema first" }),
          }),
        ]}
      >
        <TaskPlan collectionId="board" />
      </SessionItemsProvider>
    );
    const note = screen.getByText("needs the schema first");
    expect(note.getAttribute("class")).toContain("text-warning/80");
  });
});
