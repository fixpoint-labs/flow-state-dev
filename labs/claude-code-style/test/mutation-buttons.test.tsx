// @vitest-environment happy-dom
/**
 * Every button that changes something, on fixtures. A call on its way holds its
 * button, so a double click sends it once; a refused call says so next to the
 * button and leaves the screen as it was, so it never reads as done. The
 * adapter here is the fake with one call swapped for one the test settles.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LabAdapter } from "../src/adapter";
import { App } from "../src/App";
import { createFakeLab } from "./fake-lab";

afterEach(cleanup);

/** A call that waits for the test: `calls` counts it, `settle` ends the latest one. */
function held() {
  let finish: ((failure?: Error) => void) | undefined;
  const call = {
    calls: 0,
    run: () => {
      call.calls += 1;
      return new Promise<void>((resolve, reject) => {
        finish = (failure) => (failure ? reject(failure) : resolve());
      });
    },
    settle: async (failure?: Error) => {
      await act(async () => finish?.(failure));
    },
  };
  return call;
}

const thread = () => screen.getByRole("main", { name: "Main thread" });
const card = (title: string) => within(thread()).getByRole("region", { name: `Task: ${title}` });
const button = (scope: HTMLElement, name: string | RegExp) => within(scope).getByRole("button", { name }) as HTMLButtonElement;

async function ask(text: string) {
  const box = await screen.findByLabelText("Message the main session");
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

// A threads-mode session on a project, its lead filing three threads, one of them ready for review.
async function reviewReady(adapter: LabAdapter) {
  render(<App adapter={adapter} />);
  fireEvent.click(within(screen.getByRole("tablist", { name: "View" })).getByRole("tab", { name: "Projects" }));
  fireEvent.click(screen.getByRole("button", { name: "+ New session" }));
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" }));
  await ask("Research three vendors for a status page, one thread each.");
  await waitFor(() => expect(card("Vendor C · summary").dataset.column).toBe("review"));
}

describe("buttons that change something", () => {
  it("sends one review answer for a double click on a card's Resolve, and says so when it's refused", async () => {
    const resolve = held();
    await reviewReady({ ...createFakeLab({ speed: 0.01 }), resolve: resolve.run });
    const resolveButton = () => within(card("Vendor C · summary")).getByRole("button", { name: /^Resolv/ }) as HTMLButtonElement;
    fireEvent.click(resolveButton());
    fireEvent.click(resolveButton());
    expect(resolve.calls).toBe(1);
    expect(resolveButton().disabled).toBe(true);
    expect(resolveButton().textContent).toBe("Resolving…");

    await resolve.settle(new Error("the review was already answered"));
    expect(within(card("Vendor C · summary")).getByRole("alert").textContent).toBe("Couldn't resolve: the review was already answered");
    expect(card("Vendor C · summary").dataset.column).toBe("review");
    // It can be tried again, and the refusal clears when it is.
    expect(resolveButton().disabled).toBe(false);
    fireEvent.click(resolveButton());
    expect(within(card("Vendor C · summary")).queryByRole("alert")).toBeNull();
    expect(resolve.calls).toBe(2);
  });

  it("holds the review buttons in a task's view while one is on its way, and keeps your words when Request changes is refused", async () => {
    const requestChanges = held();
    await reviewReady({ ...createFakeLab({ speed: 0.01 }), requestChanges: requestChanges.run });
    fireEvent.click(button(card("Vendor C · summary"), "Request changes"));
    const view = screen.getByRole("complementary", { name: "Task: Vendor C · summary" });
    const box = within(view).getByLabelText("Message this task") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Add the EU pricing." } });
    fireEvent.click(button(view, "Request changes"));
    fireEvent.click(button(view, "Request changes"));
    expect(requestChanges.calls).toBe(1);
    expect(button(view, "Resolve").disabled).toBe(true);

    await requestChanges.settle(new Error("network down"));
    expect(within(view).getByRole("alert").textContent).toBe("Not sent: network down");
    expect(box.value).toBe("Add the EU pricing.");
    expect(button(view, "Request changes").disabled).toBe(false);
  });

  it("clears your line once a steer is taken, and keeps it with the refusal when it isn't", async () => {
    const sayInThread = held();
    await reviewReady({ ...createFakeLab({ speed: 0.01 }), sayInThread: sayInThread.run });
    fireEvent.click(button(card("Vendor A · pricing and uptime"), "View task"));
    const view = screen.getByRole("complementary", { name: "Task: Vendor A · pricing and uptime" });
    const box = within(view).getByLabelText("Message this task") as HTMLTextAreaElement;
    const sendButton = () => within(view).getByRole("button", { name: /^(Send|Answer)$/ }) as HTMLButtonElement;

    fireEvent.change(box, { target: { value: "Check the annual plan too." } });
    fireEvent.click(sendButton());
    expect(sendButton().disabled).toBe(true);
    await sayInThread.settle(new Error("the task is gone"));
    expect(within(view).getByRole("alert").textContent).toBe("Not sent: the task is gone");
    expect(box.value).toBe("Check the annual plan too.");

    fireEvent.click(sendButton());
    expect(within(view).queryByRole("alert")).toBeNull();
    await sayInThread.settle();
    expect(box.value).toBe("");
    expect(sayInThread.calls).toBe(2);
  });

  it("says when a pin is refused, and leaves the task unpinned", async () => {
    const pin = held();
    await reviewReady({ ...createFakeLab({ speed: 0.01 }), pin: pin.run });
    fireEvent.click(button(card("Vendor C · summary"), "View task"));
    const view = screen.getByRole("complementary", { name: "Task: Vendor C · summary" });
    fireEvent.click(button(view, "Pin"));
    fireEvent.click(button(view, "Pin"));
    expect(pin.calls).toBe(1);
    expect(button(view, "Pin").disabled).toBe(true);
    await pin.settle(new Error("pins are read only"));
    expect(within(view).getByRole("alert").textContent).toBe("Couldn't pin: pins are read only");
    expect(button(view, "Pin").getAttribute("aria-pressed")).toBe("false");
  });

  it("opens one session for a double click on a project, and stays on the picker saying why when it can't open", async () => {
    const fake = createFakeLab({ speed: 0.01 });
    let opens = 0;
    let fail: ((failure: Error) => void) | undefined;
    const openSession: LabAdapter["openSession"] = () => {
      opens += 1;
      return new Promise((_, reject) => (fail = reject));
    };
    render(<App adapter={{ ...fake, openSession }} />);
    const picker = await screen.findByRole("region", { name: "Choose a project" });
    const project = await within(picker).findByRole("button", { name: "vendor-notes" });
    fireEvent.click(project);
    fireEvent.click(project);
    expect(opens).toBe(1);
    expect((project as HTMLButtonElement).disabled).toBe(true);

    await act(async () => fail?.(new Error("not-a-member: vendor-notes")));
    expect(within(picker).getByRole("alert").textContent).toBe("Couldn't open the session: not-a-member: vendor-notes");
    expect(screen.queryByLabelText("Message the main session")).toBeNull();
    expect((project as HTMLButtonElement).disabled).toBe(false);
  });
  it("creates one project for a double submit, and keeps the form filled with the refusal when it can't", async () => {
    const createProject = held();
    render(<App adapter={{ ...createFakeLab({ speed: 0.01 }), createProject: async () => (await createProject.run(), undefined as never) }} />);
    const form = await screen.findByRole("form", { name: "New project" });
    fireEvent.change(within(form).getByLabelText("Project name"), { target: { value: "billing" } });
    fireEvent.change(within(form).getByLabelText("Repository"), { target: { value: "file:///tmp/billing" } });
    const create = button(form, "Create project");
    fireEvent.click(create);
    fireEvent.click(create);
    expect(createProject.calls).toBe(1);
    expect(create.disabled).toBe(true);

    await createProject.settle(new Error("repository not found"));
    expect(within(form).getByRole("alert").textContent).toBe("repository not found");
    expect((within(form).getByLabelText("Project name") as HTMLInputElement).value).toBe("billing");
    expect(create.disabled).toBe(false);
  });
});
