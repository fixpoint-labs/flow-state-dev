// @vitest-environment happy-dom
/**
 * A teammate's replies run on one model, and coding tasks on a harness: two
 * different choices, so the composer offers them as two pickers. A reply on a
 * model with no key or gateway fails only once it's sent, so the picker shows
 * where each model's calls would go and won't take one that can't go anywhere.
 * A pick must reach the teammate's settings, which the next reply reads. Each
 * case fails if a route or reason stops showing, an unreachable model can be
 * picked, or a pick stops reaching the save.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withModelRoutes } from "../flows/lab-context.mts";
import { Composer } from "../src/components/Composer";
import { shortModelName } from "../src/components/ReplyModelPicker";

afterEach(cleanup);

const CHOICES = [
  { id: "openai/gpt-6-luna", available: true, via: "Vercel AI Gateway" },
  { id: "anthropic/claude-opus-5-5", available: true, via: "anthropic key" },
  { id: "xai/grok-5", available: false, reason: "no key or gateway for xai" },
];

const open = (onPickModel = vi.fn(async () => {}), current = "openai/gpt-6-luna") => {
  render(
    <Composer sessionId="s1" workerName="Lead" running={false} onStop={() => {}} onSend={vi.fn(async () => {})} replyModel={current} models={CHOICES} onPickModel={onPickModel} />,
  );
  return onPickModel;
};

describe("Respond with", () => {
  it("shows the teammate's reply model and its route, apart from where coding tasks start", () => {
    open();
    const picker = screen.getByRole("button", { name: "Respond with gpt-6-luna · via Vercel AI Gateway" });
    expect(picker.title).toContain("Lead's own replies run on this model");
  });

  it("lists every model with its route, and an unreachable one with why, which can't be picked", () => {
    const onPick = open();
    fireEvent.click(screen.getByRole("button", { name: /^Respond with/ }));
    const menu = screen.getByRole("menu", { name: "Reply with" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["gpt-6-lunavia Vercel AI Gateway", "claude-opus-5-5via anthropic key", "grok-5no key or gateway for xai"]);
    expect(items[2]!.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(items[2]!);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("saves a pick to the teammate", async () => {
    const onPick = open();
    fireEvent.click(screen.getByRole("button", { name: /^Respond with/ }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Reply with" })).getByText("claude-opus-5-5"));
    expect(onPick).toHaveBeenCalledWith("anthropic/claude-opus-5-5");
  });

  it("says so when the save is refused, rather than showing the pick as saved", async () => {
    open(vi.fn(async () => { throw new Error("no"); }));
    fireEvent.click(screen.getByRole("button", { name: /^Respond with/ }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Reply with" })).getByText("claude-opus-5-5"));
    await waitFor(() => expect(screen.getByText("not saved")).toBeTruthy());
    expect(screen.getByRole("button", { name: /^Respond with gpt-6-luna/ })).toBeTruthy();
  });

  it("still shows a teammate's own model the lab's list doesn't name", () => {
    open(undefined, "openai/gpt-6-sol");
    expect(screen.getByRole("button", { name: "Respond with gpt-6-sol" })).toBeTruthy();
  });

  it("reads a model by its name alone, whatever its provider or route", () => {
    expect(shortModelName("openrouter:openai/gpt-6-sol")).toBe("gpt-6-sol");
    expect(shortModelName("vercel:gpt-6-luna")).toBe("gpt-6-luna");
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
