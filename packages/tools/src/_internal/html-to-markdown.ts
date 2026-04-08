import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

export interface ParsedPage {
  title: string;
  markdown: string;
  wordCount: number;
}

export function htmlToMarkdown(html: string, _url: string): ParsedPage {
  const { document } = parseHTML(html);

  const reader = new Readability(document as any);
  const article = reader.parse();

  if (!article) {
    const body = document.querySelector("body");
    const markdown = body ? turndown.turndown(body.innerHTML) : "";
    return {
      title: document.title ?? "",
      markdown,
      wordCount: markdown.split(/\s+/).filter(Boolean).length,
    };
  }

  const markdown = turndown.turndown(article.content ?? "");
  return {
    title: article.title ?? document.title ?? "",
    markdown,
    wordCount: markdown.split(/\s+/).filter(Boolean).length,
  };
}
