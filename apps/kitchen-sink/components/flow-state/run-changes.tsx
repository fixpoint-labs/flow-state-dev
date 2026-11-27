"use client";

/**
 * What a coding run changed: "Files changed (+a −d)", which opens into each
 * file's added and removed lines and, a file at a time, its patch.
 *
 * Takes plain data, so it renders whatever read supplied it: a run review's
 * stop data carries the files (harness-manager's `files`, `added`, `removed`),
 * and `loadPatch` is the app's call to the `changes` view for one file
 * (harness-manager's `harnessRunChangesView`, or a session turn's `changes`).
 * A patch is read when its file is opened, never before, and kept once read.
 * Several files can be open at once. A binary, deleted or renamed file opens
 * to one line saying so; a cut patch says how long the whole one is.
 *
 * Draws nothing for a run whose changes couldn't be read (`files: null`):
 * the caller says that in its own words, since "no files" would be a claim.
 */

import { ChevronRightIcon, FileIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** One file a run changed. `added`/`removed` are `null` for a binary file. */
export type RunChangesFile = { path: string; added: number | null; removed: number | null };

/**
 * One file's patch, as the app's read answered it. `verified: false` means
 * git couldn't read it (the checkout is gone, say): the file says the diff is
 * no longer available and reads again when reopened, rather than claiming it
 * has no changes. `lines` is the whole patch's length when it was cut.
 */
export type RunChangesPatch = { patch: string; truncated: boolean; lines?: number; verified?: boolean };

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

/** What a patch's header says about its file, when that is all there is to say: binary, deleted or renamed. */
function fileNote(lines: string[]): string | null {
  const first = lines.findIndex((line) => line.startsWith("@@"));
  const header = first < 0 ? lines : lines.slice(0, first);
  if (header.some((line) => line.startsWith("Binary files ") || line === "GIT binary patch")) return "Binary file: no lines to show.";
  if (header.some((line) => line.startsWith("deleted file mode"))) return "File deleted.";
  const renamed = header.find((line) => line.startsWith("rename from "));
  return renamed === undefined ? null : `Renamed from ${renamed.slice("rename from ".length)}.`;
}

/** One line of a unified diff, tinted by what it does: added, removed, or a hunk header. */
function lineTone(line: string): string | undefined {
  if (line.startsWith("@@")) return "bg-muted text-muted-foreground";
  if (line.startsWith("+")) return "bg-success/10 text-success";
  if (line.startsWith("-")) return "bg-destructive/10 text-destructive";
  return undefined;
}

/**
 * A unified diff from its first hunk, each line in the token for what it
 * does. Long lines scroll sideways inside the diff, never the page.
 */
function Patch({ patch }: { patch: RunChangesPatch }) {
  if (patch.patch === "") return <p className="border-t px-3 py-2 text-muted-foreground text-xs">No changes to show.</p>;
  const lines = patch.patch.split("\n");
  const note = fileNote(lines);
  if (note !== null) return <p className="border-t px-3 py-2 text-muted-foreground text-xs">{note}</p>;
  const first = lines.findIndex((line) => line.startsWith("@@"));
  const body = first < 0 ? lines : lines.slice(first);
  return (
    <div className="border-t bg-muted/40">
      {patch.truncated ? (
        <p className="border-b px-3 py-1.5 text-muted-foreground text-xs">
          Diff too large{patch.lines === undefined ? "" : `, ${patch.lines.toLocaleString()} lines`}: showing the start.
        </p>
      ) : null}
      <div className="max-w-full overflow-x-auto">
        <pre className="w-max min-w-full py-1 font-mono text-xs leading-5">
          {body.map((line, i) => (
            <div key={i} className={cn("px-3", lineTone(line))}>
              {line === "" ? " " : line}
            </div>
          ))}
        </pre>
      </div>
      {patch.truncated ? <p className="border-t px-3 py-1.5 text-muted-foreground text-xs">The diff is cut here.</p> : null}
    </div>
  );
}

type PatchState =
  | { status: "loading" }
  | { status: "ready"; patch: RunChangesPatch }
  | { status: "gone" }
  | { status: "failed"; message: string };

/** One changed file: its path and lines, opening into its patch when the app can read one. */
function FileRow({ file, loadPatch }: { file: RunChangesFile; loadPatch?: RunChangesProps["loadPatch"] }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PatchState | null>(null);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Read once per file: a patch that was read is kept; one that failed or was gone reads again.
    if (!next || loadPatch === undefined || (state !== null && (state.status === "loading" || state.status === "ready"))) return;
    setState({ status: "loading" });
    loadPatch(file.path).then(
      (patch) => setState(patch.verified === false ? { status: "gone" } : { status: "ready", patch }),
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
        ) : state.status === "gone" ? (
          <p className="border-t px-3 py-2 text-muted-foreground text-xs">Diff no longer available.</p>
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
