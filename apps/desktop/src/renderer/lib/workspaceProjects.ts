import type {
  AppProjectRecord,
  WorkspaceProjectAssociationRecord,
} from "../../shared/workspacePersistence";

export function getWorkspaceProjects(
  projects: AppProjectRecord[],
  associations: WorkspaceProjectAssociationRecord[],
  workspaceId: string | null | undefined,
) {
  return associations
    .filter((association) => association.workspaceId === workspaceId)
    .sort((left, right) => left.order - right.order)
    .flatMap((association) => {
      const project = projects.find((item) => item.id === association.projectId);
      return project ? [{ project, association }] : [];
    });
}
