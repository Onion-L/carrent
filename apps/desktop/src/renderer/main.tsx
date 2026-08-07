import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

import "katex/dist/katex.min.css";
import "@carrent/ui/tokens.css";
import "@carrent/ui/globals.css";
import "../styles/index.css";

import App from "./App";
import { BrowserWindowApp } from "./components/browser/BrowserWindowApp";

const isBrowserWindow = new URLSearchParams(window.location.search).get("browserWindow") === "1";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isBrowserWindow ? (
      <BrowserWindowApp />
    ) : (
      <HashRouter>
        <App />
      </HashRouter>
    )}
  </React.StrictMode>,
);
