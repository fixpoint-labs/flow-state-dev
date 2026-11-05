/**
 * Lay the scrolling feeds out as a browser would (happy-dom lays nothing out): the main thread's
 * list and a sheet's body, each 5000px of content in a 500px view, or
 * `height(feed)` px for a test whose content must grow. Every scroll they are asked
 * for is recorded with how it moves, and lands at once. Undone by the returned function.
 */
export function layOutFeeds(height: (feed: HTMLElement) => number = () => 5000) {
  const isFeed = (el: HTMLElement) =>
    el.classList.contains("overflow-y-auto") &&
    (el.parentElement?.getAttribute("aria-label") === "Main thread" || el.parentElement?.getAttribute("role") === "dialog");
  const names = ["scrollHeight", "clientHeight", "scrollTop", "scrollTo"] as const;
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const);
  const tops = new WeakMap<HTMLElement, number>();
  const scrolls: { feed: HTMLElement; behavior: ScrollBehavior | undefined }[] = [];
  Object.defineProperties(HTMLElement.prototype, {
    scrollHeight: { configurable: true, get(this: HTMLElement) { return isFeed(this) ? height(this) : 0; } },
    clientHeight: { configurable: true, get(this: HTMLElement) { return isFeed(this) ? 500 : 0; } },
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) { return tops.get(this) ?? 0; },
      set(this: HTMLElement, value: number) { tops.set(this, isFeed(this) ? Math.max(0, Math.min(value, height(this) - 500)) : 0); },
    },
    scrollTo: {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        if (isFeed(this)) scrolls.push({ feed: this, behavior: options.behavior });
        this.scrollTop = options.top ?? 0;
      },
    },
  });
  const restore = () => {
    for (const [name, was] of saved) {
      if (was === undefined) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
      else Object.defineProperty(HTMLElement.prototype, name, was);
    }
  };
  return { scrolls, restore };
}
