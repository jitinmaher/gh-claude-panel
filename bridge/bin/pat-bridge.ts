#!/usr/bin/env node
import { startServer } from "../src/server.js";
import { loadOrCreateToken, tokenPath } from "../src/auth.js";

const PORT = Number(
  process.env.PAT_BRIDGE_PORT ?? process.env.GH_CLAUDE_BRIDGE_PORT ?? 7321,
);
const HOST =
  process.env.PAT_BRIDGE_HOST ?? process.env.GH_CLAUDE_BRIDGE_HOST ?? "127.0.0.1";

async function main() {
  const { token, created } = await loadOrCreateToken();

  console.log("=== Pat Before I Merge — local bridge ===");
  console.log(`Token file: ${tokenPath()}`);
  if (created) {
    console.log("(new token generated on first run)");
  }
  console.log(`Token:      ${token}`);
  console.log("");
  console.log("Paste this token into the extension's options page,");
  console.log("then pick a 'Local' backend in the side panel.");
  console.log("");

  startServer({ port: PORT, host: HOST, token });
}

main().catch((err) => {
  console.error("[bridge] fatal:", err);
  process.exit(1);
});
