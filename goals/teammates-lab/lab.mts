/**
 * What the Teammates lab's goal checks share: the lab served on a fresh store
 * over a scratch git checkout as its working folder, and a session's items
 * read through the public client.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { createClient } from "@flow-state-dev/client";
import { intentFreeEnv, refuseIfAnswering, repoPath, stopProcessGroup } from "../lib/index.mts";

export const LAB = repoPath("labs", "teammates");
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export type Fsd = ReturnType<typeof createClient>;
export type Item = { type: string; role?: string; requestId?: string; blockName?: string; content?: { text?: string }[] };

/**
 * The Teammates lab for `user` on a fresh store under `dir`, its working
 * folder `workdir` (an empty git checkout is made there when none exists).
 */
export async function startTeammates(
  dir: string,
  user: string,
  env: Record<string, string>,
  workdir = join(dir, "workdir")
): Promise<{ child: ChildProcess; origin: string }> {
  if (!existsSync(workdir)) {
    mkdirSync(workdir, { recursive: true });
    execFileSync("git", ["init", "-q", workdir]);
  }
  const port = 46_000 + randomInt(0, 9_000);
  const origin = `http://127.0.0.1:${port}`;
  await refuseIfAnswering(origin);
  let log = "";
  const child = spawn("npx", ["tsx", "../../packages/cli/bin/fsdev.ts", "dev", "--app", "@flow-state-dev/teammates", "--port", String(port), "--no-open"], {
    cwd: LAB,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: intentFreeEnv(process.env, {
      GOAL_CONTROL: "",
      TEAMMATES_STORE: join(dir, "teammates.sqlite"),
      TEAMMATES_USER: user,
      TEAMMATES_WORKDIR: workdir,
      ...env,
    }),
  });
  const keep = (chunk: Buffer) => {
    log += chunk.toString();
    writeFileSync(join(dir, "server.log"), log);
  };
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  for (const until = Date.now() + 120_000; Date.now() < until; ) {
    if (child.exitCode !== null) throw new Error(`setup: the lab exited (${child.exitCode}); log tail:\n${log.slice(-2000)}`);
    if (await fetch(origin, { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok, () => false)) return { child, origin };
    await sleep(500);
  }
  stopProcessGroup(child);
  throw new Error(`setup: the lab did not answer on ${origin} within 120s; log tail:\n${log.slice(-2000)}`);
}

/** Every item of a session. */
export async function itemsOf(fsd: Fsd, sessionId: string): Promise<Item[]> {
  const items: Item[] = [];
  for (let offset = 0; ; ) {
    const page = (await fsd.sessions.state(sessionId, { includeItems: true, offset, limit: 100 })) as {
      items?: Item[];
      pagination?: { hasMore: boolean; nextOffset: number };
    };
    items.push(...(page.items ?? []));
    if (page.pagination?.hasMore !== true) return items;
    offset = page.pagination.nextOffset;
  }
}
