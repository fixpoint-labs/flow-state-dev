import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../../src/_internal/html-to-markdown";

describe("htmlToMarkdown", () => {
  it("extracts article content from a full HTML page", () => {
    const html = `
      <html>
        <head><title>Test Page</title></head>
        <body>
          <nav><a href="/">Home</a> <a href="/about">About</a></nav>
          <article>
            <h1>Main Article</h1>
            <p>This is the main content of the article with enough text for Readability to detect it as the primary content. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
            <p>Another paragraph with more content to ensure Readability picks this up as the main article body.</p>
          </article>
          <footer><p>Copyright 2026</p></footer>
        </body>
      </html>
    `;

    const result = htmlToMarkdown(html, "https://example.com/test");

    expect(result.title).toBeTruthy();
    expect(result.markdown).toContain("main content");
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it("handles minimal HTML with no article structure", () => {
    const html = `
      <html>
        <head><title>Simple</title></head>
        <body>
          <p>Hello world</p>
        </body>
      </html>
    `;

    const result = htmlToMarkdown(html, "https://example.com");

    expect(result.markdown).toContain("Hello world");
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it("preserves code blocks", () => {
    const html = `
      <html>
        <head><title>Code Example</title></head>
        <body>
          <article>
            <h1>Code Example</h1>
            <p>This article has a code block that should be preserved in the markdown output. It is important for documentation sites.</p>
            <pre><code>function hello() {
  console.log("world");
}</code></pre>
            <p>More content after the code block to make Readability happy with the article length and detection.</p>
          </article>
        </body>
      </html>
    `;

    const result = htmlToMarkdown(html, "https://example.com");

    expect(result.markdown).toContain("hello()");
  });

  it("preserves headings as markdown ATX style", () => {
    const html = `
      <html>
        <head><title>Headings</title></head>
        <body>
          <article>
            <h1>Top Level Heading</h1>
            <p>Some introductory text that is long enough for Readability to pick up. Lorem ipsum dolor sit amet.</p>
            <h2>Second Level</h2>
            <p>More paragraph text under the second heading to give enough content for extraction.</p>
          </article>
        </body>
      </html>
    `;

    const result = htmlToMarkdown(html, "https://example.com");

    // ATX-style headings
    expect(result.markdown).toMatch(/#+\s+.*Heading|#+\s+.*Level/);
  });

  it("handles empty HTML gracefully", () => {
    const html = `<html><head></head><body></body></html>`;

    const result = htmlToMarkdown(html, "https://example.com");

    expect(result.title).toBe("");
    expect(result.markdown).toBe("");
    expect(result.wordCount).toBe(0);
  });

  it("returns word count correctly", () => {
    const html = `
      <html>
        <head><title>Count Test</title></head>
        <body><p>one two three four five</p></body>
      </html>
    `;

    const result = htmlToMarkdown(html, "https://example.com");

    expect(result.wordCount).toBe(5);
  });
});
