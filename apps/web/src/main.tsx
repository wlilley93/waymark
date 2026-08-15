import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./screens/App.js";
import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
