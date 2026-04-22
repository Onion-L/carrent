import { Route, Routes } from "react-router-dom";

import { HomePage } from "./routes/HomePage";

export default function App() {
  return (
    <Routes>
      <Route element={<HomePage />} path="/" />
      <Route element={<HomePage />} path="*" />
    </Routes>
  );
}
