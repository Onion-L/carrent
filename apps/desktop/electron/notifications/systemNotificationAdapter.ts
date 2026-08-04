// Thin adapter around Electron's Notification so the run notification
// coordinator can be tested without the host notification center. It requests
// the operating system's default notification behavior (default sound,
// permission/delivery/Do-Not-Disturb handled by the OS) and exposes only what
// the coordinator needs: support detection, show, click, and close. It never
// surfaces custom sound, volume, or permission controls.

import { Notification } from "electron";
import type {
  SystemNotificationAdapter,
  SystemNotificationContent,
} from "./runNotificationCoordinator";

export function createElectronNotificationAdapter(): SystemNotificationAdapter {
  return {
    isSupported: () => Notification.isSupported(),
    show(content: SystemNotificationContent) {
      if (!Notification.isSupported()) return null;
      try {
        const notification = new Notification({
          title: content.title,
          body: content.body,
          // The default sound; no custom audio or volume.
          silent: false,
        });
        notification.show();
        return {
          close: () => {
            try {
              notification.close();
            } catch {
              // Closing a notification the OS already dismissed is harmless.
            }
          },
          onClick: (handler: () => void) => {
            notification.on("click", () => handler());
          },
        };
      } catch {
        // Construction or delivery failure is a silent no-op: it does not raise
        // a Renderer toast or alter Run state.
        return null;
      }
    },
  };
}
