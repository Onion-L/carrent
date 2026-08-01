// Opens a Thread in a new peer Carrent Window, with the failure handling that
// issue 05 requires: a BrowserWindow creation failure leaves all existing
// windows unchanged and surfaces a non-blocking error in the source window.

const MAX_THREAD_ROUTE_LENGTH = 4096;
export const WINDOW_CREATION_SMOKE_FAILURE_ENV = "CARRENT_SMOKE_FAIL_WINDOW_CREATION";

export function consumeWindowCreationSmokeFailure(env: NodeJS.ProcessEnv): boolean {
  if (env[WINDOW_CREATION_SMOKE_FAILURE_ENV] !== "1") return false;
  delete env[WINDOW_CREATION_SMOKE_FAILURE_ENV];
  return true;
}

type SourceWindow = {
  isDestroyed: () => boolean;
  reportOpenError: (message: string) => void;
};

export type OpenThreadWindowOptions = {
  route: unknown;
  source: SourceWindow | null;
  create: (route: string) => void;
};

export function openThreadInNewWindow({ route, source, create }: OpenThreadWindowOptions) {
  if (typeof route !== "string" || route.length === 0 || route.length > MAX_THREAD_ROUTE_LENGTH) {
    throw new Error("Invalid Thread route.");
  }
  try {
    create(route);
  } catch (error) {
    // BrowserWindow creation failure leaves all existing windows unchanged and
    // shows a non-blocking error in the source window.
    if (source && !source.isDestroyed()) {
      source.reportOpenError(error instanceof Error ? error.message : String(error));
    }
  }
}
