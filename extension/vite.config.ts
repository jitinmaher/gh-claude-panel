import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

/**
 * After CRX writes the manifest, widen every web_accessible_resources
 * `matches` to include `https://*\/*`. CRX auto-adds an entry for the
 * dynamic-import chunks (pr-context, selectors, etc.) scoped to the
 * static content_scripts matches — but we need those chunks loadable
 * from any GHE host the user grants at runtime, not just github.com.
 * Security is enforced by the runtime chrome.permissions grant, not by
 * the WAR pattern.
 *
 * We use `writeBundle` (not `generateBundle`) because CRX writes the
 * manifest in its own writeBundle hook AFTER generateBundle finishes,
 * so we have to mutate the file on disk rather than the in-memory bundle.
 */
function widenWebAccessibleResources(): Plugin {
  return {
    name: "pat-widen-war",
    apply: "build",
    enforce: "post",
    async writeBundle(opts) {
      const { readFile, writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const outDir = opts.dir ?? "dist";
      const manifestPath = join(outDir, "manifest.json");
      let raw: string;
      try {
        raw = await readFile(manifestPath, "utf8");
      } catch {
        return; // no manifest yet — CRX will write one on next pass
      }
      const parsed = JSON.parse(raw) as {
        web_accessible_resources?: { matches?: string[] }[];
      };
      if (!Array.isArray(parsed.web_accessible_resources)) return;
      let mutated = false;
      for (const entry of parsed.web_accessible_resources) {
        if (Array.isArray(entry.matches) && !entry.matches.includes("https://*/*")) {
          entry.matches = ["https://*/*"];
          mutated = true;
        }
      }
      if (mutated) {
        await writeFile(manifestPath, JSON.stringify(parsed, null, 2));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), crx({ manifest }), widenWebAccessibleResources()],
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5174 },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: "src/panel/index.html",
        options: "src/options/index.html",
      },
    },
  },
});
