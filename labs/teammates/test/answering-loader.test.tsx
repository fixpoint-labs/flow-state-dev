// @vitest-environment happy-dom
/**
 * The "is answering" loader: a reply draws one of six moves at random, keeps
 * it for the whole reply (the bubble comes and goes as answer text starts and
 * a later step begins), and the next reply draws again. The loader is
 * decorative, its colours are the theme's tokens, and it holds still under
 * reduced motion.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationView } from "../src/lib/conversation";
import { AnsweringLoader, LOADERS, pickLoader, useLoaderPerReply, type LoaderVariant } from "../src/components/AnsweringLoader";
import { Conversation } from "../src/components/Conversation";
import { lookOf } from "../src/lib/looks";
import { call, linesOf, message, parked } from "./lines";
import { rosterEntry } from "./scripted-server";
import { standInFollower, TestProvider } from "./stub-server";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A `random` that returns the draw landing on `variant`, then the next ones in order. */
const drawing = (...variants: LoaderVariant[]) => {
  const queue = variants.map((v) => (LOADERS.indexOf(v) + 0.5) / LOADERS.length);
  return vi.fn(() => queue.shift() ?? 0);
};

describe("picking a loader", () => {
  it("can land on every one of the six, and only on them", () => {
    const seen = new Set<LoaderVariant>();
    for (let i = 0; i < 600; i++) seen.add(pickLoader());
    expect([...seen].sort()).toEqual([...LOADERS].sort());
    expect(LOADERS).toHaveLength(6);
    // The ends of [0, 1) stay inside the list.
    expect(pickLoader(() => 0)).toBe("bounce");
    expect(pickLoader(() => 0.999999)).toBe("gather");
  });

  it("draws once when a reply starts, keeps it through every redraw, and draws again for the next reply", () => {
    const random = drawing("orbit", "chase");
    const hook = renderHook(({ replying }) => useLoaderPerReply(replying, random), { initialProps: { replying: false } });
    expect(hook.result.current).toBeUndefined();
    expect(random).not.toHaveBeenCalled();

    hook.rerender({ replying: true });
    expect(hook.result.current).toBe("orbit");
    for (let i = 0; i < 5; i++) hook.rerender({ replying: true });
    expect(hook.result.current).toBe("orbit");
    expect(random).toHaveBeenCalledTimes(1);

    hook.rerender({ replying: false });
    expect(hook.result.current).toBeUndefined();
    hook.rerender({ replying: true });
    expect(hook.result.current).toBe("chase");
  });
});

describe("the answering bubble's loader", () => {
  const worker = rosterEntry({ id: "lead", name: "Lead", description: "Coordinates work" });
  const read = call("read", "r1", "readProjectSource", { path: "a file" }, "in_progress");
  const shown = (initial: ConversationView) => {
    const follower = standInFollower("s1", initial);
    const view = render(
      <TestProvider>
        <follower.Follower />
        <Conversation worker={worker} sessionId="s1" nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => false} onFire={async () => {}} onOpen={() => {}} />
      </TestProvider>,
    );
    const bubble = () => view.container.querySelector("[data-chat-activity]");
    const loader = () => bubble()?.querySelector("[data-loader]");
    return { ...follower, bubble, loader };
  };

  it("sits left of the words, hidden from assistive tech, and stays the same for the whole reply", () => {
    vi.spyOn(Math, "random").mockImplementation(drawing("juggle", "gather", "bounce"));
    const turn: ConversationView = { lines: linesOf([read]), running: true, stopping: false, backgroundRunning: 0 };
    const { show, bubble, loader } = shown(turn);

    expect(loader()?.getAttribute("data-loader")).toBe("juggle");
    expect(loader()?.getAttribute("aria-hidden")).toBe("true");
    expect(bubble()?.firstElementChild).toBe(loader());
    // The words still say who is answering; the loader adds none.
    expect(bubble()?.textContent).toBe("Lead · reading a file…");

    // Answer text starts (the bubble goes), then a later step brings it back: the same loader.
    act(() => show({ ...turn, lines: linesOf([read, message("a", "r1", "assistant", "Looking", "in_progress")]) }));
    expect(bubble()).toBeNull();
    act(() => show({ ...turn, lines: linesOf([read, message("a", "r1", "assistant", "Looking", "completed"), call("edit", "r1", "edit_file", {}, "in_progress")]) }));
    expect(loader()?.getAttribute("data-loader")).toBe("juggle");

    // The next reply draws again.
    act(() => show({ ...turn, running: false }));
    expect(bubble()).toBeNull();
    act(() => show({ ...turn, lines: linesOf([message("u", "r2", "user", "and now?")]) }));
    expect(loader()?.getAttribute("data-loader")).toBe("gather");
  });

  it("gives way to the highlighter while the turn waits on you", () => {
    const { bubble, loader } = shown({ lines: linesOf([parked("read", "r1", "readProjectSource")]), running: true, stopping: false, backgroundRunning: 0 });
    expect(bubble()?.textContent).toBe("Lead · waiting on you…");
    expect(loader()).toBeNull();
  });

  it("draws three dots, one of them blue, for every move", () => {
    for (const variant of LOADERS) {
      const view = render(<AnsweringLoader variant={variant} />);
      expect(view.container.querySelectorAll(".ld-dot, .ld-ball")).toHaveLength(3);
      expect(view.container.querySelectorAll(".ld-live")).toHaveLength(1);
      cleanup();
    }
  });
});

describe("the loader's styles", () => {
  const css = readFileSync(join(__dirname, "../src/styles.css"), "utf8");
  const theme = readFileSync(join(__dirname, "../src/lib/theme.css"), "utf8");
  const loaderCss = css.slice(css.indexOf(".ld-stage"));

  it("colour the dots from the theme's tokens, which both Paper and Night set", () => {
    expect(loaderCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const used = [...new Set([...loaderCss.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]!))];
    expect(used.sort()).toEqual(["--blue", "--ink", "--line3"]);
    for (const name of ["paper", "night"]) {
      const block = theme.slice(theme.indexOf(`:root[data-theme="${name}"]`));
      const own = block.slice(0, block.indexOf("}"));
      for (const token of used) expect(own, `${name} sets ${token}`).toContain(`${token}:`);
    }
  });

  it("hold every dot still under reduced motion", () => {
    expect(loaderCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ld-stage \* \{ animation-play-state: paused !important; \}/);
  });
});
