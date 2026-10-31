"use client";

/**
 * What a coding run changed: "Files changed (+a −d)", which opens into each
 * file's added and removed lines and, a file at a time, its patch.
 *
 * Takes plain data, so it renders whatever read supplied it: a run review's
 * stop data carries the files (harness-manager's `files`, `added`, `removed`),
 * and `loadPatch` is the app's call to the `changes` read for one file
 * (harness-manager's `harnessRunChangesRead`, or a session turn's `changes`).
 * A patch is read when its file is opened, never before, and kept once read.
 *
 * Draws nothing for a run whose changes couldn't be read (`files: null`):
 * the caller says that in its own words, since "no files" would be a claim.
 */

import { ChevronRightIcon, FileIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** One file a run changed. `added`/`removed` are `null` for a binary file. */
export type RunChangesFile = { path: string; added: number | null; removed: number | null };

/** One file's patch, as the app's read answered it. */
export type RunChangesPatch = { patch: string; truncated: boolean };

export interface RunChangesProps {
  /** The files the run changed, or `null` when they couldn't be read. */
  files: RunChangesFile[] | null;
  /** How many files changed, when more were changed than `files` lists. Default `files.length`. */
  fileCount?: number;
  /** Lines added across every file. Default: the sum over `files`. */
  added?: number;
  /** Lines removed across every file. Default: the sum over `files`. */
  removed?: number;
  /** Reads one file's patch. Absent, files list their lines and don't open. */
  loadPatch?: (path: string) => Promise<RunChangesPatch>;
  /** Start with the file list open. Default `false`. */
  defaultOpen?: boolean;
  className?: string;
}

const sum = (files: RunChangesFile[], key: "added" | "removed") => files.reduce((n, file) => n + (file[key] ?? 0), 0);

/** The `+a −d` pair, in the success and destructive tokens. A binary file reads "binary". */
function LineCounts({ added, removed }: { added: number | null; removed: number | null }) {
  if (added === null || removed === null) return <span className="text-muted-foreground">binary</span>;
  return (
    <span className="tabular-nums">
      <span className="text-success">+{added}</span> <span className="text-destructive">−{removed}</span>
    </span>
  );
}

/** A unified diff, each line in the token for what it does. */
function Patch({ patch }: { patch: RunChangesPatch }) {
  if (patch.patch === "") return <p className="px-3 py-2 text-muted-foreground text-xs">No changes to show.</p>;
  return (
    <div className="overflow-x-auto border-t bg-muted/40">
      <pre className="px-3 py-2 font-mono text-xs leading-5">
        {patch.patch.split("\n").map((line, i) => (
          <div
            key={i}
            className={cn(
              line.startsWith("+") && !line.startsWith("+++") && "text-success",
              line.startsWith("-") && !line.startsWith("---") && "text-destructive",
              (line.startsWith("@@") || line.startsWith("diff ") || line.startsWith("index ")) && "text-muted-foreground",
            )}
          >
            {line === "" ? " " : line}
          </div>
        ))}
      </pre>
      {patch.truncated ? <p className="px-3 pb-2 text-muted-foreground text-xs">The patch is cut here; it is longer than one read holds.</p> : null}
    </div>
  );
}

type PatchState = { status: "loading" } | { status: "ready"; patch: RunChangesPatch } | { status: "failed"; message: string };

/** One changed file: its path and lines, opening into its patch when the app can read one. */
function FileRow({ file, loadPatch }: { file: RunChangesFile; loadPatch?: RunChangesProps["loadPatch"] }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PatchState | null>(null);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || loadPatch === undefined || (state !== null && state.status !== "failed")) return;
    setState({ status: "loading" });
    loadPatch(file.path).then(
      (patch) => setState({ status: "ready", patch }),
      (error: unknown) => setState({ status: "failed", message: error instanceof Error ? error.message : String(error) }),
    );
  };
  const opens = loadPatch !== undefined;
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", opens ? "hover:bg-muted/50" : "cursor-default")}
        onClick={opens ? toggle : undefined}
        aria-expanded={opens ? open : undefined}
        disabled={!opens}
      >
        {opens ? (
          <ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        ) : (
          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
        <span className="shrink-0 text-xs">
          <LineCounts added={file.added} removed={file.removed} />
        </span>
      </button>
      {open && state !== null ? (
        state.status === "loading" ? (
          <p className="border-t px-3 py-2 text-muted-foreground text-xs">Reading the patch…</p>
        ) : state.status === "failed" ? (
          <p className="border-t px-3 py-2 text-destructive text-xs">The patch couldn't be read: {state.message}</p>
        ) : (
          <Patch patch={state.patch} />
        )
      ) : null}
    </li>
  );
}

/**
 * "Files changed (+a −d)", opening into each file and, through `loadPatch`,
 * its patch.
 */
export function RunChanges({ files, fileCount, added, removed, loadPatch, defaultOpen = false, className }: RunChangesProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (files === null) return null;
  const count = fileCount ?? files.length;
  const unlisted = count - files.length;
  return (
    <div className={cn("rounded-md border text-sm", className)}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="font-medium">
          {count === 1 ? "1 file changed" : `${count} files changed`}
        </span>
        <span className="text-xs">
          (<LineCounts added={added ?? sum(files, "added")} removed={removed ?? sum(files, "removed")} />)
        </span>
      </button>
      {open ? (
        <ul className="border-t">
          {files.map((file) => (
            <FileRow key={file.path} file={file} loadPatch={loadPatch} />
          ))}
          {unlisted > 0 ? (
            <li className="px-3 py-1.5 text-muted-foreground text-xs">and {unlisted} more {unlisted === 1 ? "file" : "files"}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
