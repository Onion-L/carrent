export const MAX_ATTACHMENT_COUNT = 30;
export const MAX_SINGLE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export type ImageAttachmentValidationResult = { ok: true } | { ok: false; reason: string };

type AttachableFile = {
  type: string;
  size: number;
};

export function isSupportedImageMimeType(mimeType: string): mimeType is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function validateImageAttachments(files: AttachableFile[]): ImageAttachmentValidationResult {
  if (files.length === 0) {
    return { ok: true };
  }

  if (files.length > MAX_ATTACHMENT_COUNT) {
    return {
      ok: false,
      reason: `You can attach up to ${MAX_ATTACHMENT_COUNT} images per message.`,
    };
  }

  for (const file of files) {
    if (!isSupportedImageMimeType(file.type)) {
      return {
        ok: false,
        reason: `Unsupported image format: ${file.type}. Use PNG, JPEG, WebP, or GIF.`,
      };
    }
  }

  for (const file of files) {
    if (file.size > MAX_SINGLE_ATTACHMENT_BYTES) {
      return {
        ok: false,
        reason: `One image exceeds the 10 MB limit.`,
      };
    }
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: `Total image size exceeds the 100 MB limit.`,
    };
  }

  return { ok: true };
}

export function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}
