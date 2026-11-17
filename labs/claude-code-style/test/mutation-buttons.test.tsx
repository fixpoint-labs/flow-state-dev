// @vitest-environment happy-dom
/**
 * Every button that changes something, on the lab's own host. A call on its
 * way holds its button, so a double click sends it once; a refused call says
 * so next to the button and leaves the screen as it was, so it never reads as
 * done. One kind of call is held on its way to the host, for the test to let
 * through or refuse.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ClientFetch } from "@flow-state-dev/client";
import { App } from "../src/components/App";
import { closeApps, openTestApp, vendorScripts, type TestApp } from "./app-host";

afterEach(async () => {
  cleanup();
  window.history.replaceState(null, "", "/");
  await closeApps();
});

const SLOW = { timeout: 15_000 };

/**
 * The calls `matches` picks out, held on their way to the host: `calls`
 * counts them, `settle` lets the latest through, or refuses it with
 * `failure`, as a lost connection does.
 */
function held(matches: (method: string, path: string, body: string) => boolean) {
  let finish: ((failure?: Error) => void) | undefined;
  const call = {
    calls: 0,
    intercept: (inner: ClientFetch): ClientFetch =>
      (async (input, init) => {
        const path = new URL(String(input instanceof Request ? input.url : input), "http://x").pathname;
        if (!matches(init?.method ?? "GET", path, typeof init?.body === "string" ? init.body : "")) return inner(input, init);
        call.calls += 1;
        await new Promise<void>((resolve, reject) => {
          finish = (failure) => (failure ? reject(failure) : resolve());
        });
        return inner(input, init);
      }) as ClientFetch,
    settle: async (failure?: Error) => {
      await act(async () => finish?.(failure));
    },
  };
  return call;
}

/** The lab's host with the vendor scripts, and `call`'s calls held. */
const appHolding = (call: ReturnType<typeof held>): Promise<TestApp> => openTestApp({ scripts: vendorScripts().scripts, intercept: call.intercept });

const thread = () => screen.getByRole("main", { name: "Main thread" });
const card = (title: string) => within(thread()).getByRole("region", { name: `Task: ${title}` });
const button = (scope: HTMLElement, name: string | RegExp) => within(scope).getByRole("button", { name }) as HTMLButtonElement;

async function ask(text: string) {
  const box = await screen.findByLabelText("Message the main session", undefined, SLOW);
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

// A threads-mode session on a project, its lead filing three threads, one of them ready for review.
async function reviewReady(lab: TestApp) {
  render(lab.wrap(<App />));
  fireEvent.click(within(screen.getByRole("tablist", { name: "View" })).getByRole("tab", { name: "Projects" }));
  fireEvent.click(screen.getByRole("button", { name: "+ New session" }));
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" }, SLOW));
  await ask("Research three vendors for a status page, one thread each.");
  await waitFor(() => expect(card("Vendor C · summary").dataset.column).toBe("review"), SLOW);
  // Its accept is ready once the run's review has been read.
  await waitFor(() => expect((within(card("Vendor C · summary")).getByRole("button", { name: /^Resolve/ }) as HTMLButtonElement).disabled).toBe(false), SLOW);
}

/** A POST that answers a run's review: the review hold's answer goes to the run's own stop. */
const answersReview = (method: string, _path: string, body: string) => method === "POST" && body.includes('"verdict"');

describe("buttons that change something", () => {
  it("sends one review answer for a double click on a card's Resolve, and says so when it's refused", async () => {
    const resolve = held((method, path, body) => answersReview(method, path, body) && body.includes('"accepted"'));
    await reviewReady(await appHolding(resolve));
    const resolveButton = () => within(card("Vendor C · summary")).getByRole("button", { name: /^Resolv/ }) as HTMLButtonElement;
    fireEvent.click(resolveButton());
    fireEvent.click(resolveButton());
    await waitFor(() => expect(resolve.calls).toBe(1));
    expect(resolveButton().disabled).toBe(true);
    expect(resolveButton().textContent).toBe("Resolving…");

    await resolve.settle(new Error("the review was already answered"));
    expect(within(card("Vendor C · summary")).getByRole("alert").textContent).toBe("Couldn't resolve: the review was already answered");
    expect(card("Vendor C · summary").dataset.column).toBe("review");
    // It can be tried again, and the refusal clears when it is.
    expect(resolveButton().disabled).toBe(false);
    fireEvent.click(resolveButton());
    expect(within(card("Vendor C · summary")).queryByRole("alert")).toBeNull();
    await waitFor(() => expect(resolve.calls).toBe(2));
  });

  it("holds the review buttons in a task's view while one is on its way, and keeps your words when Request changes is refused", async () => {
    const requestChanges = held((method, path, body) => answersReview(method, path, body) && body.includes('"revise"'));
    await reviewReady(await appHolding(requestChanges));
    fireEvent.click(button(card("Vendor C · summary"), "Request changes"));
    const view = screen.getByRole("dialog", { name: "Task: Vendor C · summary" });
    const box = within(view).getByLabelText("Message this task") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Add the EU pricing." } });
    // The view reads the run's review for itself before its review buttons go live.
    await waitFor(() => expect(button(view, "Request changes").disabled).toBe(false), SLOW);
    fireEvent.click(button(view, "Request changes"));
    fireEvent.click(button(view, "Request changes"));
    await waitFor(() => expect(requestChanges.calls).toBe(1));
    expect(button(view, "Resolve").disabled).toBe(true);

    await requestChanges.settle(new Error("network down"));
    expect(within(view).getByRole("alert").textContent).toBe("Not sent: network down · Retry");
    expect(box.value).toBe("Add the EU pricing.");
    expect(button(view, "Request changes").disabled).toBe(false);
  });

  it("clears your line once a steer is taken, and keeps it with the refusal when it isn't", async () => {
    // A line in a thread with no open question is a steer on its task, through the board's own call.
    const sayInThread = held((method, path, body) => method === "POST" && path.endsWith("/actions/updateTask_tasks") && body.includes("Check the annual plan too."));
    await reviewReady(await appHolding(sayInThread));
    fireEvent.click(button(card("Vendor A · pricing and uptime"), "View task"));
    const view = screen.getByRole("dialog", { name: "Task: Vendor A · pricing and uptime" });
    const box = within(view).getByLabelText("Message this task") as HTMLTextAreaElement;
    const sendButton = () => within(view).getByRole("button", { name: /^(Send|Answer)$/ }) as HTMLButtonElement;

    fireEvent.change(box, { target: { value: "Check the annual plan too." } });
    fireEvent.click(sendButton());
    expect(sendButton().disabled).toBe(true);
    await waitFor(() => expect(sayInThread.calls).toBe(1));
    await sayInThread.settle(new Error("the task is gone"));
    expect(within(view).getByRole("alert").textContent).toBe("Not sent: the task is gone · Retry");
    expect(box.value).toBe("Check the annual plan too.");

    fireEvent.click(sendButton());
    expect(within(view).queryByRole("alert")).toBeNull();
    await waitFor(() => expect(sayInThread.calls).toBe(2));
    await sayInThread.settle();
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("says when a pin is refused, and leaves the task unpinned", async () => {
    const pin = held((method, path) => method !== "GET" && path.includes("lab-pins"));
    await reviewReady(await appHolding(pin));
    fireEvent.click(button(card("Vendor C · summary"), "View task"));
    const view = screen.getByRole("dialog", { name: "Task: Vendor C · summary" });
    fireEvent.click(button(view, "Pin"));
    fireEvent.click(button(view, "Pin"));
    await waitFor(() => expect(pin.calls).toBe(1));
    expect(button(view, "Pin").disabled).toBe(true);
    await pin.settle(new Error("pins are read only"));
    expect(within(view).getByRole("alert").textContent).toBe("Couldn't pin: pins are read only");
    expect(button(view, "Pin").getAttribute("aria-pressed")).toBe("false");
  });

  it("opens one session for a double click on a project, and stays on the picker saying why when it can't open", async () => {
    // Opening a session makes it on its worker's flow.
    const open = held((method, path) => method === "POST" && path.endsWith("/sessions"));
    const lab = await appHolding(open);
    render(lab.wrap(<App />));
    const picker = await screen.findByRole("region", { name: "Choose a project" });
    const project = await within(picker).findByRole("button", { name: "vendor-notes" }, SLOW);
    fireEvent.click(project);
    fireEvent.click(project);
    await waitFor(() => expect(open.calls).toBe(1));
    expect((project as HTMLButtonElement).disabled).toBe(true);

    await open.settle(new Error("not-a-member: vendor-notes"));
    expect(within(picker).getByRole("alert").textContent).toBe("Couldn't open the session: not-a-member: vendor-notes");
    expect(screen.queryByLabelText("Message the main session")).toBeNull();
    expect((project as HTMLButtonElement).disabled).toBe(false);
  });
  it("creates one project for a double submit, and keeps the form filled with the refusal when it can't", async () => {
    // The project is made by a send to the projects collection.
    const createProject = held((method, path, body) => method === "POST" && path.endsWith("/actions/createProject") && body.includes('"billing"'));
    const lab = await appHolding(createProject);
    render(lab.wrap(<App />));
    const form = await screen.findByRole("form", { name: "New project" });
    fireEvent.change(within(form).getByLabelText("Project name"), { target: { value: "billing" } });
    fireEvent.change(within(form).getByLabelText("Repository"), { target: { value: `file://${lab.repo}` } });
    const create = button(form, "Create project");
    fireEvent.click(create);
    fireEvent.click(create);
    // The repository is checked first, so the create starts a tick later; still once.
    await waitFor(() => expect(createProject.calls).toBe(1), SLOW);
    expect(create.disabled).toBe(true);

    await createProject.settle(new Error("repository not found"));
    expect(within(form).getByRole("alert").textContent).toBe("repository not found");
    expect((within(form).getByLabelText("Project name") as HTMLInputElement).value).toBe("billing");
    expect(create.disabled).toBe(false);
  });
});
