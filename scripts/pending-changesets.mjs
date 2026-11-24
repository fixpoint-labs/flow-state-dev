/**
 * Which files are pending changesets: the notes `changeset version` reads, then deletes in the
 * commit it makes. One predicate for every script that asks, so the vocabulary guard and the
 * changeset check can't disagree with each other or with Changesets.
 *
 * It mirrors the filter in `@changesets/read`'s `getChangesets`
 * (`dist/changesets-read.cjs.js`, `contents.filter(file => !file.startsWith(".") &&
 * file.endsWith(".md") && !/^README\.md$/i.test(file))`), over the top level of `.changeset/`
 * only, since read does not walk subfolders. `packages/core/test/pending-changesets.test.ts`
 * checks it against read itself.
 *
 * No dependencies, so a script that runs without an install can use it.
 */

/**
 * Whether a repository-relative path is a pending changeset.
 * @param {string} path
 */
export function isPendingChangeset(path) {
  const match = /^\.changeset\/([^/]+)$/.exec(path);
  if (!match) return false;
  const file = match[1];
  return !file.startsWith(".") && file.endsWith(".md") && !/^README\.md$/i.test(file);
}
