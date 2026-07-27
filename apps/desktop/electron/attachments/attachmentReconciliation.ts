import type { AppStateSnapshot } from "../../src/shared/workspacePersistence";

export async function reconcileAttachmentsAfterValidStateLoad(input: {
  appState: AppStateSnapshot | null;
  deleteOrphanedAttachments: (referencedStorageKeys: Set<string>) => Promise<string[]>;
}): Promise<string[]> {
  if (!input.appState) return [];

  const referencedStorageKeys = new Set<string>();
  const collect = (attachments: Array<{ storageKey: string }> | undefined) => {
    attachments?.forEach((attachment) => referencedStorageKeys.add(attachment.storageKey));
  };

  input.appState.threadMessages?.forEach((message) => collect(message.attachments));
  input.appState.threadDrafts?.forEach((draft) => collect(draft.attachments));
  input.appState.threadPromotionIntents?.forEach((intent) => collect(intent.attachments));
  Object.values(input.appState.threadWork ?? {}).forEach((work) => {
    collect(work.draft?.attachments);
    work.queuedMessages.forEach((message) => collect(message.attachments));
  });

  try {
    return await input.deleteOrphanedAttachments(referencedStorageKeys);
  } catch {
    return [];
  }
}
