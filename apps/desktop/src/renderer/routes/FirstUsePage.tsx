import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppState } from "../context/AppStateContext";

export function FirstUsePage() {
  const navigate = useNavigate();
  const { createWorkspace } = useAppState();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="flex h-screen w-screen items-center justify-center bg-bg px-4 text-fg">
      <form
        className="w-full max-w-sm"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await createWorkspace(name);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          navigate(`/workspace/${result.workspace.id}`);
        }}
      >
        <h1 className="text-app-22 font-semibold text-fg">Create your first Workspace</h1>
        <label
          className="mt-6 block text-app-12 font-medium text-muted"
          htmlFor="first-workspace-name"
        >
          Workspace name
        </label>
        <input
          id="first-workspace-name"
          name="workspaceName"
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          className="mt-1.5 w-full rounded-md border border-border-strong bg-surface px-3 py-2.5 text-app-14 outline-none focus-visible:ring-2 focus-visible:ring-fg/25"
        />
        {error && <p className="mt-2 text-app-12 text-danger">{error}</p>}
        <button
          type="submit"
          className="mt-4 min-h-9 w-full rounded-md bg-fg px-3 text-app-13 font-medium text-bg hover:opacity-90"
        >
          Create Workspace
        </button>
      </form>
    </main>
  );
}
