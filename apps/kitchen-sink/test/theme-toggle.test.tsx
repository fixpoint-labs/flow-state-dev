// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppThemeProvider } from "../components/theme-provider";
import { ThemeToggle } from "../components/theme-toggle";

const root = () => document.documentElement;

function mount(stored: "light" | "dark") {
  localStorage.setItem("theme", stored);
  render(
    <AppThemeProvider>
      <ThemeToggle />
    </AppThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  root().className = "";
  root().removeAttribute("data-theme");
});
afterEach(cleanup);

describe("the theme toggle", () => {
  it("paints light as the Draft stock, not plain day", () => {
    mount("light");
    expect(root().getAttribute("data-theme")).toBe("evening");
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("flips light to dark and back with one press each", async () => {
    mount("light");
    await act(async () => fireEvent.click(screen.getByTestId("theme-toggle")));
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(screen.getByTestId("theme-toggle").getAttribute("aria-label")).toBe("Switch to light theme");

    await act(async () => fireEvent.click(screen.getByTestId("theme-toggle")));
    expect(root().classList.contains("dark")).toBe(false);
    expect(root().getAttribute("data-theme")).toBe("evening");
  });
});
