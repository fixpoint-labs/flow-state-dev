/**
 * A stub of GitHub's REST API, the one true third party on this path: the
 * endpoints `githubSubscriptionProvider` asks (`/user`, a repository, a pull
 * request and its lists), answered from what the run posts, with an ETag per
 * answer (`304` when nothing moved). Each token names one login; a call with
 * any other token is refused `401`. Every call is recorded with its token, so
 * the run reads who GitHub was asked as.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

/** One pull request the stub serves. */
export interface StubPull {
  owner: string;
  repo: string;
  number: number;
  title: string;
}

/** One call the stub answered: the token it came with, the path, and the status it got. */
export interface StubCall {
  token: string | undefined;
  path: string;
  status: number;
}

type Review = Record<string, unknown>;

/** Start the stub on a free loopback port. */
export async function startStubGitHub(options: { tokens: Record<string, string>; pulls: readonly StubPull[] }) {
  const calls: StubCall[] = [];
  const reviews = new Map<string, Review[]>(options.pulls.map((p) => [`${p.owner}/${p.repo}#${p.number}`, []]));
  const opened = new Date(Date.now() - 86_400_000).toISOString();
  let nextId = 7_000;

  const user = (login: string) => ({ login, id: login.length * 1000 + 3, type: "User", html_url: `https://github.com/${login}` });
  const repository = (p: StubPull) => ({
    id: p.number + 100,
    name: p.repo,
    full_name: `${p.owner}/${p.repo}`,
    private: false,
    html_url: `https://github.com/${p.owner}/${p.repo}`,
    owner: { login: p.owner, type: "Organization" }
  });
  const issue = (p: StubPull) => ({
    number: p.number,
    title: p.title,
    state: "open",
    labels: [],
    user: user("pr-author"),
    author_association: "MEMBER",
    created_at: opened,
    updated_at: opened,
    html_url: `https://github.com/${p.owner}/${p.repo}/pull/${p.number}`,
    pull_request: { url: `https://api.github.com/repos/${p.owner}/${p.repo}/pulls/${p.number}` }
  });
  const pull = (p: StubPull) => ({ ...issue(p), head: { sha: `sha${p.number}` }, base: { ref: "main" } });

  /** The body for one GET, or `undefined` for a path the stub doesn't serve. */
  const answer = (path: string): unknown => {
    const [route] = path.split("?");
    for (const p of options.pulls) {
      const repo = `/repos/${p.owner}/${p.repo}`;
      if (route === repo) return repository(p);
      if (route === `${repo}/issues/${p.number}`) return issue(p);
      if (route === `${repo}/pulls/${p.number}`) return pull(p);
      if (route === `${repo}/pulls/${p.number}/reviews`) return reviews.get(`${p.owner}/${p.repo}#${p.number}`);
      if (route === `${repo}/issues/${p.number}/timeline`) return [];
      if (route === `${repo}/issues/${p.number}/comments`) return [];
      if (route === `${repo}/pulls/${p.number}/comments`) return [];
      if (route === `${repo}/commits/sha${p.number}/check-runs`) return { total_count: 0, check_runs: [] };
    }
    return undefined;
  };

  const server: Server = createServer((req, res) => {
    const path = req.url ?? "/";
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const login = token === undefined ? undefined : options.tokens[token];
    const send = (status: number, body?: unknown, etag?: string) => {
      calls.push({ token, path, status });
      res.writeHead(status, { "content-type": "application/json", ...(etag === undefined ? {} : { etag }) });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (req.method !== "GET") return send(405, { message: "Not Found" });
    if (login === undefined) return send(401, { message: "Bad credentials" });
    const body = path === "/user" ? user(login) : answer(path);
    if (body === undefined) return send(404, { message: "Not Found" });
    const etag = `"${createHash("sha1").update(JSON.stringify(body)).digest("hex")}"`;
    if (req.headers["if-none-match"] === etag) return send(304, undefined, etag);
    send(200, body, etag);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("setup: the GitHub stub has no port");

  return {
    /** The API root a provider names as its `apiUrl`. */
    apiUrl: `http://127.0.0.1:${address.port}`,
    calls,
    /** Post a review on `pull` now, by `login` as a project member: what a person does on GitHub. */
    review(pull: StubPull, login: string, association: string, body: string) {
      const at = new Date(Math.ceil(Date.now() / 1000) * 1000).toISOString();
      reviews.get(`${pull.owner}/${pull.repo}#${pull.number}`)!.push({
        id: (nextId += 1),
        user: user(login),
        body,
        state: "CHANGES_REQUESTED",
        submitted_at: at,
        author_association: association,
        html_url: `https://github.com/${pull.owner}/${pull.repo}/pull/${pull.number}#pullrequestreview-${nextId}`
      });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
