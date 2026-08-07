import type { SkillRecord } from "../../src/shared/skills";
import { listInstalledSkills } from "./skillCatalog";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<SkillRecord[]> | SkillRecord[],
  ) => void;
}

export interface SkillIpcServices {
  list: (projectDir?: string) => Promise<SkillRecord[]>;
}

export function registerSkillIpc(
  ipcMainLike: IpcMainLike,
  services: SkillIpcServices = {
    list: (projectDir) => listInstalledSkills({ projectDir }),
  },
) {
  ipcMainLike.handle("skills:list", async (_event, value) => {
    const projectDir = typeof value === "string" && value.trim() ? value : undefined;
    return services.list(projectDir);
  });
}
