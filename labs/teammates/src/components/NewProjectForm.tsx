import { useState } from "react";
import type { NewProject } from "../adapter";
import { useSubmit } from "../lib/use-submit";

/** A slug from a title: lowercase words joined by `-`. */
const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Create a project: a name, and the folder its code lives in, a git checkout
 * on the server's machine. The folder is optional; without one, coding work
 * has no repository to run in. A refusal shows under the form.
 */
export function NewProjectForm({ onCreate, onCancel }: { onCreate: (project: NewProject) => Promise<void>; onCancel?: () => void }) {
  const [title, setTitle] = useState("");
  const [checkout, setCheckout] = useState("");
  const id = slugOf(title);
  const { error, busy, submit } = useSubmit(() =>
    onCreate({ id, title: title.trim(), ...(checkout.trim() === "" ? {} : { checkout: checkout.trim() }) }),
  );

  return (
    <form aria-label="New project" onSubmit={(e) => void submit(e)} className="flex flex-wrap items-center gap-2 text-xs">
      <input
        aria-label="Project name"
        placeholder="Name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-32 rounded-sm border border-border bg-card px-2 py-1"
      />
      <input
        aria-label="Project folder"
        placeholder="/absolute/path/to/a/git/checkout"
        value={checkout}
        onChange={(e) => setCheckout(e.target.value)}
        className="min-w-48 flex-1 rounded-sm border border-border bg-card px-2 py-1 font-mono"
      />
      <button type="submit" disabled={busy || id === ""} className="rounded-sm bg-primary px-2 py-1 font-semibold text-primary-foreground disabled:opacity-40">
        Create project
      </button>
      {onCancel ? (
        <button type="button" onClick={onCancel} className="rounded-sm border border-border px-2 py-1 hover:bg-accent">
          Cancel
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="basis-full text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
