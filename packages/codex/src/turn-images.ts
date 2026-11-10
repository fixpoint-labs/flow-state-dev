// FIX-2519 D1.
/**
 * A turn's images, as Codex reads them: files on disk, in a folder of the
 * turn's own outside the checkout.
 *
 * Codex takes an image only as a path (`local_image`, the CLI's `--image`).
 * Written into the checkout, a screenshot is one `git add -A` from shipping
 * in the agent's pull request, so each turn gets a fresh folder under this
 * user's private temp root instead, and the folder goes when the turn ends,
 * however it ends. A host whose sandbox limits what Codex reads must allow
 * that folder.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ATTACHMENT_IMAGE_TYPES, normalizeMediaType, type AttachmentAccepts } from "@flow-state-dev/core/attachments";
import type { HarnessAttachmentBytes } from "@flow-state-dev/core/harness";
import { privateTempRoot } from "@flow-state-dev/workspace";

/** What Codex takes as a turn's files: images. */
export const CODEX_ACCEPTS: AttachmentAccepts = ATTACHMENT_IMAGE_TYPES;

/** The extension each image type is written under, which is how the CLI tells their types apart. */
const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** A turn's images on disk: the folder to remove, and each image's path in the order attached. */
export interface TurnImages {
  folder: string;
  paths: string[];
}

/** Write a turn's images into a fresh folder of its own under this user's private temp root. */
export async function writeTurnImages(files: ReadonlyArray<HarnessAttachmentBytes>): Promise<TurnImages> {
  const root = await privateTempRoot("fsd-codex", "the images Codex turns read");
  const folder = await mkdtemp(join(root, "turn-"));
  const paths: string[] = [];
  try {
    for (const [index, file] of files.entries()) {
      // Named by position, never by the attached name: a filename is the person's text, not a path.
      const path = join(folder, `${index + 1}.${EXTENSION[normalizeMediaType(file.mediaType)] ?? "bin"}`);
      await writeFile(path, file.bytes, { mode: 0o600 });
      paths.push(path);
    }
  } catch (error) {
    await removeTurnImages(folder);
    throw error;
  }
  return { folder, paths };
}

/** Remove a turn's folder. Never throws: a folder left behind is under a private root, and the turn's own outcome stands. */
export async function removeTurnImages(folder: string): Promise<void> {
  await rm(folder, { recursive: true, force: true }).catch(() => undefined);
}
