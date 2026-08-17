import { isAppRendererUrl } from "./appRendererUrl";

type PermissionWebContents = {
  getURL?: () => string;
};

export type FontPermissionSession = {
  setPermissionCheckHandler: (
    handler: (
      webContents: PermissionWebContents | null,
      permission: string,
      requestingOrigin: string,
    ) => boolean,
  ) => void;
};

export function installLocalFontPermissionHandler(session: FontPermissionSession): void {
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission !== "local-fonts") return false;
    return (
      isAppRendererUrl(requestingOrigin) ||
      (webContents?.getURL ? isAppRendererUrl(webContents.getURL()) : false)
    );
  });
}
