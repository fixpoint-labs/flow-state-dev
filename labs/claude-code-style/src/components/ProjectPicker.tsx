import { useSubmit } from "@flow-state-dev/react";
import { useState } from "react";
import type { HarnessRow, ProjectRow, RepositoryCheck } from "../adapter";
import { PICKER_COPY, repositoryDisclosure } from "../lib/first-run";
import type { ModeId } from "../modes";
import { HarnessReadiness } from "./flow-state/harness-readiness";

/**
 * *New session*'s question (spec D3): which project the session works in.
 * It asks before the composer opens and has no default, so a coding run never
 * lands in a repository nobody chose. *New project* adds one: a name and the
 * repository its coding runs clone. Picking is held while the session opens,
 * and creating while the project is made, so a second click can't do either twice;
 * a refusal says so here.
 *
 * A first run reads here too (FIX-2403): what the view does, which coding
 * harnesses can run on this machine, and, as you leave the repository field,
 * whether a run could use it and what happens to it. Create stays off while the
 * server's check says no; the server refuses the same project in the same words.
 */
export function ProjectPicker({
  mode,
  projects,
  harnesses,
  onRecheck,
  onCheckRepository,
  onPick,
  onCreate,
}: {
  mode: ModeId;
  projects: ProjectRow[];
  /** The coding harnesses' readiness, or `undefined` while it is read. */
  harnesses: HarnessRow[] | undefined;
  onRecheck: () => Promise<unknown>;
  onCheckRepository: (repository: string) => Promise<RepositoryCheck>;
  onPick: (project: ProjectRow) => Promise<void>;
  onCreate: (name: string, repository: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [repository, setRepository] = useState("");
  // The server's answer for the repository as it was when asked; a later edit makes it stale.
  const [checked, setChecked] = useState<{ repository: string; answer: RepositoryCheck }>();
  const pick = useSubmit(onPick);
  const check = useSubmit(async (value: string) => {
    const answer = await onCheckRepository(value);
    setChecked({ repository: value, answer });
  });
  const create = useSubmit(async () => {
    const value = repository.trim();
    const answer = checked?.repository === value ? checked.answer : await onCheckRepository(value);
    if (checked?.repository !== value) setChecked({ repository: value, answer });
    if (!answer.usable) return;
    await onCreate(name.trim(), value);
    setName("");
    setRepository("");
    setChecked(undefined);
  });
  const current = checked !== undefined && checked.repository === repository.trim() ? checked.answer : undefined;
  return (
    <main aria-label="Main thread" className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center px-6">
      <section aria-label="Choose a project" className="w-full max-w-sm">
        <h1 className="text-sm font-semibold">Choose a project</h1>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="picker-copy">
          {PICKER_COPY[mode]} The session works in the project's checkout, and so does every task it starts.
        </p>
        <HarnessReadiness rows={harnesses} recheck={onRecheck} className="mt-3" />
        <ul className="mt-4 flex flex-col gap-2">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                disabled={pick.busy}
                onClick={() => void pick.submit(undefined, project)}
                className="rounded-md w-full border border-border bg-background px-3 py-2 text-left font-mono text-sm hover:bg-accent disabled:opacity-50"
              >
                {project.name}
              </button>
            </li>
          ))}
        </ul>
        {pick.error === undefined ? null : (
          <p role="alert" className="mt-2 text-xs text-destructive">
            Couldn't open the session: {pick.error}
          </p>
        )}
        <form aria-label="New project" onSubmit={(event) => void create.submit(event)} className="mt-6 flex flex-col gap-2">
          <h2 className="text-xs font-semibold">New project</h2>
          <input
            aria-label="Project name"
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <input
            aria-label="Repository"
            placeholder="file:///path/to/repo"
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            onBlur={() => {
              const value = repository.trim();
              // A refusal is asked again: the person may have fixed the repository since.
              if (value !== "" && (checked?.repository !== value || !checked.answer.usable)) void check.submit(undefined, value);
            }}
            className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
          />
          <p className="text-[11px] text-muted-foreground">A git repository on this machine, as a file:// address. Its committed .gitignore must ignore .fsdev/.</p>
          {current === undefined ? null : current.usable ? (
            <p className="text-[11px] text-muted-foreground" data-testid="repository-disclosure">
              {repositoryDisclosure(current.how)}
            </p>
          ) : (
            <p role="alert" className="text-xs text-destructive" data-testid="repository-problem">
              {current.problem}
            </p>
          )}
          {check.error === undefined ? null : (
            <p role="alert" className="text-xs text-destructive">
              Couldn't check the repository: {check.error}
            </p>
          )}
          {/* Not held while a check is out: clicking Create leaves the field, and that blur's check would swallow the click. Create asks for itself. */}
          <button
            type="submit"
            disabled={create.busy || name.trim() === "" || repository.trim() === "" || current?.usable === false}
            className="rounded-md border border-border bg-background px-3 py-2 text-left text-sm font-semibold hover:bg-accent disabled:opacity-50"
          >
            Create project
          </button>
          {create.error === undefined ? null : (
            <p role="alert" className="text-xs text-destructive">
              {create.error}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
