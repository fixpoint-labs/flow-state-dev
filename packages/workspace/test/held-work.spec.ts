/**
 * Held work: a repository run's commits and files, held at a save point and
 * rebuilt on another host.
 *
 * Two host roots stand in for two machines. They share one `file://` remote
 * and one held-work folder, and nothing else. Every git process the host
 * starts is counted, because "off" is a claim about processes: none at all.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/exec";
import { fileHeldWorkStore, HELD_FILE_CAP_BYTES, HeldWorkMismatchError, type HeldWork, type HeldWorkStore } from "../src/held-work";
import { localWorkspaceHost, type PlaceRequest, type WorkspacePlace } from "../src/local-host";
import type { RepoRunSource } from "../src/run-source";
import { createRemote, git, tempDir, type Remote } from "./git-fixtures";

vi.mock("../src/exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/exec")>();
  return { ...actual, run: vi.fn(actual.run) };
});

vi.setConfig({ testTimeout: 60_000 });

const spawned = vi.mocked(run);
const { run: realRun } = await vi.importActual<typeof import("../src/exec")>("../src/exec");
const gitCommands = () => spawned.mock.calls.map(([, args]) => args.find((a) => !a.startsWith("-")));
const noSource = () => ({ kind: "refused" as const, reason: "unused", message: "unused" });

const PREFIX = "worktree-overlay/org/org-1/project-1";
const PLACE = ["epic", "run-1"];
const BRANCH = "fsd/run-1";

let rootA: string;
let rootB: string;
let storeDir: string;
let store: HeldWorkStore;
let remote: Remote;
let answer: RepoRunSource;

beforeEach(() => {
  rootA = tempDir("machine-a");
  rootB = tempDir("machine-b");
  storeDir = tempDir("held");
  store = fileHeldWorkStore({ dir: storeDir });
  remote = createRemote("marker A");
  remote.commit("main", ".gitignore", ".env\nnode_modules/\n");
  remote.commit("main", "edit.txt", "original\n");
  remote.commit("main", "gone.txt", "to be deleted\n");
  remote.commit("main", "old-name.txt", "renamed content\n");
  answer = { kind: "repo", repo: remote.url, heldPrefix: PREFIX };
  spawned.mockClear();
  spawned.mockImplementation(realRun);
});

afterEach(() => {
  for (const dir of [rootA, rootB, storeDir]) rmSync(dir, { recursive: true, force: true });
});

function hostOn(root: string, heldWork: HeldWorkStore | null = store) {
  return localWorkspaceHost({ root, remotes: { allow: ["file"] }, source: noSource, ...(heldWork ? { heldWork } : {}) });
}

function request(recorded?: PlaceRequest["recorded"]): PlaceRequest {
  return { place: PLACE, branch: BRANCH, ...(recorded !== undefined ? { recorded } : {}) };
}

/** Turn 1's work: a commit, then edits, a new file, a deletion, a rename, a binary, an exec bit, a symlink. */
function turnOne(place: WorkspacePlace): string {
  writeFileSync(join(place.cwd, "committed.txt"), "turn 1 commit\n");
  git(place.cwd, "add", "committed.txt");
  git(place.cwd, "commit", "-q", "-m", "turn 1");
  writeFileSync(join(place.cwd, "edit.txt"), "edited in turn 1\n");
  mkdirSync(join(place.cwd, "src", "deep", "nested"), { recursive: true });
  writeFileSync(join(place.cwd, "src", "deep", "nested", "new.txt"), "new in turn 1\n");
  rmSync(join(place.cwd, "gone.txt"));
  git(place.cwd, "mv", "old-name.txt", "new-name.txt");
  writeFileSync(join(place.cwd, "blob.bin"), Buffer.from([0, 1, 2, 255, 254, 0, 10, 13]));
  writeFileSync(join(place.cwd, "run.sh"), "#!/bin/sh\necho hi\n");
  chmodSync(join(place.cwd, "run.sh"), 0o755);
  symlinkSync("edit.txt", join(place.cwd, "link"));
  writeFileSync(join(place.cwd, ".env"), "SECRET=1\n");
  mkdirSync(join(place.cwd, "node_modules", "x"), { recursive: true });
  writeFileSync(join(place.cwd, "node_modules", "x", "index.js"), "ignored\n");
  return git(place.cwd, "rev-parse", "HEAD");
}

/** Every non-ignored path in a checkout: its type, mode and content. */
function treeOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (path: string, rel: string) => {
    for (const name of readdirSync(path)) {
      if (rel === "" && (name === ".git" || name === ".env" || name === "node_modules")) continue;
      const full = join(path, name);
      const key = rel === "" ? name : `${rel}/${name}`;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) out[key] = `link:${readlinkSync(full)}`;
      else if (stat.isDirectory()) walk(full, key);
      else out[key] = `${(stat.mode & 0o111) !== 0 ? "x" : "-"}:${readFileSync(full).toString("base64")}`;
    }
  };
  walk(dir, "");
  return out;
}

const mismatchOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => {
      throw new Error("expected a mismatch, but the place was provisioned");
    },
    (e: unknown) => e as HeldWorkMismatchError,
  );

describe("holding is off unless the host has a held-work store (BR-28, BR-29)", () => {
  it("checkpoints nothing, starts no process and writes no host id", async () => {
    const host = hostOn(rootA, null);
    const place = await host.provision(answer, request());
    spawned.mockClear();

    expect(await host.checkpoint(place)).toBeNull();
    expect(spawned).not.toHaveBeenCalled();
    expect(place.holding).toBeUndefined();
    expect(place.origin).toBe("new");
    expect(existsSync(join(rootA, ".host-id"))).toBe(false);
    expect(host.holds(answer)).toBe(false);
  });

  it("hands back a live place as today, origin live", async () => {
    const host = hostOn(rootA, null);
    await host.provision(answer, request());
    const again = await host.provision(answer, request());
    expect(again.origin).toBe("live");
    expect(again.repo?.created).toBe(false);
  });

  it("holds nothing on a host with a store when the source names no prefix (BR-10)", async () => {
    const host = hostOn(rootA);
    const { heldPrefix: _, ...noPrefix } = answer;
    const place = await host.provision(noPrefix, request());
    spawned.mockClear();
    expect(await host.checkpoint(place)).toBeNull();
    expect(spawned).not.toHaveBeenCalled();
    expect(await store.list("")).toEqual([]);
  });

  it("rejects a recorded hold as disabled, before any git process, where the run has no live place", async () => {
    const held = await holdTurnOne();
    spawned.mockClear();

    const error = await mismatchOf(hostOn(rootB, null).provision(answer, request({ host: "machine-a", held })));

    expect(error).toBeInstanceOf(HeldWorkMismatchError);
    expect(error.field).toBe("disabled");
    expect(spawned).not.toHaveBeenCalled();
    expect(existsSync(join(rootB, ...PLACE))).toBe(false);
    expect(await store.list(PREFIX)).toEqual([held.key]);
  });

  it("does not reject once the owner has answered: starts from the base", async () => {
    const held = await holdTurnOne();
    const place = await hostOn(rootB, null).provision(answer, request({ host: "machine-a", held: { ...held, parked: true } }));
    expect(place.origin).toBe("new");
    expect(git(place.cwd, "rev-parse", "HEAD")).toBe(remote.rev("main"));
  });

  it("does not reject a recorded hold where the run's checkout is live here", async () => {
    const offHost = hostOn(rootB, null);
    await offHost.provision(answer, request());
    const held = await holdTurnOne();
    const place = await offHost.provision(answer, request({ host: "machine-a", held }));
    expect(place.origin).toBe("live");
  });
});

describe("the folder store", () => {
  it("lists only keys under the prefix it is given, and deleting a missing key resolves", async () => {
    await store.put("a/b/1.pack", new Uint8Array([1]));
    await store.put("a/b/2.pack", new Uint8Array([2]));
    await store.put("a/c/3.pack", new Uint8Array([3]));

    expect(await store.list("a/b/")).toEqual(["a/b/1.pack", "a/b/2.pack"]);
    expect(await store.list("a/")).toEqual(["a/b/1.pack", "a/b/2.pack", "a/c/3.pack"]);
    expect(await store.list("z/")).toEqual([]);
    await expect(store.delete("a/b/missing.pack")).resolves.toBeUndefined();
    await store.delete("a/b/1.pack");
    expect(await store.get("a/b/1.pack")).toBeUndefined();
    expect(await store.get("a/b/2.pack")).toEqual(new Uint8Array([2]));
  });

  it("puts by temporary file and rename, leaving no partial file behind", async () => {
    await store.put("k/1.pack", new Uint8Array(1000).fill(7));
    expect(readdirSync(join(storeDir, "k"))).toEqual(["1.pack"]);
  });

  it("refuses a key that could leave its folder", async () => {
    await expect(store.put("../escape", new Uint8Array([1]))).rejects.toThrow(/plain segments/);
    await expect(store.get("a//b")).rejects.toThrow(/plain segments/);
  });
});

/** Machine A provisions, does turn 1 and holds it. */
async function holdTurnOne(): Promise<HeldWork & { headAfter: string }> {
  const host = hostOn(rootA);
  const place = await host.provision(answer, request());
  const head = turnOne(place);
  const held = (await host.checkpoint(place))!;
  return { ...held, headAfter: head };
}

describe("a hold snapshots the working tree through a temporary index (BR-1–BR-5, BR-11)", () => {
  it("takes edits, new, deleted, renamed, binary, executable and symlinked files, and leaves ignored ones out", async () => {
    const host = hostOn(rootA);
    const place = await host.provision(answer, request());
    const head = turnOne(place);
    const files = treeOf(place.cwd);

    const held = (await host.checkpoint(place))!;

    expect(held.head).toBe(head);
    expect(held.base).toBe(remote.rev("main"));
    expect(held.key).toBe(`${PREFIX}/${PLACE.join("/")}/${held.snapshot}.pack`);
    expect(held.skipped).toEqual([]);
    expect(git(place.cwd, "rev-parse", `${held.snapshot}^`)).toBe(head);
    const listed = git(place.cwd, "ls-tree", "-r", held.snapshot).split("\n");
    const entry = (path: string) => listed.find((line) => line.endsWith(`\t${path}`));
    expect(entry("run.sh")).toMatch(/^100755 /);
    expect(entry("link")).toMatch(/^120000 /);
    expect(entry("new-name.txt")).toBeDefined();
    expect(entry("old-name.txt")).toBeUndefined();
    expect(entry("gone.txt")).toBeUndefined();
    expect(entry(".env")).toBeUndefined();
    expect(entry("node_modules/x/index.js")).toBeUndefined();
    expect(Object.keys(files).sort()).toEqual(listed.map((line) => line.split("\t")[1]).sort());
    expect(Buffer.from((await store.get(held.key))!).subarray(0, 4).toString()).toBe("PACK");
  });

  it("leaves the checkout's index, every ref and the remote exactly as they were", async () => {
    const host = hostOn(rootA);
    const place = await host.provision(answer, request());
    turnOne(place);
    git(place.cwd, "add", "edit.txt"); // something staged, so the index has content of its own
    const indexPath = git(place.cwd, "rev-parse", "--path-format=absolute", "--git-path", "index");
    const index = readFileSync(indexPath);
    const refs = git(place.repo!.clone, "for-each-ref");
    const remoteRefs = git(remote.bare, "for-each-ref");
    const status = git(place.cwd, "status", "--porcelain");

    await host.checkpoint(place);

    expect(readFileSync(indexPath).equals(index)).toBe(true);
    expect(git(place.repo!.clone, "for-each-ref")).toBe(refs);
    expect(git(remote.bare, "for-each-ref")).toBe(remoteRefs);
    expect(git(place.cwd, "status", "--porcelain")).toBe(status);
    expect(gitCommands()).not.toContain("push");
    expect(gitCommands()).not.toContain("update-ref");
  });

  it("keeps the head's version of a file over the cap, and names it", async () => {
    remote.commit("main", "big.bin", "small at head\n");
    const host = hostOn(rootA);
    const place = await host.provision(answer, request());
    writeFileSync(join(place.cwd, "big.bin"), "staged small edit\n");
    git(place.cwd, "add", "big.bin");
    writeFileSync(join(place.cwd, "big.bin"), Buffer.alloc(HELD_FILE_CAP_BYTES + 1, 1));
    writeFileSync(join(place.cwd, "huge-new.bin"), Buffer.alloc(HELD_FILE_CAP_BYTES + 1, 2));

    const held = (await host.checkpoint(place))!;

    expect(held.skipped).toEqual(
      expect.arrayContaining([
        { path: "big.bin", why: "over-cap" },
        { path: "huge-new.bin", why: "over-cap" },
      ]),
    );
    expect(git(place.cwd, "show", `${held.snapshot}:big.bin`)).toBe("small at head");
    expect(git(place.cwd, "ls-tree", held.snapshot, "huge-new.bin")).toBe("");
    expect(held.bytes).toBeLessThan(HELD_FILE_CAP_BYTES);
  });

  it("drops a file the run deleted, however large it was at the head", async () => {
    const host = hostOn(rootA);
    const place = await host.provision(answer, request());
    writeFileSync(join(place.cwd, "large.bin"), Buffer.alloc(HELD_FILE_CAP_BYTES + 1, 3));
    git(place.cwd, "add", "large.bin");
    git(place.cwd, "commit", "-q", "-m", "large");
    rmSync(join(place.cwd, "large.bin"));

    const held = (await host.checkpoint(place))!;

    expect(held.skipped).toEqual([]);
    expect(git(place.cwd, "ls-tree", held.snapshot, "large.bin")).toBe("");
  });
});

describe("holds after holds (BR-2, BR-6)", () => {
  it("writes a whole new snapshot under a new key after a commit, leaving the first", async () => {
    const host = hostOn(rootA);
    const place = await host.provision(answer, request());
    turnOne(place);
    const first = (await host.checkpoint(place))!;
    git(place.cwd, "add", "-A");
    git(place.cwd, "commit", "-q", "-m", "turn 2");

    const second = (await host.checkpoint(place, first))!;

    expect(second.unchanged).toBe(false);
    expect(second.key).not.toBe(first.key);
    expect(second.base).toBe(first.base);
    expect(await store.list(PREFIX)).toEqual([first.key, second.key].sort());
  });

  it("returns unchanged and puts nothing when nothing changed, the same snapshot every time", async () => {
    const host = hostOn(rootA);
    const place = await host.provision(answer, request());
    turnOne(place);
    const first = (await host.checkpoint(place))!;
    const put = vi.spyOn(store, "put");
    // Past the clock's second, so a snapshot dated by the clock would differ.
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const again = (await host.checkpoint(place, first))!;

    expect(again.unchanged).toBe(true);
    expect(again.snapshot).toBe(first.snapshot);
    expect(again.key).toBe(first.key);
    expect(put).not.toHaveBeenCalled();
  });

  it("drops one key of its own place, and refuses any other", async () => {
    const host = hostOn(rootA);
    const place = await host.provision(answer, request());
    turnOne(place);
    const held = (await host.checkpoint(place))!;
    await store.put(`${PREFIX}/epic/run-2/x.pack`, new Uint8Array([1]));

    await expect(host.dropHeld(place, `${PREFIX}/epic/run-2/x.pack`)).rejects.toThrow(/refusing to drop/);
    await expect(host.dropHeld(place, `${PREFIX}/epic/run-1/sub/x.pack`)).rejects.toThrow(/refusing to drop/);
    await host.dropHeld(place, held.key);
    expect(await store.list(PREFIX)).toEqual([`${PREFIX}/epic/run-2/x.pack`]);
    await expect(host.dropHeld(place, held.key)).resolves.toBeUndefined();
  });
});

describe("a host's identity is its root's (S3)", () => {
  it("is shared by hosts on one root and differs across roots", () => {
    expect(hostOn(rootA).hostId()).toBe(hostOn(rootA).hostId());
    expect(hostOn(rootA).hostId()).not.toBe(hostOn(rootB).hostId());
  });
});

describe("provision brings a run back (BR-16–BR-22)", () => {
  it("hands a live recorded place back untouched: origin live, no fetch", async () => {
    const host = hostOn(rootA);
    const place = await host.provision(answer, request());
    turnOne(place);
    const held = (await host.checkpoint(place))!;
    writeFileSync(join(place.cwd, "after-hold.txt"), "kept\n");
    spawned.mockClear();

    const again = await host.provision(answer, request({ host: host.hostId(), held }));

    expect(again.origin).toBe("live");
    expect(again.holding?.base).toBe(held.base);
    expect(readFileSync(join(again.cwd, "after-hold.txt"), "utf8")).toBe("kept\n");
    expect(gitCommands()).not.toContain("fetch");
  });

  it("rebuilds a lost place on another host equal to the source checkout, with the changes unstaged", async () => {
    const a = hostOn(rootA);
    const placeA = await a.provision(answer, request());
    const head = turnOne(placeA);
    const held = (await a.checkpoint(placeA))!;
    const expected = treeOf(placeA.cwd);
    writeFileSync(join(placeA.cwd, "edit.txt"), "turn 2, never held\n");
    rmSync(rootA, { recursive: true, force: true });

    const b = hostOn(rootB);
    const states: string[] = [];
    const placeB = await b.provision(answer, { ...request({ host: "machine-a", held }), progress: (s) => void states.push(s) });

    expect(placeB.origin).toBe("held");
    expect(states).toEqual(["lost", "restoring"]);
    expect(treeOf(placeB.cwd)).toEqual(expected);
    expect(git(placeB.cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(placeB.cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe(BRANCH);
    expect(git(placeB.cwd, "diff", "--cached", "--name-only")).toBe("");
    const status = git(placeB.cwd, "status", "--porcelain", "--untracked-files=all");
    expect(status).toContain("?? src/deep/nested/new.txt");
    expect(status).toMatch(/^ ?M edit.txt$/m);
    expect(status).toMatch(/^ D gone.txt$/m);
    expect(placeB.holding).toEqual({ keyPrefix: `${PREFIX}/epic/run-1/`, base: held.base, host: b.hostId() });

    // And it holds again from there, to a new key once something changes.
    writeFileSync(join(placeB.cwd, "turn-3.txt"), "on b\n");
    const next = (await b.checkpoint(placeB, held))!;
    expect(next.unchanged).toBe(false);
    expect(next.base).toBe(held.base);
  });

  it("starts from the base when the record names a place but nothing was held (BR-21)", async () => {
    const states: string[] = [];
    const place = await hostOn(rootB).provision(answer, { ...request({ host: "machine-a", held: null }), progress: (s) => void states.push(s) });
    expect(place.origin).toBe("base");
    expect(states).toEqual(["lost"]);
    expect(git(place.cwd, "rev-parse", "HEAD")).toBe(remote.rev("main"));
  });

  it("moves a directory this host holds for a place recorded elsewhere aside, and keeps it (BR-22)", async () => {
    const b = hostOn(rootB);
    const earlier = await b.provision(answer, request());
    writeFileSync(join(earlier.cwd, "from-an-earlier-stay.txt"), "keep me\n");
    git(earlier.cwd, "commit", "-q", "--allow-empty", "-m", "earlier commit on b");
    const held = await holdTurnOne();

    const place = await b.provision(answer, request({ host: hostOn(rootA).hostId(), held }));

    expect(place.origin).toBe("held");
    const aside = readdirSync(join(rootB, ...PLACE)).filter((name) => name.startsWith("checkout.stale-"));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(rootB, ...PLACE, aside[0]!, "from-an-earlier-stay.txt"), "utf8")).toBe("keep me\n");
    const branches = git(place.repo!.clone, "branch", "--list", `${BRANCH}*`);
    expect(branches).toMatch(/fsd\/run-1\.stale-/);
  });

  it("lays the snapshot out in held/ after the owner answered, and starts from the base (BR-20)", async () => {
    const held = await holdTurnOne();
    const place = await hostOn(rootB).provision(answer, request({ host: "machine-a", held: { ...held, parked: true } }));

    expect(place.origin).toBe("base");
    expect(git(place.cwd, "rev-parse", "HEAD")).toBe(remote.rev("main"));
    expect(place.heldDir).toBe(join(rootB, ...PLACE, "held"));
    expect(readFileSync(join(place.heldDir!, "src", "deep", "nested", "new.txt"), "utf8")).toBe("new in turn 1\n");
    expect(existsSync(join(place.cwd, "held"))).toBe(false);
  });

  it("starts from the base with no held/ when the answered pack cannot be read", async () => {
    const held = await holdTurnOne();
    await store.delete(held.key);
    const place = await hostOn(rootB).provision(answer, request({ host: "machine-a", held: { ...held, parked: true } }));
    expect(place.origin).toBe("base");
    expect(place.heldDir).toBeUndefined();
  });
});

describe("held work that disagrees with the record is refused, naming the field (BR-15, BR-19)", () => {
  async function expectMismatch(field: string, recorded: PlaceRequest["recorded"], setup?: () => Promise<void>) {
    await setup?.();
    const before = await Promise.all((await store.list(PREFIX)).map(async (k) => [k, await store.get(k)] as const));
    const error = await mismatchOf(hostOn(rootB).provision(answer, request(recorded)));
    expect(error).toBeInstanceOf(HeldWorkMismatchError);
    expect(error.field).toBe(field);
    expect(existsSync(join(rootB, ...PLACE, "checkout"))).toBe(false);
    const after = await Promise.all((await store.list(PREFIX)).map(async (k) => [k, await store.get(k)] as const));
    expect(after).toEqual(before);
  }

  it("a pack changed in the store: pack", async () => {
    const held = await holdTurnOne();
    const bytes = (await store.get(held.key))!;
    bytes[bytes.length - 30] ^= 0xff;
    await store.put(held.key, bytes);
    await expectMismatch("pack", { host: "machine-a", held });
  });

  it("another valid pack under the recorded key: pack, by its hash", async () => {
    const a = hostOn(rootA);
    const place = await a.provision(answer, request());
    turnOne(place);
    const held = (await a.checkpoint(place))!;
    writeFileSync(join(place.cwd, "later.txt"), "a later hold\n");
    const later = (await a.checkpoint(place, held))!;
    await store.put(held.key, (await store.get(later.key))!);
    await store.delete(later.key);
    await expectMismatch("pack", { host: "machine-a", held });
  });

  it("a pack missing from the store: pack", async () => {
    const held = await holdTurnOne();
    await store.delete(held.key);
    await expectMismatch("pack", { host: "machine-a", held });
  });

  it("a key outside this attempt's prefix: scope, before any git process", async () => {
    const held = await holdTurnOne();
    spawned.mockClear();
    await expectMismatch("scope", { host: "machine-a", held: { ...held, key: `worktree-overlay/org/other/project-1/epic/run-1/${held.snapshot}.pack` } });
    expect(spawned).not.toHaveBeenCalled();
  });

  it("a base the remote does not have: base", async () => {
    const held = await holdTurnOne();
    await expectMismatch("base", { host: "machine-a", held: { ...held, base: "1".repeat(40) } });
  });

  it("a head the pack does not hold: head", async () => {
    const held = await holdTurnOne();
    await expectMismatch("head", { host: "machine-a", held: { ...held, head: "2".repeat(40) } });
  });

  it("a snapshot the pack does not hold: snapshot", async () => {
    const held = await holdTurnOne();
    await expectMismatch("snapshot", { host: "machine-a", held: { ...held, snapshot: "3".repeat(40) } });
  });

  it("another branch or remote than the record's: branch, remote", async () => {
    const held = await holdTurnOne();
    await expectMismatch("branch", { host: "machine-a", held, branch: "fsd/other" });
    await expectMismatch("remote", { host: "machine-a", held, remote: `${remote.url}-elsewhere` });
  });

  it("a rebuilt tree that is not the snapshot's: tree, with the rebuilt checkout removed", async () => {
    // A snapshot no hold would write: one carrying a file over the cap. The
    // rebuild leaves that file out when it checks itself, so the trees differ.
    const a = hostOn(rootA);
    const place = await a.provision(answer, request());
    writeFileSync(join(place.cwd, "huge.bin"), Buffer.alloc(HELD_FILE_CAP_BYTES + 1, 4));
    git(place.cwd, "add", "huge.bin");
    const tree = git(place.cwd, "write-tree");
    git(place.cwd, "reset", "-q");
    const head = git(place.cwd, "rev-parse", "HEAD");
    const snapshot = git(place.cwd, "commit-tree", tree, "-p", head, "-m", "crafted");
    const scratch = tempDir("crafted");
    const name = execPack(place.cwd, `${snapshot}\n^${head}\n`, join(scratch, "p"));
    const bytes = new Uint8Array(readFileSync(join(scratch, `p-${name}.pack`)));
    const key = `${PREFIX}/epic/run-1/${snapshot}.pack`;
    await store.put(key, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    await expectMismatch("tree", { host: "machine-a", held: { base: head, head, snapshot, key, sha256 } });
    rmSync(scratch, { recursive: true, force: true });
  });
});

function execPack(cwd: string, input: string, prefix: string): string {
  return execFileSync("git", ["pack-objects", "--revs", "-q", prefix], { cwd, input, encoding: "utf8" }).trim();
}
