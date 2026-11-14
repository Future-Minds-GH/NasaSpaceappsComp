// Entry point: global styles, the hash router (works on GitHub Pages with no server rewrites) and the app.
import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import "./styles/tokens.css";
import "./styles/layout.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
