import { useState } from "react";
import type { ProjectRow } from "../adapter";
import { useSubmit } from "../lib/use-submit";

/**
 * *New session*'s question (spec D3): which project the session works in.
 * It asks before the composer opens and has no default, so a coding run never
 * lands in a repository nobody chose. *New project* adds one: a name and the
 * repository its coding runs clone. Picking is held while the session opens,
 * so a second click can't open two, and a session that fails to open says so here.
 */
export function ProjectPicker({
  projects,
  onPick,
  onCreate,
}: {
  projects: ProjectRow[];
  onPick: (project: ProjectRow) => Promise<void>;
  onCreate: (name: string, repository: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [repository, setRepository] = useState("");
  const [error, setError] = useState<string | undefined>();
  const pick = useSubmit(onPick);
  const create = (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    onCreate(name.trim(), repository.trim()).then(
      () => {
        setName("");
        setRepository("");
      },
      (failed: unknown) => setError(failed instanceof Error ? failed.message : String(failed)),
    );
  };
  return (
    <main aria-label="Main thread" className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center px-6">
      <section aria-label="Choose a project" className="w-full max-w-sm">
        <h1 className="text-sm font-semibold">Choose a project</h1>
        <p className="mt-1 text-xs text-muted-foreground">The session works in the project's checkout, and so does every task it starts.</p>
        <ul className="mt-4 flex flex-col gap-2">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                disabled={pick.busy}
                onClick={() => void pick.submit(undefined, project)}
                className="w-full border border-border bg-background px-3 py-2 text-left font-mono text-sm hover:bg-accent disabled:opacity-50"
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
        <form aria-label="New project" onSubmit={create} className="mt-6 flex flex-col gap-2">
          <h2 className="text-xs font-semibold">New project</h2>
          <input
            aria-label="Project name"
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="border border-border bg-background px-3 py-2 text-sm"
          />
          <input
            aria-label="Repository"
            placeholder="file:///path/to/repo"
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            className="border border-border bg-background px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={name.trim() === "" || repository.trim() === ""}
            className="border border-border bg-background px-3 py-2 text-left text-sm font-semibold hover:bg-accent disabled:opacity-50"
          >
            Create project
          </button>
          {error === undefined ? null : (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
