/// <reference types="vite/client" />

declare global {
  interface Window {
    carrent: {
      platform: NodeJS.Platform;
      electronVersion: string;
    };
  }
}

export {};
