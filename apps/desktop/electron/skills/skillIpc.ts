import type { SkillRecord } from "../../src/shared/skills";
import { listInstalledSkills } from "./skillCatalog";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<SkillRecord[]> | SkillRecord[],
  ) => void;
}

export interface SkillIpcServices {
  list: () => Promise<SkillRecord[]>;
}

export function registerSkillIpc(
  ipcMainLike: IpcMainLike,
  services: SkillIpcServices = {
    list: () => listInstalledSkills(),
  },
) {
  ipcMainLike.handle("skills:list", async () => services.list());
}
