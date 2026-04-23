import { Route, Routes } from "react-router-dom";

import { AgentsPage } from "./routes/AgentsPage";
import { HomePage } from "./routes/HomePage";
import { RuntimesPage } from "./routes/RuntimesPage";
import { SettingsPage } from "./routes/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<HomePage />} path="/" />
      <Route element={<AgentsPage />} path="/agents" />
      <Route element={<RuntimesPage />} path="/runtimes" />
      <Route element={<SettingsPage />} path="/settings" />
      <Route element={<HomePage />} path="*" />
    </Routes>
  );
}
