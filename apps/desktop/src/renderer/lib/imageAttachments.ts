import type { ImageAttachmentMetadata } from "../../shared/chat";

export {
  MAX_ATTACHMENT_COUNT,
  MAX_SINGLE_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  isSupportedImageMimeType,
  validateImageAttachments,
  extensionForMimeType,
} from "../../shared/imageAttachment";

export type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  metadata?: ImageAttachmentMetadata;
};

export function pendingAttachmentFromFile(
  file: File,
  metadata?: ImageAttachmentMetadata,
): PendingAttachment {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    metadata,
  };
}

export function stripLocalPath<T extends { localPath?: string }>(
  attachment: T,
): Omit<T, "localPath"> {
  const { localPath: _localPath, ...metadata } = attachment;
  return metadata;
}

export function metadataOnly(
  attachments: Array<ImageAttachmentMetadata & { localPath?: string }>,
): ImageAttachmentMetadata[] {
  return attachments.map((attachment) => stripLocalPath(attachment));
}
