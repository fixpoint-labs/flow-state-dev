// @vitest-environment happy-dom
/**
 * The shell against a real Lab, in a DOM (V2, V3's second path, V6; BR-14,
 * BR-28). What the screen draws is compared with what the Lab's routes hold.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { App } from "../src/App";
import { Composer } from "../src/surfaces/Stream";
import type { BoardRow } from "../src/lib/reads";
import { GAPS } from "../src/gaps";
import { bootShift } from "../src/lib/shift";
import { createLabClients } from "../src/lib/connection";
import { ASKER_GATED_LINE, ASKER_REFUSED_LINE, ASKER_SLOW_LINE, heardLine, holdSlowLines, startProjectLine } from "./fixtures/ask-lab/asker.mts";
import { ASK_LAB_USER_ID, openAskLab } from "./fixtures/ask-lab/lab.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const served: ServedLab[] = [];
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await Promise.all(served.splice(0).map((lab) => lab.handle.close()));
});

async function openApp(path: string, options: Parameters<typeof openAskLab>[0] = {}, bearerToken?: string) {
  const lab = await serveLab((await openAskLab(options)).flowState);
  served.push(lab);
  // The page is served from the Lab's own origin, as the `shift-manager` command serves it.
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}${path}`);
  const clients = createLabClients({ userId: ASK_LAB_USER_ID, ...(bearerToken === undefined ? {} : { bearerToken }) });
  render(<App clients={clients} />);
  return { lab, clients };
}

describe("the sidebar's mark", () => {
  it("is the one theme control: it shows the shift the page is in, and each click moves to the next", async () => {
    const lab = await serveLab((await openAskLab()).flowState);
    served.push(lab);
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${lab.baseUrl}/inbox`);
    // Storage that keeps nothing and a clock at 21:00: the page opens on Night.
    const look = bootShift(undefined, { localStorage: { getItem: () => null, setItem: () => {} } } as unknown as Window, document.documentElement, () => new Date(2026, 9, 6, 21, 0));
    try {
      render(<App clients={createLabClients({ userId: ASK_LAB_USER_ID })} look={look} />);
      const mark = await screen.findByTestId("shift-mark");
      // The sidebar can commit before its passive effects run, and the mark
      // subscribes to the look in one. Flush them, so the first click can't
      // land before the mark is listening.
      await act(async () => {});
      expect(screen.queryByTestId("shift-switch")).toBeNull();
      expect(document.documentElement.dataset.shift).toBe("night");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(mark.getAttribute("title")).toBe("Theme: Night. Click for Day.");
      expect(screen.getByTestId("sidebar-shift-name").textContent).toMatch(/Night shift$/);

      act(() => fireEvent.click(mark));
      expect(document.documentElement.dataset.shift).toBe("day");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(screen.getByTestId("sidebar-shift-name").textContent).toMatch(/Day shift$/);

      act(() => fireEvent.click(mark));
      expect(document.documentElement.dataset.shift).toBe("evening");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(mark.getAttribute("data-shift")).toBe("evening");
      expect(screen.getByTestId("sidebar-shift-name").textContent).toMatch(/Evening shift$/);
    } finally {
      look.stop();
      document.documentElement.classList.remove("dark", "shift-fade");
      delete document.documentElement.dataset.shift;
    }
  });
});
