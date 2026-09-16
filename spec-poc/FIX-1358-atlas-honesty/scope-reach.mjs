/**
 * POC (FIX-1358) — which scopes do the shipped W3 readers actually reach?
 *
 * Throwaway. Lives on the never-merged spec branch; CI ignores `spec-poc/`.
 *
 * The premise this settles is load-bearing for the atlas teach. The epic spec
 * (FIX-1351 · SPEC.md) promises: "Drops a `CHANNEL.md` under `org/channels/`,
 * and it opens as a named session on the shipped kind", and its set table says
 * channels shipped "at org **and** team scope". If that holds, the atlas tree
 * teaches `org/channels/` as something that exists. If it does not, teaching it
 * that way ships the exact dishonesty this issue was filed to remove.
 *
 * The check plants one declaration at EACH scope for BOTH file conventions and
 * asks the real readers what came back. Every negative result carries its own
 * positive control — the team-scope sibling, and the resources reader, which
 * does walk both doors — so a green run cannot mean "the fixture never reached
 * the reader".
 *
 * Run (needs no workspace install, ~1s):
 *   node spec-poc/FIX-1358-atlas-honesty/run.sh
 * or directly, once the one-line shim in run.sh exists:
 *   node --experimental-strip-types spec-poc/FIX-1358-atlas-honesty/scope-reach.mjs
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const loader = path.resolve(here, "../../packages/workforce/src/loader");

const { readChannelsDirectory } = await import(
  path.join(loader, "read-channels-directory.ts")
);
const { readResourcesDirectory } = await import(
  path.join(loader, "read-resources-directory.ts")
);

const FRONTMATTER = "---\ndescription: a thing\n---\n\nBody.\n";

/** A workforce tree with one declaration of each convention at each scope. */
async function plantBothScopes() {
  const root = await mkdtemp(path.join(tmpdir(), "fix1358-"));

  await mkdir(path.join(root, "org", "channels", "general"), { recursive: true });
  await writeFile(path.join(root, "org", "channels", "general", "CHANNEL.md"), FRONTMATTER);
  await mkdir(path.join(root, "teams", "eng", "channels", "standup"), { recursive: true });
  await writeFile(path.join(root, "teams", "eng", "channels", "standup", "CHANNEL.md"), FRONTMATTER);

  await mkdir(path.join(root, "org", "resources"), { recursive: true });
  await writeFile(path.join(root, "org", "resources", "handbook.md"), FRONTMATTER);
  await mkdir(path.join(root, "teams", "eng", "resources"), { recursive: true });
  await writeFile(path.join(root, "teams", "eng", "resources", "runbook.md"), FRONTMATTER);

  return root;
}

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const root = await plantBothScopes();

const channels = await readChannelsDirectory(root);
const channelIds = channels.channels.map((c) => c.id).sort();
console.log("\nreadChannelsDirectory  ->", JSON.stringify(channelIds));
console.log("            errors     ->", JSON.stringify(channels.errors.map((e) => e.path)));

// Positive control. If this fails the fixture never reached the reader and
// every negative result below is meaningless. The id is team-qualified, which
// is itself the tell: a channel id has a team segment in it, so there is no id
// shape an org-scope channel could even have.
check("channels: the team-scope declaration arrives", channelIds.includes("eng.standup"));

// The claim under test.
check(
  "channels: NO org-scope channel comes back",
  channelIds.every((id) => !id.includes("general")),
  "the epic spec says one should",
);
check("channels: exactly one channel came back", channelIds.length === 1);

// And the reader is silent about it, which is why an author never finds out.
check("channels: no error names the unread org declaration", channels.errors.length === 0);

const resources = await readResourcesDirectory(root);
const resourceRefs = resources.documents.map((d) => d.ref).sort();
console.log("\nreadResourcesDirectory ->", JSON.stringify(resourceRefs));
console.log("            errors     ->", JSON.stringify(resources.errors.map((e) => e.path)));

// The contrast that makes the gap a gap: this is what "org and team scope"
// looks like when it is true, and it is the shape channels does not have.
check("resources: BOTH scopes arrive", resourceRefs.length === 2);
check(
  "resources: one of them is the bare org-level ref",
  resourceRefs.some((ref) => !ref.startsWith("teams/")),
);
check("resources: no errors", resources.errors.length === 0);

console.log(
  `\n${failures.length === 0 ? "ALL CHECKS HELD" : `${failures.length} CHECK(S) FAILED`}`,
);
process.exit(failures.length === 0 ? 0 : 1);
