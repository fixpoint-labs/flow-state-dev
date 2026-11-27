/** Types for `workspace-members.mjs`; see that file for why it is the one workspace parser. */

/** Each workspace member's package.json path, relative to `root`. */
export declare function workspaceManifests(root: string): string[];
