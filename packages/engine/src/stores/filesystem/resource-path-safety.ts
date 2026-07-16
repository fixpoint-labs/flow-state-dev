/**
 * Symlink and collision guards for nested filesystem resource stores.
 */
import { lstat, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertPathUnderRoot } from "./resource-path";

const COLLISION_CODES = new Set(["EEXIST", "ENOTDIR", "EISDIR"]);

export function collisionError(scopeLabel: string, resourceKey: string, target: string, cause: Error): Error {
  return new Error(
    `Refusing to write resource "${resourceKey}" (${scopeLabel}): path conflict at ${target}: ${cause.message}`,
    { cause }
  );
}

export function wrapFilesystemCollision(
  error: unknown,
  scopeLabel: string,
  resourceKey: string,
  target: string
): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code && COLLISION_CODES.has(code)) {
    throw collisionError(scopeLabel, resourceKey, target, error as Error);
  }
  throw error;
}

/** Reject if any existing ancestor of `target` (or the leaf) is a symlink. */
export async function assertNoSymlinkOnPath(scopeDir: string, target: string): Promise<void> {
  assertPathUnderRoot(target, scopeDir);
  const relative = path.relative(scopeDir, target);
  if (relative.startsWith("..")) {
    throw new Error(`Refusing path outside scope directory: ${target}`);
  }
  const parts = relative.split(path.sep).filter((p) => p.length > 0);
  let current = scopeDir;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    current = path.join(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlink in resource path: ${current}`);
    }
  }
}

/** Walk existing ancestors of `scopeDir` under `storeRoot` and reject symlinks. */
export async function assertNoSymlinkAncestorsOfScope(storeRoot: string, scopeDir: string): Promise<void> {
  assertPathUnderRoot(scopeDir, storeRoot);
  const relative = path.relative(storeRoot, scopeDir);
  if (relative.length === 0) {
    return;
  }
  const parts = relative.split(path.sep).filter((p) => p.length > 0);
  let current = storeRoot;
  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlink in scope path: ${current}`);
    }
  }
}

export async function mkdirParents(target: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
}

export async function atomicWriteUtf8(target: string, content: string): Promise<void> {
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(tempPath, content, "utf8");
    await renameSafe(tempPath, target);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function renameSafe(from: string, to: string): Promise<void> {
  const { rename } = await import("node:fs/promises");
  await rename(from, to);
}

export async function removeScopeDirectory(storeRoot: string, scopeDir: string): Promise<void> {
  await assertNoSymlinkAncestorsOfScope(storeRoot, scopeDir);
  let stat;
  try {
    stat = await lstat(scopeDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    await unlink(scopeDir);
    return;
  }
  await rm(scopeDir, { recursive: true, force: true });
}

export async function readUtf8File(target: string): Promise<string | undefined> {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
