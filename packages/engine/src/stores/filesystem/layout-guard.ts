/**
 * Nested-layout marker and legacy flat-file detection for filesystem content/state stores.
 */
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isLayoutMarkerFileName,
  isMetadataDirName,
  isMetadataFileName,
  LAYOUT_MARKER_NAME,
  NESTED_LAYOUT_VERSION
} from "./resource-path";

const LEGACY_ERROR =
  "Filesystem store subtree predates the nested-layout change; will not read its flat files — move it aside or delete it.";

export type LayoutResolution = "nested" | "fresh";

async function readLayoutMarker(storeRoot: string): Promise<boolean | "invalid"> {
  const markerPath = path.join(storeRoot, LAYOUT_MARKER_NAME);
  try {
    const raw = await readFile(markerPath, "utf8");
    const parsed = JSON.parse(raw) as { layout?: string };
    return parsed.layout === NESTED_LAYOUT_VERSION;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    return "invalid";
  }
}

async function scanForLegacyDataFile(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }

  for (const entry of entries) {
    const name = entry.name;
    const abs = path.join(dir, name);
    if (entry.isDirectory()) {
      if (isMetadataDirName(name)) {
        continue;
      }
      const link = await lstat(abs);
      if (link.isSymbolicLink()) {
        continue;
      }
      if (await scanForLegacyDataFile(abs)) {
        return true;
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (isLayoutMarkerFileName(name) || isMetadataFileName(name)) {
      continue;
    }
    return true;
  }
  return false;
}

async function resolveLayout(storeRoot: string): Promise<LayoutResolution> {
  const marker = await readLayoutMarker(storeRoot);
  if (marker === true) {
    return "nested";
  }
  if (marker === "invalid") {
    throw new Error(`${LEGACY_ERROR} (${storeRoot})`);
  }
  if (await scanForLegacyDataFile(storeRoot)) {
    throw new Error(`${LEGACY_ERROR} (${storeRoot})`);
  }
  return "fresh";
}

export class FilesystemLayoutGuard {
  private resolution: Promise<LayoutResolution> | undefined;

  constructor(private readonly storeRoot: string) {}

  clearCache(): void {
    this.resolution = undefined;
  }

  async ensureReadable(): Promise<void> {
    await this.resolveOnce();
  }

  async ensureWritable(): Promise<void> {
    const state = await this.resolveOnce();
    if (state === "fresh") {
      await this.writeMarkerIfAbsent();
    }
  }

  private async resolveOnce(): Promise<LayoutResolution> {
    if (!this.resolution) {
      this.resolution = resolveLayout(this.storeRoot).catch((error) => {
        this.resolution = undefined;
        throw error;
      });
    }
    return this.resolution;
  }

  private async writeMarkerIfAbsent(): Promise<void> {
    await mkdir(this.storeRoot, { recursive: true });
    const markerPath = path.join(this.storeRoot, LAYOUT_MARKER_NAME);
    const payload = JSON.stringify({ layout: NESTED_LAYOUT_VERSION });
    try {
      await writeFile(markerPath, payload, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }
}
