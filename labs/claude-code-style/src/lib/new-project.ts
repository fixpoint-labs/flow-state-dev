/**
 * Making a project from the picker. The id is the name in lower case with
 * runs of anything else as one dash, so two names can meet on one id (*Acme*
 * and *Acme!*). Creating a project whose id is taken answers with the project
 * already there, not an error, so the picker has to refuse it itself:
 * otherwise a session opened on the new entry works in the other project's
 * repository.
 */

/** The id a project named `name` is created under. */
export function projectIdOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Throw when `createProject` found a project already under the id instead of making one. */
export function refuseExisting(answer: { created: boolean; project: { id: string; title: string } }, name: string): void {
  if (answer.created) return;
  throw new Error(`"${answer.project.title}" already uses the id "${answer.project.id}". Pick a name that differs in more than case or punctuation from "${name}".`);
}
