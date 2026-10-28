import type { ProjectRow } from "../adapter";

/**
 * *New session*'s question (spec D3): which project the session works in.
 * It asks before the composer opens and has no default, so a coding run never
 * lands in a repository nobody chose.
 */
export function ProjectPicker({ projects, onPick }: { projects: ProjectRow[]; onPick: (project: ProjectRow) => void }) {
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
                onClick={() => onPick(project)}
                className="w-full border border-border bg-background px-3 py-2 text-left font-mono text-sm hover:bg-accent"
              >
                {project.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
