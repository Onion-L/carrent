import type { AttachmentKind, AttachmentMetadata } from "./chat";

export const MAX_ATTACHMENT_COUNT = 30;
export const MAX_SINGLE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export const MAX_ATTACHMENT_ID_CHARS = 128;
export const MAX_ATTACHMENT_NAME_BYTES = 255;
export const MAX_ATTACHMENT_MIME_TYPE_CHARS = 255;
export const MAX_ATTACHMENT_STORAGE_KEY_CHARS = 128;

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export type AttachmentValidationResult = { ok: true } | { ok: false; reason: string };

export type AttachmentClassification =
  | { ok: true; kind: AttachmentKind }
  | { ok: false; reason: string };

export const UNSUPPORTED_ATTACHMENT_TYPE_MESSAGE =
  "Unsupported file type. Attach PNG, JPEG, WebP, GIF, or UTF-8 text files.";

const BINARY_MIME_TYPES = new Set([
  "application/gzip",
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/x-bzip2",
  "application/x-gzip",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/x-xz",
  "application/x-zip-compressed",
  "application/zip",
]);

const BINARY_FILE_EXTENSIONS = new Set([
  "7z",
  "avi",
  "bin",
  "bz2",
  "dmg",
  "doc",
  "docx",
  "exe",
  "gz",
  "m4a",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "pdf",
  "pkg",
  "ppt",
  "pptx",
  "rar",
  "tar",
  "tgz",
  "wav",
  "webm",
  "xls",
  "xlsx",
  "xz",
  "zip",
]);

export function isSupportedImageMimeType(mimeType: string): mimeType is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function classifyAttachmentBytes(input: {
  name?: string;
  mimeType: string;
  data: Uint8Array;
}): AttachmentClassification {
  if (isSupportedImageMimeType(input.mimeType)) {
    return { ok: true, kind: "image" };
  }

  const mimeType = input.mimeType.split(";", 1)[0].trim().toLowerCase();
  const extension = input.name?.includes(".")
    ? input.name.slice(input.name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("video/") ||
    BINARY_MIME_TYPES.has(mimeType) ||
    BINARY_FILE_EXTENSIONS.has(extension)
  ) {
    return { ok: false, reason: UNSUPPORTED_ATTACHMENT_TYPE_MESSAGE };
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(input.data);
    if (text.includes("\0")) {
      return { ok: false, reason: UNSUPPORTED_ATTACHMENT_TYPE_MESSAGE };
    }
    return { ok: true, kind: "file" };
  } catch {
    return {
      ok: false,
      reason: UNSUPPORTED_ATTACHMENT_TYPE_MESSAGE,
    };
  }
}

export function validateAttachmentSelection(
  files: Array<{ size: number }>,
): AttachmentValidationResult {
  if (files.length === 0) {
    return { ok: true };
  }

  if (files.length > MAX_ATTACHMENT_COUNT) {
    return {
      ok: false,
      reason: `You can attach up to ${MAX_ATTACHMENT_COUNT} attachments per message.`,
    };
  }

  for (const file of files) {
    if (file.size > MAX_SINGLE_ATTACHMENT_BYTES) {
      return {
        ok: false,
        reason: `One attachment exceeds the 10 MB limit.`,
      };
    }
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: `Total attachment size exceeds the 100 MB limit.`,
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

const SAFE_FILE_EXTENSION_PATTERN = /^[A-Za-z0-9]{1,8}$/;

export function storageExtensionForAttachment(input: {
  kind: AttachmentKind;
  name: string;
  mimeType: string;
}): string {
  if (input.kind === "image") {
    return extensionForMimeType(input.mimeType);
  }

  const extension = input.name.includes(".")
    ? input.name.slice(input.name.lastIndexOf(".") + 1)
    : "";
  return SAFE_FILE_EXTENSION_PATTERN.test(extension) ? extension.toLowerCase() : "txt";
}

const ATTACHMENT_STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertValidAttachmentStorageKey(storageKey: string): string {
  if (
    typeof storageKey !== "string" ||
    storageKey.length > MAX_ATTACHMENT_STORAGE_KEY_CHARS ||
    !ATTACHMENT_STORAGE_KEY_PATTERN.test(storageKey) ||
    storageKey.includes("..")
  ) {
    throw new Error("Invalid attachment storage key.");
  }

  return storageKey;
}

export function isImageAttachment(
  attachment: AttachmentMetadata,
): attachment is AttachmentMetadata & { kind: "image" } {
  return attachment.kind === "image";
}

export function isFileAttachment(
  attachment: AttachmentMetadata,
): attachment is AttachmentMetadata & { kind: "file" } {
  return attachment.kind === "file";
}
