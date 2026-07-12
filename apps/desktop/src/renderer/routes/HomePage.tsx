export function HomePage() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-4">
      <img src="/logo.png" alt="Carrent" className="h-12 w-12 rounded-xl" />
      <h2 className="mt-4 text-center text-app-15 font-medium text-muted">
        Select a thread to start
      </h2>
      <p className="mt-1.5 text-center text-app-13 text-subtle">
        Choose a project from the sidebar to begin chatting
      </p>
    </div>
  );
}
