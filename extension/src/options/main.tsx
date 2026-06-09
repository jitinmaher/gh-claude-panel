import React from "react";
import { createRoot } from "react-dom/client";
import { OptionsPage } from "./OptionsPage";

// The options page opens in its own tab, so we can't sync to GitHub's
// theme. But we can still respect the OS color scheme via the default
// `data-host-theme` attribute below.
const prefersDark =
  window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.setAttribute("data-host-theme", prefersDark ? "dark" : "light");

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <React.StrictMode>
    <OptionsPage />
  </React.StrictMode>,
);
