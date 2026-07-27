import type {
  AppStateSnapshot,
  WorkspaceSnapshot,
} from "../../src/shared/workspacePersistence";

export async function reconcileAttachmentsAfterValidStateLoad(input: {
  appState: AppStateSnapshot | null;
  workspace: WorkspaceSnapshot | null;
  deleteOrphanedAttachments: (referencedStorageKeys: Set<string>) => Promise<string[]>;
}): Promise<string[]> {
  if (!input.appState || !input.workspace) return [];

  const referencedStorageKeys = new Set<string>();
  const collect = (attachments: Array<{ storageKey: string }> | undefined) => {
    attachments?.forEach((attachment) => referencedStorageKeys.add(attachment.storageKey));
  };

  input.appState.threadMessages?.forEach((message) => collect(message.attachments));
  input.appState.threadDrafts?.forEach((draft) => collect(draft.attachments));
  input.appState.threadPromotionIntents?.forEach((intent) => collect(intent.attachments));

  input.workspace.messages.forEach((message) => {
    if (message.type !== "changed_files") collect(message.attachments);
  });
  Object.values(input.workspace.threadWork ?? {}).forEach((work) => {
    collect(work.draft?.attachments);
    work.queuedMessages.forEach((message) => collect(message.attachments));
  });

  try {
    return await input.deleteOrphanedAttachments(referencedStorageKeys);
  } catch {
    return [];
  }
}
