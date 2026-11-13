/**
 * The *Copy page* control on a docs page: copies the page's Markdown, the same file served at
 * its URL plus `.md`, so a reader can paste the page into a chat with a coding agent.
 *
 * The Markdown is written by the build (`scripts/agent-docs`), so under `docusaurus start`
 * there is none to fetch and the control says it couldn't copy.
 */
import type { ReactElement } from "react";
import { useState } from "react";
import { useDoc } from "@docusaurus/plugin-content-docs/client";
import { markdownUrl } from "@site/scripts/agent-docs/index-files.mjs";

type State = "idle" | "copied" | "failed";

const LABEL: Record<State, string> = { idle: "Copy page", copied: "Copied", failed: "Couldn't copy" };

async function fetchMarkdown(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

/** Copies `url`'s text. Safari allows the write only inside the click, so it is handed the pending fetch. */
async function copyFrom(url: string): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    const text = fetchMarkdown(url).then((t) => new Blob([t], { type: "text/plain" }));
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": text })]);
  } else {
    await navigator.clipboard.writeText(await fetchMarkdown(url));
  }
}

/** A button that copies this docs page as Markdown. */
export default function CopyPage(): ReactElement {
  const { metadata } = useDoc();
  const [state, setState] = useState<State>("idle");
  const url = markdownUrl(metadata.permalink);
  const copy = () => {
    copyFrom(url).then(
      () => setState("copied"),
      () => setState("failed"),
    );
    setTimeout(() => setState("idle"), 2000);
  };
  return (
    <div className="copy-page">
      <button type="button" className="copy-page__button label" onClick={copy} aria-live="polite">
        {LABEL[state]}
      </button>
    </div>
  );
}
