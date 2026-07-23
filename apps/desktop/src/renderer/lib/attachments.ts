import type { AttachmentMetadata } from "../../shared/chat";
import { isSupportedImageMimeType } from "../../shared/attachment";
import { FileCode, FileText } from "lucide-react";

export {
  MAX_ATTACHMENT_COUNT,
  MAX_SINGLE_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  isSupportedImageMimeType,
  validateAttachmentSelection,
  extensionForMimeType,
} from "../../shared/attachment";

export type PendingAttachment = {
  id: string;
  file: File;
  previewUrl?: string;
  metadata?: AttachmentMetadata;
};

export function pendingAttachmentFromFile(
  file: File,
  metadata?: AttachmentMetadata,
): PendingAttachment {
  // Legacy metadata (pre-mixed-attachments main process) has no `kind`;
  // fall back to the file's own MIME type in that case.
  const isImage = metadata?.kind ? metadata.kind === "image" : isSupportedImageMimeType(file.type);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    ...(isImage ? { previewUrl: URL.createObjectURL(file) } : {}),
    metadata,
  };
}

// Rebuilds a renderer pending attachment from persisted metadata plus the
// bytes read back through the Attachment Store bridge.
export function pendingAttachmentFromMetadata(
  metadata: AttachmentMetadata,
  data: Uint8Array,
): PendingAttachment {
  const file = new File([data as BlobPart], metadata.name, { type: metadata.mimeType });
  return pendingAttachmentFromFile(file, metadata);
}

export function isPendingImageAttachment(attachment: PendingAttachment): boolean {
  return attachment.previewUrl !== undefined;
}

export function pendingImageAttachments(attachments: PendingAttachment[]): PendingAttachment[] {
  return attachments.filter(isPendingImageAttachment);
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${trimFixed(bytes / 1024)} KB`;
  }
  return `${trimFixed(bytes / (1024 * 1024))} MB`;
}

function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

const CODE_ATTACHMENT_EXTENSIONS = new Set([
  "c",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "lua",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "xml",
  "yaml",
  "yml",
]);

export type FileAttachmentIconKind = "code" | "text";

export const FILE_ATTACHMENT_ICONS: Record<FileAttachmentIconKind, typeof FileText> = {
  code: FileCode,
  text: FileText,
};

export function fileAttachmentIconKind(name: string): FileAttachmentIconKind {
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return CODE_ATTACHMENT_EXTENSIONS.has(extension) ? "code" : "text";
}

export function stripLocalPath<T extends { localPath?: string }>(
  attachment: T,
): Omit<T, "localPath"> {
  const { localPath: _localPath, ...metadata } = attachment;
  return metadata;
}

export function metadataOnly(
  attachments: Array<AttachmentMetadata & { localPath?: string }>,
): AttachmentMetadata[] {
  return attachments.map((attachment) => stripLocalPath(attachment));
}
