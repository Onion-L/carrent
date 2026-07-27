type BeforeQuitEvent = {
  preventDefault: () => void;
};

type LiveRunQuitPolicy = {
  hasLiveRuns: () => boolean;
  confirmQuitWithLiveRuns: () => Promise<boolean>;
  cancelLiveRuns: () => Promise<void>;
};

type AppShutdownDependencies = {
  quit: () => void;
  reportShutdownError?: (error: unknown) => void;
  beforeSave?: () => Promise<void>;
  liveRunQuitPolicy?: LiveRunQuitPolicy;
};

export function createAppShutdown({
  quit,
  reportShutdownError,
  beforeSave,
  liveRunQuitPolicy,
}: AppShutdownDependencies) {
  let isQuitting = false;
  let allowQuit = false;

  return {
    isQuitting: () => allowQuit,
    async beforeQuit(event: BeforeQuitEvent): Promise<void> {
      if (allowQuit) return;

      if (isQuitting) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      isQuitting = true;

      try {
        const activeLiveRunQuitPolicy = liveRunQuitPolicy?.hasLiveRuns() ? liveRunQuitPolicy : null;
        if (activeLiveRunQuitPolicy && !(await activeLiveRunQuitPolicy.confirmQuitWithLiveRuns())) {
          isQuitting = false;
          return;
        }

        await activeLiveRunQuitPolicy?.cancelLiveRuns();
        await beforeSave?.();
      } catch (error) {
        isQuitting = false;
        reportShutdownError?.(error);
        return;
      }

      allowQuit = true;
      quit();
    },
  };
}
