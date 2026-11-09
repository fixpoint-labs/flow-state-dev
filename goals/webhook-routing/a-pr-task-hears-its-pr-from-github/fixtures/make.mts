/**
 * Writes `deliveries.json` from real GitHub webhook payloads
 * (`@octokit/webhooks-examples`), rewritten to one repository (`acme/api`) and
 * one pull request (#412), with the senders and times this goal needs. Run
 * once; the output is committed.
 *
 *   pnpm tsx goals/webhook-routing/a-pr-task-hears-its-pr-from-github/fixtures/make.mts
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const examples = require("@octokit/webhooks-examples") as Array<{ name: string; examples: Array<Record<string, any>> }>;

const pick = (name: string, action: string, nth = 0): Record<string, any> => {
  const found = examples.find((e) => e.name === name)!.examples.filter((x) => x.action === action);
  if (found[nth] === undefined) throw new Error(`no ${name}.${action} #${nth} in the examples`);
  return structuredClone(found[nth]!);
};

const OWNER = "acme";
const REPO = "api";
const N = 412;
const user = (login: string, type = "User") => ({ login, id: login.length * 1000 + 7, type, html_url: `https://github.com/${login}` });

/** Every repository and pull request in a payload, renamed to acme/api and #412. */
function rewrite(payload: Record<string, any>): Record<string, any> {
  payload.repository = {
    ...payload.repository,
    name: REPO,
    full_name: `${OWNER}/${REPO}`,
    private: false,
    html_url: `https://github.com/${OWNER}/${REPO}`,
    owner: user(OWNER, "Organization")
  };
  delete payload.organization;
  delete payload.installation;
  for (const key of ["pull_request", "issue"]) {
    if (payload[key] === undefined) continue;
    payload[key] = { ...payload[key], number: N, html_url: `https://github.com/${OWNER}/${REPO}/pull/${N}`, title: "Rename the handler", user: user("alice-gh"), author_association: "MEMBER" };
  }
  return payload;
}

type Delivery = { label: string; event: string; payload: Record<string, any> };
const deliveries: Delivery[] = [];
const add = (label: string, event: string, payload: Record<string, any>) => deliveries.push({ label, event, payload: rewrite(payload) });

// During the opening turn: CI completes, as the app that ran it.
{
  const p = pick("check_run", "completed", 0);
  p.check_run = { ...p.check_run, id: 9101, name: "ci / test", conclusion: "failure", completed_at: "2026-11-05T10:00:05Z", app: { ...p.check_run.app, slug: "github-actions", name: "GitHub Actions" }, pull_requests: [{ ...p.check_run.pull_requests[0], number: N }], output: { title: "2 tests failed", summary: "handler.spec.ts: rename broke two imports" } };
  p.sender = user("alice-gh");
  add("ci-during-turn", "check_run", p);
}
// After the turn: a member's review, a collaborator's line comment, a listed bot's comment.
{
  const p = pick("pull_request_review", "submitted", 0);
  p.review = { ...p.review, id: 9201, body: "Please keep the old name as an alias.", state: "changes_requested", submitted_at: "2026-11-05T10:05:00Z", author_association: "MEMBER", user: user("bob") };
  p.sender = user("bob");
  add("member-review", "pull_request_review", p);
}
{
  const p = pick("pull_request_review_comment", "created", 0);
  p.comment = { ...p.comment, id: 9301, body: "This import is unused now.", created_at: "2026-11-05T10:06:00Z", updated_at: "2026-11-05T10:06:00Z", author_association: "COLLABORATOR", user: user("carol") };
  p.sender = user("carol");
  add("collaborator-line-comment", "pull_request_review_comment", p);
}
const comment = (label: string, id: number, login: string, association: string, body: string, at: string, type = "User") => {
  const p = pick("issue_comment", "created", 0);
  p.issue = { ...p.issue, pull_request: { url: `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${N}` } };
  p.comment = { ...p.comment, id, body, created_at: at, updated_at: at, author_association: association, user: user(login, type) };
  p.sender = user(login, type);
  add(label, "issue_comment", p);
};
comment("listed-bot-comment", 9401, "codex[bot]", "NONE", "Codex review: one finding in handler.ts.", "2026-11-05T10:07:00Z", "Bot");
comment("outsider-comment", 9402, "mallory", "NONE", "Merge my fork instead.", "2026-11-05T10:08:00Z");
comment("own-comment", 9403, "alice-gh", "MEMBER", "Fixed, see the next push.", "2026-11-05T10:09:00Z");
// Two review requests in one second, to two people.
for (const [i, login] of ["dave", "erin"].entries()) {
  const p = pick("pull_request", "review_requested", 0);
  p.requested_reviewer = user(login);
  p.sender = user("alice-gh");
  add(`review-request-${login}`, "pull_request", p);
  deliveries.at(-1)!.payload.pull_request.updated_at = "2026-11-05T10:10:00Z";
  void i;
}
// The merge: it ends the subscriptions to #412, and a comment after it reaches no one on #412.
{
  const p = pick("pull_request", "closed", 0);
  p.sender = user("bob");
  add("merged", "pull_request", p);
  Object.assign(deliveries.at(-1)!.payload.pull_request, { merged: true, closed_at: "2026-11-05T11:00:00Z", updated_at: "2026-11-05T11:00:00Z" });
}
comment("after-close-comment", 9404, "bob", "MEMBER", "Thanks, all good.", "2026-11-05T11:05:00Z");

// The API forms a poll rebuilds the two review requests from: the timeline's `review_requested`
// events, read later, when the pull request's own `updated_at` has moved on.
const apiForms = ["dave", "erin"].map((login) => ({
  label: `api-review-request-${login}`,
  timelineEvent: { event: "review_requested", created_at: "2026-11-05T10:10:00Z", actor: user("alice-gh"), requested_reviewer: user(login) },
  pullRequest: { number: N, title: "Rename the handler", html_url: `https://github.com/${OWNER}/${REPO}/pull/${N}`, updated_at: "2026-11-05T11:00:00Z", user: user("alice-gh"), author_association: "MEMBER", labels: [] },
  repository: { full_name: `${OWNER}/${REPO}`, private: false }
}));

writeFileSync(join(HERE, "deliveries.json"), `${JSON.stringify({ deliveries, apiForms }, null, 2)}\n`);
console.log(`wrote ${deliveries.length} deliveries and ${apiForms.length} API forms`);
