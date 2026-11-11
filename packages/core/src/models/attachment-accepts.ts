// FIX-2520.
/**
 * What each model provider reads as a file, on the same keys as the other
 * provider tables (`providerNames`). A generator's call passes its model's
 * entry to the run's `prepareMessages`, which sends a PDF as a file where it
 * is listed and as its extracted text everywhere else.
 */
import { ATTACHMENT_IMAGE_TYPES, type AttachmentAccepts } from "../attachments";
import type { ProviderName } from "./types";

const IMAGES_AND_PDF: AttachmentAccepts = [...ATTACHMENT_IMAGE_TYPES, "application/pdf"];

/** The built-in providers each read images and PDFs in v1. */
const PROVIDER_ATTACHMENT_ACCEPTS: Readonly<Record<ProviderName, AttachmentAccepts>> = {
  anthropic: IMAGES_AND_PDF,
  openai: IMAGES_AND_PDF,
  google: IMAGES_AND_PDF
};

/**
 * What a model of `provider` (a `ModelResolver.providerOf` answer) reads as a
 * file. A provider not in the table reads images only, so it gets a PDF's text.
 */
export function providerAttachmentAccepts(provider: string): AttachmentAccepts {
  return Object.hasOwn(PROVIDER_ATTACHMENT_ACCEPTS, provider)
    ? PROVIDER_ATTACHMENT_ACCEPTS[provider as ProviderName]
    : ATTACHMENT_IMAGE_TYPES;
}
